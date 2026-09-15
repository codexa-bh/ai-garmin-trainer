import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../src/lib/db/migrations";
import { getOptionalEnv } from "../src/lib/env";

loadEnvConfig(process.cwd());

function isCurrent(version: number): boolean {
  return version >= LATEST_SCHEMA_VERSION;
}

function readMemoryUserDisabled(db: Database.Database): boolean {
  // An older schema may not have metadata yet; actual read failures must reach
  // the redacted status error boundary rather than silently enabling memory.
  const table = db
    .prepare(
      "select name from sqlite_master where type = 'table' and name = 'app_metadata'",
    )
    .get();
  if (!table) return false;
  const row = db
    .prepare("select value from app_metadata where key = ?")
    .get("memory.user_disabled") as { value?: string } | undefined;
  return row?.value === "true";
}

const json = process.argv.includes("--json");
const env = getOptionalEnv();
const databasePath = resolve(process.cwd(), env.DATABASE_PATH);
const databaseDir = dirname(databasePath);

if (!existsSync(databasePath) || statSync(databasePath).size === 0) {
  const output = {
    ok: true,
    configured: true,
    exists: existsSync(databasePath),
    databaseDirExists: existsSync(databaseDir),
    schemaVersion: 0,
    latestSchemaVersion: LATEST_SCHEMA_VERSION,
    current: false,
    needsMigration: true,
    integrity: "not-created",
    memoryUserDisabled: false,
  };
  console.log(
    json
      ? JSON.stringify(output, null, 2)
      : "SQLite schema is not created; migration is needed.",
  );
  process.exit(0);
}

try {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  const schemaVersion = currentSchemaVersion(db);
  const integrity = runIntegrityCheck(db);
  const output = {
    ok: integrity === "ok",
    configured: true,
    exists: true,
    databaseDirExists: true,
    schemaVersion,
    latestSchemaVersion: LATEST_SCHEMA_VERSION,
    current: isCurrent(schemaVersion),
    needsMigration: !isCurrent(schemaVersion),
    integrity,
    memoryUserDisabled: readMemoryUserDisabled(db),
  };
  db.close();
  console.log(
    json
      ? JSON.stringify(output, null, 2)
      : `SQLite schema ${schemaVersion}/${LATEST_SCHEMA_VERSION}; integrity ${integrity}; ${output.needsMigration ? "migration is needed" : "migration is not needed"}.`,
  );
  process.exit(output.ok ? 0 : 1);
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        configured: true,
        exists: true,
        schemaVersion: 0,
        latestSchemaVersion: LATEST_SCHEMA_VERSION,
        current: false,
        needsMigration: false,
        integrity: "unreadable",
        errorClass: "database.unreadable",
        message: error instanceof Error ? error.message : "unreadable database",
        memoryUserDisabled: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
