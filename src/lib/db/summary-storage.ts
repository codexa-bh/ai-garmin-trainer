import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "./connection";
import { readSummaryImportBatch, publishSummaryImport } from "./summary-import";
import {
  readSummaryRebuildBatch,
  stageSummaryRebuild,
  interruptSummaryRebuild,
} from "./summary-rebuild";
import {
  characters,
  scalarText,
  summaryCap,
  emptySummary,
  validSummaryValue,
  validSummaryDiagnostic,
  summaryPolicyIdentity,
  summaryModelAvailable,
  summaryPriceBasis,
  SUMMARY_PATCH_REJECTIONS,
  SUMMARY_DEBOUNCE_MS,
  SUMMARY_PRICE_BASIS,
  type SummaryBatch,
  type SummarySource,
  type SummaryStatus,
  type SummaryStorage,
  type SummaryValue,
  type ManualPreference,
  type SummaryVersion,
} from "../memory/summary-policy";

type State = {
  format_version: number;
  revision: number;
  frontier: number;
  payload: string;
  checksum: string;
  privacy_generation: number;
  published_at: number | null;
};
type Control = {
  enabled: number;
  configured_enabled: number;
  model: string;
  cap: number;
  generation: number;
  manual_revision: number;
  cutoff: number;
  job_id: string | null;
  lease_until: number;
  pending_since: number | null;
  last_started: number;
  retry_at: number;
  failures: number;
  reason: string | null;
  day: string;
};
const EMPTY = JSON.stringify(emptySummary());
function state(): State {
  return getDatabase()
    .prepare("select * from summary_state where id=1")
    .get() as State;
}
function control(): Control {
  return getDatabase()
    .prepare("select * from summary_control where id=1")
    .get() as Control;
}
function hash(
  row: Pick<State, "revision" | "frontier" | "privacy_generation" | "payload">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.revision,
        row.frontier,
        row.privacy_generation,
        row.payload,
      ]),
    )
    .digest("hex");
}
function currentValue(row: State, cap: number): SummaryValue {
  summaryCap(cap); // Configuration validity is independent of generated text size.
  if (row.format_version !== 2) throw new Error("summary_unknown_version");
  const checkpoint = (
    getDatabase()
      .prepare(
        "select coalesce(max(event_seq),0) as n from summary_disposition",
      )
      .get() as { n: number }
  ).n;
  const privacy = (
    getDatabase()
      .prepare(
        "select privacy_generation as n from conversation_history_control where id=1",
      )
      .get() as { n: number }
  ).n;
  if (
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    !Number.isSafeInteger(row.frontier) ||
    row.frontier < 0 ||
    row.frontier !== checkpoint ||
    row.privacy_generation !== privacy
  )
    throw new Error("summary_corrupt");
  if (!row.checksum && row.payload === EMPTY) return emptySummary();
  if (row.checksum !== hash(row) || row.payload.length > 1024 * 1024)
    throw new Error("summary_corrupt");
  try {
    const value: unknown = JSON.parse(row.payload);
    if (validSummaryValue(value)) return value;
  } catch {
    /* Parsing failures must never echo private stored text in status. */
  }
  throw new Error("summary_corrupt");
}
function sources(frontier: number, upper?: number): SummarySource[] {
  const c = control();
  const rows = getDatabase()
    .prepare(
      `with batch as (
        select e.event_seq as eventSeq,t.turn_id as turnId,t.admission_seq as admissionSeq,t.source_version as version,t.user_id,t.conversation_id,
        case when t.summary_eligible=1 and t.status='completed' and t.admission_seq>? and not exists(select 1 from summary_suppression s where s.source_id=t.turn_id||':'||t.source_version) then 1 else 0 end as eligible
        from conversation_completion e join conversation_turn t on t.turn_id=e.turn_id
        where e.event_seq>? and e.event_seq<=? order by e.event_seq limit 20
      )
      select b.eventSeq,b.turnId,b.admissionSeq,b.version,b.eligible,
        case when b.eligible=1 then u.content else null end as user,
        case when b.eligible=1 then case when lower(u.content) like '%option%' or lower(u.content) like '%approach%' or lower(u.content) like '%choice%' or lower(u.content) like '%remember that%' or lower(u.content) like '%use that%' or lower(u.content) like '%choose that%' then
          (select m.content from conversation_turn p join message m on m.id=p.assistant_id where p.conversation_id=b.conversation_id and p.admission_seq<b.admissionSeq and p.status='completed' order by p.admission_seq desc limit 1) else null end else null end as referent
      from batch b left join message u on u.id=b.user_id order by b.eventSeq`,
    )
    .all(c.cutoff, frontier, upper ?? Number.MAX_SAFE_INTEGER) as Array<
    Omit<SummarySource, "eligible"> & { turnId: string; eligible: number }
  >;
  return rows.map((row) => ({
    eventSeq: row.eventSeq,
    sourceId: `${row.turnId}:${row.version}`,
    admissionSeq: row.admissionSeq,
    version: row.version,
    eligible: Boolean(row.eligible),
    user: row.eligible ? row.user : null,
    referent: row.eligible ? row.referent : null,
  }));
}
function pending(frontier: number): number {
  return (
    getDatabase()
      .prepare(
        "select count(*) as n from conversation_completion where event_seq>?",
      )
      .get(frontier) as { n: number }
  ).n;
}
function sameSources(batch: SummaryBatch): boolean {
  try {
    const current = batch.rebuild
      ? readSummaryRebuildBatch(batch.rebuild)?.sources.slice(
          0,
          batch.sources.length,
        )
      : batch.import
        ? readSummaryImportBatch(batch.import)?.sources.slice(
            0,
            batch.sources.length,
          )
        : sources(batch.frontier, batch.upper);
    return JSON.stringify(current) === JSON.stringify(batch.sources);
  } catch {
    return false;
  }
}
function current(batch: SummaryBatch, now: number): boolean {
  const c = control(),
    s = state();
  try {
    currentValue(s, c.cap);
  } catch {
    return false;
  }
  return (
    c.enabled === 1 &&
    c.job_id === batch.jobId &&
    c.lease_until > now &&
    c.generation === batch.controlGeneration &&
    c.manual_revision === batch.manualRevision &&
    s.privacy_generation === batch.privacyGeneration &&
    s.revision === batch.revision &&
    s.frontier === batch.frontier &&
    sameSources(batch)
  );
}
function spend(now: number) {
  const c = control();
  const date = new Date(now);
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const day = today > c.day ? today : c.day;
  return {
    day,
    ...((getDatabase()
      .prepare(
        "select attempts,reserved_usd as usd from summary_spend where day=?",
      )
      .get(day) as { attempts: number; usd: number } | undefined) ?? {
      attempts: 0,
      usd: 0,
    }),
  };
}

function summaryCostObservations(day: string) {
  // Aggregate in SQLite rather than materializing an ever-growing attempt log
  // on every passive status read. Malformed/partial historical usage stays unknown.
  return getDatabase()
    .prepare(
      `with counters as (
    select reserved_usd,spend_day,price_basis,
      case when json_valid(usage_json) then json_extract(usage_json,'$.input') end as input,
      case when json_valid(usage_json) then json_extract(usage_json,'$.output') end as output,
      case when json_valid(usage_json) then json_type(usage_json,'$.input') end as inputKind,
      case when json_valid(usage_json) then json_type(usage_json,'$.output') end as outputKind
    from summary_attempt where reserved=1
  ), observations as (
    select *,coalesce(inputKind='integer' and input between 0 and 9007199254740991
      and outputKind='integer' and output between 0 and 9007199254740991,0) as known from counters
  ) select
    coalesce(sum(case when known and price_basis=? and spend_day=? then (input*0.1+output*0.5)/1000000 else 0 end),0) as estimatedUsdToday,
    coalesce(sum(case when not known or price_basis is not ? then coalesce(reserved_usd,0) else 0 end),0) as unknownReservedUsd,
    coalesce(sum(case when not known or price_basis is not ? then 1 else 0 end),0) as unpricedAttempts
  from observations`,
    )
    .get(
      SUMMARY_PRICE_BASIS,
      day,
      SUMMARY_PRICE_BASIS,
      SUMMARY_PRICE_BASIS,
    ) as {
    estimatedUsdToday: number;
    unknownReservedUsd: number;
    unpricedAttempts: number;
  };
}

function assertVersion(expected: SummaryVersion): void {
  if (JSON.stringify(expected) !== JSON.stringify(summaryStorage.version()))
    throw new Error("summary_stale_action");
}
function writeValue(value: SummaryValue, now: number): void {
  const s = state();
  const next = {
    ...s,
    revision: s.revision + 1,
    payload: JSON.stringify(value),
  };
  // Match the existing serialized read envelope, independently of the target.
  if (next.payload.length > 1024 * 1024)
    throw new Error("summary_input_capacity");
  getDatabase()
    .prepare(
      "update summary_state set revision=?,payload=?,checksum=?,published_at=? where id=1",
    )
    .run(next.revision, next.payload, hash(next), now);
}
function invalidateManualJobs(now: number): void {
  getDatabase()
    .prepare(
      "update summary_control set manual_revision=manual_revision+1,job_id=null,lease_until=0,reason=null where id=1",
    )
    .run();
  getDatabase()
    .prepare(
      "update summary_attempt set outcome='superseded',finished_at=? where outcome='admitted'",
    )
    .run(now);
}
function preferences(): ManualPreference[] {
  const rows = getDatabase()
    .prepare("select id,text from summary_preference order by id")
    .all() as ManualPreference[];
  if (
    rows.some(
      (row) =>
        typeof row.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) ||
        typeof row.text !== "string" ||
        !row.text.trim() ||
        scalarText(row.text) !== row.text,
    )
  )
    throw new Error("summary_preferences_corrupt");
  return rows;
}

// Completion notification only records pending age; no provider or timer in SQL.
export function noteSummaryActivity(now: number): void {
  getDatabase()
    .prepare(
      "update summary_control set pending_since=coalesce(pending_since,?) where id=1 and enabled=1",
    )
    .run(now);
}

export const summaryStorage: SummaryStorage = {
  inspect() {
    return currentValue(state(), control().cap);
  },
  version() {
    const s = state(),
      c = control();
    currentValue(s, c.cap);
    return {
      revision: s.revision,
      privacy: s.privacy_generation,
      control: c.generation,
      manual: c.manual_revision,
    };
  },
  preferences,
  editSummary(expected, text, now) {
    getDatabase().transaction(() => {
      assertVersion(expected);
      const value: SummaryValue = { version: 2, text: scalarText(text) };
      if (!validSummaryValue(value)) throw new Error("summary_invalid_text");
      invalidateManualJobs(now);
      writeValue(value, now);
    })();
  },
  edit(expected, id, text, now) {
    getDatabase().transaction(() => {
      assertVersion(expected);
      const current = preferences();
      if (id !== null && !current.some((row) => row.id === id))
        throw new Error("summary_preference_unavailable");
      text = scalarText(text).trim();
      if (!text) throw new Error("summary_invalid_preference");
      getDatabase()
        .prepare(
          "insert into summary_preference(id,text) values(?,?) on conflict(id) do update set text=excluded.text",
        )
        .run(id ?? `manual_${randomUUID()}`, text);
      invalidateManualJobs(now);
      writeValue(currentValue(state(), control().cap), now);
    })();
  },
  forget(expected, id, now) {
    getDatabase().transaction(() => {
      assertVersion(expected);
      if (!preferences().some((row) => row.id === id))
        throw new Error("summary_preference_unavailable");
      getDatabase()
        .prepare("delete from summary_preference where id=?")
        .run(id);
      invalidateManualJobs(now);
      writeValue(currentValue(state(), control().cap), now);
    })();
  },
  revision() {
    const c = control(),
      s = state();
    if (
      !c.enabled ||
      !summaryModelAvailable(c.model) ||
      (s.published_at === null && preferences().length === 0)
    )
      return null;
    const value = summaryStorage.read();
    return {
      value,
      preferences: preferences(),
      stamp: {
        version: 1,
        revision: s.revision,
        privacyGeneration: s.privacy_generation,
        controlGeneration: c.generation,
        manualRevision: c.manual_revision,
        validUntil: null,
      },
    };
  },
  isGenerationCurrent(stamp) {
    const c = control(),
      s = state();
    try {
      currentValue(s, c.cap);
    } catch {
      return false;
    }
    // Ordinary publication is intentionally NOT an invalidation. A future pin
    // owner retains/seals its own immutable revision; this checks authority only.
    return (
      stamp.version === 1 &&
      c.enabled === 1 &&
      summaryModelAvailable(c.model) &&
      (stamp.validUntil === null || stamp.validUntil > Date.now()) &&
      s.privacy_generation === stamp.privacyGeneration &&
      c.generation === stamp.controlGeneration &&
      c.manual_revision === stamp.manualRevision
    );
  },
  configure(enabled, model, cap) {
    summaryCap(cap);
    const db = getDatabase();
    db.transaction(() => {
      const c = control();
      currentValue(state(), c.cap); // Never reset corrupt/newer state through configuration.
      if (
        c.configured_enabled === Number(enabled) &&
        c.model === model &&
        c.cap === cap
      )
        return;
      // A smaller drafting target preserves the complete valid publication.
      // Configuration generation still invalidates old in-flight authority.
      db.prepare(
        "update summary_control set enabled=?,configured_enabled=?,model=?,cap=?,generation=generation+1,job_id=null,lease_until=0 where id=1",
      ).run(Number(enabled), Number(enabled), model, cap);
      db.prepare(
        "update summary_attempt set outcome='interrupted' where outcome='admitted'",
      ).run();
    })();
  },
  read() {
    const c = control();
    if (!c.enabled || !summaryModelAvailable(c.model)) return emptySummary();
    return currentValue(state(), c.cap);
  },
  status(now) {
    const c = control(),
      s = state(),
      budget = spend(now),
      count = pending(s.frontier);
    let value = emptySummary(),
      reason = c.reason,
      result: SummaryStatus["state"];
    try {
      value = currentValue(s, c.cap);
      result =
        s.published_at === null ? "never-produced" : count ? "stale" : "fresh";
    } catch (error) {
      result = "unavailable";
      reason = error instanceof Error ? error.message : "summary_corrupt";
    }
    if (!c.enabled) result = "disabled";
    else if (!c.model) result = "unselected";
    else if (!summaryModelAvailable(c.model)) {
      result = "unavailable";
      reason = "summary_unsupported_model";
    } else if (reason) result = value.text ? "stale" : "unavailable";
    return {
      version: 1,
      state: result,
      reason,
      revision: s.revision,
      frontier: s.frontier,
      pending: count,
      items: value.text ? 1 : 0,
      characters: characters(value.text),
      cap: c.cap,
      publishedAt: s.published_at,
      enabled: Boolean(c.enabled),
      model: c.model,
      usedByChat: false,
      attemptsToday: budget.attempts,
      reservedUsdToday: budget.usd,
      ...summaryCostObservations(budget.day),
      priceBasis: summaryPriceBasis(c.model),
    };
  },
  admit(now, jobId) {
    const db = getDatabase();
    return db.transaction(() => {
      const c = control(),
        s = state();
      if (!c.enabled || !summaryModelAvailable(c.model) || c.retry_at > now)
        return null;
      const previous = currentValue(s, c.cap);
      if (c.job_id) {
        if (c.lease_until > now) return null;
        // An expired admitted provider effect is uncertain, never blind replay.
        const attempt = db
          .prepare("select reserved from summary_attempt where job_id=?")
          .get(c.job_id) as { reserved: number } | undefined;
        db.prepare(
          "update summary_attempt set outcome='interrupted' where job_id=? and outcome='admitted'",
        ).run(c.job_id);
        interruptSummaryRebuild("summary_interrupted");
        db.prepare(
          "update summary_control set job_id=null,lease_until=0,reason='summary_interrupted',retry_at=? where id=1",
        ).run(attempt?.reserved ? Number.MAX_SAFE_INTEGER : now + 300000);
        return null;
      }
      let rebuilt: ReturnType<typeof readSummaryRebuildBatch> = null;
      try {
        rebuilt = readSummaryRebuildBatch();
      } catch (error) {
        const changed =
          error instanceof Error &&
          error.message === "summary_rebuild_source_changed";
        if (changed) interruptSummaryRebuild("summary_rebuild_source_changed");
        db.prepare("update summary_control set reason=? where id=1").run(
          changed
            ? "summary_rebuild_review_required"
            : "summary_rebuild_unavailable",
        );
        return null;
      }
      let imported: ReturnType<typeof readSummaryImportBatch> = null;
      try {
        imported = rebuilt ? null : readSummaryImportBatch();
      } catch {
        db.prepare(
          "update summary_import set state='review-required' where state='active'",
        ).run();
        db.prepare(
          "update summary_control set reason='summary_import_review_required' where id=1",
        ).run();
        return null;
      }
      const batch =
        rebuilt?.sources ?? imported?.sources ?? sources(s.frontier);
      if (!batch.length) return null;
      const since = c.pending_since ?? now;
      db.prepare("update summary_control set pending_since=? where id=1").run(
        since,
      );
      // The native lifetime coalesces activity; storage independently bounds
      // dispatch even for concurrent explicit catch-up callers or clock rollback.
      if (
        now - c.last_started < SUMMARY_DEBOUNCE_MS ||
        now - since < SUMMARY_DEBOUNCE_MS
      )
        return null;
      db.prepare(
        "update summary_control set job_id=?,lease_until=?,last_started=? where id=1",
      ).run(jobId, now + 30000, now);
      db.prepare(
        "insert into summary_attempt(job_id,started_at,outcome,reserved,policy_identity,source_ids_json,upper_event,prior_revision,privacy_generation,control_generation) values(?,?,'admitted',0,?,?,?,?,?,?)",
      ).run(
        jobId,
        now,
        summaryPolicyIdentity(c.model),
        JSON.stringify(batch.map((source) => source.sourceId)),
        batch.at(-1)?.eventSeq ?? s.frontier,
        s.revision,
        s.privacy_generation,
        c.generation,
      );
      if (imported)
        db.prepare("update summary_attempt set import_id=? where job_id=?").run(
          imported.identity.id,
          jobId,
        );
      return {
        jobId,
        ...(imported ? { import: imported.identity } : {}),
        ...(rebuilt
          ? {
              rebuild: {
                ...rebuilt.identity,
                upperCompletion: rebuilt.upperCompletion,
              },
            }
          : {}),
        revision: s.revision,
        privacyGeneration: s.privacy_generation,
        controlGeneration: c.generation,
        manualRevision: c.manual_revision,
        frontier: s.frontier,
        upper: batch.at(-1)?.eventSeq ?? s.frontier,
        cap: c.cap,
        previous: rebuilt?.previous ?? previous,
        sources: batch,
      };
    })();
  },
  reserve(batch, now) {
    const db = getDatabase();
    return db.transaction(() => {
      // Refuse obsolete callers requesting a secondary effect at runtime too.
      if (arguments.length !== 2 || !current(batch, now)) return false;
      const requestId = batch.jobId;
      const attempt = db
        .prepare("select reserved from summary_attempt where job_id=?")
        .get(requestId) as { reserved: number } | undefined;
      if (!attempt || attempt.reserved) return false;
      const budget = spend(now);
      // Admission history remains durable, but no app-imposed spending or
      // attempt cap/reservation. Historical monetary liabilities stay intact.
      db.prepare(
        "insert into summary_spend(day,attempts,reserved_usd) values(?,1,?) on conflict(day) do update set attempts=attempts+1,reserved_usd=reserved_usd+excluded.reserved_usd",
      ).run(budget.day, 0);
      db.prepare("update summary_control set day=? where id=1").run(budget.day);
      db.prepare(
        "update summary_attempt set reserved=1,reserved_usd=?,spend_day=?,price_basis=? where job_id=?",
      ).run(null, budget.day, summaryPriceBasis(control().model), requestId);
      return true;
    })();
  },
  heartbeat(batch, now) {
    if (!current(batch, now)) return false;
    getDatabase()
      .prepare(
        "update summary_control set lease_until=? where id=1 and job_id=?",
      )
      .run(now + 30000, batch.jobId);
    return true;
  },
  publish(batch, candidate, now) {
    const db = getDatabase();
    return db.transaction(() => {
      const attempt = db
        .prepare("select outcome from summary_attempt where job_id=?")
        .get(batch.jobId) as { outcome: string } | undefined;
      if (attempt?.outcome === "committed" || attempt?.outcome === "staged")
        return true;
      if (
        !current(batch, now) ||
        !validSummaryValue(candidate.value) ||
        candidate.dispositions.length !== batch.sources.length ||
        candidate.dispositions.some(
          (entry, index) =>
            entry.eventSeq !== batch.sources[index]?.eventSeq ||
            entry.sourceId !== batch.sources[index]?.sourceId,
        )
      )
        return false;
      // Preferences are independent: generation cannot rewrite them or count
      // their text toward the generated-summary-only drafting target.
      preferences();
      const value = candidate.value;
      // Refuse before staging/publication rather than creating unreadable state.
      if (JSON.stringify(value).length > 1024 * 1024)
        throw new Error("summary_input_capacity");
      if (batch.rebuild && !stageSummaryRebuild(batch, candidate, now)) {
        db.prepare(
          "update summary_attempt set outcome='staged',finished_at=?,source_ids_json=? where job_id in (?,?) and outcome='admitted'",
        ).run(
          now,
          JSON.stringify(batch.sources.map((source) => source.sourceId)),
          batch.jobId,
          `${batch.jobId}:condense`,
        );
        db.prepare(
          "update summary_control set job_id=null,lease_until=0,retry_at=0,failures=0,reason=null where id=1",
        ).run();
        return true;
      }
      const payload = JSON.stringify(value);
      const next = {
        revision: batch.revision + 1,
        frontier: batch.rebuild
          ? batch.rebuild.upperCompletion
          : batch.import
            ? batch.frontier
            : batch.upper,
        privacy_generation: batch.privacyGeneration,
        payload,
      };
      if (batch.rebuild) {
        // The sealed full-pool inventory also accounted for excluded completions.
        // Advance routine coverage only in the final replacement transaction,
        // never by pretending an excluded event was exported or represented.
        const rows = db
          .prepare(
            "select e.event_seq,t.turn_id||':'||t.source_version as source_id from conversation_completion e join conversation_turn t on t.turn_id=e.turn_id where e.event_seq>? and e.event_seq<=? order by e.event_seq",
          )
          .all(batch.frontier, next.frontier) as {
          event_seq: number;
          source_id: string;
        }[];
        for (const row of rows)
          db.prepare(
            "insert into summary_disposition(event_seq,source_id,reason,revision) values(?,?,?,?)",
          ).run(
            row.event_seq,
            row.source_id,
            "reviewed-by-rebuild",
            next.revision,
          );
      } else if (batch.import)
        publishSummaryImport(batch.import, candidate.dispositions);
      else
        for (const item of candidate.dispositions)
          db.prepare(
            "insert into summary_disposition(event_seq,source_id,reason,revision) values(?,?,?,?)",
          ).run(item.eventSeq, item.sourceId, item.reason, next.revision);
      db.prepare(
        "update summary_state set revision=?,frontier=?,payload=?,checksum=?,published_at=? where id=1",
      ).run(next.revision, next.frontier, payload, hash(next), now);
      db.prepare(
        "update summary_attempt set outcome='committed',finished_at=?,policy_identity=?,upper_event=?,source_ids_json=? where job_id in (?,?) and outcome='admitted'",
      ).run(
        now,
        summaryPolicyIdentity(control().model),
        batch.upper,
        JSON.stringify(batch.sources.map((source) => source.sourceId)),
        batch.jobId,
        `${batch.jobId}:condense`,
      );
      db.prepare(
        "update summary_control set job_id=null,lease_until=0,pending_since=case when exists(select 1 from conversation_completion where event_seq>?) then coalesce(pending_since,?) else null end,retry_at=0,failures=0,reason=null where id=1",
      ).run(next.frontier, now);
      return true;
    })();
  },
  usage(batch, usage, rejection, diagnostic) {
    if (
      (diagnostic !== undefined &&
        (rejection !== "value" || !validSummaryDiagnostic(diagnostic))) ||
      (rejection !== undefined &&
        !SUMMARY_PATCH_REJECTIONS.includes(rejection)) ||
      Object.values(usage).some(
        (value) =>
          value !== null && (!Number.isSafeInteger(value) || value < 0),
      )
    )
      throw new Error("summary_invalid_usage");
    getDatabase()
      .prepare(
        "update summary_attempt set usage_json=? where job_id=? and outcome='admitted' and usage_json is null",
      )
      .run(
        JSON.stringify({
          ...usage,
          ...(rejection ? { rejection } : {}),
          ...(diagnostic ? { diagnostic } : {}),
        }),
        batch.jobId,
      );
  },
  fail(batch, reason, now, retryDelay) {
    const db = getDatabase();
    db.transaction(() => {
      if (batch.rebuild) interruptSummaryRebuild(reason, batch.rebuild.id);
      db.prepare(
        "update summary_attempt set outcome=?,finished_at=? where job_id in (?,?) and outcome='admitted'",
      ).run(reason, now, batch.jobId, `${batch.jobId}:condense`);
      const c = control();
      if (c.job_id !== batch.jobId) return;
      const retryAt =
        retryDelay === undefined
          ? Number.MAX_SAFE_INTEGER
          : now + (c.failures === 0 ? retryDelay : 300000);
      db.prepare(
        "update summary_control set job_id=null,lease_until=0,failures=failures+1,reason=?,retry_at=? where id=1",
      ).run(reason, retryAt);
    })();
  },
  control(action, now) {
    const db = getDatabase();
    db.transaction(() => {
      const c = control();
      currentValue(state(), c.cap);
      if (
        action === "enable" &&
        (!c.configured_enabled || !summaryModelAvailable(c.model))
      )
        throw new Error("summary_not_configured");
      if (action === "retry") {
        db.prepare(
          "update summary_control set reason=null,retry_at=0 where id=1",
        ).run();
        return;
      }
      db.prepare(
        "update summary_control set generation=generation+1,job_id=null,lease_until=0 where id=1",
      ).run();
      if (action === "disable" || action === "enable")
        db.prepare("update summary_control set enabled=? where id=1").run(
          Number(action === "enable"),
        );
      if (action === "clear") {
        db.prepare(
          "update summary_original_boundary set floor=max(floor,(select coalesce(max(rowid),0) from message)),clear_floor=max(clear_floor,(select coalesce(max(rowid),0) from message)) where id=1",
        ).run();
        db.prepare(
          "update summary_control set cutoff=(select coalesce(max(admission_seq),0) from conversation_turn),manual_revision=manual_revision+1,reason=null,retry_at=0 where id=1",
        ).run();
        db.prepare(
          "update summary_state set payload=?,checksum='',revision=revision+1,published_at=null where id=1",
        ).run(EMPTY);
        db.prepare("delete from summary_suppression").run();
        db.prepare("delete from summary_manual").run();
        db.prepare("delete from summary_preference").run();
      }
      db.prepare(
        "update summary_attempt set outcome='interrupted',finished_at=? where outcome='admitted'",
      ).run(now);
    })();
  },
};
