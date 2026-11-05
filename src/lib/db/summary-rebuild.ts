import { createHash } from "node:crypto";
import { summarySelection } from "../model-settings/summary-selection";
import { getDatabase } from "./connection";
import {
  emptySummary,
  minimizeSummarySource,
  validSummaryValue,
  summaryModelAvailable,
  summaryPriceBasis,
  type SummaryBatch,
  type SummaryCandidate,
  type SummarySource,
  type SummaryValue,
} from "../memory/summary-policy";

import {
  DEFAULT_REBUILD_SELECTION,
  parseRebuildSelection,
  type SummaryRebuildSelection,
} from "../memory/summary-controls";

// Finite operation bounds, not inventory/list limits. Every available row is
// counted; an over-limit selection refuses Start rather than silently clipping.
const MAX_SOURCES = 10000;
const MAX_SCALARS = 2000000;
const MAX_MESSAGE = 16000;
const MAX_SELECTION_JSON = 5000000;
const MAX_OPERATION_MS = 2 * 60 * 60 * 1000;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Authority = {
  revision: number;
  privacy: number;
  control: number;
  manual: number;
  cutoff: number;
  floor: number;
  clearFloor: number;
  model: string;
  cap: number;
  enabled: number;
};
function authority(): Authority {
  return getDatabase()
    .prepare(
      `select s.revision,s.privacy_generation as privacy,
    c.generation as control,c.manual_revision as manual,c.cutoff,b.floor,b.clear_floor as clearFloor,c.model,c.cap,c.enabled
    from summary_state s,summary_control c,summary_original_boundary b where s.id=1 and c.id=1 and b.id=1`,
    )
    .get() as Authority;
}
type Original = {
  rowid: number;
  id: string;
  conversationId: string;
  conversationExists: number;
  role: string;
  content: string;
  length: number;
  createdAt: number;
  turnId: string | null;
  version: number | null;
  admissionSeq: number | null;
  status: string | null;
  eventSeq: number | null;
  contextUserSourceId?: string;
  contextUserMessageId?: string;
};
type Selected = {
  sourceId: string;
  messageId: string;
  conversationId: string;
  hash: string;
  createdAt: number;
  contextId: string | null;
  contextHash: string | null;
  contextUserSourceId: string | null;
  contextUserMessageId: string | null;
};
function originals(after: number): Original[] {
  return getDatabase()
    .prepare(
      `select m.rowid,m.id,m.conversation_id as conversationId,(c.id is not null) as conversationExists,m.role,
    substr(m.content,1,${MAX_MESSAGE + 1}) as content,length(m.content) as length,m.created_at as createdAt,
    t.turn_id as turnId,t.source_version as version,t.admission_seq as admissionSeq,t.status,e.event_seq as eventSeq
    from message m left join conversation c on c.id=m.conversation_id
    left join conversation_turn t on (m.role='user' and t.user_id=m.id) or (m.role='assistant' and t.assistant_id=m.id)
    left join conversation_completion e on e.turn_id=t.turn_id
    where m.rowid>? order by m.rowid limit 250`,
    )
    .all(after) as Original[];
}
function originalHash(row: Original): string {
  return digest([
    row.id,
    row.conversationId,
    row.conversationExists,
    row.role,
    row.content,
    row.length,
    row.createdAt,
    row.turnId,
    row.version,
    row.status,
    row.admissionSeq,
    row.eventSeq,
  ]);
}
function original(id: string): Original | undefined {
  // Same bounded projection used by inventory; no transcript/tool grounding export.
  return getDatabase()
    .prepare(
      `select m.rowid,m.id,m.conversation_id as conversationId,exists(select 1 from conversation c where c.id=m.conversation_id) as conversationExists,m.role,
    substr(m.content,1,${MAX_MESSAGE + 1}) as content,length(m.content) as length,m.created_at as createdAt,
    t.turn_id as turnId,t.source_version as version,t.admission_seq as admissionSeq,t.status,e.event_seq as eventSeq
    from message m left join conversation_turn t on (m.role='user' and t.user_id=m.id) or (m.role='assistant' and t.assistant_id=m.id)
    left join conversation_completion e on e.turn_id=t.turn_id where m.id=?`,
    )
    .get(id) as Original | undefined;
}
function suppressedOriginal(messageId: string, sourceId: string): boolean {
  if (!getDatabase().prepare("select 1 from summary_suppression limit 1").get())
    return false;
  // Original rows have no native version counter. Preserve a forgotten original
  // across timestamp/content edits; only a genuinely new message ID is new
  // authority. Do not lose the relationship by changing its content hash.
  return Boolean(
    getDatabase()
      .prepare(
        `select 1 from summary_suppression where source_id=?
    union all select 1 from summary_rebuild r,json_each(r.selection_json) j join summary_suppression s
    on s.source_id=json_extract(j.value,'$.sourceId')
      or s.source_id='original-assistant:'||json_extract(j.value,'$.contextHash')
    where json_extract(j.value,'$.messageId')=? or json_extract(j.value,'$.contextId')=? or json_extract(j.value,'$.contextUserMessageId')=? limit 1`,
      )
      .get(sourceId, messageId, messageId, messageId),
  );
}
function restricted(
  row: Original,
  a: Authority,
  selection: SummaryRebuildSelection,
): boolean {
  return row.turnId
    ? row.status !== "completed" ||
        row.eventSeq === null ||
        (row.admissionSeq ?? 0) <= a.cutoff
    : row.rowid <= a.clearFloor ||
        (row.rowid <= a.floor && !selection.includeLegacy);
}
function precedingUserId(row: Original): string | undefined {
  const users = getDatabase()
    .prepare(
      "select id,created_at as createdAt from message where conversation_id=? and role='user' and created_at<? order by created_at desc,id limit 2",
    )
    .all(row.conversationId, row.createdAt) as {
    id: string;
    createdAt: number;
  }[];
  // Tied unlinked users do not prove which privacy intent owns the referent.
  return users[0] && users[0].createdAt !== users[1]?.createdAt
    ? users[0].id
    : undefined;
}
function context(
  row: Original,
  a: Authority,
  selection: SummaryRebuildSelection,
): Original | undefined {
  // Equal timestamps are not causal proof; do not choose an arbitrary tied role.
  const candidates = getDatabase()
    .prepare(
      `select id from message where conversation_id=? and created_at<? order by created_at desc,id limit 2`,
    )
    .all(row.conversationId, row.createdAt) as { id: string }[];
  const previous = candidates[0] && original(candidates[0].id);
  const other = candidates[1] && original(candidates[1].id);
  if (
    !previous ||
    previous.role !== "assistant" ||
    previous.length > 1200 ||
    previous.createdAt === other?.createdAt ||
    restricted(previous, a, selection)
  )
    return undefined;
  const originId = previous.turnId
    ? (
        getDatabase()
          .prepare(
            "select user_id as id from conversation_turn where turn_id=?",
          )
          .get(previous.turnId) as { id: string } | undefined
      )?.id
    : precedingUserId(previous);
  const origin = originId ? original(originId) : undefined;
  if (
    !origin ||
    origin.role !== "user" ||
    origin.length > MAX_MESSAGE ||
    restricted(origin, a, selection)
  )
    return undefined;
  const originSourceId = origin.turnId
    ? `${origin.turnId}:${origin.version}`
    : `original:${originalHash(origin)}`;
  if (
    suppressedOriginal(origin.id, originSourceId) ||
    !minimizeSummarySource({
      sourceId: originSourceId,
      eventSeq: 0,
      admissionSeq: 0,
      version: 1,
      eligible: true,
      user: origin.content,
      referent: null,
    })
  )
    return undefined;
  // The common minimizer screens the *whole* assistant passage; ordinary
  // summarization keeps its existing narrow option-referent admission.
  const safe = minimizeSummarySource({
    eventSeq: 0,
    admissionSeq: 0,
    version: 1,
    eligible: true,
    sourceId: "context-screen",
    user: "I choose the first option",
    referent: previous.content,
  });
  const assistantSourceId = `original-assistant:${originalHash(previous)}`;
  if (suppressedOriginal(previous.id, assistantSourceId)) return undefined;
  return safe?.referent
    ? {
        ...previous,
        contextUserSourceId: originSourceId,
        contextUserMessageId: origin.id,
      }
    : undefined;
}
function materialize(row: Original, selected: Selected): SummarySource {
  const preceding = selected.contextId
    ? original(selected.contextId)
    : undefined;
  return {
    sourceId: selected.sourceId,
    eventSeq: row.eventSeq ?? 0,
    admissionSeq: row.admissionSeq ?? 0,
    version: row.version ?? 1,
    eligible: true,
    user: row.content,
    referent: preceding?.content ?? null,
    original: {
      conversationId: row.conversationId,
      messageId: row.id,
      speaker: "user",
      createdAt: row.createdAt,
      hash: selected.hash,
      context: preceding
        ? {
            messageId: preceding.id,
            speaker: "assistant",
            createdAt: preceding.createdAt,
            hash: selected.contextHash!,
            sourceId: `original-assistant:${selected.contextHash!}`,
            userSourceId: selected.contextUserSourceId!,
          }
        : null,
    },
  };
}
export function summaryRebuildInventory(
  configuration = "",
  requested: SummaryRebuildSelection = DEFAULT_REBUILD_SELECTION,
) {
  const db = getDatabase(),
    a = authority();
  const selection = parseRebuildSelection(requested);
  if (!selection) throw new Error("summary_rebuild_selection_invalid");
  const conversations = db
    .prepare("select id,title from conversation order by updated_at desc,id")
    .all() as { id: string; title: string }[];
  if (
    selection.conversationIds?.some(
      (id) => !conversations.some((chat) => chat.id === id),
    )
  )
    throw new Error("summary_rebuild_selection_changed");
  const scope =
    selection.conversationIds === null
      ? null
      : new Set(selection.conversationIds);
  const hash = createHash("sha256").update(
    JSON.stringify([a, configuration, selection, conversations]),
  );
  const counts = {
    chats: 0,
    selectedChats: scope?.size ?? conversations.length,
    legacyUserMessages: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    includedChats: 0,
    excludedChats: 0,
    excludedMessages: 0,
    includedUserMessages: 0,
    assistantContext: 0,
    excludedUserMessages: 0,
  };
  counts.chats = (
    db.prepare("select count(*) as n from conversation").get() as { n: number }
  ).n;
  hash.update(JSON.stringify(counts.chats));
  const includedChats = new Set<string>(),
    contextIds = new Set<string>();
  const reasons: Record<string, number> = {};
  const selected: Selected[] = [];
  const suppressed = new Set(
    (
      db.prepare("select source_id from summary_suppression").all() as {
        source_id: string;
      }[]
    ).map((r) => r.source_id),
  );
  let after = 0,
    scalars = 0;
  for (;;) {
    const page = originals(after);
    if (!page.length) break;
    for (const row of page) {
      after = row.rowid;
      hash.update(originalHash(row));
      counts.messages++;
      if (row.role === "assistant") counts.assistantMessages++;
      if (row.role !== "user") continue;
      counts.userMessages++;
      const sourceId = row.turnId
        ? `${row.turnId}:${row.version}`
        : `original:${originalHash(row)}`;
      let reason: string | null = null;
      if (scope && !scope.has(row.conversationId)) reason = "not-selected";
      else if (!row.conversationExists) reason = "orphan-message";
      else if (suppressed.has(sourceId) || suppressedOriginal(row.id, sourceId))
        reason = "suppressed";
      else if (
        row.turnId &&
        (row.status !== "completed" || row.eventSeq === null)
      )
        reason = "incomplete-linked-turn";
      else if (row.turnId && (row.admissionSeq ?? 0) <= a.cutoff)
        reason = "linked-cutoff";
      else if (!row.turnId && row.rowid <= a.clearFloor) reason = "known-clear";
      else if (!row.turnId && row.rowid <= a.floor && !selection.includeLegacy)
        reason = "unproven-legacy-or-cleared-original";
      else if (!Number.isSafeInteger(row.createdAt) || row.createdAt < 0)
        reason = "unsupported-time";
      else if (row.length > MAX_MESSAGE) reason = "oversized-message";
      const preceding = reason ? undefined : context(row, a, selection);
      const entry: Selected = {
        sourceId,
        messageId: row.id,
        conversationId: row.conversationId,
        hash: originalHash(row),
        createdAt: row.createdAt,
        contextId: preceding?.id ?? null,
        contextHash: preceding ? originalHash(preceding) : null,
        contextUserSourceId: preceding?.contextUserSourceId ?? null,
        contextUserMessageId: preceding?.contextUserMessageId ?? null,
      };
      if (!reason && !minimizeSummarySource(materialize(row, entry)))
        reason = "unsafe-or-unresolved-context";
      hash.update(JSON.stringify([entry, reason]));
      if (reason) {
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        counts.excludedUserMessages++;
        continue;
      }
      counts.includedUserMessages++;
      if (!row.turnId && row.rowid <= a.floor) counts.legacyUserMessages++;
      includedChats.add(row.conversationId);
      if (preceding) contextIds.add(preceding.id);
      scalars += row.length + (preceding?.length ?? 0);
      // Keep memory finite even for huge inventories. Limits are an explicit
      // operation refusal, not a partial selection passed to generation.
      if (selected.length < MAX_SOURCES + 1) selected.push(entry);
    }
  }
  selected.sort((left, right) => {
    return (
      left.createdAt - right.createdAt ||
      left.conversationId.localeCompare(right.conversationId) ||
      left.messageId.localeCompare(right.messageId)
    );
  });
  counts.includedChats = includedChats.size;
  counts.assistantContext = contextIds.size;
  counts.excludedChats = counts.chats - counts.includedChats;
  counts.excludedMessages =
    counts.messages - counts.includedUserMessages - counts.assistantContext;
  const limitExceeded =
    counts.includedUserMessages > MAX_SOURCES ||
    scalars > MAX_SCALARS ||
    JSON.stringify(selected).length > MAX_SELECTION_JSON;
  const selectedModel = summaryModelAvailable(a.model)
    ? summarySelection(a.model)
    : null;
  return {
    snapshot: hash.digest("hex"),
    authority: a,
    selection,
    selected,
    counts,
    reasons,
    scalars,
    limitExceeded,
    preflight: {
      version: 1 as const,
      selection,
      conversations,
      counts,
      reasons,
      complete: true,
      limitExceeded,
      configuredProvider: selectedModel?.provider ?? "unselected",
      model: selectedModel?.modelId ?? "unselected",
      enabled: a.enabled === 1,
      ready:
        a.enabled === 1 &&
        summaryModelAvailable(a.model) &&
        !limitExceeded &&
        selected.length > 0,
      estimatedUsd: {
        low: 0,
        conservativeMaximum: null as number | null,
        priceBasis: summaryPriceBasis(a.model),
        uncertainty:
          "Cost is unknown before generation; no application spending cap or price qualification. Historical reservations, usage and unknown effects are retained.",
      },
      semantics:
        "Complete generated-memory replacement only after validation; manual overlays and originals remain. Next admitted chat turns adopt available valid memory. Exclusion reasons are exclusive user-message categories; assistant context is counted separately and may overlap passages. Unused/duplicate/low-value dispositions are reported after processing, not as admission exclusions.",
    },
  };
}
type Operation = {
  id: string;
  format_version: number;
  boot: string;
  snapshot: string;
  selection_json: string;
  authority_json: string;
  candidate_json: string;
  candidate_checksum: string;
  dispositions_json: string;
  position: number;
  state: string;
  reason: string | null;
  created_at: number;
  deadline: number;
  checksum: string;
};
function seal(row: Operation): string {
  return digest([
    row.format_version,
    row.id,
    row.boot,
    row.snapshot,
    row.selection_json,
    row.authority_json,
    row.dispositions_json,
    row.position,
    row.created_at,
    row.deadline,
  ]);
}
function checked(row: Operation): {
  selected: Selected[];
  candidate: SummaryValue;
  dispositions: SummaryCandidate["dispositions"];
} {
  if (
    ![1, 2].includes(row.format_version) ||
    !["active", "complete", "cancelled", "interrupted", "invalidated"].includes(
      row.state,
    ) ||
    row.checksum !== seal(row) ||
    (row.candidate_checksum !== digest(row.candidate_json) &&
      !(
        row.state !== "active" &&
        row.candidate_checksum === "" &&
        row.candidate_json === JSON.stringify(emptySummary())
      )) ||
    row.selection_json.length > MAX_SELECTION_JSON ||
    row.candidate_json.length > 1048576 ||
    row.dispositions_json.length > 2000000
  )
    throw new Error("summary_rebuild_unavailable");
  const selected = JSON.parse(row.selection_json) as Selected[],
    candidate: unknown = JSON.parse(row.candidate_json),
    dispositions = JSON.parse(
      row.dispositions_json,
    ) as SummaryCandidate["dispositions"];
  const a = JSON.parse(row.authority_json) as Authority & {
    selection?: SummaryRebuildSelection;
  };
  if (row.format_version === 2 && !parseRebuildSelection(a.selection))
    throw new Error("summary_rebuild_unavailable");
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.length > MAX_SOURCES ||
    !Number.isSafeInteger(row.position) ||
    row.position < 0 ||
    row.position > selected.length ||
    !Array.isArray(dispositions) ||
    dispositions.length !== row.position ||
    dispositions.some((d, i) => d.sourceId !== selected[i].sourceId) ||
    !validSummaryValue(candidate, a.cap)
  )
    throw new Error("summary_rebuild_unavailable");
  return { selected, candidate, dispositions };
}
function live(): Operation | undefined {
  return getDatabase()
    .prepare("select * from summary_rebuild where state='active'")
    .get() as Operation | undefined;
}
export function startSummaryRebuild(
  id: string,
  snapshot: string,
  boot: string,
  now: number,
  requested: SummaryRebuildSelection = DEFAULT_REBUILD_SELECTION,
): string {
  const selection = parseRebuildSelection(requested);
  if (!selection) throw new Error("summary_rebuild_selection_invalid");
  const db = getDatabase();
  return db.transaction(() => {
    summaryRebuildStatus(); // Unknown/corrupt saved operation state never grants a fresh Start.
    const prior = db
      .prepare("select * from summary_rebuild where id=?")
      .get(id) as Operation | undefined;
    if (prior) {
      checked(prior);
      const consent =
        prior.format_version === 2
          ? (
              JSON.parse(prior.authority_json) as {
                selection: SummaryRebuildSelection;
              }
            ).selection
          : DEFAULT_REBUILD_SELECTION;
      if (
        prior.snapshot !== snapshot ||
        prior.boot !== boot ||
        JSON.stringify(consent) !== JSON.stringify(selection)
      )
        throw new Error("summary_rebuild_identity_conflict");
      return prior.id; // Same request reconciliation never dispatches another operation.
    }
    if (
      live() ||
      db
        .prepare("select 1 from summary_control where job_id is not null")
        .get() ||
      db
        .prepare(
          "select 1 from summary_import where state in ('active','paused')",
        )
        .get()
    )
      throw new Error("summary_rebuild_busy");
    const inventory = summaryRebuildInventory(boot, selection);
    if (inventory.snapshot !== snapshot)
      throw new Error("summary_rebuild_stale_preflight");
    if (!inventory.preflight.ready || !boot)
      throw new Error("summary_rebuild_not_ready");
    const row: Operation = {
      id,
      format_version: 2,
      boot,
      snapshot,
      selection_json: JSON.stringify(inventory.selected),
      authority_json: JSON.stringify({ ...inventory.authority, selection }),
      candidate_json: JSON.stringify(emptySummary()),
      candidate_checksum: digest(JSON.stringify(emptySummary())),
      dispositions_json: "[]",
      position: 0,
      state: "active",
      reason: null,
      created_at: now,
      deadline: now + MAX_OPERATION_MS,
      checksum: "",
    };
    row.checksum = seal(row);
    db.prepare(
      "insert into summary_rebuild(id,format_version,boot,snapshot,selection_json,authority_json,candidate_json,candidate_checksum,dispositions_json,position,state,reason,created_at,deadline,checksum) values(@id,@format_version,@boot,@snapshot,@selection_json,@authority_json,@candidate_json,@candidate_checksum,@dispositions_json,@position,@state,@reason,@created_at,@deadline,@checksum)",
    ).run(row);
    db.prepare(
      "update summary_control set pending_since=?,reason=null,retry_at=0 where id=1",
    ).run(now - 2001);
    return id;
  })();
}
export function summaryRebuildStatus(boot?: string) {
  const row = getDatabase()
    .prepare("select * from summary_rebuild order by rowid desc limit 1")
    .get() as Operation | undefined;
  if (!row) return null;
  const value = checked(row);
  return {
    id: row.id,
    state:
      row.state === "active" && boot !== undefined && row.boot !== boot
        ? "interrupted"
        : row.state,
    reason: row.reason,
    processed: row.position,
    total: value.selected.length,
    dispositions: value.dispositions.reduce<Record<string, number>>(
      (counts, item) => {
        counts[item.reason] = (counts[item.reason] ?? 0) + 1;
        return counts;
      },
      {},
    ),
    createdAt: row.created_at,
    deadline: row.deadline,
  };
}
export function interruptSummaryRebuild(reason: string, id?: string): void {
  const row = live();
  if (!row || (id !== undefined && id !== row.id)) return;
  checked(row); // Preserve unsupported/corrupt bytes, never scrub them as recovery.
  getDatabase()
    .prepare(
      `update summary_rebuild set state='interrupted',reason=?,candidate_json='{"version":1,"items":[],"text":""}',candidate_checksum='' where state='active' and (? is null or id=?)`,
    )
    .run(reason, id ?? null, id ?? null);
}
export function reconcileSummaryRebuild(boot: string, now: number): void {
  const row = live();
  if (row) checked(row);
  if (row && (row.boot !== boot || row.deadline <= now))
    interruptSummaryRebuild(
      row.boot !== boot
        ? "summary_rebuild_reopened"
        : "summary_rebuild_deadline",
      row.id,
    );
}
export function cancelSummaryRebuild(id: string): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const row = db
      .prepare("select * from summary_rebuild where id=?")
      .get(id) as Operation | undefined;
    if (!row) throw new Error("summary_rebuild_unavailable");
    checked(row);
    if (row.state !== "active") return false;
    db.prepare(
      `update summary_rebuild set state='cancelled',reason='summary_rebuild_cancelled',candidate_json='{"version":1,"items":[],"text":""}',candidate_checksum='' where id=?`,
    ).run(id);
    db.prepare(
      "update summary_attempt set outcome='interrupted' where job_id=(select job_id from summary_control where id=1) and outcome='admitted'",
    ).run();
    db.prepare(
      "update summary_control set job_id=null,lease_until=0 where id=1",
    ).run();
    return true;
  })();
}
export function readSummaryRebuildBatch(expected?: {
  id: string;
  position: number;
}) {
  const row = live();
  if (!row) {
    if (expected) throw new Error("summary_rebuild_not_active");
    return null;
  }
  const { selected, candidate } = checked(row);
  if (
    expected &&
    (expected.id !== row.id || expected.position !== row.position)
  )
    throw new Error("summary_rebuild_conflict");
  const saved = JSON.parse(row.authority_json) as Authority & {
    selection?: SummaryRebuildSelection;
  };
  const { selection: consent = DEFAULT_REBUILD_SELECTION, ...savedAuthority } =
    saved;
  if (
    JSON.stringify(authority()) !== JSON.stringify(savedAuthority) ||
    summaryRebuildInventory(row.boot, consent).snapshot !== row.snapshot
  )
    throw new Error("summary_rebuild_source_changed");
  const batch = selected.slice(row.position, row.position + 20);
  const sources = batch.map((entry) => {
    const current = original(entry.messageId),
      preceding = entry.contextId ? original(entry.contextId) : null;
    if (
      !current ||
      originalHash(current) !== entry.hash ||
      (entry.contextId &&
        (!preceding || originalHash(preceding) !== entry.contextHash))
    )
      throw new Error("summary_rebuild_source_changed");
    return materialize(current, entry);
  });
  return {
    identity: { id: row.id, position: row.position },
    sources,
    previous: candidate,
  };
}
/** Called only inside the existing writer's transaction after lease/CAS and
 * overlay/capacity validation. Returns false for a staged (not published) batch. */
export function stageSummaryRebuild(
  batch: SummaryBatch,
  candidate: SummaryCandidate,
  now: number,
): boolean {
  const db = getDatabase(),
    row = live();
  if (
    !row ||
    !batch.rebuild ||
    row.id !== batch.rebuild.id ||
    row.position !== batch.rebuild.position ||
    row.deadline <= now
  )
    throw new Error("summary_rebuild_conflict");
  const { selected, dispositions } = checked(row);
  readSummaryRebuildBatch(batch.rebuild);
  if (
    !candidate.dispositions.length ||
    candidate.dispositions.some(
      (d, i) => d.sourceId !== selected[row.position + i]?.sourceId,
    )
  )
    throw new Error("summary_rebuild_conflict");
  row.position += candidate.dispositions.length;
  row.candidate_json = JSON.stringify(candidate.value);
  row.candidate_checksum = digest(row.candidate_json);
  row.dispositions_json = JSON.stringify([
    ...dispositions,
    ...candidate.dispositions,
  ]);
  row.checksum = seal(row);
  const complete = row.position === selected.length;
  if (complete) {
    // Once published, the active-summary owner is the sole text owner. Keep
    // bounded progress/provenance/accounting receipts, not historical copies.
    row.candidate_json = JSON.stringify(emptySummary());
    row.candidate_checksum = "";
  }
  db.prepare(
    "update summary_rebuild set candidate_json=?,candidate_checksum=?,dispositions_json=?,position=?,checksum=?,state=? where id=?",
  ).run(
    row.candidate_json,
    row.candidate_checksum,
    row.dispositions_json,
    row.position,
    row.checksum,
    complete ? "complete" : "active",
    row.id,
  );
  return complete;
}
export function rebuildSourceLink(sourceId: string) {
  return getDatabase()
    .prepare(
      `select json_extract(j.value,'$.conversationId') as conversationId,
      case when json_extract(j.value,'$.sourceId')=? then json_extract(j.value,'$.messageId') else json_extract(j.value,'$.contextId') end as messageId
    from summary_rebuild r,json_each(r.selection_json) j where r.state='complete'
      and (json_extract(j.value,'$.sourceId')=? or 'original-assistant:'||json_extract(j.value,'$.contextHash')=?)
    order by r.rowid desc limit 1`,
    )
    .get(sourceId, sourceId, sourceId) as
    { conversationId: string; messageId: string } | undefined;
}
