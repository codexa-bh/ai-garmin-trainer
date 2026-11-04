import { randomUUID } from "node:crypto";
import { getDatabase } from "./connection";

/** Purpose-specific worst-case admission. Unknown billing is never refunded. */
export function reserveTitleSpend(): string | null {
  const db = getDatabase();
  return db.transaction(() => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const latest = db
      .prepare("select max(day) as day from conversation_title_spend")
      .get() as { day: string | null };
    if (latest.day && day < latest.day) return null;
    const spent = db
      .prepare(
        "select count(*) as attempts,coalesce(sum(reserved_usd),0) as usd from conversation_title_spend where day=?",
      )
      .get(day) as { attempts: number; usd: number };
    // Reviewed Luna: <=2048 input,120 output; USD0.001 exceeds undiscounted
    // standard input/output cost. No explicit cache writes or reasoning allowed.
    if (spent.attempts >= 100 || spent.usd + 0.001 > 0.10000001) return null;
    const id = randomUUID();
    db.prepare(
      "insert into conversation_title_spend(id,day,reserved_usd) values(?,?,0.001)",
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
