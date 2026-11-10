import type {
  WeeklyProposal,
  WeeklyRecord,
  WeeklyStore,
  WeeklySummary,
} from "../weekly/contracts";
import { getDatabase } from "./connection";
import type { WeeklyKpis } from "../weekly/kpi-contracts";

type WeeklyDatabase = ReturnType<typeof getDatabase>;
export function createWeeklyStore(
  getDatabase: () => WeeklyDatabase,
): WeeklyStore {
  return {
    transaction: (action) => getDatabase().transaction(action)(),
    read(weekStart) {
      const row = getDatabase()
        .prepare(
          "select document_json from weekly_artifact where week_start = ?",
        )
        .get(weekStart) as { document_json: string } | undefined;
      return row ? (JSON.parse(row.document_json) as WeeklyRecord) : null;
    },
    history(before, limit) {
      const rows = getDatabase()
        .prepare(
          `with weeks as (select week_start from weekly_artifact union select week_start from weekly_kpi)
      select weeks.week_start as weekStart,
      coalesce(json_extract(document_json, '$.timeZone'),json_extract(state_json,'$.timeZone')) as timeZone,
      coalesce(json_extract(state_json, '$.revision'),json_extract(document_json,'$.revision')) as revision,
      (coalesce(json_type(document_json, '$.latest') != 'null',0) or json_extract(state_json,'$.latestId') is not null) as hasPlan,
      (coalesce(json_type(document_json, '$.review') != 'null',0) or coalesce(json_array_length(state_json,'$.assessments'),0)>0) as hasReview,
      json_extract(document_json, '$.review.asOf') as reviewAsOf
      from weeks left join weekly_artifact using(week_start) left join weekly_kpi using(week_start)
      where weeks.week_start < ? order by weeks.week_start desc limit ?`,
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
    readKpis(weekStart) {
      const row = getDatabase()
        .prepare("select state_json from weekly_kpi where week_start=?")
        .get(weekStart) as { state_json: string } | undefined;
      return row ? (JSON.parse(row.state_json) as WeeklyKpis) : null;
    },
    saveKpis(weekStart, state) {
      getDatabase()
        .prepare(
          "insert into weekly_kpi(week_start,state_json) values (?,?) on conflict(week_start) do update set state_json=excluded.state_json",
        )
        .run(weekStart, JSON.stringify(state));
    },
    registerTrack(concept, key, signature) {
      const db = getDatabase();
      const existing = db
        .prepare(
          "select signature from weekly_kpi_track where concept_id=? and track_key=?",
        )
        .get(concept, key) as { signature: string } | undefined;
      if (existing && existing.signature !== signature)
        throw new Error("incompatible_kpi_track_identity");
      db.prepare(
        "insert or ignore into weekly_kpi_track(concept_id,track_key,signature) values (?,?,?)",
      ).run(concept, key, signature);
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
        (turn.previousAssistantId === null
          ? rows[1]?.role !== "assistant"
          : rows[1]?.id === turn.previousAssistantId &&
            rows[1]?.role === "assistant")
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
}
export const weeklyStore = createWeeklyStore(getDatabase);
