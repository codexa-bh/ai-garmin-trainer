import { copyFileSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  migrateDatabase,
  runIntegrityCheck,
} from "../src/lib/db/migrations";

describe("versioned SQLite migration foundation", () => {
  it("creates an explicit schema version and verifies integrity", () => {
    const db = new Database(":memory:");
    const result = migrateDatabase(db);
    expect(result.toVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(runIntegrityCheck(db)).toBe("ok");
    expect(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'trainer_memory'",
        )
        .get(),
    ).toBeTruthy();
    db.close();
  });

  it("supports backup-before-upgrade restore rehearsal on a disposable fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "trainer-migration-"));
    const dbPath = join(dir, "trainer.sqlite");
    const backupPath = join(dir, "trainer-backup.sqlite");
    const db = new Database(dbPath);
    migrateDatabase(db);
    db.prepare(
      "insert into trainer_profile (id, goals_json, sports_json, preferences_json, constraints_json, updated_at) values ('default', '[\"base\"]', '[]', '{}', '[]', 1)",
    ).run();
    db.close();
    copyFileSync(dbPath, backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(statSync(backupPath).size).toBeGreaterThan(0);

    const upgraded = new Database(dbPath);
    const result = migrateDatabase(upgraded);
    expect(result.integrity).toBe("ok");
    upgraded.close();

    copyFileSync(backupPath, dbPath);
    const restored = new Database(dbPath);
    expect(runIntegrityCheck(restored)).toBe("ok");
    expect(currentSchemaVersion(restored)).toBe(LATEST_SCHEMA_VERSION);
    restored.close();
  });
});
