import Database from "better-sqlite3";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  migrateDatabase,
  runIntegrityCheck,
} from "../../src/lib/db/migrations";

// No selected filesystem path is accepted or opened writable. Native exclusively
// writes/publishes these fresh bytes; initialization has no disk WAL to hand off.
export function freshDatabase(input: unknown): Buffer {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    (input as { version?: unknown }).version !== 1
  )
    throw new Error("Unsupported initialization request.");
  const db = new Database(":memory:");
  try {
    migrateDatabase(db);
    if (
      currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION ||
      runIntegrityCheck(db) !== "ok"
    )
      throw new Error("Fresh schema verification failed.");
    const bytes = db.serialize();
    if (bytes.length > 8 * 1024 * 1024)
      throw new Error("Fresh database exceeds initialization bound.");
    return bytes;
  } finally {
    db.close();
  }
}
