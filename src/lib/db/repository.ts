import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getOptionalEnv } from "../env";
import { createSchemaSql } from "./migrations";
import type {
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";
import type {
  ActivityDetailAvailability,
  ActivityLapDetail,
  ActivityStreamPoint,
  NormalizedActivityDetail,
} from "../garmin/detail-types";
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

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function upsertActivityDetail(detail: NormalizedActivityDetail): void {
  const db = getDatabase();
  const upsertAvailability = db.prepare(`
    insert into activity_detail_availability (garmin_id, fetched_at, source, status, has_session, has_laps, has_streams, has_gps, has_elevation, has_heart_rate, has_grade, has_power, has_recovery, record_count, lap_count, unavailable_reason, session_json, derived_json)
    values (@garminId, @fetchedAt, @source, @status, @hasSession, @hasLaps, @hasStreams, @hasGps, @hasElevation, @hasHeartRate, @hasGrade, @hasPower, @hasRecovery, @recordCount, @lapCount, @unavailableReason, @sessionJson, @derivedJson)
    on conflict(garmin_id) do update set
      fetched_at=excluded.fetched_at,
      source=excluded.source,
      status=excluded.status,
      has_session=excluded.has_session,
      has_laps=excluded.has_laps,
      has_streams=excluded.has_streams,
      has_gps=excluded.has_gps,
      has_elevation=excluded.has_elevation,
      has_heart_rate=excluded.has_heart_rate,
      has_grade=excluded.has_grade,
      has_power=excluded.has_power,
      has_recovery=excluded.has_recovery,
      record_count=excluded.record_count,
      lap_count=excluded.lap_count,
      unavailable_reason=excluded.unavailable_reason,
      session_json=excluded.session_json,
      derived_json=excluded.derived_json
  `);
  const insertLap = db.prepare(`
    insert into activity_lap (garmin_id, lap_number, start_time, duration_sec, distance_meters, avg_speed_mps, avg_heart_rate, max_heart_rate, elevation_gain_meters, elevation_loss_meters, avg_power_watts, normalized_power_watts)
    values (@garminId, @lapNumber, @startTime, @durationSec, @distanceMeters, @avgSpeedMps, @avgHeartRate, @maxHeartRate, @elevationGainMeters, @elevationLossMeters, @avgPowerWatts, @normalizedPowerWatts)
  `);
  const insertPoint = db.prepare(`
    insert into activity_stream_point (garmin_id, elapsed_sec, timestamp, heart_rate, speed_mps, altitude_meters, grade_pct, lat, lon, cadence, power_watts, temperature_c)
    values (@garminId, @elapsedSec, @timestamp, @heartRate, @speedMps, @altitudeMeters, @gradePct, @lat, @lon, @cadence, @powerWatts, @temperatureC)
  `);
  db.transaction(() => {
    db.prepare("delete from activity_lap where garmin_id = ?").run(
      detail.garminId,
    );
    db.prepare("delete from activity_stream_point where garmin_id = ?").run(
      detail.garminId,
    );
    upsertAvailability.run({
      garminId: detail.garminId,
      fetchedAt: detail.fetchedAt.getTime(),
      source: detail.source,
      status: detail.status,
      hasSession: bool(detail.hasSession),
      hasLaps: bool(detail.hasLaps),
      hasStreams: bool(detail.hasStreams),
      hasGps: bool(detail.hasGps),
      hasElevation: bool(detail.hasElevation),
      hasHeartRate: bool(detail.hasHeartRate),
      hasGrade: bool(detail.hasGrade),
      hasPower: bool(detail.hasPower),
      hasRecovery: bool(detail.hasRecovery),
      recordCount: detail.recordCount,
      lapCount: detail.lapCount,
      unavailableReason: detail.unavailableReason,
      sessionJson: detail.session ? JSON.stringify(detail.session) : null,
      derivedJson: detail.derived ? JSON.stringify(detail.derived) : null,
    });
    for (const lap of detail.laps)
      insertLap.run({ garminId: detail.garminId, ...lap });
    for (const point of detail.stream)
      insertPoint.run({ garminId: detail.garminId, ...point });
  })();
}

export function getActivityByGarminId(
  garminId: string,
): NormalizedActivity | null {
  const row = getDatabase()
    .prepare(
      `select garmin_id as garminId, name, sport, started_at as startedAt, duration_sec as durationSec,
              distance_meters as distanceMeters, calories, avg_heart_rate as avgHeartRate,
              max_heart_rate as maxHeartRate, steps, elevation_gain_meters as elevationGainMeters,
              elevation_loss_meters as elevationLossMeters, training_effect as trainingEffect
       from activity where garmin_id = ?`,
    )
    .get(garminId) as
    (Omit<NormalizedActivity, "startedAt"> & { startedAt: number }) | undefined;
  return row ? { ...row, startedAt: new Date(row.startedAt) } : null;
}

export function listActivityDetailAvailability(
  limit = 25,
): ActivityDetailAvailability[] {
  const rows = getDatabase()
    .prepare(
      `select garmin_id as garminId, fetched_at as fetchedAt, status, has_session as hasSession,
              has_laps as hasLaps, has_streams as hasStreams, has_gps as hasGps,
              has_elevation as hasElevation, has_heart_rate as hasHeartRate, has_grade as hasGrade,
              has_power as hasPower, has_recovery as hasRecovery, record_count as recordCount,
              lap_count as lapCount, unavailable_reason as unavailableReason
       from activity_detail_availability order by fetched_at desc limit ?`,
    )
    .all(limit) as Array<
    ActivityDetailAvailability & { fetchedAt: number | null }
  >;
  return rows.map((row) => ({
    ...row,
    fetchedAt: row.fetchedAt ? new Date(row.fetchedAt) : null,
    hasSession: Boolean(row.hasSession),
    hasLaps: Boolean(row.hasLaps),
    hasStreams: Boolean(row.hasStreams),
    hasGps: Boolean(row.hasGps),
    hasElevation: Boolean(row.hasElevation),
    hasHeartRate: Boolean(row.hasHeartRate),
    hasGrade: Boolean(row.hasGrade),
    hasPower: Boolean(row.hasPower),
    hasRecovery: Boolean(row.hasRecovery),
  }));
}

export function getActivityDetailForAnalytics(garminId: string): {
  activity: NormalizedActivity | null;
  availability: ActivityDetailAvailability | null;
  session: Record<string, unknown> | null;
  derived: Record<string, unknown> | null;
  laps: ActivityLapDetail[];
  stream: ActivityStreamPoint[];
} {
  const db = getDatabase();
  const activity = getActivityByGarminId(garminId);
  const availabilityRow = db
    .prepare(
      `select garmin_id as garminId, fetched_at as fetchedAt, status, has_session as hasSession,
              has_laps as hasLaps, has_streams as hasStreams, has_gps as hasGps,
              has_elevation as hasElevation, has_heart_rate as hasHeartRate, has_grade as hasGrade,
              has_power as hasPower, has_recovery as hasRecovery, record_count as recordCount,
              lap_count as lapCount, unavailable_reason as unavailableReason, session_json as sessionJson,
              derived_json as derivedJson
       from activity_detail_availability where garmin_id = ?`,
    )
    .get(garminId) as
    | (ActivityDetailAvailability & {
        fetchedAt: number | null;
        sessionJson: string | null;
        derivedJson: string | null;
      })
    | undefined;
  const laps = db
    .prepare(
      `select lap_number as lapNumber, start_time as startTime, duration_sec as durationSec,
              distance_meters as distanceMeters, avg_speed_mps as avgSpeedMps,
              avg_heart_rate as avgHeartRate, max_heart_rate as maxHeartRate,
              elevation_gain_meters as elevationGainMeters, elevation_loss_meters as elevationLossMeters,
              avg_power_watts as avgPowerWatts, normalized_power_watts as normalizedPowerWatts
       from activity_lap where garmin_id = ? order by lap_number`,
    )
    .all(garminId) as ActivityLapDetail[];
  const stream = db
    .prepare(
      `select timestamp, elapsed_sec as elapsedSec, heart_rate as heartRate, speed_mps as speedMps,
              altitude_meters as altitudeMeters, grade_pct as gradePct, lat, lon, cadence,
              power_watts as powerWatts, temperature_c as temperatureC
       from activity_stream_point where garmin_id = ? order by elapsed_sec`,
    )
    .all(garminId) as ActivityStreamPoint[];
  return {
    activity,
    availability: availabilityRow
      ? {
          ...availabilityRow,
          fetchedAt: availabilityRow.fetchedAt
            ? new Date(availabilityRow.fetchedAt)
            : null,
          hasSession: Boolean(availabilityRow.hasSession),
          hasLaps: Boolean(availabilityRow.hasLaps),
          hasStreams: Boolean(availabilityRow.hasStreams),
          hasGps: Boolean(availabilityRow.hasGps),
          hasElevation: Boolean(availabilityRow.hasElevation),
          hasHeartRate: Boolean(availabilityRow.hasHeartRate),
          hasGrade: Boolean(availabilityRow.hasGrade),
          hasPower: Boolean(availabilityRow.hasPower),
          hasRecovery: Boolean(availabilityRow.hasRecovery),
        }
      : null,
    session: parseJsonObject(availabilityRow?.sessionJson ?? null),
    derived: parseJsonObject(availabilityRow?.derivedJson ?? null),
    laps,
    stream,
  };
}

export function listActivitiesForComparison(limit = 250): NormalizedActivity[] {
  return listRecentActivities(limit);
}

export function dataCounts(): {
  activities: number;
  healthDays: number;
  detailedActivities: number;
} {
  const activityRow = getDatabase()
    .prepare("select count(*) as count from activity")
    .get() as { count: number };
  const healthRow = getDatabase()
    .prepare("select count(*) as count from daily_health")
    .get() as { count: number };
  const detailRow = getDatabase()
    .prepare(
      "select count(*) as count from activity_detail_availability where status in ('available', 'partial')",
    )
    .get() as { count: number };
  return {
    activities: activityRow.count,
    healthDays: healthRow.count,
    detailedActivities: detailRow.count,
  };
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
    db.prepare("delete from activity_stream_point").run();
    db.prepare("delete from activity_lap").run();
    db.prepare("delete from activity_detail_availability").run();
    db.prepare("delete from activity").run();
    db.prepare("delete from daily_health").run();
    db.prepare("delete from sync_checkpoint").run();
    db.prepare("delete from sync_run").run();
  })();
  return [
    "activity_stream_point",
    "activity_lap",
    "activity_detail_availability",
    "activity",
    "daily_health",
    "sync_checkpoint",
    "sync_run",
  ];
}
