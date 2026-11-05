import { randomUUID } from "node:crypto";
import { getDatabase } from "./connection";

/** Durable attempt receipt, not a spending/attempt gate. Old liabilities remain. */
export function reserveTitleSpend(): string | null {
  const db = getDatabase();
  return db.transaction(() => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const id = randomUUID();
    db.prepare(
      "insert into conversation_title_spend(id,day,reserved_usd) values(?,?,0)",
    ).run(id, day);
    return id;
  })();
}
export function recordTitleUsage(
  id: string,
  usage: { input: number | null; output: number | null; cached: number | null },
): void {
  if (
    Object.values(usage).some(
      (value) => value !== null && (!Number.isSafeInteger(value) || value < 0),
    )
  )
    throw new Error("title_invalid_usage");
  getDatabase()
    .prepare(
      "update conversation_title_spend set usage_json=? where id=? and usage_json is null",
    )
    .run(JSON.stringify(usage), id);
}
