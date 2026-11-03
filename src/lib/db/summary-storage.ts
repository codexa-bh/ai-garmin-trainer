import { createHash } from "node:crypto";
import { getDatabase } from "./connection";
import {
  characters,
  emptySummary,
  renderSummary,
  validSummaryValue,
  SUMMARY_POLICY,
  type SummaryBatch,
  type SummarySource,
  type SummaryStatus,
  type SummaryStorage,
  type SummaryValue,
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
  if (row.format_version !== 1) throw new Error("summary_unknown_version");
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
  const value: unknown = JSON.parse(row.payload);
  if (!validSummaryValue(value, cap)) throw new Error("summary_corrupt");
  return value;
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
  return (
    JSON.stringify(sources(batch.frontier, batch.upper)) ===
    JSON.stringify(batch.sources)
  );
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

export const summaryStorage: SummaryStorage = {
  revision() {
    const c = control(),
      s = state();
    if (!c.enabled || c.model !== "gpt-6-luna" || s.published_at === null)
      return null;
    const value = summaryStorage.read();
    const expiries = value.items.flatMap((item) =>
      item.expiresAt === null ? [] : [item.expiresAt],
    );
    return {
      value,
      stamp: {
        version: 1,
        revision: s.revision,
        privacyGeneration: s.privacy_generation,
        controlGeneration: c.generation,
        manualRevision: c.manual_revision,
        validUntil: expiries.length ? Math.min(...expiries) : null,
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
      c.model === "gpt-6-luna" &&
      (stamp.validUntil === null || stamp.validUntil > Date.now()) &&
      s.privacy_generation === stamp.privacyGeneration &&
      c.generation === stamp.controlGeneration &&
      c.manual_revision === stamp.manualRevision
    );
  },
  configure(enabled, model, cap) {
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
      // Smaller N cannot silently truncate old text. It requires a fresh bounded revision.
      if (characters(currentValue(state(), c.cap).text) > cap)
        db.prepare(
          "update summary_state set payload=?,checksum='',revision=revision+1,published_at=null where id=1",
        ).run(EMPTY);
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
    if (!c.enabled || c.model !== "gpt-6-luna") return emptySummary();
    const value = currentValue(state(), c.cap);
    const items = value.items.filter(
      (item) => item.expiresAt === null || item.expiresAt > Date.now(),
    );
    return { version: 1, items, text: renderSummary(items) };
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
    else if (c.model !== "gpt-6-luna") {
      result = "unavailable";
      reason = "summary_unsupported_model";
    } else if (reason) result = value.items.length ? "stale" : "unavailable";
    return {
      version: 1,
      state: result,
      reason,
      revision: s.revision,
      frontier: s.frontier,
      pending: count,
      items: value.items.length,
      characters: characters(value.text),
      enabled: Boolean(c.enabled),
      model: c.model,
      usedByChat: false,
      attemptsToday: budget.attempts,
      reservedUsdToday: budget.usd,
    };
  },
  admit(now, jobId) {
    const db = getDatabase();
    return db.transaction(() => {
      const c = control(),
        s = state();
      if (!c.enabled || c.model !== "gpt-6-luna" || c.retry_at > now)
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
        db.prepare(
          "update summary_control set job_id=null,lease_until=0,reason='summary_interrupted',retry_at=? where id=1",
        ).run(attempt?.reserved ? Number.MAX_SAFE_INTEGER : now + 300000);
        return null;
      }
      const batch = sources(s.frontier);
      if (
        !batch.length &&
        !previous.items.some(
          (item) => item.expiresAt !== null && item.expiresAt <= now,
        )
      )
        return null;
      const since = c.pending_since ?? now;
      db.prepare("update summary_control set pending_since=? where id=1").run(
        since,
      );
      const scalars = batch.reduce(
        (sum, source) => sum + (source.user ? characters(source.user) : 0),
        0,
      );
      const eligible = batch.filter((source) => source.eligible).length;
      if (
        now - c.last_started < 30000 ||
        now - since < 10000 ||
        (eligible > 0 && eligible < 4 && scalars < 2000 && now - since < 120000)
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
        SUMMARY_POLICY,
        JSON.stringify(batch.map((source) => source.sourceId)),
        batch.at(-1)?.eventSeq ?? s.frontier,
        s.revision,
        s.privacy_generation,
        c.generation,
      );
      return {
        jobId,
        revision: s.revision,
        privacyGeneration: s.privacy_generation,
        controlGeneration: c.generation,
        manualRevision: c.manual_revision,
        frontier: s.frontier,
        upper: batch.at(-1)?.eventSeq ?? s.frontier,
        cap: c.cap,
        previous,
        sources: batch,
      };
    })();
  },
  reserve(batch, now) {
    const db = getDatabase();
    return db.transaction(() => {
      if (!current(batch, now)) return false;
      const attempt = db
        .prepare("select reserved from summary_attempt where job_id=?")
        .get(batch.jobId) as { reserved: number };
      if (attempt.reserved) return false;
      const budget = spend(now);
      if (budget.attempts >= 10 || budget.usd + 0.01 > 0.10000001) return false;
      db.prepare(
        "insert into summary_spend(day,attempts,reserved_usd) values(?,1,0.01) on conflict(day) do update set attempts=attempts+1,reserved_usd=reserved_usd+0.01",
      ).run(budget.day);
      db.prepare("update summary_control set day=? where id=1").run(budget.day);
      db.prepare("update summary_attempt set reserved=1 where job_id=?").run(
        batch.jobId,
      );
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
      if (attempt?.outcome === "committed") return true;
      if (
        !current(batch, now) ||
        !validSummaryValue(candidate.value, batch.cap) ||
        candidate.dispositions.length !== batch.sources.length ||
        candidate.dispositions.some(
          (entry, index) =>
            entry.eventSeq !== batch.sources[index]?.eventSeq ||
            entry.sourceId !== batch.sources[index]?.sourceId,
        )
      )
        return false;
      const payload = JSON.stringify(candidate.value);
      const next = {
        revision: batch.revision + 1,
        frontier: batch.upper,
        privacy_generation: batch.privacyGeneration,
        payload,
      };
      for (const item of candidate.itemDispositions)
        db.prepare(
          "insert into summary_item_disposition(item_id,revision,reason) values(?,?,?)",
        ).run(item.itemId, next.revision, item.reason);
      for (const item of candidate.dispositions)
        db.prepare(
          "insert into summary_disposition(event_seq,source_id,reason,revision) values(?,?,?,?)",
        ).run(item.eventSeq, item.sourceId, item.reason, next.revision);
      db.prepare(
        "update summary_state set revision=?,frontier=?,payload=?,checksum=?,published_at=? where id=1",
      ).run(next.revision, next.frontier, payload, hash(next), now);
      db.prepare(
        "update summary_attempt set outcome='committed',finished_at=?,policy_identity=?,upper_event=?,source_ids_json=? where job_id=?",
      ).run(
        now,
        SUMMARY_POLICY,
        batch.upper,
        JSON.stringify(batch.sources.map((source) => source.sourceId)),
        batch.jobId,
      );
      db.prepare(
        "update summary_control set job_id=null,lease_until=0,pending_since=null,retry_at=0,failures=0,reason=null,manual_revision=manual_revision+? where id=1",
      ).run(Number(candidate.correction));
      return true;
    })();
  },
  usage(batch, usage) {
    if (
      Object.values(usage).some(
        (value) =>
          value !== null && (!Number.isSafeInteger(value) || value < 0),
      )
    )
      throw new Error("summary_invalid_usage");
    getDatabase()
      .prepare(
        "update summary_attempt set usage_json=? where job_id=? and outcome='admitted'",
      )
      .run(JSON.stringify(usage), batch.jobId);
  },
  fail(batch, reason, now, retryDelay) {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare(
        "update summary_attempt set outcome=?,finished_at=? where job_id=? and outcome='admitted'",
      ).run(reason, now, batch.jobId);
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
        (!c.configured_enabled || c.model !== "gpt-6-luna")
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
          "update summary_control set cutoff=(select coalesce(max(admission_seq),0) from conversation_turn),manual_revision=manual_revision+1,reason=null,retry_at=0 where id=1",
        ).run();
        db.prepare(
          "update summary_state set payload=?,checksum='',revision=revision+1,published_at=null where id=1",
        ).run(EMPTY);
        db.prepare("delete from summary_suppression").run();
      }
      db.prepare(
        "update summary_attempt set outcome='interrupted',finished_at=? where outcome='admitted'",
      ).run(now);
    })();
  },
};
