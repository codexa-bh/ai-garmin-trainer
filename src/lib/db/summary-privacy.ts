import { getDatabase } from "./connection";
import type { SummarySource, SummaryCandidate } from "../memory/summary-policy";

/** Existing suppression namespace, with stable original identity across edits.
 * No generation/control increment: new-input exclusion cannot erase prior state. */
export function summarySourceRestricted(
  sourceId: string,
  messageId: string,
): boolean {
  if (!getDatabase().prepare("select 1 from summary_suppression limit 1").get())
    return false;
  return Boolean(
    getDatabase()
      .prepare(
        `select 1 from summary_suppression where source_id in (?,?)
    union all select 1 from summary_rebuild r,json_each(r.selection_json) j join summary_suppression s
    on s.source_id=json_extract(j.value,'$.sourceId') or s.source_id='original-assistant:'||json_extract(j.value,'$.contextHash')
    where (json_extract(j.value,'$.messageId')=? or json_extract(j.value,'$.contextId')=? or json_extract(j.value,'$.contextUserMessageId')=?)
    and not exists(select 1 from summary_suppression n where n.source_id='original-message:'||json_extract(j.value,'$.messageId')) limit 1`,
      )
      .get(
        sourceId,
        `original-message:${messageId}`,
        messageId,
        messageId,
        messageId,
      ),
  );
}
/** Called only by the current writer transaction, after all validation/staging.
 * Successful staged privacy remains durable even if a later rebuild chunk fails. */
export function restrictSummaryInputs(
  sources: SummarySource[],
  candidate: SummaryCandidate,
): void {
  const insert = getDatabase().prepare(
    "insert or ignore into summary_suppression(source_id) values(?)",
  );
  for (const [index, disposition] of candidate.dispositions.entries()) {
    if (disposition.reason !== "privacy-excluded") continue;
    const source = sources[index];
    const messageId = source.identity?.messageId ?? source.original?.messageId;
    if (!messageId) throw new Error("summary_source_identity_unavailable");
    insert.run(source.sourceId);
    insert.run(`original-message:${messageId}`);
  }
}
