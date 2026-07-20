import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import {
  currentSchemaVersion,
  databaseHasUserData,
  LATEST_SCHEMA_VERSION,
  migrateDatabase,
  runIntegrityCheck,
} from "../src/lib/db/migrations";
import { getOptionalEnv } from "../src/lib/env";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupPathFor(dbPath: string): string {
  const dir = join(dirname(dbPath), "backups");
  mkdirSync(dir, { recursive: true });
  return join(dir, `trainer-schema-backup-${timestamp()}.sqlite`);
}

function needsBackup(db: Database.Database, dbPath: string): boolean {
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) return false;
  return (
    currentSchemaVersion(db) < LATEST_SCHEMA_VERSION || databaseHasUserData(db)
  );
}

const env = getOptionalEnv();
mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
const db = new Database(env.DATABASE_PATH);
const beforeVersion = currentSchemaVersion(db);
let backupPath: string | null = null;

if (needsBackup(db, env.DATABASE_PATH)) {
  const integrity = runIntegrityCheck(db);
  if (integrity !== "ok") {
    throw new Error(
      `Refusing migration because pre-upgrade SQLite integrity check failed: ${integrity}`,
    );
  }
  backupPath = backupPathFor(env.DATABASE_PATH);
  copyFileSync(env.DATABASE_PATH, backupPath);
}

const result = migrateDatabase(db);
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      databasePath: env.DATABASE_PATH,
      schemaVersionBefore: beforeVersion,
      schemaVersionAfter: result.toVersion,
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      applied: result.applied,
      backupPath,
      integrity: result.integrity,
      rollback: backupPath
        ? "Stop the app and restore this SQLite backup manually if upgrade validation fails; automatic downgrade is not supported."
        : "No pre-existing user data backup was needed for this migration run.",
    },
    null,
    2,
  ),
);
