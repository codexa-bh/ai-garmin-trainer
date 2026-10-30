import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getOptionalEnv } from "../env";
import { migrateDatabase } from "./migrations";
import { acquireDatabaseWriter } from "./writer-ownership";
import { assertDesktopDatabase } from "./desktop-preflight";

let database: Database.Database | undefined;
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((item) => item.name === column))
    db.exec(`alter table ${table} add column ${ddl}`);
}

function ensureActivityDetailColumns(db: Database.Database): void {
  db.exec(
    `create table if not exists activity_detail_attempt (garmin_id text primary key, attempted_at integer not null, completed_at integer, force integer not null default 0, status text not null, detail_status text, retryable integer not null default 0, error_class text, error_message text, preserved_previous integer not null default 0)`,
  );
  ensureColumn(db, "activity", "name", "name text");
  ensureColumn(db, "activity", "max_heart_rate", "max_heart_rate integer");
  ensureColumn(db, "activity", "steps", "steps integer");
  ensureColumn(
    db,
    "activity",
    "elevation_gain_meters",
    "elevation_gain_meters real",
  );
  ensureColumn(
    db,
    "activity",
    "elevation_loss_meters",
    "elevation_loss_meters real",
  );
}

export function getDatabase(): Database.Database {
  if (database) return database;
  const env = getOptionalEnv();
  if (process.env.TRAINER_DESKTOP === "1")
    assertDesktopDatabase(env.DATABASE_PATH);
  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  const release = acquireDatabaseWriter(env.DATABASE_PATH);
  try {
    database = new Database(env.DATABASE_PATH);
    if (process.env.TRAINER_DESKTOP !== "1") migrateDatabase(database);
    ensureActivityDetailColumns(database);
    return database;
  } catch (error) {
    database?.close();
    database = undefined;
    release();
    throw error;
  }
}
