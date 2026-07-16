import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getOptionalEnv } from "../env";
import { createSchemaSql } from "./migrations";
import type {
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";

let database: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (database) return database;
  const env = getOptionalEnv();
  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  database = new Database(env.DATABASE_PATH);
  for (const statement of createSchemaSql()) database.exec(statement);
  return database;
}

export function upsertActivities(activities: NormalizedActivity[]): number {
  const db = getDatabase();
  const insert = db.prepare(`
    insert into activity (id, garmin_id, sport, started_at, duration_sec, distance_meters, calories, avg_heart_rate, training_effect, source_updated_at)
    values (@id, @garminId, @sport, @startedAt, @durationSec, @distanceMeters, @calories, @avgHeartRate, @trainingEffect, @sourceUpdatedAt)
    on conflict(garmin_id) do update set
      sport=excluded.sport,
      started_at=excluded.started_at,
      duration_sec=excluded.duration_sec,
      distance_meters=excluded.distance_meters,
      calories=excluded.calories,
      avg_heart_rate=excluded.avg_heart_rate,
      training_effect=excluded.training_effect,
      source_updated_at=excluded.source_updated_at
  `);
  const now = Date.now();
  const run = db.transaction((items: NormalizedActivity[]) => {
    for (const activity of items) {
      insert.run({
        id: `garmin-${activity.garminId}`,
        garminId: activity.garminId,
        sport: activity.sport,
        startedAt: activity.startedAt.getTime(),
        durationSec: activity.durationSec,
        distanceMeters: activity.distanceMeters,
        calories: activity.calories,
        avgHeartRate: activity.avgHeartRate,
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
