import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LlmDebugTrace } from "@/lib/ai/debug-trace";
import { getOptionalEnv } from "../env";
import { migrateDatabase } from "./migrations";
import { EMPTY_GARMIN_ATHLETE_VALUES } from "../garmin/athlete-normalize";
import { EMPTY_GARMIN_BODY_METRIC_VALUES } from "../garmin/body-metrics-normalize";
import type {
  GarminAthleteBaselineAvailability,
  GarminAthleteBaselineDto,
  GarminAthleteBaselineSnapshot,
  GarminBodyMetricsAvailability,
  GarminBodyMetricsDto,
  GarminBodyMetricsSnapshot,
  HeartRateZoneBoundaryDto,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";
import type { NormalizedActivityHrZoneTime } from "../garmin/activity-hr-zone-time";
import type {
  ActivityDetailAttempt,
  ActivityDetailAttemptStatus,
  ActivityDetailAvailability,
  ActivityDetailCoverage,
  ActivityDetailStatus,
  ActivityLapDetail,
  ActivityStreamPoint,
  NormalizedActivityDetail,
} from "../garmin/detail-types";
import type { TrainerMemory, TrainerProfile } from "../ai/context";
import {
  redactGarminRawPayload,
  type GarminRawContentType,
  type GarminRawSubjectType,
} from "../garmin/raw-payload";
import { dailyHealthAvailability } from "../garmin/normalize";

export type HealthCoverage = {
  totalRows: number;
  completeDays: number;
  partialDays: number;
  missingDays: number;
  metrics: {
    sleepDays: number;
    restingHeartRateDays: number;
    hrvDays: number;
    stressDays: number;
    stepsDays: number;
    calorieDays: number;
    bodyBatteryDays: number;
  };
};

export type SyncRunOptions = {
  coverageStart?: string | null;
  coverageEnd?: string | null;
  lastError?: string | null;
};

export type ActivityDashboardListItem = NormalizedActivity & {
  detailStatus: ActivityDetailStatus | null;
};

export type ActivityDashboardListPage = {
  activities: ActivityDashboardListItem[];
  nextOffset: number | null;
  totalApprox: number;
  limit: number;
  offset: number;
};

export type ActivityDashboardChartPoint = {
  elapsedSec: number;
  heartRate: number | null;
  altitudeMeters: number | null;
  speedKmh: number | null;
};

export type ActivityDashboardSpeedStatus =
  "available" | "missing_speed" | "insufficient_speed";

export type ActivityDashboardSpeedChart = {
  status: ActivityDashboardSpeedStatus;
  sourcePointCount: number;
  pointCount: number;
  message: string;
};

export type ActivityDashboardChartTimeScaleStatus =
  "elapsed" | "timestamp_derived" | "sample_index_limited";

export type ActivityDashboardRoutePoint = {
  elapsedSec: number;
  lat: number;
  lon: number;
  altitudeMeters: number | null;
  gradePct: number | null;
};

export type ActivityDashboardRouteBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  minAltitudeMeters: number | null;
  maxAltitudeMeters: number | null;
};

export type ActivityDashboardRoute = {
  status: "available" | "missing_gps" | "insufficient_points";
  sourcePointCount: number;
  pointCount: number;
  maxPoints: number;
  simplified: boolean;
  bounds: ActivityDashboardRouteBounds | null;
  points: ActivityDashboardRoutePoint[];
  message: string;
};

export type ActivityDashboardHeartRateZoneBucket = {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string | null;
  lowerBpm: number;
  upperBpm: number | null;
  seconds: number;
  percent: number;
};

export type ActivityDashboardHeartRateZoneTime = {
  status:
    | "available"
    | "missing_zones"
    | "missing_heart_rate"
    | "insufficient_stream"
    | "missing_activity_zone_times";
  timeSource: "garmin_activity" | "local_stream" | null;
  zoneSource: "garmin_mcp" | "derived" | null;
  zoneStatus:
    "garmin_configured" | "derived_from_garmin_max_hr" | "unavailable";
  formula: string | null;
  classifiedSeconds: number;
  unclassifiedSeconds: number;
  noHeartRateSeconds: number;
  activityDurationSec: number | null;
  sourceTotalSeconds: number | null;
  buckets: ActivityDashboardHeartRateZoneBucket[];
  message: string;
};

export type ActivityDashboardDetail = {
  activity: NormalizedActivity;
  detail: {
    status: ActivityDetailStatus;
    hasHeartRate: boolean;
    hasElevation: boolean;
    hasLaps: boolean;
    recordCount: number;
    lapCount: number;
    unavailableReason: string | null;
  };
  charts: {
    downsampled: boolean;
    sourcePointCount: number;
    pointCount: number;
    maxPoints: number;
    domainStartSec: number;
    domainEndSec: number | null;
    timeScaleStatus: ActivityDashboardChartTimeScaleStatus;
    timeScaleMessage: string | null;
    speed: ActivityDashboardSpeedChart;
    points: ActivityDashboardChartPoint[];
  };
  route: ActivityDashboardRoute;
  heartRateZones: ActivityDashboardHeartRateZoneTime;
  laps: ActivityLapDetail[];
};

let database: Database.Database | undefined;
let lastChatMessageTimestamp = 0;

function nextChatMessageTimestamp(): number {
  lastChatMessageTimestamp = Math.max(Date.now(), lastChatMessageTimestamp + 1);
  return lastChatMessageTimestamp;
}

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
  mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
  database = new Database(env.DATABASE_PATH);
  migrateDatabase(database);
  ensureActivityDetailColumns(database);
  return database;
}

export function getAppMetadata(key: string): string | null {
  const row = getDatabase()
    .prepare("select value from app_metadata where key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppMetadata(key: string, value: string): void {
  getDatabase()
    .prepare(
      `insert into app_metadata (key, value, updated_at) values (?, ?, ?)
       on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

export const TRAINING_PLAN_STALE_AFTER_DAYS = 14;
export const TRAINING_PLAN_TITLE_MAX_LENGTH = 120;
export const TRAINING_PLAN_CONTENT_MAX_LENGTH = 32000;

export type TrainingPlan = {
  title: string;
  contentMarkdown: string;
  revisedAt: string;
};

export type TrainingPlanStatus = {
  plan: TrainingPlan | null;
  stale: boolean;
  staleAfterDays: number;
};

function normalizeTrainingPlanTitle(title: string | null | undefined): string {
  const compact = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return compact
    ? compact.slice(0, TRAINING_PLAN_TITLE_MAX_LENGTH)
    : "Training Plan";
}

function rowToTrainingPlan(row: {
  title: string;
  content_markdown: string;
  revised_at: number;
}): TrainingPlan {
  return {
    title: row.title,
    contentMarkdown: row.content_markdown,
    revisedAt: new Date(row.revised_at).toISOString(),
  };
}

export function getTrainingPlan(): TrainingPlan | null {
  const row = getDatabase()
    .prepare(
      "select title, content_markdown, revised_at from training_plan where id = 'default'",
    )
    .get() as
    { title: string; content_markdown: string; revised_at: number } | undefined;
  return row ? rowToTrainingPlan(row) : null;
}

export function trainingPlanStatus(now = Date.now()): TrainingPlanStatus {
  const plan = getTrainingPlan();
  if (!plan)
    return {
      plan: null,
      stale: true,
      staleAfterDays: TRAINING_PLAN_STALE_AFTER_DAYS,
    };
  const revisedAt = Date.parse(plan.revisedAt);
  const stale = Number.isFinite(revisedAt)
    ? now - revisedAt > TRAINING_PLAN_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
    : true;
  return { plan, stale, staleAfterDays: TRAINING_PLAN_STALE_AFTER_DAYS };
}

export function replaceTrainingPlan(input: {
  title?: string | null;
  contentMarkdown: string;
  now?: Date;
}): TrainingPlan {
  const contentMarkdown = input.contentMarkdown.trim();
  if (!contentMarkdown) throw new Error("training_plan_content_required");
  if (contentMarkdown.length > TRAINING_PLAN_CONTENT_MAX_LENGTH)
    throw new Error("training_plan_content_too_large");
  const title = normalizeTrainingPlanTitle(input.title);
  const nowMs = (input.now ?? new Date()).getTime();
  getDatabase()
    .prepare(
      `insert into training_plan (id, title, content_markdown, revised_at, updated_at)
       values ('default', ?, ?, ?, ?)
       on conflict(id) do update set title = excluded.title, content_markdown = excluded.content_markdown, revised_at = excluded.revised_at, updated_at = excluded.updated_at`,
    )
    .run(title, contentMarkdown, nowMs, nowMs);
  const saved = getTrainingPlan();
  if (!saved) throw new Error("training_plan_save_failed");
  return saved;
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

function dailyHealthMetricFields(
  day: Omit<NormalizedDailyHealth, "availability">,
): Omit<NormalizedDailyHealth, "date" | "availability"> {
  return {
    sleepMinutes: day.sleepMinutes,
    restingHeartRate: day.restingHeartRate,
    hrvStatus: day.hrvStatus,
    hrvMs: day.hrvMs,
    stressAvg: day.stressAvg,
    steps: day.steps,
    calories: day.calories,
    bodyBatteryAvg: day.bodyBatteryAvg,
  };
}

function mergeDailyHealth(
  previous: NormalizedDailyHealth,
  incoming: NormalizedDailyHealth,
): NormalizedDailyHealth {
  const merged = {
    date: incoming.date,
    sleepMinutes: incoming.sleepMinutes ?? previous.sleepMinutes ?? null,
    restingHeartRate:
      incoming.restingHeartRate ?? previous.restingHeartRate ?? null,
    hrvStatus: incoming.hrvStatus ?? previous.hrvStatus ?? null,
    hrvMs: incoming.hrvMs ?? previous.hrvMs ?? null,
    stressAvg: incoming.stressAvg ?? previous.stressAvg ?? null,
    steps: incoming.steps ?? previous.steps ?? null,
    calories: incoming.calories ?? previous.calories ?? null,
    bodyBatteryAvg: incoming.bodyBatteryAvg ?? previous.bodyBatteryAvg ?? null,
  };
  return {
    ...merged,
    availability: dailyHealthAvailability(dailyHealthMetricFields(merged)),
  };
}

export function upsertDailyHealth(days: NormalizedDailyHealth[]): number {
  const db = getDatabase();
  const byDate = db.prepare(`
    select date, sleep_minutes as sleepMinutes, resting_heart_rate as restingHeartRate,
           hrv_status as hrvStatus, hrv_ms as hrvMs, stress_avg as stressAvg,
           steps, calories, body_battery_avg as bodyBatteryAvg, availability
    from daily_health where date = ?
  `);
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
  const run = db.transaction((items: NormalizedDailyHealth[]) => {
    for (const day of items) {
      const previous = byDate.get(day.date) as
        NormalizedDailyHealth | undefined;
      const merged = previous
        ? mergeDailyHealth(previous, day)
        : {
            ...day,
            availability: dailyHealthAvailability(dailyHealthMetricFields(day)),
          };
      insert.run(merged);
    }
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

export function recordSyncRun(
  status: string,
  optionsOrLastError?: SyncRunOptions | string,
): string {
  const options: SyncRunOptions =
    typeof optionsOrLastError === "string"
      ? { lastError: optionsOrLastError }
      : (optionsOrLastError ?? {});
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `insert into sync_run (id, status, started_at, finished_at, coverage_start, coverage_end, last_error)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      status,
      Date.now(),
      status === "running" ? null : Date.now(),
      options.coverageStart ?? null,
      options.coverageEnd ?? null,
      options.lastError ?? null,
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

type ActivityRow = {
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
};

const activitySelectColumns = `garmin_id as garminId, name, sport, started_at as startedAt, duration_sec as durationSec,
              distance_meters as distanceMeters, calories, avg_heart_rate as avgHeartRate,
              max_heart_rate as maxHeartRate, steps, elevation_gain_meters as elevationGainMeters,
              elevation_loss_meters as elevationLossMeters, training_effect as trainingEffect`;

function normalizeActivityRow<T extends ActivityRow>(
  row: T,
): Omit<T, "startedAt"> & {
  startedAt: Date;
} {
  return { ...row, startedAt: new Date(row.startedAt) };
}

function boundedInteger(
  value: number,
  fallback: number,
  min: number,
  max: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function listRecentActivities(limit = 12): NormalizedActivity[] {
  const rows = getDatabase()
    .prepare(
      `select ${activitySelectColumns}
       from activity order by started_at desc limit ?`,
    )
    .all(limit) as ActivityRow[];
  return rows.map((row) => normalizeActivityRow(row));
}

export function listActivitiesForDashboard(
  options: {
    query?: string | null;
    limit?: number;
    offset?: number;
  } = {},
): ActivityDashboardListPage {
  const safeLimit = boundedInteger(options.limit ?? 100, 100, 1, 100);
  const safeOffset = boundedInteger(options.offset ?? 0, 0, 0, 100000);
  const query = (options.query ?? "").trim().toLocaleLowerCase();
  const db = getDatabase();
  const likeQuery = `%${query}%`;
  const where = query
    ? `where lower(coalesce(a.name, '')) like ?
        or lower(a.sport) like ?
        or lower(a.garmin_id) like ?
        or date(a.started_at / 1000, 'unixepoch') like ?`
    : "";
  const params = query ? [likeQuery, likeQuery, likeQuery, likeQuery] : [];
  const total = db
    .prepare(`select count(*) as count from activity a ${where}`)
    .get(...params) as { count: number };
  const rows = db
    .prepare(
      `select a.${activitySelectColumns.replaceAll(", ", ", a.")}, d.status as detailStatus
       from activity a
       left join activity_detail_availability d on d.garmin_id = a.garmin_id
       ${where}
       order by a.started_at desc
       limit ? offset ?`,
    )
    .all(...params, safeLimit, safeOffset) as Array<
    ActivityRow & { detailStatus: ActivityDetailStatus | null }
  >;
  const nextOffset =
    safeOffset + rows.length < total.count ? safeOffset + rows.length : null;
  return {
    activities: rows.map((row) => normalizeActivityRow(row)),
    nextOffset,
    totalApprox: total.count,
    limit: safeLimit,
    offset: safeOffset,
  };
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

function parseHeartRateZoneBoundaries(
  value: string | null,
): HeartRateZoneBoundaryDto[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (
        item,
      ): item is {
        zone: 1 | 2 | 3 | 4 | 5;
        label: string | null;
        lowerBpm: number;
        upperBpm: number | null;
      } => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          return false;
        const zone = (item as { zone?: unknown }).zone;
        const lowerBpm = (item as { lowerBpm?: unknown }).lowerBpm;
        const upperBpm = (item as { upperBpm?: unknown }).upperBpm;
        return (
          typeof zone === "number" &&
          zone >= 1 &&
          zone <= 5 &&
          typeof lowerBpm === "number" &&
          (upperBpm === null || typeof upperBpm === "number")
        );
      },
    );
  } catch {
    return [];
  }
}

function emptyHeartRateZoneTime(
  input: Pick<
    ActivityDashboardHeartRateZoneTime,
    | "status"
    | "timeSource"
    | "zoneSource"
    | "zoneStatus"
    | "formula"
    | "activityDurationSec"
    | "sourceTotalSeconds"
    | "buckets"
    | "message"
  >,
): ActivityDashboardHeartRateZoneTime {
  return {
    ...input,
    classifiedSeconds: 0,
    unclassifiedSeconds: 0,
    noHeartRateSeconds: 0,
  };
}

function findHeartRateZone(
  heartRate: number,
  boundaries: HeartRateZoneBoundaryDto[],
): HeartRateZoneBoundaryDto | null {
  return (
    boundaries.find(
      (zone) =>
        heartRate >= zone.lowerBpm &&
        (zone.upperBpm === null || heartRate <= zone.upperBpm),
    ) ?? null
  );
}

function getStoredActivityHeartRateZoneTime(
  garminId: string,
  activityDurationSec: number | null,
): ActivityDashboardHeartRateZoneTime | null {
  const rows = getDatabase()
    .prepare(
      `select zone, seconds, source_lower_bpm as sourceLowerBpm, source_total_seconds as sourceTotalSeconds
       from activity_hr_zone_time where garmin_id = ? and status = 'available' order by zone`,
    )
    .all(garminId) as Array<{
    zone: 1 | 2 | 3 | 4 | 5;
    seconds: number;
    sourceLowerBpm: number | null;
    sourceTotalSeconds: number;
  }>;
  if (rows.length !== 5) return null;
  const baseline = getGarminAthleteBaseline().values.heartRateZones;
  const boundariesByZone = new Map(
    baseline.boundaries.map((boundary) => [boundary.zone, boundary]),
  );
  const classifiedSeconds = rows.reduce((total, row) => total + row.seconds, 0);
  const buckets = rows.map((row) => {
    const boundary = boundariesByZone.get(row.zone);
    return {
      zone: row.zone,
      label: boundary?.label ?? `Zone ${row.zone}`,
      lowerBpm: boundary?.lowerBpm ?? row.sourceLowerBpm ?? 0,
      upperBpm: boundary?.upperBpm ?? null,
      seconds: row.seconds,
      percent: classifiedSeconds
        ? Math.round((row.seconds / classifiedSeconds) * 1000) / 10
        : 0,
    };
  });
  return {
    status: "available",
    timeSource: "garmin_activity",
    zoneSource: baseline.source,
    zoneStatus: baseline.status,
    formula: baseline.formula,
    classifiedSeconds,
    unclassifiedSeconds: 0,
    noHeartRateSeconds: 0,
    activityDurationSec,
    sourceTotalSeconds: rows[0]?.sourceTotalSeconds ?? classifiedSeconds,
    buckets,
    message:
      "Using Garmin activity HR-zone time totals; BPM boundaries are shown from the current Garmin baseline when available.",
  };
}

function getActivityHeartRateZoneTime(
  garminId: string,
  activityDurationSec: number | null,
): ActivityDashboardHeartRateZoneTime {
  const stored = getStoredActivityHeartRateZoneTime(
    garminId,
    activityDurationSec,
  );
  if (stored) return stored;

  const baseline = getGarminAthleteBaseline().values.heartRateZones;
  const boundaries = baseline.boundaries;
  if (baseline.status === "unavailable" || boundaries.length !== 5) {
    return emptyHeartRateZoneTime({
      status: "missing_zones",
      timeSource: null,
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: [],
      message:
        "Time in HR zones is unavailable because Garmin activity HR-zone totals and complete HR-zone boundaries are not available.",
    });
  }

  const stream = getDatabase()
    .prepare(
      `select elapsed_sec as elapsedSec, heart_rate as heartRate
       from activity_stream_point where garmin_id = ? order by elapsed_sec`,
    )
    .all(garminId) as Array<{ elapsedSec: number; heartRate: number | null }>;
  if (!stream.some((point) => point.heartRate !== null)) {
    return emptyHeartRateZoneTime({
      status: "missing_heart_rate",
      timeSource: "local_stream",
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: boundaries.map((zone) => ({ ...zone, seconds: 0, percent: 0 })),
      message:
        "Garmin activity HR-zone totals are unavailable, and local fallback cannot run because this activity has no heart-rate stream samples.",
    });
  }
  if (stream.length < 2) {
    return emptyHeartRateZoneTime({
      status: "insufficient_stream",
      timeSource: "local_stream",
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: boundaries.map((zone) => ({ ...zone, seconds: 0, percent: 0 })),
      message:
        "Garmin activity HR-zone totals are unavailable; local stream fallback needs at least two elapsed samples to compute durations.",
    });
  }

  const secondsByZone = new Map<number, number>();
  let classifiedSeconds = 0;
  let unclassifiedSeconds = 0;
  let noHeartRateSeconds = 0;
  for (let index = 0; index < stream.length - 1; index += 1) {
    const current = stream[index];
    const next = stream[index + 1];
    const seconds = Math.max(0, next.elapsedSec - current.elapsedSec);
    if (!seconds) continue;
    if (current.heartRate === null) {
      noHeartRateSeconds += seconds;
      continue;
    }
    const zone = findHeartRateZone(current.heartRate, boundaries);
    if (!zone) {
      unclassifiedSeconds += seconds;
      continue;
    }
    classifiedSeconds += seconds;
    secondsByZone.set(zone.zone, (secondsByZone.get(zone.zone) ?? 0) + seconds);
  }

  if (
    classifiedSeconds === 0 &&
    noHeartRateSeconds === 0 &&
    unclassifiedSeconds === 0
  ) {
    return emptyHeartRateZoneTime({
      status: "insufficient_stream",
      timeSource: "local_stream",
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: boundaries.map((zone) => ({ ...zone, seconds: 0, percent: 0 })),
      message:
        "Garmin activity HR-zone totals are unavailable; local stream fallback needs increasing elapsed samples to compute durations.",
    });
  }

  const buckets = boundaries.map((zone) => {
    const seconds = secondsByZone.get(zone.zone) ?? 0;
    return {
      ...zone,
      seconds,
      percent: classifiedSeconds
        ? Math.round((seconds / classifiedSeconds) * 1000) / 10
        : 0,
    };
  });
  return {
    status: "available",
    timeSource: "local_stream",
    zoneSource: baseline.source,
    zoneStatus: baseline.status,
    formula: baseline.formula,
    classifiedSeconds,
    unclassifiedSeconds,
    noHeartRateSeconds,
    activityDurationSec,
    sourceTotalSeconds:
      classifiedSeconds + unclassifiedSeconds + noHeartRateSeconds,
    buckets,
    message:
      baseline.status === "garmin_configured"
        ? "Garmin activity HR-zone totals are unavailable; using local stream-derived timing with Garmin-configured HR-zone boundaries."
        : "Garmin activity HR-zone totals are unavailable; using local stream-derived timing with zones estimated from Garmin max HR.",
  };
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeGarminAthleteBaselineRefresh(input: {
  snapshot: GarminAthleteBaselineSnapshot | null;
  status: Exclude<GarminAthleteBaselineAvailability, "failed">;
  attemptedAt: Date;
  completedAt?: Date;
  preservedPrevious?: boolean;
  errorMessage?: string | null;
}): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("delete from garmin_athlete_baseline").run();
    if (input.snapshot && input.snapshot.availability !== "unavailable") {
      const values = input.snapshot.values;
      db.prepare(
        `insert into garmin_athlete_baseline (id, fetched_at, source, availability, configured_max_heart_rate_bpm, heart_rate_zones_status, heart_rate_zones_formula, heart_rate_zones_json, cycling_ftp_watts, cycling_ftp_measured_on, cycling_ftp_source_stale, available_training_days_json, preferred_long_training_days_json)
         values ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.snapshot.fetchedAt.getTime(),
        input.snapshot.source,
        input.snapshot.availability,
        values.configuredMaxHeartRateBpm,
        values.heartRateZones.status,
        values.heartRateZones.formula,
        JSON.stringify(values.heartRateZones.boundaries),
        values.cyclingFtpWatts,
        values.cyclingFtpMeasuredOn,
        values.cyclingFtpSourceStale === null
          ? null
          : bool(values.cyclingFtpSourceStale),
        JSON.stringify(values.availableTrainingDays),
        JSON.stringify(values.preferredLongTrainingDays),
      );
    }
    db.prepare(
      `insert into garmin_athlete_baseline_attempt (id, attempted_at, completed_at, status, error_message, preserved_previous)
       values ('default', ?, ?, ?, ?, ?)
       on conflict(id) do update set
         attempted_at=excluded.attempted_at,
         completed_at=excluded.completed_at,
         status=excluded.status,
         error_message=excluded.error_message,
         preserved_previous=excluded.preserved_previous`,
    ).run(
      input.attemptedAt.getTime(),
      (input.completedAt ?? new Date()).getTime(),
      input.status,
      input.errorMessage?.slice(0, 500) ?? null,
      bool(Boolean(input.preservedPrevious)),
    );
  })();
}

export function recordGarminAthleteBaselineFailure(input: {
  attemptedAt: Date;
  completedAt?: Date;
  errorMessage: string;
  preservedPrevious?: boolean;
}): void {
  getDatabase()
    .prepare(
      `insert into garmin_athlete_baseline_attempt (id, attempted_at, completed_at, status, error_message, preserved_previous)
       values ('default', ?, ?, 'failed', ?, ?)
       on conflict(id) do update set
         attempted_at=excluded.attempted_at,
         completed_at=excluded.completed_at,
         status=excluded.status,
         error_message=excluded.error_message,
         preserved_previous=excluded.preserved_previous`,
    )
    .run(
      input.attemptedAt.getTime(),
      (input.completedAt ?? new Date()).getTime(),
      input.errorMessage.slice(0, 500),
      bool(Boolean(input.preservedPrevious)),
    );
}

export function getGarminAthleteBaseline(): GarminAthleteBaselineDto {
  const db = getDatabase();
  const baseline = db
    .prepare(
      `select fetched_at as fetchedAt, source, availability, configured_max_heart_rate_bpm as configuredMaxHeartRateBpm, heart_rate_zones_status as heartRateZonesStatus, heart_rate_zones_formula as heartRateZonesFormula, heart_rate_zones_json as heartRateZonesJson, cycling_ftp_watts as cyclingFtpWatts, cycling_ftp_measured_on as cyclingFtpMeasuredOn, cycling_ftp_source_stale as cyclingFtpSourceStale, available_training_days_json as availableTrainingDaysJson, preferred_long_training_days_json as preferredLongTrainingDaysJson from garmin_athlete_baseline where id = 'default'`,
    )
    .get() as
    | {
        fetchedAt: number;
        source: "garmin_mcp";
        availability: Exclude<GarminAthleteBaselineAvailability, "failed">;
        configuredMaxHeartRateBpm: number | null;
        heartRateZonesStatus:
          | "garmin_configured"
          | "derived_from_garmin_max_hr"
          | "unavailable"
          | null;
        heartRateZonesFormula: string | null;
        heartRateZonesJson: string | null;
        cyclingFtpWatts: number | null;
        cyclingFtpMeasuredOn: string | null;
        cyclingFtpSourceStale: number | null;
        availableTrainingDaysJson: string | null;
        preferredLongTrainingDaysJson: string | null;
      }
    | undefined;
  const attempt = db
    .prepare(
      `select attempted_at as attemptedAt, status, preserved_previous as preservedPrevious from garmin_athlete_baseline_attempt where id = 'default'`,
    )
    .get() as
    | {
        attemptedAt: number;
        status: GarminAthleteBaselineAvailability;
        preservedPrevious: number;
      }
    | undefined;
  const values = baseline
    ? {
        configuredMaxHeartRateBpm: baseline.configuredMaxHeartRateBpm,
        heartRateZones: {
          status: baseline.heartRateZonesStatus ?? "unavailable",
          source:
            baseline.heartRateZonesStatus === "garmin_configured"
              ? ("garmin_mcp" as const)
              : baseline.heartRateZonesStatus === "derived_from_garmin_max_hr"
                ? ("derived" as const)
                : null,
          formula: baseline.heartRateZonesFormula,
          boundaries: parseHeartRateZoneBoundaries(baseline.heartRateZonesJson),
        },
        cyclingFtpWatts: baseline.cyclingFtpWatts,
        cyclingFtpMeasuredOn: baseline.cyclingFtpMeasuredOn,
        cyclingFtpSourceStale:
          baseline.cyclingFtpSourceStale === null
            ? null
            : Boolean(baseline.cyclingFtpSourceStale),
        availableTrainingDays: parseJsonArray(
          baseline.availableTrainingDaysJson,
        ),
        preferredLongTrainingDays: parseJsonArray(
          baseline.preferredLongTrainingDaysJson,
        ),
      }
    : { ...EMPTY_GARMIN_ATHLETE_VALUES };
  return {
    availability:
      attempt?.status === "failed"
        ? "failed"
        : (baseline?.availability ?? attempt?.status ?? "unavailable"),
    source: baseline?.source ?? null,
    fetchedAt: baseline ? new Date(baseline.fetchedAt).toISOString() : null,
    lastAttemptAt: attempt ? new Date(attempt.attemptedAt).toISOString() : null,
    preservedPrevious: Boolean(attempt?.preservedPrevious),
    values,
    unsupported: {
      configuredMaxHeartRate: values.configuredMaxHeartRateBpm === null,
      completeHeartRateZoneBoundaries:
        values.heartRateZones.status !== "garmin_configured",
      reason:
        values.heartRateZones.status === "derived_from_garmin_max_hr"
          ? "derived_from_garmin_max_hr"
          : values.configuredMaxHeartRateBpm === null ||
              values.heartRateZones.status === "unavailable"
            ? "not_exposed_by_pinned_connector"
            : null,
    },
  };
}

export function writeGarminBodyMetricsRefresh(input: {
  snapshot: GarminBodyMetricsSnapshot | null;
  status: Exclude<GarminBodyMetricsAvailability, "failed">;
  attemptedAt: Date;
  completedAt?: Date;
  preservedPrevious?: boolean;
  errorMessage?: string | null;
}): void {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("delete from garmin_body_metrics").run();
    db.prepare("delete from garmin_body_weight_history").run();
    if (input.snapshot && input.snapshot.availability !== "unavailable") {
      db.prepare(
        `insert into garmin_body_metrics (id, fetched_at, source, availability, weight_kg, height_cm, history_availability, history_range_start, history_range_end, history_count)
         values ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.snapshot.fetchedAt.getTime(),
        input.snapshot.source,
        input.snapshot.availability,
        input.snapshot.values.weightKg,
        input.snapshot.values.heightCm,
        input.snapshot.history.availability,
        input.snapshot.history.rangeStart,
        input.snapshot.history.rangeEnd,
        input.snapshot.history.count,
      );
      const insertHistory = db.prepare(
        `insert into garmin_body_weight_history (date, weight_kg, source, fetched_at)
         values (?, ?, ?, ?)`,
      );
      for (const row of input.snapshot.historyRows) {
        insertHistory.run(
          row.date,
          row.weightKg,
          row.source,
          row.fetchedAt.getTime(),
        );
      }
    }
    db.prepare(
      `insert into garmin_body_metric_attempt (id, attempted_at, completed_at, status, error_message, preserved_previous)
       values ('default', ?, ?, ?, ?, ?)
       on conflict(id) do update set
         attempted_at=excluded.attempted_at,
         completed_at=excluded.completed_at,
         status=excluded.status,
         error_message=excluded.error_message,
         preserved_previous=excluded.preserved_previous`,
    ).run(
      input.attemptedAt.getTime(),
      (input.completedAt ?? new Date()).getTime(),
      input.status,
      input.errorMessage?.slice(0, 500) ?? null,
      bool(Boolean(input.preservedPrevious)),
    );
  })();
}

export function recordGarminBodyMetricsFailure(input: {
  attemptedAt: Date;
  completedAt?: Date;
  errorMessage: string;
  preservedPrevious?: boolean;
}): void {
  getDatabase()
    .prepare(
      `insert into garmin_body_metric_attempt (id, attempted_at, completed_at, status, error_message, preserved_previous)
       values ('default', ?, ?, 'failed', ?, ?)
       on conflict(id) do update set
         attempted_at=excluded.attempted_at,
         completed_at=excluded.completed_at,
         status=excluded.status,
         error_message=excluded.error_message,
         preserved_previous=excluded.preserved_previous`,
    )
    .run(
      input.attemptedAt.getTime(),
      (input.completedAt ?? new Date()).getTime(),
      input.errorMessage.slice(0, 500),
      bool(Boolean(input.preservedPrevious)),
    );
}

export function getGarminBodyMetrics(): GarminBodyMetricsDto {
  const db = getDatabase();
  const metrics = db
    .prepare(
      `select fetched_at as fetchedAt, source, availability, weight_kg as weightKg, height_cm as heightCm, history_availability as historyAvailability, history_range_start as historyRangeStart, history_range_end as historyRangeEnd, history_count as historyCount from garmin_body_metrics where id = 'default'`,
    )
    .get() as
    | {
        fetchedAt: number;
        source: "garmin_mcp";
        availability: Exclude<GarminBodyMetricsAvailability, "failed">;
        weightKg: number | null;
        heightCm: number | null;
        historyAvailability: "available" | "unavailable" | "failed";
        historyRangeStart: string | null;
        historyRangeEnd: string | null;
        historyCount: number;
      }
    | undefined;
  const attempt = db
    .prepare(
      `select attempted_at as attemptedAt, status, preserved_previous as preservedPrevious from garmin_body_metric_attempt where id = 'default'`,
    )
    .get() as
    | {
        attemptedAt: number;
        status: GarminBodyMetricsAvailability;
        preservedPrevious: number;
      }
    | undefined;
  return {
    availability:
      attempt?.status === "failed"
        ? "failed"
        : (metrics?.availability ?? attempt?.status ?? "unavailable"),
    source: metrics?.source ?? null,
    fetchedAt: metrics ? new Date(metrics.fetchedAt).toISOString() : null,
    lastAttemptAt: attempt ? new Date(attempt.attemptedAt).toISOString() : null,
    preservedPrevious: Boolean(attempt?.preservedPrevious),
    values: metrics
      ? { weightKg: metrics.weightKg, heightCm: metrics.heightCm }
      : { ...EMPTY_GARMIN_BODY_METRIC_VALUES },
    history: metrics
      ? {
          availability: metrics.historyAvailability,
          rangeStart: metrics.historyRangeStart,
          rangeEnd: metrics.historyRangeEnd,
          count: metrics.historyCount,
        }
      : {
          availability: "unavailable",
          rangeStart: null,
          rangeEnd: null,
          count: 0,
        },
  };
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
    insert into activity_stream_point (garmin_id, elapsed_sec, timestamp, distance_meters, heart_rate, speed_mps, altitude_meters, grade_pct, lat, lon, cadence, power_watts, temperature_c)
    values (@garminId, @elapsedSec, @timestamp, @distanceMeters, @heartRate, @speedMps, @altitudeMeters, @gradePct, @lat, @lon, @cadence, @powerWatts, @temperatureC)
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

export function upsertActivityHrZoneTime(
  detail: NormalizedActivityHrZoneTime,
): void {
  const db = getDatabase();
  const insert = db.prepare(`
    insert into activity_hr_zone_time (garmin_id, zone, fetched_at, source, status, seconds, source_lower_bpm, source_total_seconds)
    values (@garminId, @zone, @fetchedAt, @source, @status, @seconds, @sourceLowerBpm, @sourceTotalSeconds)
    on conflict(garmin_id, zone) do update set
      fetched_at=excluded.fetched_at,
      source=excluded.source,
      status=excluded.status,
      seconds=excluded.seconds,
      source_lower_bpm=excluded.source_lower_bpm,
      source_total_seconds=excluded.source_total_seconds
  `);
  db.transaction(() => {
    for (const bucket of detail.buckets) {
      insert.run({
        garminId: detail.garminId,
        zone: bucket.zone,
        fetchedAt: detail.fetchedAt.getTime(),
        source: detail.source,
        status: detail.status,
        seconds: bucket.seconds,
        sourceLowerBpm: bucket.sourceLowerBpm,
        sourceTotalSeconds: detail.sourceTotalSeconds,
      });
    }
  })();
}

export function recordActivityDetailAttempt(input: {
  garminId: string;
  force?: boolean;
  status: ActivityDetailAttemptStatus;
  detailStatus?: ActivityDetailStatus | null;
  retryable?: boolean;
  errorClass?: string | null;
  errorMessage?: string | null;
  preservedPrevious?: boolean;
}): void {
  getDatabase()
    .prepare(
      `insert into activity_detail_attempt (garmin_id, attempted_at, completed_at, force, status, detail_status, retryable, error_class, error_message, preserved_previous)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(garmin_id) do update set
         attempted_at=excluded.attempted_at,
         completed_at=excluded.completed_at,
         force=excluded.force,
         status=excluded.status,
         detail_status=excluded.detail_status,
         retryable=excluded.retryable,
         error_class=excluded.error_class,
         error_message=excluded.error_message,
         preserved_previous=excluded.preserved_previous`,
    )
    .run(
      input.garminId,
      Date.now(),
      input.status === "running" ? null : Date.now(),
      bool(Boolean(input.force)),
      input.status,
      input.detailStatus ?? null,
      bool(Boolean(input.retryable)),
      input.errorClass ?? null,
      input.errorMessage?.slice(0, 1000) ?? null,
      bool(Boolean(input.preservedPrevious)),
    );
}

export function getActivityDetailAttempt(
  garminId: string,
): ActivityDetailAttempt | null {
  const row = getDatabase()
    .prepare(
      `select garmin_id as garminId, attempted_at as attemptedAt, completed_at as completedAt,
              force, status, detail_status as detailStatus, retryable, error_class as errorClass,
              error_message as errorMessage, preserved_previous as preservedPrevious
       from activity_detail_attempt where garmin_id = ?`,
    )
    .get(garminId) as
    | (Omit<
        ActivityDetailAttempt,
        | "attemptedAt"
        | "completedAt"
        | "force"
        | "retryable"
        | "preservedPrevious"
      > & {
        attemptedAt: number;
        completedAt: number | null;
        force: number;
        retryable: number;
        preservedPrevious: number;
      })
    | undefined;
  return row
    ? {
        ...row,
        attemptedAt: new Date(row.attemptedAt),
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
        force: Boolean(row.force),
        retryable: Boolean(row.retryable),
        preservedPrevious: Boolean(row.preservedPrevious),
      }
    : null;
}

export function listActivityIdsNeedingDetail(limit = 500): string[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 5000);
  const rows = getDatabase()
    .prepare(
      `select a.garmin_id as garminId
       from activity a
       left join activity_detail_availability d on d.garmin_id = a.garmin_id
       left join activity_detail_attempt t on t.garmin_id = a.garmin_id
       where d.status is null
          or d.status = 'not_requested'
          or (t.status = 'failed' and t.retryable = 1 and coalesce(d.status, '') not in ('available', 'partial', 'unsupported'))
       order by a.started_at asc
       limit ?`,
    )
    .all(safeLimit) as Array<{ garminId: string }>;
  return rows.map((row) => row.garminId);
}

export function activityDetailCoverage(): ActivityDetailCoverage {
  const row = getDatabase()
    .prepare(
      `select
         (select count(*) from activity) as total,
         (select count(*) from activity a left join activity_detail_availability d on d.garmin_id = a.garmin_id where d.status is null or d.status = 'not_requested') as pending,
         (select count(*) from activity_detail_availability where status = 'available') as available,
         (select count(*) from activity_detail_availability where status = 'partial') as partial,
         (select count(*) from activity_detail_availability where status = 'unsupported') as unsupported,
         (select count(*) from activity_detail_attempt where status = 'running') as inProgress,
         (select count(*) from activity_detail_attempt t left join activity_detail_availability d on d.garmin_id = t.garmin_id where t.status = 'failed' and t.retryable = 1 and coalesce(d.status, '') not in ('available', 'partial', 'unsupported')) as retryableFailures,
         (select count(*) from activity_detail_attempt where status = 'failed' and preserved_previous = 1) as preservedFailures`,
    )
    .get() as Omit<ActivityDetailCoverage, "terminal">;
  return {
    ...row,
    terminal: row.available + row.partial + row.unsupported,
  };
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
      `select timestamp, elapsed_sec as elapsedSec, distance_meters as distanceMeters,
              heart_rate as heartRate, speed_mps as speedMps, altitude_meters as altitudeMeters,
              grade_pct as gradePct, lat, lon, cadence, power_watts as powerWatts,
              temperature_c as temperatureC
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

type ActivityDashboardChartSourcePoint = {
  elapsedSec: number;
  heartRate: number | null;
  altitudeMeters: number | null;
  speedMps: number | null;
};

type ActivityDashboardChartRow = ActivityDashboardChartSourcePoint & {
  timestamp: string | null;
};

type ActivityDashboardChartTiming = {
  domainStartSec: number;
  domainEndSec: number | null;
  timeScaleStatus: ActivityDashboardChartTimeScaleStatus;
  timeScaleMessage: string | null;
  points: ActivityDashboardChartSourcePoint[];
};

function timestampMillis(value: string | null): number | null {
  if (value === null) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function deriveChartElapsedFromTimestamps(
  rows: ActivityDashboardChartRow[],
): ActivityDashboardChartSourcePoint[] | null {
  if (rows.length < 2) return null;
  const firstTimestamp = timestampMillis(rows[0]?.timestamp ?? null);
  if (firstTimestamp === null) return null;

  const elapsedSeconds: number[] = [];
  let previousElapsed = -1;
  for (const row of rows) {
    const currentTimestamp = timestampMillis(row.timestamp);
    if (currentTimestamp === null) return null;
    const elapsedSec = Math.round((currentTimestamp - firstTimestamp) / 1000);
    if (elapsedSec < 0 || elapsedSec < previousElapsed) return null;
    elapsedSeconds.push(elapsedSec);
    previousElapsed = elapsedSec;
  }

  return rows.map((row, index) => ({
    elapsedSec: elapsedSeconds[index],
    heartRate: row.heartRate,
    altitudeMeters: row.altitudeMeters,
    speedMps: row.speedMps,
  }));
}

function maxElapsedSec(points: Array<{ elapsedSec: number }>): number {
  return points.reduce(
    (maximum, point) => Math.max(maximum, point.elapsedSec),
    0,
  );
}

function isLikelySampleIndexTimeline(
  rows: ActivityDashboardChartRow[],
  activityDurationSec: number | null,
): boolean {
  if (
    rows.length < 2 ||
    activityDurationSec === null ||
    activityDurationSec <= 0
  )
    return false;
  const maximumElapsed = maxElapsedSec(rows);
  if (maximumElapsed <= 0 || maximumElapsed >= activityDurationSec * 0.5)
    return false;
  return rows.length >= maximumElapsed * 0.8;
}

function chartTimingForRows(
  rows: ActivityDashboardChartRow[],
  activityDurationSec: number | null,
): ActivityDashboardChartTiming {
  const rawPoints = rows.map(({ timestamp: _timestamp, ...point }) => point);
  const rawMaximumElapsed = maxElapsedSec(rawPoints);
  const timestampPoints = deriveChartElapsedFromTimestamps(rows);
  if (timestampPoints) {
    const timestampMaximumElapsed = maxElapsedSec(timestampPoints);
    if (timestampMaximumElapsed > rawMaximumElapsed + 60) {
      return {
        domainStartSec: 0,
        domainEndSec:
          activityDurationSec !== null &&
          activityDurationSec >= timestampMaximumElapsed
            ? Math.round(activityDurationSec)
            : timestampMaximumElapsed,
        timeScaleStatus: "timestamp_derived",
        timeScaleMessage:
          "Chart timing is derived from record timestamps because stored elapsed samples were index-like.",
        points: timestampPoints,
      };
    }
  }

  const sampleIndexLimited = isLikelySampleIndexTimeline(
    rows,
    activityDurationSec,
  );
  return {
    domainStartSec: 0,
    domainEndSec: sampleIndexLimited
      ? rawMaximumElapsed
      : activityDurationSec !== null && activityDurationSec >= rawMaximumElapsed
        ? Math.round(activityDurationSec)
        : rawMaximumElapsed,
    timeScaleStatus: sampleIndexLimited ? "sample_index_limited" : "elapsed",
    timeScaleMessage: sampleIndexLimited
      ? "Chart timing is limited to the available sample-index stream because no safe elapsed or timestamp evidence is available."
      : null,
    points: rawPoints,
  };
}

type ActivityDashboardSpeedSeries = {
  metadata: ActivityDashboardSpeedChart;
  values: Array<number | null>;
};

function finiteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export const ACTIVITY_DASHBOARD_SPEED_SMOOTHING_WINDOW_SEC = 30;
const ACTIVITY_DASHBOARD_SPEED_SMOOTHING_HALF_WINDOW_SEC =
  ACTIVITY_DASHBOARD_SPEED_SMOOTHING_WINDOW_SEC / 2;
const ACTIVITY_DASHBOARD_SPEED_SMOOTHING_EDGE_WEIGHT = 1;

function activityDashboardSpeedSmoothingWeight(deltaSec: number): number {
  if (deltaSec > ACTIVITY_DASHBOARD_SPEED_SMOOTHING_HALF_WINDOW_SEC) return 0;
  return (
    ACTIVITY_DASHBOARD_SPEED_SMOOTHING_HALF_WINDOW_SEC -
    deltaSec +
    ACTIVITY_DASHBOARD_SPEED_SMOOTHING_EDGE_WEIGHT
  );
}

function smoothedActivityDashboardSpeedKmh(
  points: ActivityDashboardChartSourcePoint[],
  index: number,
): number | null {
  const centerPoint = points[index];
  const centerSpeedMps = centerPoint?.speedMps ?? null;
  if (
    !centerPoint ||
    !finiteNumber(centerPoint.elapsedSec) ||
    !finiteNumber(centerSpeedMps) ||
    centerSpeedMps < 0
  )
    return null;
  if (centerSpeedMps === 0) return 0;

  let weightedSpeedMps = 0;
  let weightTotal = 0;
  points.forEach((point) => {
    const speedMps = point.speedMps;
    if (!finiteNumber(speedMps) || speedMps < 0) return;
    const deltaSec = Math.abs(point.elapsedSec - centerPoint.elapsedSec);
    const weight = activityDashboardSpeedSmoothingWeight(deltaSec);
    if (weight <= 0) return;
    weightedSpeedMps += speedMps * weight;
    weightTotal += weight;
  });

  return weightTotal > 0 ? (weightedSpeedMps / weightTotal) * 3.6 : null;
}

function activityDashboardSpeedSeries(
  points: ActivityDashboardChartSourcePoint[],
): ActivityDashboardSpeedSeries {
  const values = points.map((_, index) =>
    smoothedActivityDashboardSpeedKmh(points, index),
  );
  const pointCount = values.filter(finiteNumber).length;
  if (pointCount === 0) {
    return {
      metadata: {
        status: "missing_speed",
        sourcePointCount: 0,
        pointCount: 0,
        message:
          "Speed unavailable because this activity has no normalized stream speed samples.",
      },
      values,
    };
  }
  if (pointCount < 2) {
    return {
      metadata: {
        status: "insufficient_speed",
        sourcePointCount: pointCount,
        pointCount,
        message:
          "Speed unavailable because at least two finite non-negative stream speed samples are needed.",
      },
      values,
    };
  }
  return {
    metadata: {
      status: "available",
      sourcePointCount: pointCount,
      pointCount,
      message:
        "Speed uses 30-second smoothed normalized stream speed samples converted to km/h.",
    },
    values,
  };
}

const ACTIVITY_DASHBOARD_ROUTE_MAX_POINTS = 400;

type ActivityDashboardRouteRow = ActivityDashboardRoutePoint;

function finiteRouteCoordinate(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function activityDashboardRouteBounds(
  points: ActivityDashboardRoutePoint[],
): ActivityDashboardRouteBounds {
  const altitudes = points
    .map((point) => point.altitudeMeters)
    .filter(finiteRouteCoordinate);
  return {
    minLat: Math.min(...points.map((point) => point.lat)),
    maxLat: Math.max(...points.map((point) => point.lat)),
    minLon: Math.min(...points.map((point) => point.lon)),
    maxLon: Math.max(...points.map((point) => point.lon)),
    minAltitudeMeters: altitudes.length ? Math.min(...altitudes) : null,
    maxAltitudeMeters: altitudes.length ? Math.max(...altitudes) : null,
  };
}

function simplifyActivityDashboardRoute(
  points: ActivityDashboardRoutePoint[],
  maxPoints: number,
): ActivityDashboardRoutePoint[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints < 2) return points.slice(0, maxPoints);
  const lastIndex = points.length - 1;
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    return points[sourceIndex];
  });
}

function buildActivityDashboardRoute(
  rows: ActivityDashboardRouteRow[],
): ActivityDashboardRoute {
  const points = rows.filter(
    (point) =>
      finiteRouteCoordinate(point.lat) && finiteRouteCoordinate(point.lon),
  );
  const maxPoints = ACTIVITY_DASHBOARD_ROUTE_MAX_POINTS;
  if (points.length === 0) {
    return {
      status: "missing_gps",
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints,
      simplified: false,
      bounds: null,
      points: [],
      message:
        "Route unavailable because this activity has no normalized GPS stream points.",
    };
  }
  if (points.length < 2) {
    return {
      status: "insufficient_points",
      sourcePointCount: points.length,
      pointCount: points.length,
      maxPoints,
      simplified: false,
      bounds: activityDashboardRouteBounds(points),
      points,
      message:
        "Route unavailable because at least two normalized GPS points are needed to draw a route.",
    };
  }
  const simplifiedPoints = simplifyActivityDashboardRoute(points, maxPoints);
  return {
    status: "available",
    sourcePointCount: points.length,
    pointCount: simplifiedPoints.length,
    maxPoints,
    simplified: simplifiedPoints.length < points.length,
    bounds: activityDashboardRouteBounds(points),
    points: simplifiedPoints,
    message:
      simplifiedPoints.length < points.length
        ? `Showing ${simplifiedPoints.length.toLocaleString()} representative route points from ${points.length.toLocaleString()} normalized GPS stream points.`
        : `Showing ${points.length.toLocaleString()} normalized GPS stream points.`,
  };
}

export function getActivityDashboardDetail(
  garminId: string,
): ActivityDashboardDetail | null {
  const db = getDatabase();
  const activity = getActivityByGarminId(garminId);
  if (!activity) return null;
  const availability = db
    .prepare(
      `select status, has_laps as hasLaps, has_elevation as hasElevation,
              has_heart_rate as hasHeartRate, record_count as recordCount,
              lap_count as lapCount, unavailable_reason as unavailableReason
       from activity_detail_availability where garmin_id = ?`,
    )
    .get(garminId) as
    | {
        status: ActivityDetailStatus;
        hasLaps: number;
        hasElevation: number;
        hasHeartRate: number;
        recordCount: number;
        lapCount: number;
        unavailableReason: string | null;
      }
    | undefined;
  const chartRows = db
    .prepare(
      `select elapsed_sec as elapsedSec, timestamp, speed_mps as speedMps,
              heart_rate as heartRate, altitude_meters as altitudeMeters
       from activity_stream_point
       where garmin_id = ? and (heart_rate is not null or altitude_meters is not null or speed_mps is not null)
       order by elapsed_sec`,
    )
    .all(garminId) as ActivityDashboardChartRow[];
  const chartTiming = chartTimingForRows(chartRows, activity.durationSec);
  const speedSeries = activityDashboardSpeedSeries(chartTiming.points);
  const points = chartTiming.points.map(
    ({ speedMps: _speedMps, ...point }, index) => ({
      ...point,
      speedKmh: speedSeries.values[index] ?? null,
    }),
  );
  const sourcePointCount = points.length;
  const routeRows = db
    .prepare(
      `select elapsed_sec as elapsedSec, lat, lon,
              altitude_meters as altitudeMeters, grade_pct as gradePct
       from activity_stream_point
       where garmin_id = ? and lat is not null and lon is not null
       order by elapsed_sec`,
    )
    .all(garminId) as ActivityDashboardRouteRow[];
  const route = buildActivityDashboardRoute(routeRows);
  const laps = db
    .prepare(
      `select lap_number as lapNumber, start_time as startTime, duration_sec as durationSec,
              distance_meters as distanceMeters, avg_speed_mps as avgSpeedMps,
              avg_heart_rate as avgHeartRate, max_heart_rate as maxHeartRate,
              elevation_gain_meters as elevationGainMeters, elevation_loss_meters as elevationLossMeters,
              avg_power_watts as avgPowerWatts, normalized_power_watts as normalizedPowerWatts
       from activity_lap where garmin_id = ? order by lap_number limit 100`,
    )
    .all(garminId) as ActivityLapDetail[];
  const hasHeartRate = points.some((point) => point.heartRate !== null);
  const hasElevation = points.some((point) => point.altitudeMeters !== null);
  return {
    activity,
    detail: {
      status: availability?.status ?? "not_requested",
      hasHeartRate,
      hasElevation,
      hasLaps: laps.length > 0,
      recordCount: availability?.recordCount ?? 0,
      lapCount: availability?.lapCount ?? laps.length,
      unavailableReason: availability?.unavailableReason ?? null,
    },
    charts: {
      downsampled: false,
      sourcePointCount,
      pointCount: points.length,
      maxPoints: sourcePointCount,
      domainStartSec: chartTiming.domainStartSec,
      domainEndSec: chartTiming.domainEndSec,
      timeScaleStatus: chartTiming.timeScaleStatus,
      timeScaleMessage: chartTiming.timeScaleMessage,
      speed: speedSeries.metadata,
      points,
    },
    route,
    heartRateZones: getActivityHeartRateZoneTime(
      garminId,
      activity.durationSec,
    ),
    laps,
  };
}

export function listActivitiesForComparison(
  limit?: number,
): NormalizedActivity[] {
  const query = `select garmin_id as garminId, name, sport, started_at as startedAt, duration_sec as durationSec,
              distance_meters as distanceMeters, calories, avg_heart_rate as avgHeartRate,
              max_heart_rate as maxHeartRate, steps, elevation_gain_meters as elevationGainMeters,
              elevation_loss_meters as elevationLossMeters, training_effect as trainingEffect
       from activity order by started_at desc${limit ? " limit ?" : ""}`;
  const statement = getDatabase().prepare(query);
  const rows = (limit ? statement.all(limit) : statement.all()) as Array<{
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

export type ActivityReferenceInput = {
  garminId?: string | null;
  suppliedName?: string | null;
  date?: string | null;
};

export type ActivityVerificationEvidence = {
  tool: "activityVerification";
  reference: {
    garminId: string | null;
    suppliedName: string | null;
    date: string | null;
  };
  outcome: "found" | "not_found" | "ambiguous";
  matches: Array<{
    garminId: string;
    label: string;
    labelSource: "garmin" | "fallback";
    date: string;
    sport: string;
    distanceMeters: number | null;
    durationSec: number | null;
    elevationGainMeters: number | null;
    avgHeartRate: number | null;
  }>;
  importedCoverage: {
    activityCount: number;
    earliestDate: string | null;
    latestDate: string | null;
  };
  privacy: string;
};

function normalizeActivityReference(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function verifyActivityReference(
  reference: ActivityReferenceInput,
  matchLimit = 5,
): ActivityVerificationEvidence {
  const activities = listActivitiesForComparison();
  const suppliedName = reference.suppliedName?.trim() || null;
  const normalizedName = suppliedName
    ? normalizeActivityReference(suppliedName)
    : null;
  const candidates = activities.filter((activity) => {
    const date = activity.startedAt.toISOString().slice(0, 10);
    if (reference.garminId && activity.garminId !== reference.garminId)
      return false;
    if (reference.date && date !== reference.date) return false;
    if (normalizedName) {
      const storedName = activity.name
        ? normalizeActivityReference(activity.name)
        : null;
      if (storedName !== normalizedName) return false;
    }
    return true;
  });
  const boundedMatches = candidates.slice(0, matchLimit).map((activity) => {
    const date = activity.startedAt.toISOString().slice(0, 10);
    const sourceName = activity.name?.trim();
    return {
      garminId: activity.garminId,
      label:
        sourceName ||
        `Imported ${activity.sport} on ${date} (Garmin ID ${activity.garminId})`,
      labelSource: sourceName ? ("garmin" as const) : ("fallback" as const),
      date,
      sport: activity.sport,
      distanceMeters: activity.distanceMeters,
      durationSec: activity.durationSec,
      elevationGainMeters: activity.elevationGainMeters,
      avgHeartRate: activity.avgHeartRate,
    };
  });
  const times = activities.map((activity) => activity.startedAt.getTime());
  return {
    tool: "activityVerification",
    reference: {
      garminId: reference.garminId ?? null,
      suppliedName,
      date: reference.date ?? null,
    },
    outcome:
      candidates.length === 0
        ? "not_found"
        : candidates.length === 1
          ? "found"
          : "ambiguous",
    matches: boundedMatches,
    importedCoverage: {
      activityCount: activities.length,
      earliestDate: times.length
        ? new Date(Math.min(...times)).toISOString().slice(0, 10)
        : null,
      latestDate: times.length
        ? new Date(Math.max(...times)).toISOString().slice(0, 10)
        : null,
    },
    privacy:
      "Verified against local normalized SQLite activity summaries only; raw FIT, GPS streams, connector payloads, and credentials were not sent to the model.",
  };
}

export function healthCoverage(): HealthCoverage {
  const row = getDatabase()
    .prepare(
      `select count(*) as totalRows,
              coalesce(sum(case when availability = 'complete' then 1 else 0 end), 0) as completeDays,
              coalesce(sum(case when availability = 'partial' then 1 else 0 end), 0) as partialDays,
              coalesce(sum(case when availability = 'missing' then 1 else 0 end), 0) as missingDays,
              coalesce(sum(case when sleep_minutes is not null then 1 else 0 end), 0) as sleepDays,
              coalesce(sum(case when resting_heart_rate is not null then 1 else 0 end), 0) as restingHeartRateDays,
              coalesce(sum(case when hrv_ms is not null then 1 else 0 end), 0) as hrvDays,
              coalesce(sum(case when stress_avg is not null then 1 else 0 end), 0) as stressDays,
              coalesce(sum(case when steps is not null then 1 else 0 end), 0) as stepsDays,
              coalesce(sum(case when calories is not null then 1 else 0 end), 0) as calorieDays,
              coalesce(sum(case when body_battery_avg is not null then 1 else 0 end), 0) as bodyBatteryDays
       from daily_health`,
    )
    .get() as {
    totalRows: number;
    completeDays: number;
    partialDays: number;
    missingDays: number;
    sleepDays: number;
    restingHeartRateDays: number;
    hrvDays: number;
    stressDays: number;
    stepsDays: number;
    calorieDays: number;
    bodyBatteryDays: number;
  };
  return {
    totalRows: row.totalRows,
    completeDays: row.completeDays,
    partialDays: row.partialDays,
    missingDays: row.missingDays,
    metrics: {
      sleepDays: row.sleepDays,
      restingHeartRateDays: row.restingHeartRateDays,
      hrvDays: row.hrvDays,
      stressDays: row.stressDays,
      stepsDays: row.stepsDays,
      calorieDays: row.calorieDays,
      bodyBatteryDays: row.bodyBatteryDays,
    },
  };
}

export function dataCounts(): {
  activities: number;
  healthDays: number;
  healthCoverage: HealthCoverage;
  detailedActivities: number;
  detailCoverage: ActivityDetailCoverage;
} {
  const activityRow = getDatabase()
    .prepare("select count(*) as count from activity")
    .get() as { count: number };
  const coverage = healthCoverage();
  const detailRow = getDatabase()
    .prepare(
      "select count(*) as count from activity_detail_availability where status in ('available', 'partial')",
    )
    .get() as { count: number };
  return {
    activities: activityRow.count,
    healthDays: coverage.totalRows,
    healthCoverage: coverage,
    detailedActivities: detailRow.count,
    detailCoverage: activityDetailCoverage(),
  };
}

export function importSummary(): {
  activities: number;
  healthDays: number;
  healthCoverage: HealthCoverage;
  detailedActivities: number;
  detailCoverage: ActivityDetailCoverage;
  athleteBaseline: GarminAthleteBaselineDto;
  bodyMetrics: GarminBodyMetricsDto;
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
    athleteBaseline: getGarminAthleteBaseline(),
    bodyMetrics: getGarminBodyMetrics(),
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

export type TrainerMemoryStatus =
  | "pending_confirmation"
  | "confirmed"
  | "expired"
  | "superseded"
  | "deleted"
  | "rejected";

export type TrainerMemoryCategory = TrainerMemory["category"];

export type StoredTrainerMemory = TrainerMemory & {
  status: TrainerMemoryStatus;
  sourceType: string;
  sourceRef: string | null;
  validFrom: Date | null;
  supersedesId: string | null;
  supersededById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TrainerMemoryRow = {
  id: string;
  category: TrainerMemoryCategory;
  value: string;
  status: TrainerMemoryStatus;
  sourceType: string;
  sourceRef: string | null;
  provenanceText: string;
  validFrom: number | null;
  expiresAt: number | null;
  reconfirmAfter: number | null;
  supersedesId: string | null;
  supersededById: string | null;
  createdAt: number;
  updatedAt: number;
};

function mapTrainerMemory(row: TrainerMemoryRow): StoredTrainerMemory {
  return {
    id: row.id,
    category: row.category,
    value: row.value,
    status: row.status,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    provenanceText: row.provenanceText,
    validFrom: row.validFrom ? new Date(row.validFrom) : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    reconfirmAfter: row.reconfirmAfter ? new Date(row.reconfirmAfter) : null,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function createTrainerMemoryProposal(input: {
  category: TrainerMemoryCategory;
  value: string;
  sourceType: string;
  sourceRef?: string | null;
  provenanceText: string;
  validFrom?: Date | null;
  expiresAt?: Date | null;
  reconfirmAfter?: Date | null;
  supersedesId?: string | null;
}): StoredTrainerMemory {
  const now = Date.now();
  const id = `memory-${now}-${Math.random().toString(36).slice(2, 10)}`;
  getDatabase()
    .prepare(
      `insert into trainer_memory (id, category, value, status, source_type, source_ref, provenance_text, valid_from, expires_at, reconfirm_after, supersedes_id, created_at, updated_at)
       values (?, ?, ?, 'pending_confirmation', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.category,
      input.value.slice(0, 1000),
      input.sourceType,
      input.sourceRef ?? null,
      input.provenanceText.slice(0, 500),
      input.validFrom?.getTime() ?? null,
      input.expiresAt?.getTime() ?? null,
      input.reconfirmAfter?.getTime() ?? null,
      input.supersedesId ?? null,
      now,
      now,
    );
  return getTrainerMemory(id)!;
}

export function confirmTrainerMemory(id: string): StoredTrainerMemory {
  const now = Date.now();
  const existing = getTrainerMemory(id);
  if (!existing) throw new Error(`Memory proposal not found: ${id}`);
  if (existing.status !== "pending_confirmation") {
    throw new Error(`Only pending memories can be confirmed: ${id}`);
  }
  const db = getDatabase();
  db.transaction(() => {
    if (existing.supersedesId) {
      db.prepare(
        "update trainer_memory set status = 'superseded', superseded_by_id = ?, updated_at = ? where id = ?",
      ).run(id, now, existing.supersedesId);
    }
    db.prepare(
      "update trainer_memory set status = 'confirmed', updated_at = ? where id = ?",
    ).run(now, id);
  })();
  return getTrainerMemory(id)!;
}

export function getTrainerMemory(id: string): StoredTrainerMemory | null {
  const row = getDatabase()
    .prepare(
      `select id, category, value, status, source_type as sourceType, source_ref as sourceRef, provenance_text as provenanceText, valid_from as validFrom, expires_at as expiresAt, reconfirm_after as reconfirmAfter, supersedes_id as supersedesId, superseded_by_id as supersededById, created_at as createdAt, updated_at as updatedAt from trainer_memory where id = ?`,
    )
    .get(id) as TrainerMemoryRow | undefined;
  return row ? mapTrainerMemory(row) : null;
}

export function expireDueTrainerMemories(now = Date.now()): number {
  const result = getDatabase()
    .prepare(
      `update trainer_memory set status = 'expired', updated_at = ?
       where status = 'confirmed' and ((expires_at is not null and expires_at <= ?) or (reconfirm_after is not null and reconfirm_after <= ?))`,
    )
    .run(now, now, now);
  return result.changes;
}

export function listActiveTrainerMemories(
  limit = 8,
  now = Date.now(),
): StoredTrainerMemory[] {
  expireDueTrainerMemories(now);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const rows = getDatabase()
    .prepare(
      `select id, category, value, status, source_type as sourceType, source_ref as sourceRef, provenance_text as provenanceText, valid_from as validFrom, expires_at as expiresAt, reconfirm_after as reconfirmAfter, supersedes_id as supersedesId, superseded_by_id as supersededById, created_at as createdAt, updated_at as updatedAt
       from trainer_memory
       where status = 'confirmed'
       order by updated_at desc
       limit ?`,
    )
    .all(safeLimit) as TrainerMemoryRow[];
  return rows.map(mapTrainerMemory);
}

export function listTrainerMemoriesForReview(
  limit = 40,
): StoredTrainerMemory[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 80);
  const rows = getDatabase()
    .prepare(
      `select id, category, value, status, source_type as sourceType, source_ref as sourceRef, provenance_text as provenanceText, valid_from as validFrom, expires_at as expiresAt, reconfirm_after as reconfirmAfter, supersedes_id as supersedesId, superseded_by_id as supersededById, created_at as createdAt, updated_at as updatedAt
       from trainer_memory
       where status in ('pending_confirmation', 'confirmed')
       order by status = 'pending_confirmation' desc, updated_at desc
       limit ?`,
    )
    .all(safeLimit) as TrainerMemoryRow[];
  return rows.map(mapTrainerMemory);
}

export function rejectTrainerMemory(id: string): StoredTrainerMemory {
  const existing = getTrainerMemory(id);
  if (!existing) throw new Error(`Memory proposal not found: ${id}`);
  if (existing.status !== "pending_confirmation") {
    throw new Error(`Only pending memories can be rejected: ${id}`);
  }
  getDatabase()
    .prepare(
      "update trainer_memory set status = 'rejected', updated_at = ? where id = ?",
    )
    .run(Date.now(), id);
  return getTrainerMemory(id)!;
}

export function forgetTrainerMemory(id: string): StoredTrainerMemory {
  const existing = getTrainerMemory(id);
  if (!existing) throw new Error(`Memory not found: ${id}`);
  if (!["pending_confirmation", "confirmed"].includes(existing.status)) {
    throw new Error(
      `Only pending or confirmed memories can be forgotten: ${id}`,
    );
  }
  getDatabase()
    .prepare(
      "update trainer_memory set status = 'deleted', updated_at = ? where id = ?",
    )
    .run(Date.now(), id);
  return getTrainerMemory(id)!;
}

export type GarminRawPayloadRecord = {
  id: string;
  sourceTool: string;
  subjectType: GarminRawSubjectType;
  subjectId: string;
  fetchedAt: Date;
  contentType: GarminRawContentType;
  payload: unknown;
  sha256: string;
  redactionVersion: number;
  redactedFieldCount: number;
};

export function upsertGarminRawPayload(input: {
  sourceTool: string;
  subjectType: GarminRawSubjectType;
  subjectId: string;
  payload: unknown;
  fetchedAt?: Date;
}): GarminRawPayloadRecord {
  const redacted = redactGarminRawPayload(input.payload);
  const fetchedAt = input.fetchedAt ?? new Date();
  const id =
    `${input.sourceTool}:${input.subjectType}:${input.subjectId}:${redacted.sha256}`.slice(
      0,
      240,
    );
  getDatabase()
    .prepare(
      `insert into garmin_raw_payload (id, source_tool, subject_type, subject_id, fetched_at, content_type, payload_json, payload_text, sha256, redaction_version, redacted_field_count)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         fetched_at=excluded.fetched_at,
         payload_json=excluded.payload_json,
         payload_text=excluded.payload_text,
         redacted_field_count=excluded.redacted_field_count`,
    )
    .run(
      id,
      input.sourceTool,
      input.subjectType,
      input.subjectId.slice(0, 120),
      fetchedAt.getTime(),
      redacted.contentType,
      redacted.contentType === "json" ? JSON.stringify(redacted.payload) : null,
      redacted.contentType === "text" ? String(redacted.payload) : null,
      redacted.sha256,
      redacted.redactionVersion,
      redacted.redactedFieldCount,
    );
  return {
    id,
    sourceTool: input.sourceTool,
    subjectType: input.subjectType,
    subjectId: input.subjectId.slice(0, 120),
    fetchedAt,
    contentType: redacted.contentType,
    payload: redacted.payload,
    sha256: redacted.sha256,
    redactionVersion: redacted.redactionVersion,
    redactedFieldCount: redacted.redactedFieldCount,
  };
}

function parseRawPayload(row: {
  id: string;
  sourceTool: string;
  subjectType: GarminRawSubjectType;
  subjectId: string;
  fetchedAt: number;
  contentType: GarminRawContentType;
  payloadJson: string | null;
  payloadText: string | null;
  sha256: string;
  redactionVersion: number;
  redactedFieldCount: number;
}): GarminRawPayloadRecord {
  return {
    ...row,
    fetchedAt: new Date(row.fetchedAt),
    payload:
      row.contentType === "json" && row.payloadJson
        ? (JSON.parse(row.payloadJson) as unknown)
        : row.payloadText,
  };
}

export function listGarminRawPayloadsForAnalysis(
  limit = 100,
): GarminRawPayloadRecord[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const rows = getDatabase()
    .prepare(
      `select id, source_tool as sourceTool, subject_type as subjectType, subject_id as subjectId, fetched_at as fetchedAt, content_type as contentType, payload_json as payloadJson, payload_text as payloadText, sha256, redaction_version as redactionVersion, redacted_field_count as redactedFieldCount
       from garmin_raw_payload
       order by fetched_at desc
       limit ?`,
    )
    .all(safeLimit) as Parameters<typeof parseRawPayload>[0][];
  return rows.map(parseRawPayload);
}

export const DEFAULT_CONVERSATION_ID = "default";
const GENERIC_CONVERSATION_TITLES = new Set(["Trainer chat", "New chat"]);

export type ChatRole = "user" | "assistant";

export type ChatGrounding = {
  debugTrace?: LlmDebugTrace;
  tool?: string;
  activityId?: string;
  activityName?: string | null;
  activityDate?: string | null;
  privacy?: string;
  summary?: string;
  toolSteps?: Array<{
    index: 1 | 2 | 3 | 4;
    tool: string;
    status: "succeeded" | "rejected" | "failed";
    summary: string;
    activityIds?: string[];
    privacy: string;
    reason?: string;
    selection?: {
      reason: "multiple_tool_calls";
      count: number;
      toolNames: string[];
      selectedTool?: string;
    };
  }>;
};

export type StoredChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  grounding: ChatGrounding | null;
  createdAt: Date;
};

export type StoredConversation = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationSummary = StoredConversation;

export type ChatMessagePage = {
  conversationId: string;
  messages: StoredChatMessage[];
  nextCursor: string | null;
};

const MAX_GROUNDING_JSON_CHARS = 24000;

type StoredMessageRow = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  groundingJson: string | null;
  createdAt: number;
};

type StoredConversationRow = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

function parseGrounding(value: string | null): ChatGrounding | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ChatGrounding;
  } catch {
    return null;
  }
}

function truncateJsonString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function compactGroundingForStorage(grounding: ChatGrounding): ChatGrounding {
  if (!grounding.debugTrace) return grounding;
  const trace = grounding.debugTrace;
  return {
    ...grounding,
    debugTrace: {
      ...trace,
      userRequest: trace.userRequest
        ? truncateJsonString(trace.userRequest, 1200)
        : trace.userRequest,
      finalAnswer: truncateJsonString(trace.finalAnswer, 2400),
      providerCalls: trace.providerCalls.slice(0, 8).map((call) => ({
        ...call,
        text: call.text ? truncateJsonString(call.text, 700) : call.text,
        truncated:
          call.truncated || trace.providerCalls.length > 8 || undefined,
      })),
      toolSteps: trace.toolSteps.slice(0, 4).map((step) => ({
        ...step,
        result: step.result,
        summary: step.summary
          ? truncateJsonString(step.summary, 700)
          : step.summary,
        privacy: step.privacy
          ? truncateJsonString(step.privacy, 500)
          : step.privacy,
      })),
      truncated: trace.truncated || trace.providerCalls.length > 8 || undefined,
    },
  };
}

function groundingJsonForStorage(
  grounding: ChatGrounding | null | undefined,
): string | null {
  if (!grounding) return null;
  let candidate: ChatGrounding = grounding;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const json = JSON.stringify(candidate);
    if (json.length <= MAX_GROUNDING_JSON_CHARS) return json;
    candidate = compactGroundingForStorage(candidate);
    if (candidate.debugTrace) {
      candidate = {
        ...candidate,
        debugTrace: {
          ...candidate.debugTrace,
          userRequest: candidate.debugTrace.userRequest
            ? truncateJsonString(candidate.debugTrace.userRequest, 600)
            : candidate.debugTrace.userRequest,
          finalAnswer: truncateJsonString(
            candidate.debugTrace.finalAnswer,
            1200,
          ),
          providerCalls: candidate.debugTrace.providerCalls.slice(0, 4),
          toolSteps: candidate.debugTrace.toolSteps.map((step) => ({
            index: step.index,
            tool: step.tool,
            status: step.status,
            summary: step.summary
              ? truncateJsonString(step.summary, 300)
              : step.summary,
            reason: step.reason,
            truncated: true,
          })),
          truncated: true,
        },
      };
    }
  }
  const fallback = { ...candidate, debugTrace: undefined };
  return JSON.stringify(fallback);
}

function mapStoredMessage(row: StoredMessageRow): StoredChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    grounding: parseGrounding(row.groundingJson),
    createdAt: new Date(row.createdAt),
  };
}

function mapStoredConversation(row: StoredConversationRow): StoredConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function safeConversationId(value: string | null | undefined): string {
  const candidate = value?.trim() || DEFAULT_CONVERSATION_ID;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(candidate)) {
    throw new Error(
      "Conversation id must be a local opaque id with letters, numbers, dashes, underscores, dots, or colons only",
    );
  }
  return candidate;
}

export function normalizeConversationTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) throw new Error("Conversation title cannot be empty");
  return compact.length > 48 ? `${compact.slice(0, 47)}…` : compact;
}

export function initialConversationTitle(value: string): string {
  try {
    return normalizeConversationTitle(value);
  } catch {
    return "New chat";
  }
}

function conversationCursor(
  row: Pick<StoredMessageRow, "createdAt" | "id">,
): string {
  return Buffer.from(`${row.createdAt}:${row.id}`, "utf8").toString(
    "base64url",
  );
}

function parseConversationCursor(cursor: string | null | undefined): {
  createdAt: number;
  id: string;
} | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf(":");
    const createdAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!Number.isFinite(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function getConversation(
  id = DEFAULT_CONVERSATION_ID,
): StoredConversation | null {
  const row = getDatabase()
    .prepare(
      "select id, title, created_at as createdAt, updated_at as updatedAt from conversation where id = ?",
    )
    .get(safeConversationId(id)) as StoredConversationRow | undefined;
  return row ? mapStoredConversation(row) : null;
}

export function ensureConversation(
  id = DEFAULT_CONVERSATION_ID,
  title = "Trainer chat",
): StoredConversation {
  const conversationId = safeConversationId(id);
  const now = Date.now();
  getDatabase()
    .prepare(
      `insert into conversation (id, title, manual_title, created_at, updated_at)
       values (?, ?, 0, ?, ?)
       on conflict(id) do nothing`,
    )
    .run(conversationId, initialConversationTitle(title), now, now);
  return getConversation(conversationId)!;
}

export function createConversation(input?: {
  id?: string;
  title?: string;
}): StoredConversation {
  const id = safeConversationId(
    input?.id ??
      `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  return ensureConversation(id, input?.title ?? "New chat");
}

export function listConversations(limit = 40): ConversationSummary[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 80);
  const rows = getDatabase()
    .prepare(
      `select id, title, created_at as createdAt, updated_at as updatedAt
       from conversation
       order by updated_at desc, id desc
       limit ?`,
    )
    .all(safeLimit) as StoredConversationRow[];
  return rows.map(mapStoredConversation);
}

export function renameConversation(
  id: string,
  title: string,
): StoredConversation | null {
  const conversationId = safeConversationId(id);
  const normalizedTitle = normalizeConversationTitle(title);
  const now = Date.now();
  const changes = getDatabase()
    .prepare(
      "update conversation set title = ?, manual_title = 1, updated_at = ? where id = ?",
    )
    .run(normalizedTitle, now, conversationId).changes;
  return changes > 0 ? getConversation(conversationId) : null;
}

export function deleteConversation(id = DEFAULT_CONVERSATION_ID): boolean {
  const conversationId = safeConversationId(id);
  const db = getDatabase();
  const changes = db.transaction(() => {
    db.prepare("delete from message where conversation_id = ?").run(
      conversationId,
    );
    db.prepare(
      "update semantic_memory set status = 'deleted', updated_at = ? where source_conversation_id = ? and kind = 'conversation'",
    ).run(Date.now(), conversationId);
    return db
      .prepare("delete from conversation where id = ?")
      .run(conversationId).changes;
  })();
  return changes > 0;
}

function retitleInitialConversationIfNeeded(
  conversationId: string,
  role: ChatRole,
  content: string,
  createdAt: number,
): void {
  if (role !== "user") return;
  const row = getDatabase()
    .prepare(
      `select c.title as title, c.manual_title as manualTitle, count(m.id) as messageCount
       from conversation c left join message m on m.conversation_id = c.id
       where c.id = ?
       group by c.id`,
    )
    .get(conversationId) as
    { title: string; manualTitle: number; messageCount: number } | undefined;
  if (
    !row ||
    row.manualTitle === 1 ||
    row.messageCount !== 1 ||
    !GENERIC_CONVERSATION_TITLES.has(row.title)
  )
    return;
  getDatabase()
    .prepare("update conversation set title = ?, updated_at = ? where id = ?")
    .run(initialConversationTitle(content), createdAt, conversationId);
}

export function appendChatMessage(input: {
  conversationId?: string;
  role: ChatRole;
  content: string;
  grounding?: ChatGrounding | null;
}): StoredChatMessage {
  const conversationId = safeConversationId(input.conversationId);
  ensureConversation(conversationId, input.content.slice(0, 80));
  const createdAt = nextChatMessageTimestamp();
  const id = `${conversationId}-${input.role}-${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
  getDatabase()
    .prepare(
      `insert into message (id, conversation_id, role, content, grounding_json, created_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      conversationId,
      input.role,
      input.content.slice(0, 12000),
      groundingJsonForStorage(input.grounding),
      createdAt,
    );
  retitleInitialConversationIfNeeded(
    conversationId,
    input.role,
    input.content,
    createdAt,
  );
  getDatabase()
    .prepare("update conversation set updated_at = ? where id = ?")
    .run(createdAt, conversationId);
  return {
    id,
    conversationId,
    role: input.role,
    content: input.content.slice(0, 12000),
    grounding: input.grounding ?? null,
    createdAt: new Date(createdAt),
  };
}

export function listRecentChatMessages(
  conversationId = DEFAULT_CONVERSATION_ID,
  limit = 12,
): StoredChatMessage[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 40);
  const rows = getDatabase()
    .prepare(
      `select id, conversation_id as conversationId, role, content, grounding_json as groundingJson, created_at as createdAt
       from message
       where conversation_id = ?
       order by created_at desc, id desc
       limit ?`,
    )
    .all(safeConversationId(conversationId), safeLimit) as StoredMessageRow[];
  return rows.reverse().map(mapStoredMessage);
}

export function listChatMessagePage(input: {
  conversationId?: string;
  cursor?: string | null;
  limit?: number;
}): ChatMessagePage {
  const conversationId = safeConversationId(input.conversationId);
  const safeLimit = Math.min(Math.max(Math.trunc(input.limit ?? 30), 1), 60);
  const cursor = parseConversationCursor(input.cursor);
  const sql = cursor
    ? `select id, conversation_id as conversationId, role, content, grounding_json as groundingJson, created_at as createdAt
       from message
       where conversation_id = ? and (created_at < ? or (created_at = ? and id < ?))
       order by created_at desc, id desc
       limit ?`
    : `select id, conversation_id as conversationId, role, content, grounding_json as groundingJson, created_at as createdAt
       from message
       where conversation_id = ?
       order by created_at desc, id desc
       limit ?`;
  const params = cursor
    ? [
        conversationId,
        cursor.createdAt,
        cursor.createdAt,
        cursor.id,
        safeLimit + 1,
      ]
    : [conversationId, safeLimit + 1];
  const rows = getDatabase()
    .prepare(sql)
    .all(...params) as StoredMessageRow[];
  const visibleRows = rows.slice(0, safeLimit);
  const nextCursor =
    rows.length > safeLimit && visibleRows.length
      ? conversationCursor(visibleRows[visibleRows.length - 1]!)
      : null;
  return {
    conversationId,
    messages: [...visibleRows].reverse().map(mapStoredMessage),
    nextCursor,
  };
}

export function clearConversationHistory(
  conversationId = DEFAULT_CONVERSATION_ID,
): void {
  deleteConversation(conversationId);
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
    db.prepare("delete from garmin_raw_payload").run();
    db.prepare("delete from activity_stream_point").run();
    db.prepare("delete from activity_lap").run();
    db.prepare("delete from activity_detail_availability").run();
    db.prepare("delete from garmin_athlete_baseline").run();
    db.prepare("delete from garmin_athlete_baseline_attempt").run();
    db.prepare("delete from garmin_body_metrics").run();
    db.prepare("delete from garmin_body_metric_attempt").run();
    db.prepare("delete from garmin_body_weight_history").run();
    db.prepare("delete from activity").run();
    db.prepare("delete from daily_health").run();
    db.prepare("delete from sync_checkpoint").run();
    db.prepare("delete from sync_run").run();
  })();
  return [
    "garmin_raw_payload",
    "activity_stream_point",
    "activity_lap",
    "activity_detail_availability",
    "garmin_athlete_baseline",
    "garmin_athlete_baseline_attempt",
    "garmin_body_metrics",
    "garmin_body_metric_attempt",
    "garmin_body_weight_history",
    "activity",
    "daily_health",
    "sync_checkpoint",
    "sync_run",
  ];
}
