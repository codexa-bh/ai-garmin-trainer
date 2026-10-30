import { buildDashboardDetail } from "../local-data/dashboard-policy";
import {
  interpretEffortCoverage,
  interpretHealthCoverage,
} from "../local-data/coverage-policy";
import {
  storedHeartRateZoneTime,
  streamHeartRateZoneTime,
} from "../local-data/heart-rate-policy";
import {
  boundedInteger,
  interpretActivityReference,
} from "../local-data/activity-policy";
import {
  dailyHealthMetricFields,
  mergeDailyHealth,
  dailyHealthTrailingCriteria,
  dailyHealthRefreshCutoff,
  shiftIsoDate,
} from "../local-data/health-policy";
export { DAILY_HEALTH_MUTABLE_TRAILING_DAYS } from "../local-data/health-policy";
import type {
  ActivityDashboardListPage,
  ActivityDashboardHeartRateZoneTime,
  ActivityDashboardDetail,
  ActivityEffortCoverage,
  ActivityReferenceInput,
  ActivityVerificationEvidence,
  DailyHealthFreshnessEvidence,
  ActivityAnalyticsDetail,
  LocalDataCounts,
  LocalImportSummary,
} from "../local-data/contracts";
export type {
  ActivityDashboardListItem,
  ActivityDashboardListPage,
  ActivityDashboardHeartRateZoneBucket,
  ActivityDashboardHeartRateZoneTime,
  ActivityDashboardDetail,
  ActivityEffortCoverage,
  ActivityReferenceInput,
  ActivityVerificationEvidence,
  DailyHealthFreshnessEvidence,
  ActivityAnalyticsDetail,
  LocalDataCounts,
  LocalImportSummary,
} from "../local-data/contracts";
import {
  buildActivityDashboardCharts,
  buildActivityDashboardRoute,
} from "../analytics/activity-dashboard-calculations";
import type {
  ActivityDashboardChartRow,
  ActivityDashboardRoutePoint,
} from "../analytics/activity-dashboard-calculations";
export {
  ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC,
  ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC,
} from "../analytics/activity-dashboard-calculations";
import { getDatabase } from "./connection";
export { getDatabase } from "./connection";
import { EMPTY_GARMIN_ATHLETE_VALUES } from "../garmin/athlete-normalize";
import { EMPTY_GARMIN_BODY_METRIC_VALUES } from "../garmin/body-metrics-normalize";
import type {
  GarminAthleteBaselineAvailability,
  GarminAthleteBaselineDto,
  GarminAthleteBaselineSnapshot,
  GarminBodyMetricsAvailability,
  GarminBodyMetricsDto,
  GarminBodyMetricsSnapshot,
  GarminBodyWeightHistorySource,
  GarminCurrentWeightSource,
  GarminWeighInAvailability,
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
export { getTrainerProfile, saveTrainerProfile } from "./profile-repository";
export type {
  TrainerMemoryStatus,
  TrainerMemoryCategory,
  StoredTrainerMemory,
} from "../memory/legacy-contracts";
import {
  redactGarminRawPayload,
  type GarminRawContentType,
  type GarminRawSubjectType,
} from "../garmin/raw-payload";
import { dailyHealthAvailability } from "../garmin/normalize";

import type { HealthCoverage } from "../garmin/import-contracts";

export type SyncRunOptions = {
  coverageStart?: string | null;
  coverageEnd?: string | null;
  lastError?: string | null;
};

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

export function upsertActivities(activities: NormalizedActivity[]): number {
  const db = getDatabase();
  const insert = db.prepare(`
    insert into activity (id, garmin_id, name, sport, started_at, duration_sec, distance_meters, calories, avg_heart_rate, max_heart_rate, steps, elevation_gain_meters, elevation_loss_meters, training_effect, anaerobic_training_effect, training_effect_label, training_load, moderate_intensity_minutes, vigorous_intensity_minutes, total_intensity_minutes, source_updated_at)
    values (@id, @garminId, @name, @sport, @startedAt, @durationSec, @distanceMeters, @calories, @avgHeartRate, @maxHeartRate, @steps, @elevationGainMeters, @elevationLossMeters, @trainingEffect, @anaerobicTrainingEffect, @trainingEffectLabel, @trainingLoad, @moderateIntensityMinutes, @vigorousIntensityMinutes, @totalIntensityMinutes, @sourceUpdatedAt)
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
      training_effect=coalesce(excluded.training_effect, activity.training_effect),
      anaerobic_training_effect=coalesce(excluded.anaerobic_training_effect, activity.anaerobic_training_effect),
      training_effect_label=coalesce(excluded.training_effect_label, activity.training_effect_label),
      training_load=coalesce(excluded.training_load, activity.training_load),
      moderate_intensity_minutes=coalesce(excluded.moderate_intensity_minutes, activity.moderate_intensity_minutes),
      vigorous_intensity_minutes=coalesce(excluded.vigorous_intensity_minutes, activity.vigorous_intensity_minutes),
      total_intensity_minutes=coalesce(excluded.total_intensity_minutes, activity.total_intensity_minutes),
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
        trainingEffect: activity.trainingEffect ?? null,
        anaerobicTrainingEffect: activity.anaerobicTrainingEffect ?? null,
        trainingEffectLabel: activity.trainingEffectLabel ?? null,
        trainingLoad: activity.trainingLoad ?? null,
        moderateIntensityMinutes: activity.moderateIntensityMinutes ?? null,
        vigorousIntensityMinutes: activity.vigorousIntensityMinutes ?? null,
        totalIntensityMinutes: activity.totalIntensityMinutes ?? null,
        sourceUpdatedAt: now,
      });
    }
  });
  run(activities);
  return activities.length;
}

export function upsertDailyHealth(days: NormalizedDailyHealth[]): number {
  const db = getDatabase();
  const byDate = db.prepare(`
    select date, sleep_minutes as sleepMinutes, sleep_score as sleepScore,
           sleep_deep_minutes as sleepDeepMinutes,
           sleep_light_minutes as sleepLightMinutes,
           sleep_rem_minutes as sleepRemMinutes,
           sleep_awake_minutes as sleepAwakeMinutes,
           sleep_nap_minutes as sleepNapMinutes,
           resting_heart_rate as restingHeartRate,
           hrv_status as hrvStatus, hrv_ms as hrvMs, stress_avg as stressAvg,
           steps, calories, active_calories as activeCalories,
           resting_calories as restingCalories, total_calories as totalCalories,
           intensity_minutes as intensityMinutes, body_battery_avg as bodyBatteryAvg,
           body_battery_morning as bodyBatteryMorning,
           body_battery_evening as bodyBatteryEvening, availability
    from daily_health where date = ?
  `);
  const insert = db.prepare(`
    insert into daily_health (date, sleep_minutes, sleep_score, sleep_deep_minutes, sleep_light_minutes, sleep_rem_minutes, sleep_awake_minutes, sleep_nap_minutes, resting_heart_rate, hrv_status, hrv_ms, stress_avg, steps, calories, active_calories, resting_calories, total_calories, intensity_minutes, body_battery_avg, body_battery_morning, body_battery_evening, availability)
    values (@date, @sleepMinutes, @sleepScore, @sleepDeepMinutes, @sleepLightMinutes, @sleepRemMinutes, @sleepAwakeMinutes, @sleepNapMinutes, @restingHeartRate, @hrvStatus, @hrvMs, @stressAvg, @steps, @calories, @activeCalories, @restingCalories, @totalCalories, @intensityMinutes, @bodyBatteryAvg, @bodyBatteryMorning, @bodyBatteryEvening, @availability)
    on conflict(date) do update set
      sleep_minutes=excluded.sleep_minutes,
      sleep_score=excluded.sleep_score,
      sleep_deep_minutes=excluded.sleep_deep_minutes,
      sleep_light_minutes=excluded.sleep_light_minutes,
      sleep_rem_minutes=excluded.sleep_rem_minutes,
      sleep_awake_minutes=excluded.sleep_awake_minutes,
      sleep_nap_minutes=excluded.sleep_nap_minutes,
      resting_heart_rate=excluded.resting_heart_rate,
      hrv_status=excluded.hrv_status,
      hrv_ms=excluded.hrv_ms,
      stress_avg=excluded.stress_avg,
      steps=excluded.steps,
      calories=excluded.calories,
      active_calories=excluded.active_calories,
      resting_calories=excluded.resting_calories,
      total_calories=excluded.total_calories,
      intensity_minutes=excluded.intensity_minutes,
      body_battery_avg=excluded.body_battery_avg,
      body_battery_morning=excluded.body_battery_morning,
      body_battery_evening=excluded.body_battery_evening,
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

export function getDailyHealthFreshnessEvidence(
  date: string,
): DailyHealthFreshnessEvidence | null {
  const row = getDatabase()
    .prepare(
      `select ? as date,
              daily_health.availability as availability,
              exists (
                select 1 from garmin_raw_payload
                where subject_type = 'daily_health'
                  and source_tool = 'get_stats'
                  and subject_id = ? || ':stats'
              ) as hasStatsPayload,
              exists (
                select 1 from garmin_raw_payload
                where subject_type = 'daily_health'
                  and source_tool = 'get_sleep_summary'
                  and subject_id = ? || ':sleep'
              ) as hasSleepPayload,
              exists (
                select 1 from garmin_raw_payload
                where subject_type = 'daily_health'
                  and source_tool = 'get_body_battery'
                  and subject_id = ? || ':body_battery'
              ) as hasBodyBatteryPayload
       from (select 1) seed
       left join daily_health on daily_health.date = ?`,
    )
    .get(date, date, date, date, date) as
    | {
        date: string;
        availability: NormalizedDailyHealth["availability"] | null;
        hasStatsPayload: 0 | 1;
        hasSleepPayload: 0 | 1;
        hasBodyBatteryPayload: 0 | 1;
      }
    | undefined;
  if (!row) return null;
  return {
    date: row.date,
    availability: row.availability,
    hasStatsPayload: Boolean(row.hasStatsPayload),
    hasSleepPayload: Boolean(row.hasSleepPayload),
    hasBodyBatteryPayload: Boolean(row.hasBodyBatteryPayload),
  };
}

export function listDailyHealthMissingGapDates(input: {
  startDate: string;
  endDate: string;
  limit?: number;
}): string[] {
  const safeLimit = Math.min(
    Math.max(Math.trunc(input.limit ?? 1000), 1),
    1000,
  );
  if (input.startDate > input.endDate) return [];
  const rows = getDatabase()
    .prepare(
      `with recursive candidate_dates(date) as (
         select ?
         union all
         select date(candidate_dates.date, '+1 day')
         from candidate_dates
         where candidate_dates.date < ?
       )
       select candidate_dates.date as date
       from candidate_dates
       left join daily_health on daily_health.date = candidate_dates.date
       where daily_health.date is null
       order by candidate_dates.date asc
       limit ?`,
    )
    .all(input.startDate, input.endDate, safeLimit) as Array<{ date: string }>;
  return rows.map((row) => row.date);
}

export function listDailyHealthRepairCandidateDates(input: {
  startDate: string;
  endDate: string;
  limit?: number;
}): string[] {
  const safeLimit = Math.min(Math.max(Math.trunc(input.limit ?? 500), 1), 1000);
  const rows = getDatabase()
    .prepare(
      `select daily_health.date as date
       from daily_health
       where daily_health.availability = 'missing'
         and daily_health.date between ? and ?
         and (
           not exists (
             select 1 from garmin_raw_payload
             where subject_type = 'daily_health'
               and source_tool = 'get_stats'
               and subject_id = daily_health.date || ':stats'
           )
           or not exists (
             select 1 from garmin_raw_payload
             where subject_type = 'daily_health'
               and source_tool = 'get_sleep_summary'
               and subject_id = daily_health.date || ':sleep'
           )
         )
       order by daily_health.date asc
       limit ?`,
    )
    .all(input.startDate, input.endDate, safeLimit) as Array<{ date: string }>;
  return rows.map((row) => row.date);
}

export function listDailyHealthIntensityRepairCandidateDates(input: {
  startDate: string;
  endDate: string;
  limit?: number;
}): string[] {
  const safeLimit = Math.min(
    Math.max(Math.trunc(input.limit ?? 1000), 1),
    1000,
  );
  const rows = getDatabase()
    .prepare(
      `select daily_health.date as date
       from daily_health
       where daily_health.intensity_minutes is null
         and daily_health.date between ? and ?
         and (
           daily_health.steps is not null
           or coalesce(daily_health.total_calories, daily_health.calories) is not null
           or daily_health.active_calories is not null
           or daily_health.resting_calories is not null
         )
         and not exists (
           select 1 from garmin_raw_payload
           where subject_type = 'daily_health'
             and source_tool = 'get_stats'
             and subject_id = daily_health.date || ':stats'
         )
       order by daily_health.date asc
       limit ?`,
    )
    .all(input.startDate, input.endDate, safeLimit) as Array<{ date: string }>;
  return rows.map((row) => row.date);
}

export function listDailyHealthTrailingCandidateDates(input: {
  startDate: string;
  endDate: string;
  mutableTrailingDays?: number;
  limit?: number;
}): string[] {
  const { safeLimit, startDate } = dailyHealthTrailingCriteria(input);
  if (startDate > input.endDate) return [];
  const rows = getDatabase()
    .prepare(
      `with recursive candidate_dates(date) as (
         select ?
         union all
         select date(candidate_dates.date, '+1 day')
         from candidate_dates
         where candidate_dates.date < ?
       )
       select candidate_dates.date as date
       from candidate_dates
       left join daily_health on daily_health.date = candidate_dates.date
       where daily_health.date is null
          or daily_health.availability <> 'complete'
          or candidate_dates.date >= ?
          or (
            select count(distinct source_tool) from garmin_raw_payload
            where subject_type = 'daily_health'
              and fetched_at > ?
              and (
                (source_tool = 'get_stats' and subject_id = candidate_dates.date || ':stats')
                or (source_tool = 'get_sleep_summary' and subject_id = candidate_dates.date || ':sleep')
                or (source_tool = 'get_body_battery' and subject_id = candidate_dates.date || ':body_battery')
              )
          ) < 3
       order by candidate_dates.date asc
       limit ?`,
    )
    // Coverage is not finality: today/yesterday always refresh; older complete
    // days retry daily while in the tail, even after unchanged/empty responses.
    .all(
      startDate,
      input.endDate,
      shiftIsoDate(input.endDate, -1),
      dailyHealthRefreshCutoff(Date.now()),
      safeLimit,
    ) as Array<{ date: string }>;
  return rows.map((row) => row.date);
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
  anaerobicTrainingEffect: number | null;
  trainingEffectLabel: string | null;
  trainingLoad: number | null;
  moderateIntensityMinutes: number | null;
  vigorousIntensityMinutes: number | null;
  totalIntensityMinutes: number | null;
};

const activitySelectColumns = `garmin_id as garminId, name, sport, started_at as startedAt, duration_sec as durationSec,
              distance_meters as distanceMeters, calories, avg_heart_rate as avgHeartRate,
              max_heart_rate as maxHeartRate, steps, elevation_gain_meters as elevationGainMeters,
              elevation_loss_meters as elevationLossMeters, training_effect as trainingEffect,
              anaerobic_training_effect as anaerobicTrainingEffect, training_effect_label as trainingEffectLabel,
              training_load as trainingLoad, moderate_intensity_minutes as moderateIntensityMinutes,
              vigorous_intensity_minutes as vigorousIntensityMinutes, total_intensity_minutes as totalIntensityMinutes`;

function normalizeActivityRow<T extends ActivityRow>(
  row: T,
): Omit<T, "startedAt"> & {
  startedAt: Date;
} {
  return { ...row, startedAt: new Date(row.startedAt) };
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

export function listActivityIdsNeedingEffortBackfill(limit = 50): string[] {
  const safeLimit = boundedInteger(limit, 50, 1, 1000);
  const rows = getDatabase()
    .prepare(
      `select garmin_id as garminId
       from activity
       where training_effect is null
         and anaerobic_training_effect is null
         and training_effect_label is null
         and training_load is null
         and moderate_intensity_minutes is null
         and vigorous_intensity_minutes is null
         and total_intensity_minutes is null
       order by started_at desc
       limit ?`,
    )
    .all(safeLimit) as Array<{ garminId: string }>;
  return rows.map((row) => row.garminId);
}

export function activityEffortCoverage(): ActivityEffortCoverage {
  const row = getDatabase()
    .prepare(
      `select count(*) as total,
              sum(case when training_effect is not null
                         or anaerobic_training_effect is not null
                         or training_effect_label is not null
                         or training_load is not null
                         or moderate_intensity_minutes is not null
                         or vigorous_intensity_minutes is not null
                         or total_intensity_minutes is not null then 1 else 0 end) as withAnyEffortField,
              sum(case when moderate_intensity_minutes is not null
                         or vigorous_intensity_minutes is not null
                         or total_intensity_minutes is not null then 1 else 0 end) as withIntensityMinutes,
              sum(case when training_load is not null then 1 else 0 end) as withTrainingLoad,
              sum(case when anaerobic_training_effect is not null then 1 else 0 end) as withAnaerobicTrainingEffect,
              sum(case when training_effect is null
                         and anaerobic_training_effect is null
                         and training_effect_label is null
                         and training_load is null
                         and moderate_intensity_minutes is null
                         and vigorous_intensity_minutes is null
                         and total_intensity_minutes is null then 1 else 0 end) as needingBackfill
       from activity`,
    )
    .get() as Record<keyof ActivityEffortCoverage, number | null>;
  return interpretEffortCoverage(row);
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
      `select date, sleep_minutes as sleepMinutes, sleep_score as sleepScore,
              sleep_deep_minutes as sleepDeepMinutes,
              sleep_light_minutes as sleepLightMinutes,
              sleep_rem_minutes as sleepRemMinutes,
              sleep_awake_minutes as sleepAwakeMinutes,
              sleep_nap_minutes as sleepNapMinutes,
              resting_heart_rate as restingHeartRate,
              hrv_status as hrvStatus, hrv_ms as hrvMs, stress_avg as stressAvg,
              steps, calories, active_calories as activeCalories,
              resting_calories as restingCalories, total_calories as totalCalories,
              intensity_minutes as intensityMinutes, body_battery_avg as bodyBatteryAvg,
              body_battery_morning as bodyBatteryMorning,
              body_battery_evening as bodyBatteryEvening, availability
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
  return storedHeartRateZoneTime(rows, baseline, activityDurationSec);
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
  if (baseline.status === "unavailable" || baseline.boundaries.length !== 5) {
    return streamHeartRateZoneTime([], baseline, activityDurationSec);
  }
  const stream = getDatabase()
    .prepare(
      `select elapsed_sec as elapsedSec, heart_rate as heartRate
       from activity_stream_point where garmin_id = ? order by elapsed_sec`,
    )
    .all(garminId) as Array<{ elapsedSec: number; heartRate: number | null }>;
  return streamHeartRateZoneTime(stream, baseline, activityDurationSec);
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

function normalizeHistorySource(
  value: string | null,
): GarminBodyWeightHistorySource {
  if (value === "weigh_in" || value === "body_composition" || value === "mixed")
    return value;
  return null;
}

function normalizeCurrentWeightSource(
  value: string | null,
): GarminCurrentWeightSource {
  return value === "profile" || value === "weigh_in" ? value : null;
}

function normalizeWeighInAvailability(
  value: string | null,
): GarminWeighInAvailability {
  return value === "available" || value === "unavailable" || value === "failed"
    ? value
    : null;
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
        `insert into garmin_body_metrics (id, fetched_at, source, availability, weight_kg, height_cm, history_availability, history_range_start, history_range_end, history_count, history_source, current_weight_source, weigh_in_availability)
         values ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.snapshot.history.source ?? null,
        input.snapshot.currentWeightSource ?? null,
        input.snapshot.weighInAvailability ?? null,
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
      `select fetched_at as fetchedAt, source, availability, weight_kg as weightKg, height_cm as heightCm, history_availability as historyAvailability, history_range_start as historyRangeStart, history_range_end as historyRangeEnd, history_count as historyCount, history_source as historySource, current_weight_source as currentWeightSource, weigh_in_availability as weighInAvailability from garmin_body_metrics where id = 'default'`,
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
        historySource: string | null;
        currentWeightSource: string | null;
        weighInAvailability: string | null;
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
          source: normalizeHistorySource(metrics.historySource),
          rangeStart: metrics.historyRangeStart,
          rangeEnd: metrics.historyRangeEnd,
          count: metrics.historyCount,
        }
      : {
          availability: "unavailable",
          source: null,
          rangeStart: null,
          rangeEnd: null,
          count: 0,
        },
    currentWeightSource: normalizeCurrentWeightSource(
      metrics?.currentWeightSource ?? null,
    ),
    weighInAvailability: normalizeWeighInAvailability(
      metrics?.weighInAvailability ?? null,
    ),
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
      `select ${activitySelectColumns}
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

export function getActivityDetailForAnalytics(
  garminId: string,
): ActivityAnalyticsDetail {
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

/** Selected normalized evidence only; cap+1 makes overflow observable. No archives. */
export function getActivityTerrainInput(garminId: string) {
  const activity = getActivityByGarminId(garminId);
  const points =
    activity &&
    ["hike", "hiking", "walk", "walking"].includes(activity.sport.toLowerCase())
      ? (getDatabase()
          .prepare(
            `select timestamp, elapsed_sec as elapsedSec,
        distance_meters as distanceMeters, altitude_meters as altitudeMeters, heart_rate as heartRate
        from activity_stream_point where garmin_id = ? order by elapsed_sec limit 100001`,
          )
          .all(
            garminId,
          ) as import("../analytics/terrain-sections").TerrainPoint[])
      : [];
  return { sport: activity?.sport ?? null, points };
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
      `select elapsed_sec as elapsedSec, timestamp, distance_meters as distanceMeters,
              heart_rate as heartRate, altitude_meters as altitudeMeters,
              grade_pct as gradePct
       from activity_stream_point
       where garmin_id = ? and (heart_rate is not null or altitude_meters is not null or distance_meters is not null)
       order by elapsed_sec`,
    )
    .all(garminId) as ActivityDashboardChartRow[];
  const charts = buildActivityDashboardCharts(chartRows, activity.durationSec);
  const routeRows = db
    .prepare(
      `select elapsed_sec as elapsedSec, lat, lon,
              altitude_meters as altitudeMeters, grade_pct as gradePct
       from activity_stream_point
       where garmin_id = ? and lat is not null and lon is not null
       order by elapsed_sec`,
    )
    .all(garminId) as ActivityDashboardRoutePoint[];
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
  return buildDashboardDetail(
    activity,
    availability,
    charts,
    route,
    laps,
    getActivityHeartRateZoneTime(garminId, activity.durationSec),
  );
}

export function listActivitiesForComparison(
  limit?: number,
): NormalizedActivity[] {
  const query = `select ${activitySelectColumns}
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
    anaerobicTrainingEffect: number | null;
    trainingEffectLabel: string | null;
    trainingLoad: number | null;
    moderateIntensityMinutes: number | null;
    vigorousIntensityMinutes: number | null;
    totalIntensityMinutes: number | null;
  }>;
  return rows.map((row) => ({ ...row, startedAt: new Date(row.startedAt) }));
}

export function verifyActivityReference(
  reference: ActivityReferenceInput,
  matchLimit = 5,
): ActivityVerificationEvidence {
  return interpretActivityReference(
    listActivitiesForComparison(),
    reference,
    matchLimit,
  );
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
              coalesce(sum(case when coalesce(total_calories, calories) is not null then 1 else 0 end), 0) as calorieDays,
              coalesce(sum(case when intensity_minutes is not null then 1 else 0 end), 0) as intensityDays,
              coalesce(sum(case when body_battery_morning is not null or body_battery_evening is not null or body_battery_avg is not null then 1 else 0 end), 0) as bodyBatteryDays
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
    intensityDays: number;
    bodyBatteryDays: number;
  };
  return interpretHealthCoverage(row);
}

export function dataCounts(): LocalDataCounts {
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
    activityEffortCoverage: activityEffortCoverage(),
  };
}

export function importSummary(): LocalImportSummary {
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

export { clearChatAndProfile, clearGarminData } from "./local-data-lifecycle";

export {
  DEFAULT_CONVERSATION_ID,
  safeConversationId,
  getConversation,
  ensureConversation,
  createConversation,
  listConversations,
  renameConversation,
  appendChatMessage,
  listRecentChatMessages,
  listChatMessagePage,
} from "./conversation-repository";

export {
  deleteConversation,
  clearConversationHistory,
} from "./conversation-lifecycle";
