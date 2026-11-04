import { randomUUID, createHash } from "node:crypto";
import { getDatabase } from "./connection";
import { appendChatMessage } from "./conversation-repository";
import { safeConversationId } from "../chat/conversation-policy";
import { summaryStorage } from "./summary-storage";
import type { SummaryVersion } from "../memory/summary-policy";
import {
  adoptSummaryPin,
  readSummaryPin,
  publishSummaryProjection,
  summaryAuthority,
} from "./conversation-summary-pin";
import {
  assertVisibleText,
  CONVERSATION_POLICY_ID,
  type ConversationAdmission,
  type ConversationHistoryPorts,
  type ConversationReplay,
  type ConversationSegment,
  type ConversationTurnSource,
} from "../chat/conversation-replay";

let bootId: string | undefined;
function boot(): string {
  return (bootId ??= randomUUID());
}
function publicationHash(
  segment: Pick<
    ConversationSegment,
    | "version"
    | "revision"
    | "privacyGeneration"
    | "coveredThrough"
    | "policyIdentity"
    | "compact"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        segment.version,
        segment.revision,
        segment.privacyGeneration,
        segment.coveredThrough,
        segment.policyIdentity,
        segment.compact,
      ]),
    )
    .digest("hex");
}
function generation(): number {
  return (
    getDatabase()
      .prepare(
        "select privacy_generation as generation from conversation_history_control where id=1",
      )
      .get() as { generation: number }
  ).generation;
}
function assertCurrent(admission: ConversationAdmission): void {
  const row = getDatabase()
    .prepare(
      `select t.status from conversation_turn t join message m on m.id=t.user_id join conversation c on c.id=t.conversation_id
    where t.turn_id=? and t.conversation_id=? and t.admission_seq=? and t.privacy_generation=? and t.status in ('admitted','completed')`,
    )
    .get(
      admission.turnId,
      admission.conversationId,
      admission.sourceAdmissionSeq,
      admission.privacyGeneration,
    );
  if (
    !row ||
    generation() !== admission.privacyGeneration ||
    (admission.summaryAuthority &&
      JSON.stringify(summaryAuthority()) !==
        JSON.stringify(admission.summaryAuthority)) ||
    (admission.summaryPin &&
      JSON.stringify(readSummaryPin(admission.conversationId)) !==
        JSON.stringify(admission.summaryPin))
  )
    throw new Error("conversation_context_invalidated");
}
function read(admission: ConversationAdmission): ConversationReplay {
  const db = getDatabase();
  return db.transaction(() => {
    assertCurrent(admission);
    const row = db
      .prepare(
        `select format_version as version,revision,privacy_generation as privacyGeneration,covered_through as coveredThrough,compact,compact_sha256 as compactHash,compact_characters as compactCharacters,policy_identity as policyIdentity from conversation_segment where conversation_id=?`,
      )
      .get(admission.conversationId) as
      | (Omit<ConversationSegment, "pinnedSummary"> & {
          compactHash: string;
          compactCharacters: number;
        })
      | undefined;
    if (
      !row ||
      row.version !== 1 ||
      row.policyIdentity !== CONVERSATION_POLICY_ID ||
      row.privacyGeneration !== admission.privacyGeneration ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 0 ||
      !Number.isSafeInteger(row.coveredThrough) ||
      row.coveredThrough < 0 ||
      row.compactCharacters !== row.compact.length ||
      row.compact.length > 6000 ||
      (row.coveredThrough === 0
        ? row.compact !== "" || row.compactHash !== ""
        : !row.compact || publicationHash(row) !== row.compactHash)
    )
      throw new Error("conversation_segment_unavailable");
    const rows = db
      .prepare(
        `select t.turn_id as turnId,e.event_seq as eventSeq,t.user_id as userId,t.assistant_id as assistantId,u.content as user,a.content as assistant
      from conversation_completion e join conversation_turn t on t.turn_id=e.turn_id
      join message u on u.id=t.user_id join message a on a.id=t.assistant_id
      where t.conversation_id=? and t.status='completed' and e.event_seq>? order by e.event_seq limit 4097`,
      )
      .iterate(
        admission.conversationId,
        row.coveredThrough,
      ) as IterableIterator<ConversationTurnSource>;
    const turns: ConversationTurnSource[] = [];
    let bytes = 0;
    let overflow = false;
    for (const turn of rows) {
      bytes +=
        Buffer.byteLength(turn.user, "utf8") +
        Buffer.byteLength(turn.assistant, "utf8");
      if (bytes > 512 * 1024 || turns.length >= 4096) {
        overflow = true;
        break;
      }
      turns.push(turn);
    }
    const legacyUnlinked = Boolean(
      db
        .prepare(
          `select 1 from message m where m.conversation_id=? and not exists (select 1 from conversation_turn t where t.user_id=m.id or t.assistant_id=m.id) limit 1`,
        )
        .get(admission.conversationId),
    );
    return {
      admission,
      segment: {
        version: row.version,
        revision: row.revision,
        privacyGeneration: row.privacyGeneration,
        coveredThrough: row.coveredThrough,
        compact: row.compact,
        policyIdentity: row.policyIdentity,
        pinnedSummary: readSummaryPin(admission.conversationId),
      },
      turns,
      overflow,
      legacyUnlinked,
    };
  })();
}

export function invalidateConversationHistory(): void {
  getDatabase()
    .prepare(
      "update conversation_history_control set privacy_generation=privacy_generation+1 where id=1",
    )
    .run();
}

export function assertSummaryRefreshIdle(conversationId: string): void {
  const db = getDatabase();
  if (!db.prepare("select 1 from conversation where id=?").get(conversationId))
    throw new Error("conversation_unavailable");
  if (
    db
      .prepare(
        "select 1 from conversation_turn where conversation_id=? and status='admitted'",
      )
      .get(conversationId)
  )
    throw new Error("conversation_busy_retry_after_current_turn");
}

export function refreshConversationSummary(
  conversationId: string,
  expected: SummaryVersion,
  segmentRevision: number,
): void {
  const db = getDatabase();
  db.transaction(() => {
    if (JSON.stringify(summaryStorage.version()) !== JSON.stringify(expected))
      throw new Error("summary_stale_action");
    assertSummaryRefreshIdle(conversationId);
    const row = db
      .prepare(
        "select format_version as version,revision,privacy_generation as privacyGeneration,covered_through as coveredThrough,compact,compact_sha256 as compactHash,compact_characters as compactCharacters,policy_identity as policyIdentity from conversation_segment where conversation_id=?",
      )
      .get(conversationId) as
      | (Omit<ConversationSegment, "pinnedSummary"> & {
          compactHash: string;
          compactCharacters: number;
        })
      | undefined;
    if (
      row &&
      (row.policyIdentity !== CONVERSATION_POLICY_ID ||
        row.privacyGeneration !== generation() ||
        row.compactCharacters !== row.compact.length ||
        row.compact.length > 6000 ||
        (row.coveredThrough
          ? publicationHash(row) !== row.compactHash
          : row.compact !== "" || row.compactHash !== ""))
    )
      throw new Error("conversation_segment_unavailable");
    if ((row?.revision ?? 0) !== segmentRevision || (row && row.version !== 1))
      throw new Error("summary_stale_action");
    if (!row)
      db.prepare(
        "insert into conversation_segment(conversation_id,privacy_generation,policy_identity,revision) values(?,?,?,1)",
      ).run(conversationId, generation(), CONVERSATION_POLICY_ID);
    else
      db.prepare(
        "update conversation_segment set revision=revision+1,compact_sha256=? where conversation_id=?",
      ).run(
        row.coveredThrough
          ? publicationHash({ ...row, revision: row.revision + 1 })
          : "",
        conversationId,
      );
    adoptSummaryPin(conversationId, true);
  })();
}

/** Synchronous storage owner. Generation never holds this transaction. */
export const conversationHistory: ConversationHistoryPorts = {
  admit(conversationId, userText) {
    assertVisibleText(userText);
    if (!userText.trim()) throw new Error("conversation_text_limit");
    conversationId = safeConversationId(conversationId);
    const db = getDatabase();
    return db.transaction(() => {
      // Native's exclusive DB writer lease establishes a process epoch. After a
      // crash, a different boot cannot leave a permanent busy turn behind.
      db.prepare(
        "update conversation_turn set status='aborted' where conversation_id=? and status='admitted' and boot_id<>?",
      ).run(conversationId, boot());
      if (
        db
          .prepare(
            "select 1 from conversation_turn where conversation_id=? and status='admitted'",
          )
          .get(conversationId)
      )
        throw new Error("conversation_busy_retry_after_current_turn");
      const userRecord = appendChatMessage({
        conversationId,
        role: "user",
        content: userText,
      });
      // Preexisting conversations get a compatible initial boundary; an existing
      // creation-time null is never replaced merely because S has since published.
      adoptSummaryPin(userRecord.conversationId);
      const pin = readSummaryPin(userRecord.conversationId);
      const privacyGeneration = generation();
      const turnId = randomUUID();
      const inserted = db
        .prepare(
          "insert into conversation_turn(turn_id,conversation_id,user_id,status,boot_id,privacy_generation) values(?,?,?,'admitted',?,?)",
        )
        .run(
          turnId,
          userRecord.conversationId,
          userRecord.id,
          boot(),
          privacyGeneration,
        );
      db.prepare(
        "insert into conversation_segment(conversation_id,privacy_generation,policy_identity) values(?,?,?) on conflict(conversation_id) do nothing",
      ).run(
        userRecord.conversationId,
        privacyGeneration,
        CONVERSATION_POLICY_ID,
      );
      return {
        userRecord,
        admission: {
          turnId,
          conversationId: userRecord.conversationId,
          sourceAdmissionSeq: Number(inserted.lastInsertRowid),
          privacyGeneration,
          summaryAuthority: summaryAuthority(),
          summaryPin: pin,
        },
      };
    })();
  },
  read,
  assertCurrent,
  projectSummary(replay, projected) {
    return getDatabase().transaction(() => {
      assertCurrent(replay.admission);
      if (
        !replay.segment.pinnedSummary ||
        !publishSummaryProjection(
          replay.admission.conversationId,
          replay.segment.pinnedSummary,
          projected,
        )
      )
        return false;
      replay.admission.summaryPin = projected;
      return true;
    })();
  },
  complete(admission, answer) {
    assertVisibleText(answer.content);
    const db = getDatabase();
    return db.transaction(() => {
      assertCurrent(admission);
      // Duplicate completion reads the committed record, never adds another event.
      const existing = db
        .prepare(
          "select m.id,m.content,m.grounding_json as grounding,m.created_at as createdAt from conversation_turn t join message m on m.id=t.assistant_id where t.turn_id=? and t.status='completed'",
        )
        .get(admission.turnId) as
        | {
            id: string;
            content: string;
            grounding: string | null;
            createdAt: number;
          }
        | undefined;
      if (existing) {
        if (existing.content !== answer.content)
          throw new Error("conversation_completion_conflict");
        return {
          id: existing.id,
          conversationId: admission.conversationId,
          role: "assistant" as const,
          content: existing.content,
          grounding: existing.grounding
            ? (JSON.parse(existing.grounding) as typeof answer.grounding)
            : null,
          createdAt: new Date(existing.createdAt),
        };
      }
      const assistant = appendChatMessage({
        conversationId: admission.conversationId,
        role: "assistant",
        ...answer,
      });
      db.prepare(
        "update conversation_turn set assistant_id=?,status='completed' where turn_id=?",
      ).run(assistant.id, admission.turnId);
      db.prepare("insert into conversation_completion(turn_id) values(?)").run(
        admission.turnId,
      );
      // The synchronous correction trigger revokes every other admitted turn.
      // Only this already-committed correction receives the new delivery receipt;
      // no await or unrelated mutation can interleave with this transaction.
      admission.summaryAuthority = summaryAuthority();
      admission.summaryPin = readSummaryPin(admission.conversationId);
      // Correction may revoke summary-derived debug content in this transaction.
      // Deliver the actual committed grounding, not its pre-trigger copy.
      const persisted = db
        .prepare("select grounding_json from message where id=?")
        .get(assistant.id) as { grounding_json: string | null };
      return {
        ...assistant,
        grounding: persisted.grounding_json
          ? (JSON.parse(persisted.grounding_json) as typeof answer.grounding)
          : null,
      };
    })();
  },
  abandon(admission) {
    getDatabase()
      .prepare(
        "update conversation_turn set status='aborted' where turn_id=? and status='admitted'",
      )
      .run(admission.turnId);
  },
  reserveCompaction(admission) {
    const db = getDatabase();
    return db.transaction(() => {
      assertCurrent(admission);
      const latest = db
        .prepare("select max(day) as day from conversation_compaction_spend")
        .get() as { day: string | null };
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (latest.day && day < latest.day) return false;
      db.prepare(
        "insert into conversation_compaction_spend(day,attempts,reserved_usd) values(?,0,0) on conflict(day) do nothing",
      ).run(day);
      // Keep the whole worst-case reservation, including abort/unknown billing.
      return (
        db
          .prepare(
            "update conversation_compaction_spend set attempts=attempts+1,reserved_usd=reserved_usd+0.01 where day=? and attempts<10 and reserved_usd<0.099999",
          )
          .run(day).changes === 1
      );
    })();
  },
  publish(replay, covered, compact) {
    if (!covered.length || !compact || compact.length > 6000) return false;
    const db = getDatabase();
    return db.transaction(() => {
      assertCurrent(replay.admission);
      const current = read(replay.admission);
      if (
        current.segment.revision === replay.segment.revision + 1 &&
        current.segment.compact === compact &&
        current.segment.coveredThrough === covered.at(-1)!.eventSeq
      )
        return true;
      if (
        current.segment.revision !== replay.segment.revision ||
        covered.length > current.turns.length - 2 ||
        current.segment.coveredThrough !== replay.segment.coveredThrough ||
        covered.some(
          (turn, index) =>
            JSON.stringify(turn) !== JSON.stringify(current.turns[index]),
        )
      )
        return false;
      const published =
        db
          .prepare(
            `update conversation_segment set revision=revision+1,covered_through=?,compact=?,compact_sha256=?,compact_characters=? where conversation_id=? and revision=? and privacy_generation=?`,
          )
          .run(
            covered.at(-1)!.eventSeq,
            compact,
            publicationHash({
              ...current.segment,
              revision: current.segment.revision + 1,
              coveredThrough: covered.at(-1)!.eventSeq,
              compact,
            }),
            compact.length,
            replay.admission.conversationId,
            replay.segment.revision,
            replay.admission.privacyGeneration,
          ).changes === 1;
      if (published) {
        adoptSummaryPin(replay.admission.conversationId, true);
        replay.admission.summaryPin = readSummaryPin(
          replay.admission.conversationId,
        );
        replay.admission.summaryAuthority = summaryAuthority();
      }
      return published;
    })();
  },
};
