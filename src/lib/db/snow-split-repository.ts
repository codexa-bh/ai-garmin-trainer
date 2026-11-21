import type Database from "better-sqlite3";
import type { SnowSplit, SnowSplitEvidence } from "../garmin/extra-types";
import type {
  SnowActivityEvidence,
  SnowSplitHeartRateEvidence,
} from "../local-data/contracts";
import { deriveActivitySplitHeartRates } from "./split-heart-rate-repository";

/** Per-type rows in the trainer overview; matches its optional-row bound. */
const SPLIT_HEART_RATE_ROW_LIMIT = 20;

const SPLIT_HEART_RATE_MEANING =
  "avgHeartRate and zoneSeconds are derived at read time from stored heart-rate samples inside each split's own measured window (duration-weighted, activity-file zone boundaries, bucket order below zone 1 then zones 1-5). They are not Garmin lap or session values and are never added to them. null with a reason is unavailable, never zero. Rows are capped per type: read sourceCount/omittedCount before generalizing across all runs or lifts.";

function splitHeartRateEvidence(
  db: Database.Database,
  garminId: string,
): SnowSplitHeartRateEvidence {
  const derived = deriveActivitySplitHeartRates(db, garminId);
  const lowerBounds =
    derived
      .map((split) => split.heartRate.zones.buckets)
      .find((buckets) => buckets !== null)
      ?.filter((bucket) => bucket.zone !== null)
      .map((bucket) => bucket.lowerBpm as number) ?? null;
  return {
    meaning: SPLIT_HEART_RATE_MEANING,
    zoneLowerBpm: lowerBounds,
    perTypeLimit: SPLIT_HEART_RATE_ROW_LIMIT,
    types: (["run", "lift"] as const).map((splitType) => {
      const all = derived.filter((split) => split.splitType === splitType);
      const rows = all.slice(0, SPLIT_HEART_RATE_ROW_LIMIT).map((split) => ({
        splitKey: split.splitKey,
        timerSeconds: split.timerSeconds,
        distanceMeters: split.distanceMeters,
        descentMeters: split.descentMeters,
        avgHeartRate: split.heartRate.avgHeartRate,
        supportSeconds: split.heartRate.supportSeconds,
        hrUnavailableReason: split.heartRate.unavailableReason,
        zoneSeconds:
          split.heartRate.zones.buckets?.map((bucket) => bucket.seconds) ??
          null,
        zoneUnavailableReason: split.heartRate.zones.unavailableReason,
      }));
      return {
        splitType,
        sourceCount: all.length,
        returnedCount: rows.length,
        omittedCount: all.length - rows.length,
        rows,
      };
    }),
  };
}

/** No locations or source identifiers enter the ordinary activity summary. */
export function snowActivityEvidence(
  db: Database.Database,
  garminId: string,
  options: { splitHeartRate?: boolean } = {},
): SnowActivityEvidence {
  const coverage = db
    .prepare(
      `select status, reason from garmin_data_coverage
    where data_group='snow_run_lift_splits' and subject_type='activity' and subject_id=?`,
    )
    .get(garminId) as SnowActivityEvidence["coverage"] | undefined;
  const types = db
    .prepare(
      `select split_type as splitType, count(*) as count,
    sum(distance_meters) as distanceMeters, sum(timer_seconds) as timerSeconds,
    sum(descent_meters) as descentMeters, count(distance_meters) as distanceMeasuredCount,
    count(timer_seconds) as timerMeasuredCount, count(descent_meters) as descentMeasuredCount
    from activity_snow_split where garmin_id=?
    group by split_type order by split_type`,
    )
    .all(garminId) as SnowActivityEvidence["types"];
  return {
    coverage: coverage ?? { status: "not_backfilled", reason: null },
    hrAssociation: "no-proven-lap-link",
    ...(options.splitHeartRate
      ? { splitHeartRate: splitHeartRateEvidence(db, garminId) }
      : {}),
    types,
  };
}

const COLUMNS: Array<[string, keyof SnowSplit]> = [
  ["message_index", "messageIndex"],
  ["source_order", "sourceOrder"],
  ["split_type", "splitType"],
  ["start_time", "startTime"],
  ["end_time", "endTime"],
  ["elapsed_seconds", "elapsedSeconds"],
  ["timer_seconds", "timerSeconds"],
  ["moving_seconds", "movingSeconds"],
  ["distance_meters", "distanceMeters"],
  ["avg_speed_mps", "avgSpeedMps"],
  ["max_speed_mps", "maxSpeedMps"],
  ["avg_vertical_speed_mps", "avgVerticalSpeedMps"],
  ["ascent_meters", "ascentMeters"],
  ["descent_meters", "descentMeters"],
  ["start_elevation_meters", "startElevationMeters"],
  ["start_lat", "startLat"],
  ["start_lon", "startLon"],
  ["end_lat", "endLat"],
  ["end_lon", "endLon"],
];

/** Split-only writer, also used by maintenance: no lap/dynamics/normal Sync writes. */
export function upsertSnowSplits(
  db: Database.Database,
  garminId: string,
  evidence: SnowSplitEvidence,
): void {
  db.transaction(() => {
    if (!db.prepare("select 1 from activity where garmin_id = ?").get(garminId))
      throw new Error("snow-parent-missing");
    if (evidence.status === "populated" && evidence.rows.length) {
      const names = COLUMNS.map(([name]) => name);
      const insert = db.prepare(`insert into activity_snow_split
        (garmin_id, split_key, ${names.join(",")}, fetched_at)
        values (@garminId, @splitKey, ${names.map((n) => `@${n}`).join(",")}, @now)
        on conflict(garmin_id, split_key) do update set
        ${names.map((n) => `${n}=coalesce(excluded.${n},${n})`).join(",")}, fetched_at=excluded.fetched_at`);
      const keys = evidence.rows.map((row) => row.splitKey);
      if (new Set(keys).size !== keys.length)
        throw new Error("snow-duplicate-key");
      for (const row of evidence.rows)
        insert.run({
          garminId,
          splitKey: row.splitKey,
          ...Object.fromEntries(COLUMNS.map(([name, key]) => [name, row[key]])),
          now: Date.now(),
        });
      db.prepare(
        `delete from activity_snow_split where garmin_id = ?
        and split_key not in (select value from json_each(?))`,
      ).run(garminId, JSON.stringify(keys));
    }
    // Empty/missing/error evidence never deletes useful rows. Latest attempt is
    // visible even when prior rows survive; it must not masquerade as complete.
    db.prepare(
      `insert into garmin_data_coverage (data_group, subject_type, subject_id, status, reason, updated_at)
      values ('snow_run_lift_splits','activity',?,?,?,?)
      on conflict(data_group,subject_type,subject_id) do update set
      status=excluded.status, reason=excluded.reason, updated_at=excluded.updated_at`,
    ).run(garminId, evidence.status, evidence.reason, Date.now());
  })();
}
