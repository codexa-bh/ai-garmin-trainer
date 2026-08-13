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
    expect(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'garmin_athlete_baseline'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'garmin_raw_payload'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'garmin_body_metrics'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'garmin_body_weight_history'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      db
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'training_plan'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      (
        db.prepare("pragma table_info(conversation)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    ).toContain("manual_title");
    db.close();
  });

  it("rebuilds athlete baselines without obsolete threshold and VO2 columns", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table app_metadata (key text primary key, value text not null, updated_at integer not null);
      insert into app_metadata (key, value, updated_at) values ('schema_version', '5', 1);
      create table garmin_athlete_baseline (
        id text primary key default 'default',
        fetched_at integer not null,
        source text not null,
        availability text not null,
        running_lactate_threshold_heart_rate_bpm integer,
        cycling_lactate_threshold_heart_rate_bpm integer,
        rowing_lactate_threshold_heart_rate_bpm integer,
        configured_max_heart_rate_bpm integer,
        heart_rate_zones_status text,
        heart_rate_zones_formula text,
        heart_rate_zones_json text not null default '[]',
        cycling_ftp_watts integer,
        cycling_ftp_measured_on text,
        cycling_ftp_source_stale integer,
        vo2_max_running real,
        vo2_max_cycling real,
        available_training_days_json text not null default '[]',
        preferred_long_training_days_json text not null default '[]'
      );
      create table garmin_athlete_baseline_attempt (id text primary key default 'default', attempted_at integer not null, completed_at integer, status text not null, error_message text, preserved_previous integer not null default 0);
      create table conversation (id text primary key, title text not null, created_at integer not null, updated_at integer not null);
      insert into garmin_athlete_baseline (id, fetched_at, source, availability, running_lactate_threshold_heart_rate_bpm, cycling_lactate_threshold_heart_rate_bpm, rowing_lactate_threshold_heart_rate_bpm, configured_max_heart_rate_bpm, heart_rate_zones_status, heart_rate_zones_formula, heart_rate_zones_json, cycling_ftp_watts, cycling_ftp_measured_on, cycling_ftp_source_stale, vo2_max_running, vo2_max_cycling, available_training_days_json, preferred_long_training_days_json)
        values ('default', 1784707200000, 'garmin_mcp', 'partial', 168, 170, 166, 190, 'derived_from_garmin_max_hr', '50/60/70/80/90% of Garmin FIT zones_target max_heart_rate', '[{"zone":1,"label":"Zone 1","lowerBpm":95,"upperBpm":113}]', 250, '2026-07-19', 0, 52.1, 48.5, '["monday","wednesday"]', '["sunday"]');
      insert into garmin_athlete_baseline_attempt (id, attempted_at, completed_at, status, error_message, preserved_previous) values ('default', 1784707200000, 1784707200000, 'partial', null, 0);
    `);

    const result = migrateDatabase(db);
    expect(result.applied).toContain("6:prune_athlete_baseline_fields");
    const columns = db
      .prepare("pragma table_info(garmin_athlete_baseline)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "fetched_at",
      "source",
      "availability",
      "configured_max_heart_rate_bpm",
      "heart_rate_zones_status",
      "heart_rate_zones_formula",
      "heart_rate_zones_json",
      "cycling_ftp_watts",
      "cycling_ftp_measured_on",
      "cycling_ftp_source_stale",
      "available_training_days_json",
      "preferred_long_training_days_json",
    ]);
    expect(
      db
        .prepare(
          "select configured_max_heart_rate_bpm as maxHr, cycling_ftp_watts as ftp, available_training_days_json as days from garmin_athlete_baseline",
        )
        .get(),
    ).toEqual({ maxHr: 190, ftp: 250, days: '["monday","wednesday"]' });
    expect(
      db.prepare("select status from garmin_athlete_baseline_attempt").get(),
    ).toEqual({ status: "partial" });
    db.close();
  });

  it("adds Training Plan storage without mutating existing local data", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table app_metadata (key text primary key, value text not null, updated_at integer not null);
      insert into app_metadata (key, value, updated_at) values ('schema_version', '10', 1);
      create table conversation (id text primary key, title text not null, manual_title integer not null default 0, created_at integer not null, updated_at integer not null);
      insert into conversation (id, title, manual_title, created_at, updated_at) values ('default', 'Existing chat', 0, 1, 1);
    `);

    const result = migrateDatabase(db);

    expect(result.applied).toContain("11:training_plan_singleton");
    expect(
      db.prepare("select title from conversation where id = 'default'").get(),
    ).toEqual({ title: "Existing chat" });
    expect(
      db.prepare("select count(*) as count from training_plan").get(),
    ).toEqual({ count: 0 });
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
