import type Database from "better-sqlite3";
import {
  deriveSplitHeartRate,
  prepareHeartRateSamples,
  resolveZoneBoundaries,
  type SplitHeartRate,
} from "../local-data/split-heart-rate";

/** One measured split with its read-time derived heart rate; no locations. */
export type DerivedSplit = {
  splitKey: string;
  splitType: "run" | "lift";
  timerSeconds: number | null;
  distanceMeters: number | null;
  descentMeters: number | null;
  heartRate: SplitHeartRate;
};

const FILE_BOUNDARY_SESSION_SOURCES = [
  "garmin_official_fit",
  "garmin_official_estimate",
];

/**
 * Activity-specific historical zone lower bounds from rows already stored for
 * this activity. Reading a lap row's boundaries never associates the lap with a
 * split; the current athlete baseline is never consulted.
 */
function storedZoneBoundaries(db: Database.Database, garminId: string) {
  const sessionRows = db
    .prepare(
      `select zone, source_lower_bpm as lower from activity_hr_zone_time
       where garmin_id = ? and status = 'available' and source in (${FILE_BOUNDARY_SESSION_SOURCES.map(() => "?").join(",")})
       order by zone`,
    )
    .all(garminId, ...FILE_BOUNDARY_SESSION_SOURCES) as Array<{
    zone: number;
    lower: number | null;
  }>;
  const session = sessionRows.length
    ? [1, 2, 3, 4, 5].map(
        (zone) => sessionRows.find((row) => row.zone === zone)?.lower ?? null,
      )
    : null;
  const lapRows = db
    .prepare(
      `select lap_number as lapNumber, bucket, lower_bpm as lower
       from activity_lap_hr_zone_time
       where garmin_id = ? and bucket between 1 and 5
         and lap_number in (select lap_number from activity_lap where garmin_id = ?)
       order by lap_number, bucket`,
    )
    .all(garminId, garminId) as Array<{
    lapNumber: number;
    bucket: number;
    lower: number | null;
  }>;
  const byLap = new Map<number, Array<number | null>>();
  for (const row of lapRows) {
    const lowers = byLap.get(row.lapNumber) ?? [null, null, null, null, null];
    lowers[row.bucket - 1] = row.lower;
    byLap.set(row.lapNumber, lowers);
  }
  return resolveZoneBoundaries({ session, laps: [...byLap.values()] });
}

/**
 * The single read-time route for split heart rate: one parameterized read of the
 * activity's splits, its stored HR samples and its own zone boundaries, then the
 * pure derivation per split. Never writes and never fetches per split. Rows are
 * in display order: start time (unknown last), message index, split key.
 */
export function deriveActivitySplitHeartRates(
  db: Database.Database,
  garminId: string,
): DerivedSplit[] {
  const splits = db
    .prepare(
      `select split_key as splitKey, split_type as splitType, start_time as startTime,
              end_time as endTime, timer_seconds as timerSeconds,
              distance_meters as distanceMeters, descent_meters as descentMeters
       from activity_snow_split where garmin_id = ?
       order by start_time is null, start_time, message_index, split_key`,
    )
    .all(garminId) as Array<{
    splitKey: string;
    splitType: "run" | "lift";
    startTime: string | null;
    endTime: string | null;
    timerSeconds: number | null;
    distanceMeters: number | null;
    descentMeters: number | null;
  }>;
  if (!splits.length) return [];
  // The raw activity repository writes Date.getTime() milliseconds (despite the
  // Drizzle timestamp annotation). Preserve that convention, never guess units.
  // Read only this activity; no later/foreign anchor.
  const activity = db
    .prepare("select started_at as startedAt from activity where garmin_id = ?")
    .get(garminId) as { startedAt: number } | undefined;
  const activityStartMs =
    activity && Number.isSafeInteger(activity.startedAt)
      ? activity.startedAt
      : null;
  const samples = prepareHeartRateSamples(
    db
      .prepare(
        `select timestamp, heart_rate as heartRate from activity_stream_point
         where garmin_id = ? order by elapsed_sec`,
      )
      .all(garminId) as Array<{
      timestamp: string | null;
      heartRate: number | null;
    }>,
    activityStartMs,
  );
  const boundaries = storedZoneBoundaries(db, garminId);
  return splits.map(({ startTime, endTime, ...split }) => ({
    ...split,
    heartRate: deriveSplitHeartRate(
      samples,
      { startTime, endTime },
      boundaries,
    ),
  }));
}
