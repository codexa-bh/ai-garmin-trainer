import type Database from "better-sqlite3";
import { getDatabase } from "./connection";
import type {
  ActivityListExtras,
  DailyExtras,
  ExtraCoverage,
  FitActivityExtras,
  FitDynamics,
} from "../garmin/extra-types";

/**
 * Storage for the additional Garmin evidence relations. Scalars use coalesce
 * upserts (a missing value never erases a stored one); child sets are replaced
 * only when their source object was actually returned. Coverage is written in
 * the same transaction, after its data.
 */
type Db = Database.Database;

function coverageWriter(db: Db, now: number) {
  const insert = db.prepare(`
    insert into garmin_data_coverage (data_group, subject_type, subject_id, status, reason, updated_at)
    values (@group, @subjectType, @subjectId, @status, @reason, @now)
    on conflict(data_group, subject_type, subject_id) do update set
      status=excluded.status, reason=excluded.reason, updated_at=excluded.updated_at
    where not (
      excluded.status in ('failed','unavailable','empty')
      and garmin_data_coverage.status = 'populated'
    )
  `);
  // A later failure/empty read never demotes durable populated evidence.
  return (entries: ExtraCoverage[]) => {
    for (const entry of entries) insert.run({ ...entry, now });
  };
}

function coalesceUpdate(columns: string[]): string {
  return columns
    .map((column) => `${column}=coalesce(excluded.${column}, ${column})`)
    .join(", ");
}

const SLEEP_COLUMNS = [
  "start_gmt_ms",
  "end_gmt_ms",
  "start_local",
  "end_local",
  "utc_offset_minutes",
  "awake_count",
  "avg_sleep_stress",
  "avg_heart_rate",
  "unmeasurable_seconds",
  "window_confirmation_type",
  "overall_score",
  "overall_qualifier",
  "feedback_code",
  "insight_code",
  "personalized_insight_code",
];
const HRV_COLUMNS = [
  "weekly_avg_ms",
  "last_night_5min_high_ms",
  "baseline_low_upper_ms",
  "baseline_balanced_low_ms",
  "baseline_balanced_upper_ms",
  "baseline_marker_value",
  "feedback_code",
];
const BATTERY_COLUMNS = [
  "min_level",
  "max_level",
  "charged",
  "drained",
  "latest_level",
  "end_of_day_level",
  "feedback_level",
  "feedback_at_gmt",
  "feedback_short_code",
  "feedback_long_code",
  "end_of_day_feedback_level",
  "end_of_day_feedback_at_gmt",
  "end_of_day_feedback_short_code",
  "end_of_day_feedback_long_code",
];
const STRESS_COLUMNS = [
  "avg_level",
  "max_level",
  "qualifier",
  "total_seconds",
  "rest_seconds",
  "activity_seconds",
  "uncategorized_seconds",
  "low_seconds",
  "medium_seconds",
  "high_seconds",
  "rest_fraction",
  "activity_fraction",
  "uncategorized_fraction",
  "low_fraction",
  "medium_fraction",
  "high_fraction",
];

function upsertSql(table: string, key: string[], columns: string[]): string {
  const all = [...key, ...columns, "fetched_at"];
  return `insert into ${table} (${all.join(", ")}) values (${all
    .map((column) => `@${column}`)
    .join(", ")}) on conflict(${key.join(", ")}) do update set ${coalesceUpdate(
    columns,
  )}, fetched_at=excluded.fetched_at`;
}

export function upsertDailyExtras(
  days: DailyExtras[],
  db: Db = getDatabase(),
): number {
  const now = Date.now();
  const sleep = db.prepare(
    upsertSql("daily_sleep_detail", ["date"], SLEEP_COLUMNS),
  );
  // Components are keyed by name: merge per component so a refresh that omits
  // one never erases it, and a returned value/qualifier replaces its own row.
  const component = db.prepare(`
    insert into daily_sleep_score_component (date, component, value, qualifier, optimal_start, optimal_end, ideal_start_seconds, ideal_end_seconds)
    values (@date, @component, @value, @qualifier, @optimalStart, @optimalEnd, @idealStartSeconds, @idealEndSeconds)
    on conflict(date, component) do update set
      value=coalesce(excluded.value, value),
      qualifier=coalesce(excluded.qualifier, qualifier),
      optimal_start=coalesce(excluded.optimal_start, optimal_start),
      optimal_end=coalesce(excluded.optimal_end, optimal_end),
      ideal_start_seconds=coalesce(excluded.ideal_start_seconds, ideal_start_seconds),
      ideal_end_seconds=coalesce(excluded.ideal_end_seconds, ideal_end_seconds)
  `);
  const hrv = db.prepare(upsertSql("daily_hrv_detail", ["date"], HRV_COLUMNS));
  const battery = db.prepare(
    upsertSql("daily_body_battery", ["date"], BATTERY_COLUMNS),
  );
  const deleteEvents = db.prepare(
    "delete from body_battery_event where date = ?",
  );
  const event = db.prepare(`
    insert into body_battery_event (date, event_key, event_type, start_gmt, start_local, duration_seconds, impact, feedback_type, short_feedback, source_activity_id)
    values (@date, @eventKey, @eventType, @startGmt, @startLocal, @durationSeconds, @impact, @feedbackType, @shortFeedback, @sourceActivityId)
  `);
  const stress = db.prepare(
    upsertSql("daily_stress", ["date"], STRESS_COLUMNS),
  );
  const vo2 = db.prepare(`
    insert into vo2_max_reading (date, branch, vo2_max, vo2_max_precise, sport, sub_sport, fetched_at)
    values (@date, @branch, @vo2Max, @vo2MaxPrecise, @sport, @subSport, @now)
    on conflict(date, branch) do update set vo2_max=excluded.vo2_max, vo2_max_precise=excluded.vo2_max_precise,
      sport=coalesce(excluded.sport, sport), sub_sport=coalesce(excluded.sub_sport, sub_sport), fetched_at=excluded.fetched_at
  `);
  const writeCoverage = coverageWriter(db, now);
  db.transaction(() => {
    for (const day of days) {
      const base = { date: day.date, fetched_at: now };
      if (day.sleep) {
        const d = day.sleep.detail;
        sleep.run({
          ...base,
          start_gmt_ms: d.startGmtMs,
          end_gmt_ms: d.endGmtMs,
          start_local: d.startLocal,
          end_local: d.endLocal,
          utc_offset_minutes: d.utcOffsetMinutes,
          awake_count: d.awakeCount,
          avg_sleep_stress: d.avgSleepStress,
          avg_heart_rate: d.avgHeartRate,
          unmeasurable_seconds: d.unmeasurableSeconds,
          window_confirmation_type: d.windowConfirmationType,
          overall_score: d.overallScore,
          overall_qualifier: d.overallQualifier,
          feedback_code: d.feedbackCode,
          insight_code: d.insightCode,
          personalized_insight_code: d.personalizedInsightCode,
        });
        for (const item of day.sleep.components ?? [])
          component.run({ date: day.date, ...item });
      }
      if (day.hrv) {
        const h = day.hrv;
        hrv.run({
          ...base,
          weekly_avg_ms: h.weeklyAvgMs,
          last_night_5min_high_ms: h.lastNight5MinHighMs,
          baseline_low_upper_ms: h.baselineLowUpperMs,
          baseline_balanced_low_ms: h.baselineBalancedLowMs,
          baseline_balanced_upper_ms: h.baselineBalancedUpperMs,
          baseline_marker_value: h.baselineMarkerValue,
          feedback_code: h.feedbackCode,
        });
      }
      if (day.bodyBattery) {
        const b = day.bodyBattery.day;
        battery.run({
          ...base,
          min_level: b.minLevel,
          max_level: b.maxLevel,
          charged: b.charged,
          drained: b.drained,
          latest_level: b.latestLevel,
          end_of_day_level: b.endOfDayLevel,
          feedback_level: b.feedbackLevel,
          feedback_at_gmt: b.feedbackAtGmt,
          feedback_short_code: b.feedbackShortCode,
          feedback_long_code: b.feedbackLongCode,
          end_of_day_feedback_level: b.endOfDayFeedbackLevel,
          end_of_day_feedback_at_gmt: b.endOfDayFeedbackAtGmt,
          end_of_day_feedback_short_code: b.endOfDayFeedbackShortCode,
          end_of_day_feedback_long_code: b.endOfDayFeedbackLongCode,
        });
        // A returned list (even empty) is the day's complete event set: an
        // ongoing event's duration (part of its identity) changes during the
        // day, so merging would double-count. An absent list preserves rows.
        if (day.bodyBattery.events) {
          deleteEvents.run(day.date);
          for (const item of day.bodyBattery.events)
            event.run({ date: day.date, ...item });
        }
      }
      if (day.stress) {
        const s = day.stress;
        stress.run({
          ...base,
          avg_level: s.avgLevel,
          max_level: s.maxLevel,
          qualifier: s.qualifier,
          total_seconds: s.totalSeconds,
          rest_seconds: s.restSeconds,
          activity_seconds: s.activitySeconds,
          uncategorized_seconds: s.uncategorizedSeconds,
          low_seconds: s.lowSeconds,
          medium_seconds: s.mediumSeconds,
          high_seconds: s.highSeconds,
          rest_fraction: s.restFraction,
          activity_fraction: s.activityFraction,
          uncategorized_fraction: s.uncategorizedFraction,
          low_fraction: s.lowFraction,
          medium_fraction: s.mediumFraction,
          high_fraction: s.highFraction,
        });
      }
      for (const reading of day.vo2 ?? []) vo2.run({ ...reading, now });
      writeCoverage(day.coverage);
    }
  })();
  return days.length;
}

const LIST_COLUMNS: Array<[string, keyof ActivityListExtras]> = [
  ["body_battery_delta", "bodyBatteryDelta"],
  ["avg_run_cadence_spm", "avgRunCadenceSpm"],
  ["max_run_cadence_spm", "maxRunCadenceSpm"],
  ["avg_double_cadence_spm", "avgDoubleCadenceSpm"],
  ["max_double_cadence_spm", "maxDoubleCadenceSpm"],
  ["avg_fractional_cadence_spm", "avgFractionalCadenceSpm"],
  ["max_fractional_cadence_spm", "maxFractionalCadenceSpm"],
  ["avg_stride_length_cm", "avgStrideLengthCm"],
  ["avg_vertical_oscillation_cm", "avgVerticalOscillationCm"],
  ["avg_ground_contact_time_ms", "avgGroundContactTimeMs"],
  ["avg_ground_contact_balance_pct", "avgGroundContactBalancePct"],
  ["avg_vertical_ratio_pct", "avgVerticalRatioPct"],
  ["avg_grade_adjusted_speed_mps", "avgGradeAdjustedSpeedMps"],
];
const FIT_COLUMNS: Array<[string, keyof FitDynamics]> = [
  ["fit_avg_cadence_cpm", "avgCadenceCpm"],
  ["fit_max_cadence_cpm", "maxCadenceCpm"],
  ["fit_total_cycles", "totalCycles"],
  ["fit_avg_vertical_oscillation_cm", "avgVerticalOscillationCm"],
  ["fit_avg_stance_time_ms", "avgStanceTimeMs"],
  ["fit_avg_stance_time_balance_pct", "avgStanceTimeBalancePct"],
  ["fit_avg_vertical_ratio_pct", "avgVerticalRatioPct"],
  ["fit_avg_step_length_m", "avgStepLengthM"],
  ["fit_avg_grade_adjusted_speed_mps", "avgGradeAdjustedSpeedMps"],
];

/** Only for activities already stored; extras never create activity rows. */
export function upsertActivityListExtras(
  items: ActivityListExtras[],
  db: Db = getDatabase(),
): number {
  const now = Date.now();
  const exists = db.prepare("select 1 from activity where garmin_id = ?");
  const metrics = db.prepare(
    upsertSql(
      "activity_extra_metrics",
      ["garmin_id"],
      LIST_COLUMNS.map(([column]) => column),
    ),
  );
  const deleteSplits = db.prepare(
    "delete from activity_split_summary where garmin_id = ?",
  );
  const split = db.prepare(`
    insert into activity_split_summary (garmin_id, split_type, split_count, duration_sec, distance_meters, avg_speed_mps, max_speed_mps, total_ascent_meters, elevation_loss_meters, avg_elevation_gain_meters, max_elevation_gain_meters, max_distance_meters, num_falls, num_climb_sends, fetched_at)
    values (@garminId, @splitType, @count, @durationSec, @distanceMeters, @avgSpeedMps, @maxSpeedMps, @totalAscentMeters, @elevationLossMeters, @avgElevationGainMeters, @maxElevationGainMeters, @maxDistanceMeters, @numFalls, @numClimbSends, @now)
  `);
  const writeCoverage = coverageWriter(db, now);
  let written = 0;
  db.transaction(() => {
    for (const item of items) {
      if (!exists.get(item.garminId)) continue;
      metrics.run({
        garmin_id: item.garminId,
        fetched_at: now,
        ...Object.fromEntries(
          LIST_COLUMNS.map(([column, key]) => [column, item[key]]),
        ),
      });
      if (item.splits && item.splits.length) {
        deleteSplits.run(item.garminId);
        for (const entry of item.splits)
          split.run({ garminId: item.garminId, ...entry, now });
      }
      writeCoverage(item.coverage);
      written += 1;
    }
  })();
  return written;
}

/**
 * FIT lap times are UTC. Stored lap text from earlier readers may omit the
 * zone or milliseconds, so compare instants (zone-less text read as UTC)
 * within two seconds; a missing or unparseable time never matches a present one.
 */
function sameLapStart(stored: string | null, decoded: string | null): boolean {
  if (stored === null || decoded === null) return stored === decoded;
  const instant = (value: string) =>
    Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  const a = instant(stored);
  const b = instant(decoded);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 2000;
}

/**
 * FIT session/lap dynamics and lap HR zones for one activity. Lap rows are
 * matched by count, lap number and start instant; mismatching stored laps
 * leave lap evidence unavailable rather than attaching it to different laps.
 */
export function upsertFitActivityExtras(
  garminId: string,
  extras: FitActivityExtras,
  db: Db = getDatabase(),
): { lapsMatched: boolean } {
  const now = Date.now();
  if (!db.prepare("select 1 from activity where garmin_id = ?").get(garminId))
    return { lapsMatched: false };
  const stored = db
    .prepare(
      "select lap_number as lapNumber, start_time as startTime from activity_lap where garmin_id = ? order by lap_number",
    )
    .all(garminId) as Array<{ lapNumber: number; startTime: string | null }>;
  const lapsMatched =
    stored.length === extras.laps.length &&
    stored.every(
      (lap, index) =>
        lap.lapNumber === extras.laps[index].lapNumber &&
        sameLapStart(lap.startTime, extras.laps[index].startTime),
    );
  const session = db.prepare(
    upsertSql(
      "activity_extra_metrics",
      ["garmin_id"],
      FIT_COLUMNS.map(([column]) => column),
    ),
  );
  const lap = db.prepare(`
    update activity_lap set
      fit_avg_cadence_cpm=coalesce(@avgCadenceCpm, fit_avg_cadence_cpm),
      fit_max_cadence_cpm=coalesce(@maxCadenceCpm, fit_max_cadence_cpm),
      fit_total_cycles=coalesce(@totalCycles, fit_total_cycles),
      fit_avg_vertical_oscillation_cm=coalesce(@avgVerticalOscillationCm, fit_avg_vertical_oscillation_cm),
      fit_avg_stance_time_ms=coalesce(@avgStanceTimeMs, fit_avg_stance_time_ms),
      fit_avg_step_length_m=coalesce(@avgStepLengthM, fit_avg_step_length_m)
    where garmin_id = @garminId and lap_number = @lapNumber
  `);
  const deleteZones = db.prepare(
    "delete from activity_lap_hr_zone_time where garmin_id = ?",
  );
  const zone = db.prepare(`
    insert into activity_lap_hr_zone_time (garmin_id, lap_number, bucket, zone, bucket_kind, seconds, lower_bpm, upper_bpm, calc_method, source_max_heart_rate, source_resting_heart_rate, fetched_at)
    values (@garminId, @lapNumber, @bucket, @zone, @kind, @seconds, @lowerBpm, @upperBpm, @calcMethod, @sourceMaxHeartRate, @sourceRestingHeartRate, @now)
  `);
  const writeCoverage = coverageWriter(db, now);
  db.transaction(() => {
    session.run({
      garmin_id: garminId,
      fetched_at: now,
      ...Object.fromEntries(
        FIT_COLUMNS.map(([column, key]) => [column, extras.session[key]]),
      ),
    });
    if (lapsMatched) {
      for (const item of extras.laps)
        lap.run({ garminId, lapNumber: item.lapNumber, ...item.dynamics });
      if (extras.lapZoneStatus.status === "populated") {
        deleteZones.run(garminId);
        for (const entry of extras.lapZones)
          for (const bucket of entry.buckets)
            zone.run({
              garminId,
              lapNumber: entry.lapNumber,
              calcMethod: entry.calcMethod,
              sourceMaxHeartRate: entry.sourceMaxHeartRate,
              sourceRestingHeartRate: entry.sourceRestingHeartRate,
              ...bucket,
              now,
            });
      }
    }
    writeCoverage([
      {
        group: "lap_hr_zones",
        subjectType: "activity",
        subjectId: garminId,
        ...(lapsMatched
          ? extras.lapZoneStatus
          : { status: "unavailable", reason: "stored-laps-differ" }),
      },
    ]);
  })();
  return { lapsMatched };
}

/** Coverage only (e.g. a failed or file-less read); never touches evidence rows. */
export function recordExtraCoverage(
  entries: ExtraCoverage[],
  db: Db = getDatabase(),
): void {
  const write = coverageWriter(db, Date.now());
  db.transaction(() => write(entries))();
}

/**
 * Explicit-target maintenance store for the extra-data backfill. It writes
 * only additional evidence, coverage and its own checkpoint key; it never
 * touches activity/daily_health core columns, laps/streams or sync state.
 */
export function createExtraBackfillStore(db: Db) {
  const checkpointKey = "garmin_extra_backfill";
  return {
    readCheckpoint(): string | null {
      const row = db
        .prepare("select value from sync_checkpoint where key = ?")
        .get(checkpointKey) as { value: string } | undefined;
      return row?.value ?? null;
    },
    /** Data and checkpoint commit together; a crash replays idempotently. */
    commit(work: () => void, checkpoint: string): void {
      db.transaction(() => {
        work();
        db.prepare(
          `insert into sync_checkpoint (key, value, updated_at) values (?, ?, ?)
           on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
        ).run(checkpointKey, checkpoint, Date.now());
      })();
    },
    upsertDailyExtras: (days: DailyExtras[]) => upsertDailyExtras(days, db),
    upsertActivityListExtras: (items: ActivityListExtras[]) =>
      upsertActivityListExtras(items, db),
    upsertFitActivityExtras: (garminId: string, extras: FitActivityExtras) =>
      upsertFitActivityExtras(garminId, extras, db),
    recordExtraCoverage: (entries: ExtraCoverage[]) =>
      recordExtraCoverage(entries, db),
    /** Stored activities by UTC start date, ordered for a stable cursor. */
    storedActivities(from: string, to: string) {
      return db
        .prepare(
          `select garmin_id as garminId, started_at as startedAt from activity
           where date(started_at / 1000, 'unixepoch') between ? and ?
           order by started_at, garmin_id`,
        )
        .all(from, to) as Array<{ garminId: string; startedAt: number }>;
    },
    /** Stored daily-health dates only: the backfill never invents days. */
    storedDates(from: string, to: string): string[] {
      return (
        db
          .prepare(
            "select date from daily_health where date between ? and ? order by date",
          )
          .all(from, to) as Array<{ date: string }>
      ).map((row) => row.date);
    },
    /** Stored daily steps (account-consistency evidence only). */
    storedSteps(from: string, to: string): Map<string, number> {
      const rows = db
        .prepare(
          "select date, steps from daily_health where date between ? and ? and steps is not null",
        )
        .all(from, to) as Array<{ date: string; steps: number }>;
      return new Map(rows.map((row) => [row.date, row.steps]));
    },
    /** Subjects whose group coverage exists and is not a failure. */
    settled(group: string, subjectIds: string[]): Set<string> {
      if (!subjectIds.length) return new Set();
      const rows = db
        .prepare(
          `select subject_id as id from garmin_data_coverage
           where data_group = ? and status <> 'failed'
           and subject_id in (select value from json_each(?))`,
        )
        .all(group, JSON.stringify(subjectIds)) as Array<{ id: string }>;
      return new Set(rows.map((row) => row.id));
    },
    coverageCounts(from: string, to: string) {
      return db
        .prepare(
          `select c.data_group as "group", c.status, count(*) as count
           from garmin_data_coverage c
           left join activity a on c.subject_type = 'activity' and a.garmin_id = c.subject_id
           where (c.subject_type = 'date' and c.subject_id between ? and ?)
              or (c.subject_type = 'activity' and date(a.started_at / 1000, 'unixepoch') between ? and ?)
           group by c.data_group, c.status order by 1, 2`,
        )
        .all(from, to, from, to) as Array<{
        group: string;
        status: string;
        count: number;
      }>;
    },
  };
}
