import { getDatabase } from "./connection";
import { deriveActivitySplitHeartRates } from "./split-heart-rate-repository";
import { SNOW_ACTIVITY_SPORTS } from "../garmin/extra-types";
import {
  ACTIVITY_LAP_LIMIT,
  ACTIVITY_SUPPLEMENT_GROUPS,
  HEALTH_SUPPLEMENT_GROUPS,
  SNOW_RUN_LIST_LIMIT,
  type ActivitySupplement,
  type HealthSupplements,
  type SupplementCoverage,
} from "../local-data/supplement-contracts";
import {
  interpretActivitySupplement,
  interpretHealthSupplements,
} from "../local-data/supplement-policy";

/**
 * Read-only, bounded reads of the normalized additional Garmin evidence for the
 * Health and Activity views. Every child relation is queried on its own real key
 * and joined in the interpretation policy, so one parent never multiplies rows.
 * Raw Garmin payloads, locations and free text are never selected.
 */

type CoverageRow = {
  subjectId: string;
  group: string;
  status: SupplementCoverage["status"];
  reason: string | null;
};

/** Closed short codes only; anything else is dropped rather than shown. */
function closedCode(value: string | null): string | null {
  return value !== null && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

function coverageBy(rows: CoverageRow[]) {
  const bySubject = new Map<string, Map<string, SupplementCoverage>>();
  for (const row of rows) {
    const groups = bySubject.get(row.subjectId) ?? new Map();
    groups.set(row.group, {
      status: row.status,
      reason: closedCode(row.reason),
    });
    bySubject.set(row.subjectId, groups);
  }
  return bySubject;
}

/**
 * Dated supplements over the same bounded window as the Health daily rows (the
 * newest `dayLimit` rows, oldest..latest date); null when no daily rows exist.
 */
export function getHealthSupplements(
  dayLimit: number,
): HealthSupplements | null {
  const db = getDatabase();
  const window = db
    .prepare(
      `select min(date) as "from", max(date) as "to"
       from (select date from daily_health order by date desc limit ?)`,
    )
    .get(dayLimit) as { from: string | null; to: string | null };
  if (!window.from || !window.to) return null;
  const { from, to } = window;
  const range = [from, to] as const;
  const sleep = db
    .prepare(
      "select date, overall_qualifier as overallQualifier from daily_sleep_detail where date between ? and ?",
    )
    .all(...range) as Array<{ date: string; overallQualifier: string | null }>;
  const components = db
    .prepare(
      `select date, component, value, qualifier from daily_sleep_score_component
       where date between ? and ? order by date, component`,
    )
    .all(...range) as Array<{
    date: string;
    component: string;
    value: number | null;
    qualifier: string | null;
  }>;
  const hrv = db
    .prepare(
      `select date, weekly_avg_ms as weeklyAvgMs, baseline_balanced_low_ms as balancedLowMs,
              baseline_balanced_upper_ms as balancedUpperMs, feedback_code as feedbackCode
       from daily_hrv_detail where date between ? and ?`,
    )
    .all(...range) as Array<{
    date: string;
    weeklyAvgMs: number | null;
    balancedLowMs: number | null;
    balancedUpperMs: number | null;
    feedbackCode: string | null;
  }>;
  const stress = db
    .prepare(
      `select date, total_seconds as totalSeconds, rest_seconds as restSeconds,
              low_seconds as lowSeconds, medium_seconds as mediumSeconds,
              high_seconds as highSeconds, activity_seconds as activitySeconds,
              uncategorized_seconds as uncategorizedSeconds
       from daily_stress where date between ? and ?`,
    )
    .all(...range) as Array<{
    date: string;
    totalSeconds: number | null;
    restSeconds: number | null;
    lowSeconds: number | null;
    mediumSeconds: number | null;
    highSeconds: number | null;
    activitySeconds: number | null;
    uncategorizedSeconds: number | null;
  }>;
  const battery = db
    .prepare(
      "select date, charged, drained from daily_body_battery where date between ? and ?",
    )
    .all(...range) as Array<{
    date: string;
    charged: number | null;
    drained: number | null;
  }>;
  const vo2 = db
    .prepare(
      `select date, branch, vo2_max as vo2Max, vo2_max_precise as vo2MaxPrecise,
              sport, sub_sport as subSport
       from vo2_max_reading where date between ? and ? order by date, branch`,
    )
    .all(...range) as HealthSupplements["vo2"];
  const coverage = db
    .prepare(
      `select subject_id as subjectId, data_group as "group", status, reason
       from garmin_data_coverage
       where subject_type = 'date' and subject_id between ? and ?
         and data_group in (${HEALTH_SUPPLEMENT_GROUPS.map(() => "?").join(",")})`,
    )
    .all(...range, ...HEALTH_SUPPLEMENT_GROUPS) as CoverageRow[];
  return interpretHealthSupplements({
    from,
    to,
    sleep: sleep.map((row) => ({
      ...row,
      overallQualifier: closedCode(row.overallQualifier),
    })),
    components: components.map((row) => ({
      ...row,
      qualifier: closedCode(row.qualifier),
    })),
    hrv: hrv.map((row) => ({
      ...row,
      feedbackCode: closedCode(row.feedbackCode),
    })),
    stress,
    battery,
    vo2: vo2.map((row) => ({
      ...row,
      sport: closedCode(row.sport),
      subSport: closedCode(row.subSport),
    })),
    coverage: coverageBy(coverage),
  });
}

/** Known-ID read for one activity; lap-zone rows are bounded by the lap bound. */
export function getActivitySupplement(garminId: string): ActivitySupplement {
  const db = getDatabase();
  const metrics = db
    .prepare(
      `select body_battery_delta as bodyBatteryDelta,
              avg_run_cadence_spm as avgSpm, max_run_cadence_spm as maxSpm,
              avg_stride_length_cm as strideLengthCm,
              fit_avg_cadence_cpm as fitAvgCpm, fit_avg_step_length_m as fitStepLengthM
       from activity_extra_metrics where garmin_id = ?`,
    )
    .get(garminId) as
    | {
        bodyBatteryDelta: number | null;
        avgSpm: number | null;
        maxSpm: number | null;
        strideLengthCm: number | null;
        fitAvgCpm: number | null;
        fitStepLengthM: number | null;
      }
    | undefined;
  const lapNumbers = (
    db
      .prepare(
        "select lap_number as lapNumber from activity_lap where garmin_id = ? order by lap_number limit ?",
      )
      .all(garminId, ACTIVITY_LAP_LIMIT) as Array<{ lapNumber: number }>
  ).map((lap) => lap.lapNumber);
  const zones = db
    .prepare(
      `select lap_number as lapNumber, bucket, bucket_kind as kind, zone, seconds,
              lower_bpm as lowerBpm, upper_bpm as upperBpm, calc_method as calcMethod,
              source_max_heart_rate as sourceMaxHeartRate,
              source_resting_heart_rate as sourceRestingHeartRate
       from activity_lap_hr_zone_time
       where garmin_id = ? and lap_number in (select lap_number from activity_lap where garmin_id = ? order by lap_number limit ?)
       order by lap_number, bucket`,
    )
    .all(garminId, garminId, ACTIVITY_LAP_LIMIT) as Array<{
    lapNumber: number;
    bucket: number;
    kind: "below" | "zone" | "above";
    zone: number | null;
    seconds: number;
    lowerBpm: number | null;
    upperBpm: number | null;
    calcMethod: string | null;
    sourceMaxHeartRate: number | null;
    sourceRestingHeartRate: number | null;
  }>;
  const totals = db
    .prepare(
      `select split_type as splitType, split_count as count, duration_sec as durationSec,
              distance_meters as distanceMeters, max_distance_meters as bestSplitDistanceMeters,
              max_speed_mps as maxSpeedMps
       from activity_split_summary where garmin_id = ? order by split_type`,
    )
    .all(garminId) as ActivitySupplement["snowTotals"];
  const activity = db
    .prepare("select sport from activity where garmin_id = ?")
    .get(garminId) as { sport: string } | undefined;
  const runTotal = db
    .prepare(
      "select count(*) as n from activity_snow_split where garmin_id = ? and split_type = 'run'",
    )
    .get(garminId) as { n: number };
  const runs = db
    .prepare(
      `select split_key as splitKey,
              timer_seconds as timerSeconds, distance_meters as distanceMeters,
              descent_meters as descentMeters, ascent_meters as ascentMeters,
              avg_speed_mps as avgSpeedMps, max_speed_mps as maxSpeedMps
       from activity_snow_split where garmin_id = ? and split_type = 'run'
       order by start_time is null, start_time, message_index, split_key limit ?`,
    )
    .all(
      garminId,
      SNOW_RUN_LIST_LIMIT,
    ) as ActivitySupplement["snowRuns"]["entries"];
  const derivedByKey = new Map(
    deriveActivitySplitHeartRates(db, garminId).map((split) => [
      split.splitKey,
      split.heartRate,
    ]),
  );
  const coverage = db
    .prepare(
      `select subject_id as subjectId, data_group as "group", status, reason
       from garmin_data_coverage
       where subject_type = 'activity' and subject_id = ?
         and data_group in (${ACTIVITY_SUPPLEMENT_GROUPS.map(() => "?").join(",")})`,
    )
    .all(garminId, ...ACTIVITY_SUPPLEMENT_GROUPS) as CoverageRow[];
  return interpretActivitySupplement({
    metrics: metrics ?? null,
    lapNumbers,
    zones: zones.map((row) => ({
      ...row,
      calcMethod: closedCode(row.calcMethod),
    })),
    totals,
    snowActivity: SNOW_ACTIVITY_SPORTS.some(
      (sport) => sport === activity?.sport,
    ),
    runTotal: runTotal.n,
    runs: runs.map((run) => ({
      ...run,
      heartRate: derivedByKey.get(run.splitKey),
    })),
    coverage: coverageBy(coverage).get(garminId) ?? new Map(),
  });
}
