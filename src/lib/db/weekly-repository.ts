import type {
  WeeklyProposal,
  WeeklyRecord,
  WeeklyStore,
  WeeklySummary,
} from "../weekly/contracts";
import { getDatabase } from "./connection";

export const weeklyStore: WeeklyStore = {
  transaction: (action) => getDatabase().transaction(action)(),
  read(weekStart) {
    const row = getDatabase()
      .prepare("select document_json from weekly_artifact where week_start = ?")
      .get(weekStart) as { document_json: string } | undefined;
    return row ? (JSON.parse(row.document_json) as WeeklyRecord) : null;
  },
  history(before, limit) {
    const rows = getDatabase()
      .prepare(
        `select week_start as weekStart, json_extract(document_json, '$.timeZone') as timeZone,
      json_extract(document_json, '$.revision') as revision,
      json_type(document_json, '$.latest') != 'null' as hasPlan,
      json_type(document_json, '$.review') != 'null' as hasReview,
      json_extract(document_json, '$.review.asOf') as reviewAsOf
      from weekly_artifact where week_start < ? order by week_start desc limit ?`,
      )
      .all(before, limit) as WeeklySummary[];
    return rows.map((row) => ({
      ...row,
      hasPlan: Boolean(row.hasPlan),
      hasReview: Boolean(row.hasReview),
    }));
  },
  save(record) {
    getDatabase()
      .prepare(
        "insert into weekly_artifact(week_start, document_json) values (?, ?) on conflict(week_start) do update set document_json=excluded.document_json",
      )
      .run(record.weekStart, JSON.stringify(record));
  },
  proposal(id) {
    const row = getDatabase()
      .prepare("select proposal_json from weekly_proposal where id = ?")
      .get(id) as { proposal_json: string } | undefined;
    return row ? (JSON.parse(row.proposal_json) as WeeklyProposal) : null;
  },
  pending(conversationId) {
    const row = getDatabase()
      .prepare(
        "select proposal_json from weekly_proposal where conversation_id = ?",
      )
      .get(conversationId) as { proposal_json: string } | undefined;
    return row ? (JSON.parse(row.proposal_json) as WeeklyProposal) : null;
  },
  saveProposal(proposal) {
    getDatabase()
      .prepare(
        "insert into weekly_proposal(id, conversation_id, proposal_json) values (?, ?, ?) on conflict(id) do update set proposal_json=excluded.proposal_json",
      )
      .run(proposal.id, proposal.conversationId, JSON.stringify(proposal));
  },
  invalidate(conversationId) {
    getDatabase()
      .prepare("delete from weekly_proposal where conversation_id = ?")
      .run(conversationId);
  },
  isCurrentTurn(turn) {
    const rows = getDatabase()
      .prepare(
        "select id, role from message where conversation_id = ? order by created_at desc limit 2",
      )
      .all(turn.conversationId) as { id: string; role: string }[];
    return (
      rows[0]?.id === turn.turnId &&
      rows[0]?.role === "user" &&
      rows[1]?.id === turn.previousAssistantId &&
      rows[1]?.role === "assistant"
    );
  },
  messageExists(id, conversationId) {
    return Boolean(
      getDatabase()
        .prepare(
          "select 1 from message where id=? and conversation_id=? and role='assistant'",
        )
        .get(id, conversationId),
    );
  },
};
