import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getOptionalEnv } from "../env";
import { createSchemaSql } from "./migrations";
import type {
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";
import type { TrainerProfile } from "../ai/context";

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
  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  database = new Database(env.DATABASE_PATH);
  for (const statement of createSchemaSql()) database.exec(statement);
  ensureActivityDetailColumns(database);
  return database;
}

export function upsertActivities(activities: NormalizedActivity[]): number {
  const db = getDatabase();
  const insert = db.prepare(`
    insert into activity (id, garmin_id, name, sport, started_at, duration_sec, distance_meters, calories, avg_heart_rate, max_heart_rate, steps, elevation_gain_meters, elevation_loss_meters, training_effect, source_updated_at)
    values (@id, @garminId, @name, @sport, @startedAt, @durationSec, @distanceMeters, @calories, @avgHeartRate, @maxHeartRate, @steps, @elevationGainMeters, @elevationLossMeters, @trainingEffect, @sourceUpdatedAt)
    on conflict(garmin_id) do update set
      name=excluded.name,
      sport=excluded.sport,
      started_at=excluded.started_at,
      duration_sec=excluded.duration_sec,
      distance_meters=excluded.distance_meters,
      calories=excluded.calories,
      avg_heart_rate=excluded.avg_heart_rate,
      max_heart_rate=excluded.max_heart_rate,
      steps=excluded.steps,
      elevation_gain_meters=excluded.elevation_gain_meters,
      elevation_loss_meters=excluded.elevation_loss_meters,
      training_effect=excluded.training_effect,
      source_updated_at=excluded.source_updated_at
  `);
  const now = Date.now();
  const run = db.transaction((items: NormalizedActivity[]) => {
    for (const activity of items) {
      insert.run({
        id: `garmin-${activity.garminId}`,
        garminId: activity.garminId,
        name: activity.name,
        sport: activity.sport,
        startedAt: activity.startedAt.getTime(),
        durationSec: activity.durationSec,
        distanceMeters: activity.distanceMeters,
        calories: activity.calories,
        avgHeartRate: activity.avgHeartRate,
        maxHeartRate: activity.maxHeartRate,
        steps: activity.steps,
        elevationGainMeters: activity.elevationGainMeters,
        elevationLossMeters: activity.elevationLossMeters,
        trainingEffect: activity.trainingEffect,
        sourceUpdatedAt: now,
      });
    }
  });
  run(activities);
  return activities.length;
}

export function upsertDailyHealth(days: NormalizedDailyHealth[]): number {
  const db = getDatabase();
  const insert = db.prepare(`
    insert into daily_health (date, sleep_minutes, resting_heart_rate, hrv_status, hrv_ms, stress_avg, steps, calories, body_battery_avg, availability)
    values (@date, @sleepMinutes, @restingHeartRate, @hrvStatus, @hrvMs, @stressAvg, @steps, @calories, @bodyBatteryAvg, @availability)
    on conflict(date) do update set
      sleep_minutes=excluded.sleep_minutes,
      resting_heart_rate=excluded.resting_heart_rate,
      hrv_status=excluded.hrv_status,
      hrv_ms=excluded.hrv_ms,
      stress_avg=excluded.stress_avg,
      steps=excluded.steps,
      calories=excluded.calories,
      body_battery_avg=excluded.body_battery_avg,
      availability=excluded.availability
  `);
  const run = getDatabase().transaction((items: NormalizedDailyHealth[]) => {
    for (const day of items) insert.run(day);
  });
  run(days);
  return days.length;
}

export function saveCheckpoint(key: string, value: string): void {
  getDatabase()
    .prepare(
      `insert into sync_checkpoint (key, value, updated_at) values (?, ?, ?)
       on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

export function getCheckpoint(key: string): string | null {
  const row = getDatabase()
    .prepare("select value from sync_checkpoint where key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function recordSyncRun(status: string, lastError?: string): string {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      "insert into sync_run (id, status, started_at, finished_at, last_error) values (?, ?, ?, ?, ?)",
    )
    .run(
      id,
      status,
      Date.now(),
      status === "running" ? null : Date.now(),
      lastError ?? null,
    );
  return id;
}

export function finishSyncRun(
  id: string,
  status: string,
  lastError?: string,
): void {
  getDatabase()
    .prepare(
      "update sync_run set status = ?, finished_at = ?, last_error = ? where id = ?",
    )
    .run(status, Date.now(), lastError ?? null, id);
}

export function listRecentActivities(limit = 12): NormalizedActivity[] {
  const rows = getDatabase()
    .prepare(
      `select garmin_id as garminId, name, sport, started_at as startedAt, duration_sec as durationSec,
              distance_meters as distanceMeters, calories, avg_heart_rate as avgHeartRate,
              max_heart_rate as maxHeartRate, steps, elevation_gain_meters as elevationGainMeters,
              elevation_loss_meters as elevationLossMeters, training_effect as trainingEffect
       from activity order by started_at desc limit ?`,
    )
    .all(limit) as Array<{
    garminId: string;
    name: string | null;
    sport: string;
    startedAt: number;
    durationSec: number | null;
    distanceMeters: number | null;
    calories: number | null;
    avgHeartRate: number | null;
    maxHeartRate: number | null;
    steps: number | null;
    elevationGainMeters: number | null;
    elevationLossMeters: number | null;
    trainingEffect: number | null;
  }>;
  return rows.map((row) => ({ ...row, startedAt: new Date(row.startedAt) }));
}

export function listRecentDailyHealth(limit = 14): NormalizedDailyHealth[] {
  return getDatabase()
    .prepare(
      `select date, sleep_minutes as sleepMinutes, resting_heart_rate as restingHeartRate,
              hrv_status as hrvStatus, hrv_ms as hrvMs, stress_avg as stressAvg,
              steps, calories, body_battery_avg as bodyBatteryAvg, availability
       from daily_health order by date desc limit ?`,
    )
    .all(limit) as NormalizedDailyHealth[];
}

export function dataCounts(): { activities: number; healthDays: number } {
  const activityRow = getDatabase()
    .prepare("select count(*) as count from activity")
    .get() as { count: number };
  const healthRow = getDatabase()
    .prepare("select count(*) as count from daily_health")
    .get() as { count: number };
  return { activities: activityRow.count, healthDays: healthRow.count };
}

export function importSummary(): {
  activities: number;
  healthDays: number;
  latestActivityDate: string | null;
  healthStartDate: string | null;
  healthEndDate: string | null;
} {
  const counts = dataCounts();
  const latestActivity = getDatabase()
    .prepare("select max(started_at) as value from activity")
    .get() as { value: number | null };
  const healthRange = getDatabase()
    .prepare("select min(date) as start, max(date) as end from daily_health")
    .get() as { start: string | null; end: string | null };
  return {
    ...counts,
    latestActivityDate: latestActivity.value
      ? new Date(latestActivity.value).toISOString().slice(0, 10)
      : null,
    healthStartDate: healthRange.start,
    healthEndDate: healthRange.end,
  };
}

export function getTrainerProfile(): TrainerProfile {
  const row = getDatabase()
    .prepare(
      "select goals_json as goalsJson, sports_json as sportsJson, preferences_json as preferencesJson, constraints_json as constraintsJson from trainer_profile where id = 'default'",
    )
    .get() as
    | {
        goalsJson: string;
        sportsJson: string;
        preferencesJson: string;
        constraintsJson: string;
      }
    | undefined;
  if (!row) return { goals: [], sports: [], preferences: {}, constraints: [] };
  return {
    goals: JSON.parse(row.goalsJson) as string[],
    sports: JSON.parse(row.sportsJson) as string[],
    preferences: JSON.parse(row.preferencesJson) as Record<string, string>,
    constraints: JSON.parse(row.constraintsJson) as string[],
  };
}

export function saveTrainerProfile(profile: TrainerProfile): TrainerProfile {
  getDatabase()
    .prepare(
      `insert into trainer_profile (id, goals_json, sports_json, preferences_json, constraints_json, updated_at)
       values ('default', ?, ?, ?, ?, ?)
       on conflict(id) do update set
         goals_json=excluded.goals_json,
         sports_json=excluded.sports_json,
         preferences_json=excluded.preferences_json,
         constraints_json=excluded.constraints_json,
         updated_at=excluded.updated_at`,
    )
    .run(
      JSON.stringify(profile.goals),
      JSON.stringify(profile.sports),
      JSON.stringify(profile.preferences),
      JSON.stringify(profile.constraints),
      Date.now(),
    );
  return getTrainerProfile();
}

export function clearChatAndProfile(): string[] {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("delete from message").run();
    db.prepare("delete from conversation").run();
    db.prepare("delete from trainer_profile").run();
  })();
  return ["messages", "conversations", "trainer_profile"];
}

export function clearGarminData(): string[] {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("delete from activity").run();
    db.prepare("delete from daily_health").run();
    db.prepare("delete from sync_checkpoint").run();
    db.prepare("delete from sync_run").run();
  })();
  return ["activity", "daily_health", "sync_checkpoint", "sync_run"];
}
