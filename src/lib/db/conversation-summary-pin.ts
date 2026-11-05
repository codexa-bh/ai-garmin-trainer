import { createHash } from "node:crypto";
import { getDatabase } from "./connection";
import { summaryStorage } from "./summary-storage";
import {
  validSummaryValue,
  SUMMARY_MODEL_CONTEXT,
} from "../memory/summary-policy";
import type { SummaryPin } from "../chat/summary-pin";

function seal(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}
export function summaryAuthority(): { control: number; manual: number } {
  return getDatabase()
    .prepare(
      "select generation as control,manual_revision as manual from summary_control where id=1",
    )
    .get() as { control: number; manual: number };
}

/** Called only inside the conversation owner's creation/adoption transaction. */
export function adoptSummaryPin(conversationId: string, replace = false): void {
  const db = getDatabase();
  if (
    !replace &&
    db
      .prepare("select 1 from conversation_summary_pin where conversation_id=?")
      .get(conversationId)
  )
    return;
  const existing = db
    .prepare(
      "select format_version,payload,seal from conversation_summary_pin where conversation_id=?",
    )
    .get(conversationId) as
    { format_version: number; payload: string; seal: string } | undefined;
  // Adoption is not authority to repair unsupported/corrupt saved bytes.
  if (
    existing &&
    (existing.format_version !== 1 ||
      (existing.payload !== "null" && seal(existing.payload) !== existing.seal))
  )
    return;
  if (
    existing?.payload !== undefined &&
    existing.payload !== "null" &&
    !readSummaryPin(conversationId)
  ) {
    const current = db
      .prepare(
        "select payload from conversation_summary_pin where conversation_id=?",
      )
      .get(conversationId) as { payload: string };
    if (current.payload !== "null") return;
  }
  let pin: SummaryPin | null = null;
  let reason: string | null = null;
  try {
    const revision = summaryStorage.revision();
    if (revision) pin = { version: 1, ...revision, omitted: 0, tokens: null };
  } catch {
    reason = "summary_unavailable";
  }
  const previous = existing ? readSummaryPin(conversationId) : null;
  if (
    previous &&
    pin &&
    previous.omitted === 0 &&
    JSON.stringify(previous.stamp) === JSON.stringify(pin.stamp) &&
    JSON.stringify(previous.value) === JSON.stringify(pin.value)
  )
    return;
  const payload = JSON.stringify(pin);
  db.prepare(
    `insert into conversation_summary_pin(conversation_id,payload,seal,reason) values(?,?,?,?)
    on conflict(conversation_id) do update set payload=excluded.payload,seal=excluded.seal,reason=excluded.reason`,
  ).run(conversationId, payload, seal(payload), reason);
}

export function readSummaryPin(conversationId: string): SummaryPin | null {
  const db = getDatabase();
  const row = db
    .prepare(
      "select format_version as version,payload,seal from conversation_summary_pin where conversation_id=?",
    )
    .get(conversationId) as
    { version: number; payload: string; seal: string } | undefined;
  if (!row || row.version !== 1 || row.payload.length > 1024 * 1024)
    return null;
  if (row.payload === "null") return null;
  // Corruption preserves bytes and refuses consumption; it is not reset authority.
  if (seal(row.payload) !== row.seal) return null;
  try {
    const pin = JSON.parse(row.payload) as SummaryPin;
    if (
      pin.version !== 1 ||
      !validSummaryValue(pin.value, 20000) ||
      !Number.isSafeInteger(pin.omitted) ||
      pin.omitted < 0 ||
      (pin.tokens !== null &&
        (!Number.isSafeInteger(pin.tokens) ||
          pin.tokens < 0 ||
          pin.tokens > SUMMARY_MODEL_CONTEXT))
    )
      return null;
    if (!summaryStorage.isGenerationCurrent(pin.stamp)) {
      db.prepare(
        "update conversation_summary_pin set payload='null',seal='',reason='invalidated' where conversation_id=? and seal=?",
      ).run(conversationId, row.seal);
      return null;
    }
    return pin;
  } catch {
    return null;
  }
}

export function conversationSummaryStatus(conversationId: string) {
  const db = getDatabase();
  if (!db.prepare("select 1 from conversation where id=?").get(conversationId))
    return null;
  const segment = db
    .prepare(
      "select revision from conversation_segment where conversation_id=?",
    )
    .get(conversationId) as { revision: number } | undefined;
  const pin = readSummaryPin(conversationId);
  const row = db
    .prepare(
      "select reason,format_version,payload from conversation_summary_pin where conversation_id=?",
    )
    .get(conversationId) as
    | { reason: string | null; format_version: number; payload: string }
    | undefined;
  return {
    conversationId,
    segmentRevision: segment?.revision ?? 0,
    pin,
    reason:
      row?.format_version !== undefined && row.format_version !== 1
        ? "unsupported_pin_format"
        : !pin && row?.payload !== undefined && row.payload !== "null"
          ? "pin_corrupt"
          : (row?.reason ?? null),
  };
}

export function publishSummaryProjection(
  conversationId: string,
  before: SummaryPin,
  projected: SummaryPin,
): boolean {
  const current = readSummaryPin(conversationId);
  if (
    !current ||
    JSON.stringify(current) !== JSON.stringify(before) ||
    before.tokens !== null ||
    projected.tokens === null ||
    !Number.isSafeInteger(projected.tokens) ||
    projected.tokens < 0 ||
    projected.tokens > SUMMARY_MODEL_CONTEXT ||
    JSON.stringify(projected.stamp) !== JSON.stringify(before.stamp) ||
    !validSummaryValue(projected.value, 20000) ||
    projected.omitted !==
      before.omitted +
        before.value.items.length -
        projected.value.items.length ||
    projected.value.items.some(
      (item) =>
        !before.value.items.some(
          (original) => JSON.stringify(item) === JSON.stringify(original),
        ),
    )
  )
    return false;
  const payload = JSON.stringify(projected);
  return (
    getDatabase()
      .prepare(
        "update conversation_summary_pin set payload=?,seal=? where conversation_id=? and seal=?",
      )
      .run(payload, seal(payload), conversationId, seal(JSON.stringify(before)))
      .changes === 1
  );
}
