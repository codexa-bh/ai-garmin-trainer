/**
 * Read-time, time-weighted heart rate for one measured snow run or lift.
 *
 * Pure policy: stored HR samples and a split's own measured window go in, a
 * derived Avg HR and zone time (or a closed unavailable reason) come out. Nothing
 * here reads storage, links splits to Garmin laps, or allocates lap/session
 * totals. One implementation serves the run table and the trainer evidence.
 *
 * Conventions (each is a deliberate, tested boundary):
 * - Instants are explicit-zone ISO strings normalised to epoch milliseconds;
 *   a string without Z/offset is invalid, never read in the host timezone.
 * - Only samples inside [start, end] supply HR for the split. A sample supports
 *   the half-open span [its time, next sample time) clipped to the end, so a
 *   shared boundary can never acquire time twice and nothing is held past `end`.
 * - A sample is held for at most MAX_HOLD_SECONDS (same bridge as the existing
 *   file-boundary zone estimate). Missing/invalid HR, or a longer span, is
 *   unsupported time, never zero or interpolated.
 * - Any contiguous unsupported stretch over MAX_HOLD_SECONDS, or total support
 *   under MIN_SUPPORT_FRACTION of the window, makes the whole result
 *   unavailable: no partial result is presented as whole-split HR.
 */

const MAX_HOLD_SECONDS = 30;
const MIN_SUPPORT_FRACTION = 0.8;
/** Plausible measured range; anything else is missing support, not a value. */
const MIN_HEART_RATE_BPM = 1;
const MAX_HEART_RATE_BPM = 300;

type SplitHeartRateReason =
  | "invalid-window"
  | "no-heart-rate-samples"
  | "insufficient-samples"
  | "significant-gap"
  | "insufficient-support";

type SplitZoneReason =
  | "missing-zone-boundaries"
  | "conflicting-zone-boundaries"
  | "heart-rate-unavailable";

type SplitZoneBucket = {
  /** 0 below zone 1, 1–5 zones. */
  bucket: number;
  kind: "below" | "zone";
  zone: number | null;
  seconds: number;
  lowerBpm: number | null;
  upperBpm: number | null;
};

export type SplitHeartRate = {
  avgHeartRate: number | null;
  /** Seconds of the window that stored samples support; null when unavailable. */
  supportSeconds: number | null;
  windowSeconds: number | null;
  unavailableReason: SplitHeartRateReason | null;
  zones: {
    buckets: SplitZoneBucket[] | null;
    unavailableReason: SplitZoneReason | null;
  };
};

export type HeartRateSample = { at: number; heartRate: number | null };
export type SplitWindow = { startTime: string | null; endTime: string | null };

const ZONED_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch milliseconds for an explicitly zoned ISO instant; otherwise null. */
function zonedInstantMs(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !ZONED_ISO.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * Sorted samples with a valid instant. Invalid HR is kept as a null sample so it
 * still ends the previous sample's hold; duplicate instants keep the first.
 */
export function prepareHeartRateSamples(
  rows: Array<{ timestamp: string | null; heartRate: number | null }>,
): HeartRateSample[] {
  const samples: HeartRateSample[] = [];
  for (const row of rows) {
    const at = zonedInstantMs(row.timestamp);
    if (at === null) continue;
    const bpm = row.heartRate;
    samples.push({
      at,
      heartRate:
        typeof bpm === "number" &&
        Number.isFinite(bpm) &&
        bpm >= MIN_HEART_RATE_BPM &&
        bpm <= MAX_HEART_RATE_BPM
          ? bpm
          : null,
    });
  }
  samples.sort((a, b) => a.at - b.at);
  return samples.filter(
    (sample, index) => index === 0 || sample.at !== samples[index - 1].at,
  );
}

function firstIndexAtOrAfter(samples: HeartRateSample[], at: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].at < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

const unavailable = (
  reason: SplitHeartRateReason,
  windowSeconds: number | null,
): SplitHeartRate => ({
  avgHeartRate: null,
  supportSeconds: null,
  windowSeconds,
  unavailableReason: reason,
  zones: { buckets: null, unavailableReason: "heart-rate-unavailable" },
});

/** Strictly ascending positive lower bounds for zones 1–5, else null. */
type ZoneLowerBounds = [number, number, number, number, number];

function zoneBuckets(
  secondsByBucket: number[],
  lowers: ZoneLowerBounds,
): SplitZoneBucket[] {
  return secondsByBucket.map((seconds, bucket) => ({
    bucket,
    kind: bucket === 0 ? "below" : "zone",
    zone: bucket === 0 ? null : bucket,
    seconds,
    lowerBpm: bucket === 0 ? null : lowers[bucket - 1],
    upperBpm: bucket === 5 ? null : lowers[bucket] - 1,
  }));
}

/** Zone N starts at its lower bound (inclusive); under zone 1 is its own bucket. */
function bucketFor(heartRate: number, lowers: ZoneLowerBounds): number {
  let bucket = 0;
  while (bucket < 5 && heartRate >= lowers[bucket]) bucket += 1;
  return bucket;
}

export type ZoneBoundaryEvidence =
  | { status: "available"; lowers: ZoneLowerBounds }
  | {
      status: "unavailable";
      reason: "missing-zone-boundaries" | "conflicting-zone-boundaries";
    };

export function deriveSplitHeartRate(
  samples: HeartRateSample[],
  window: SplitWindow,
  boundaries: ZoneBoundaryEvidence,
): SplitHeartRate {
  const start = zonedInstantMs(window.startTime);
  const end = zonedInstantMs(window.endTime);
  if (start === null || end === null || end <= start)
    return unavailable("invalid-window", null);
  const windowSeconds = (end - start) / 1000;
  const first = firstIndexAtOrAfter(samples, start);
  if (first >= samples.length || samples[first].at > end)
    return unavailable("no-heart-rate-samples", windowSeconds);

  const inWindow: number[] = [];
  for (
    let index = first;
    index < samples.length && samples[index].at <= end;
    index += 1
  )
    inWindow.push(index);
  const measured = inWindow.filter(
    (index) => samples[index].heartRate !== null,
  );
  if (!measured.length)
    return unavailable("no-heart-rate-samples", windowSeconds);
  if (measured.length < 2)
    return unavailable("insufficient-samples", windowSeconds);

  const lowers = boundaries.status === "available" ? boundaries.lowers : null;
  const bucketSeconds = [0, 0, 0, 0, 0, 0];
  let weighted = 0;
  let support = 0;
  let cursor = start;
  let longestUnsupportedMs = 0;
  for (const index of inWindow) {
    const sample = samples[index];
    longestUnsupportedMs = Math.max(longestUnsupportedMs, sample.at - cursor);
    cursor = Math.max(cursor, sample.at);
    if (sample.heartRate === null) continue;
    const next = samples[index + 1]?.at ?? end;
    const spanEnd = Math.min(end, next);
    const spanSeconds = (spanEnd - sample.at) / 1000;
    if (spanSeconds <= 0 || spanSeconds > MAX_HOLD_SECONDS) continue;
    weighted += sample.heartRate * spanSeconds;
    support += spanSeconds;
    if (lowers)
      bucketSeconds[bucketFor(sample.heartRate, lowers)] += spanSeconds;
    cursor = spanEnd;
  }
  longestUnsupportedMs = Math.max(longestUnsupportedMs, end - cursor);
  if (longestUnsupportedMs / 1000 > MAX_HOLD_SECONDS)
    return unavailable("significant-gap", windowSeconds);
  if (support / windowSeconds < MIN_SUPPORT_FRACTION)
    return unavailable("insufficient-support", windowSeconds);

  return {
    avgHeartRate: weighted / support,
    supportSeconds: support,
    windowSeconds,
    unavailableReason: null,
    zones: lowers
      ? { buckets: zoneBuckets(bucketSeconds, lowers), unavailableReason: null }
      : {
          buckets: null,
          unavailableReason:
            boundaries.status === "unavailable"
              ? boundaries.reason
              : "missing-zone-boundaries",
        },
  };
}

function strictlyAscending(values: number[]): values is ZoneLowerBounds {
  return (
    values.length === 5 &&
    values.every(
      (value, index) =>
        Number.isInteger(value) &&
        value > 0 &&
        (index === 0 || value > values[index - 1]),
    )
  );
}

/**
 * Activity-specific historical zone lower bounds. Candidates are the file
 * boundaries stored with the session zone time and the per-lap file boundaries;
 * each source must be complete and consistent, and two sources must agree.
 * Using the same file's boundaries never links a lap to a split. No current
 * athlete baseline is ever a fallback.
 */
export function resolveZoneBoundaries(input: {
  /** Five source lower bounds from file-derived session zone rows, or null. */
  session: Array<number | null> | null;
  /** Per-lap zone 1–5 lower bounds, one entry per lap that has zone rows. */
  laps: Array<Array<number | null>>;
}): ZoneBoundaryEvidence {
  const candidates: ZoneLowerBounds[] = [];
  if (input.session) {
    if (input.session.some((value) => value === null))
      return { status: "unavailable", reason: "missing-zone-boundaries" };
    const values = input.session as number[];
    if (!strictlyAscending(values))
      return { status: "unavailable", reason: "conflicting-zone-boundaries" };
    candidates.push(values);
  }
  for (const lap of input.laps) {
    if (lap.some((value) => value === null)) continue;
    const values = lap as number[];
    if (!strictlyAscending(values))
      return { status: "unavailable", reason: "conflicting-zone-boundaries" };
    candidates.push(values);
  }
  if (!candidates.length)
    return { status: "unavailable", reason: "missing-zone-boundaries" };
  const [head, ...rest] = candidates;
  return rest.every((values) => values.every((value, i) => value === head[i]))
    ? { status: "available", lowers: head }
    : { status: "unavailable", reason: "conflicting-zone-boundaries" };
}

/**
 * Explicit allowlist for UI and trainer transport: derived values and closed
 * reasons only. No timestamps, samples or database rows are carried.
 */
export function projectSplitHeartRate(value: SplitHeartRate): SplitHeartRate {
  const finite = (n: number | null) =>
    typeof n === "number" && Number.isFinite(n) ? n : null;
  return {
    avgHeartRate: finite(value.avgHeartRate),
    supportSeconds: finite(value.supportSeconds),
    windowSeconds: finite(value.windowSeconds),
    unavailableReason: value.unavailableReason,
    zones: {
      unavailableReason: value.zones.unavailableReason,
      buckets:
        value.zones.buckets?.map((bucket) => ({
          bucket: bucket.bucket,
          kind: bucket.kind,
          zone: bucket.zone,
          seconds: bucket.seconds,
          lowerBpm: bucket.lowerBpm,
          upperBpm: bucket.upperBpm,
        })) ?? null,
    },
  };
}
