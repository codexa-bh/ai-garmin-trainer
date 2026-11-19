import FitParser from "fit-file-parser";
import type { NormalizedActivityHrZoneTime } from "./activity-hr-zone-time";
import { FitAdmissionError, admitFitBytes } from "./official-zip";

/**
 * One in-process decode of an original activity file, reused for detail streams,
 * the athlete baseline and exact HR time in zones. The parser is synchronous, so
 * its CPU bound is the admitted input size and record cap, not AbortSignal.
 */
const FIT_DECODE_LIMITS = { records: 200_000, laps: 2_000 } as const;

type Fields = Record<string, unknown>;

type FitZoneBoundaries = {
  /** Upper boundary (bpm) of zone index 0..N, as written in the file. */
  highBoundaries: number[];
  method: string | null;
};

export type DecodedActivityFit = {
  /** Shape accepted by `normalizeActivityDetail`. */
  detail: { session: Fields; laps: Fields[]; records: Fields[] };
  /** Session-referenced `time_in_zone` seconds for zone index 0..N, or null. */
  zoneSeconds: number[] | null;
  boundaries: FitZoneBoundaries | null;
  zonesTarget: {
    max_heart_rate: number | null;
    threshold_heart_rate: number | null;
    functional_threshold_power: number | null;
  } | null;
};

function record(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : {};
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function iso(value: unknown): string | undefined {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : undefined;
}
function compact(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}
function numericArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(
    (item) => typeof item === "number" && Number.isFinite(item),
  )
    ? (value as number[])
    : null;
}
function referenceIndex(message: Fields): number | undefined {
  const raw = message.reference_index;
  return typeof raw === "number" ? raw : num(record(raw).value);
}

function sessionFields(session: Fields): Fields {
  return compact({
    sport: session.sport,
    sub_sport: session.sub_sport,
    start_time: iso(session.start_time),
    total_elapsed_time_s: num(session.total_elapsed_time),
    total_timer_time_s: num(session.total_timer_time),
    total_distance_m: num(session.total_distance),
    avg_speed_mps: num(session.enhanced_avg_speed ?? session.avg_speed),
    max_speed_mps: num(session.enhanced_max_speed ?? session.max_speed),
    avg_heart_rate_bpm: num(session.avg_heart_rate),
    max_hr_bpm: num(session.max_heart_rate),
    avg_power_w: num(session.avg_power),
    max_power_w: num(session.max_power),
    normalized_power_w: num(session.normalized_power),
    total_ascent_m: num(session.total_ascent),
    total_descent_m: num(session.total_descent),
    total_calories: num(session.total_calories),
    avg_cadence_rpm: num(session.avg_cadence),
  });
}

function lapFields(lap: Fields, index: number): Fields {
  return compact({
    lap_number: index + 1,
    start_time: iso(lap.start_time),
    total_elapsed_time_s: num(lap.total_elapsed_time),
    total_distance_m: num(lap.total_distance),
    avg_speed_mps: num(lap.enhanced_avg_speed ?? lap.avg_speed),
    avg_heart_rate_bpm: num(lap.avg_heart_rate),
    max_hr_bpm: num(lap.max_heart_rate),
    total_ascent_m: num(lap.total_ascent),
    total_descent_m: num(lap.total_descent),
    avg_power_w: num(lap.avg_power),
    normalized_power_w: num(lap.normalized_power),
  });
}

function recordFields(point: Fields): Fields {
  return compact({
    timestamp: iso(point.timestamp),
    distance: num(point.distance),
    heart_rate_bpm: num(point.heart_rate),
    enhanced_speed: num(point.enhanced_speed ?? point.speed),
    enhanced_altitude: num(point.enhanced_altitude ?? point.altitude),
    lat_deg: num(point.position_lat),
    lon_deg: num(point.position_long),
    cadence_rpm: num(point.cadence),
    power_w: num(point.power),
    temperature_c: num(point.temperature),
    grade_pct: num(point.grade),
  });
}

/** Session-referenced messages only; laps and unreferenced messages are never added. */
function sessionZoneTime(
  messages: Fields[],
): Pick<DecodedActivityFit, "zoneSeconds" | "boundaries"> {
  const bySession = new Map<number, Fields>();
  for (const message of messages) {
    if (message.reference_mesg !== "session") continue;
    const index = referenceIndex(message);
    if (index !== undefined && numericArray(message.time_in_hr_zone))
      bySession.set(index, message);
  }
  const chosen = [...bySession.values()];
  let boundaries: FitZoneBoundaries | null = null;
  for (const message of messages) {
    if (message.reference_mesg !== "session") continue;
    const high = numericArray(message.hr_zone_high_boundary);
    if (high && high.length >= 5 && high.every((value) => value > 0)) {
      boundaries = {
        highBoundaries: high,
        method:
          typeof message.hr_calc_type === "string"
            ? message.hr_calc_type
            : null,
      };
      break;
    }
  }
  if (!chosen.length) return { zoneSeconds: null, boundaries };
  // Distinct sessions are disjoint in time; each session counted once, by reference.
  const width = Math.min(
    ...chosen.map((m) => (m.time_in_hr_zone as number[]).length),
  );
  if (width < 6) return { zoneSeconds: null, boundaries };
  const totals = Array.from({ length: width }, () => 0);
  for (const message of chosen)
    (message.time_in_hr_zone as number[]).forEach((seconds, index) => {
      if (index < width) totals[index] += seconds;
    });
  if (totals.some((seconds) => seconds < 0))
    return { zoneSeconds: null, boundaries };
  return { zoneSeconds: totals, boundaries };
}

function zonesTarget(messages: Fields[]): DecodedActivityFit["zonesTarget"] {
  for (const message of messages) {
    const max = num(message.max_heart_rate);
    const threshold = num(message.threshold_heart_rate);
    const ftp = num(message.functional_threshold_power);
    if (max !== undefined || threshold !== undefined || ftp !== undefined)
      return {
        max_heart_rate: max ?? null,
        threshold_heart_rate: threshold ?? null,
        functional_threshold_power: ftp ?? null,
      };
  }
  return null;
}

export async function decodeActivityFit(
  archive: Uint8Array,
  signal?: AbortSignal,
): Promise<DecodedActivityFit> {
  const bytes = admitFitBytes(archive);
  signal?.throwIfAborted();
  let parsed: Awaited<ReturnType<FitParser["parseAsync"]>>;
  try {
    parsed = await new FitParser({ force: false, mode: "list" }).parseAsync(
      Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ) as Buffer<ArrayBuffer>,
    );
  } catch {
    throw new FitAdmissionError("unparseable");
  }
  signal?.throwIfAborted();
  const records = (parsed.records ?? []) as Fields[];
  const laps = (parsed.laps ?? []) as Fields[];
  if (
    records.length > FIT_DECODE_LIMITS.records ||
    laps.length > FIT_DECODE_LIMITS.laps
  )
    throw new FitAdmissionError("too-many-records");
  const sessions = (parsed.sessions ?? []) as Fields[];
  const zoneMessages = (parsed.time_in_zone ?? []) as Fields[];
  const zoneTime = sessionZoneTime(zoneMessages);
  // `zones_target` is exposed as a single message by the parser when present.
  const target = (parsed as unknown as Fields).zones_target;
  return {
    detail: {
      session: sessions.length ? sessionFields(record(sessions[0])) : {},
      laps: laps.map((lap, index) => lapFields(record(lap), index)),
      records: records.map((point) => recordFields(record(point))),
    },
    ...zoneTime,
    zonesTarget: zonesTarget(target ? [record(target)] : []),
  };
}

/**
 * Exact FIT zone seconds mapped to the stored five-zone contract. Index 0 (below
 * zone 1) and indexes above zone 5 are excluded; the lower boundary of zone N is
 * the preceding high boundary. Precision is rounded exactly as the MCP path did.
 */
export function exactZoneTime(
  garminId: string,
  decoded: DecodedActivityFit,
  fetchedAt: Date,
): NormalizedActivityHrZoneTime | null {
  if (!decoded.zoneSeconds || decoded.zoneSeconds.length < 6) return null;
  const buckets = ([1, 2, 3, 4, 5] as const).map((zone) => {
    const lower = decoded.boundaries?.highBoundaries[zone - 1];
    return {
      zone,
      seconds: Math.round(decoded.zoneSeconds![zone]),
      sourceLowerBpm: lower && lower > 0 ? Math.round(lower) : null,
    };
  });
  return {
    garminId,
    fetchedAt,
    source: "garmin_official_fit",
    status: "available",
    sourceTotalSeconds: buckets.reduce(
      (sum, bucket) => sum + bucket.seconds,
      0,
    ),
    buckets,
  };
}

/** Maximum gap (s) bridged when holding the previous heart-rate sample. */
const ESTIMATE_MAX_GAP_SECONDS = 30;

/**
 * Approximate zone time from sampled heart rate using only boundaries stored in
 * the file itself (never today's zones). Gaps and pauses longer than the bridge
 * are excluded, so this is labelled an estimate, never equivalent to Garmin's.
 */
export function estimatedZoneTime(
  garminId: string,
  decoded: DecodedActivityFit,
  fetchedAt: Date,
): NormalizedActivityHrZoneTime | null {
  const high = decoded.boundaries?.highBoundaries;
  if (!high || high.length < 5) return null;
  const samples = decoded.detail.records.flatMap((point) => {
    const hr = num(point.heart_rate_bpm);
    const at =
      typeof point.timestamp === "string" ? Date.parse(point.timestamp) : NaN;
    return hr !== undefined && Number.isFinite(at) ? [{ hr, at }] : [];
  });
  if (samples.length < 2) return null;
  // Index 0 is below zone 1, 1–5 are the zones, 6 is above the top boundary.
  const seconds = [0, 0, 0, 0, 0, 0, 0];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const span = (samples[index + 1].at - samples[index].at) / 1000;
    if (span <= 0 || span > ESTIMATE_MAX_GAP_SECONDS) continue;
    const hr = samples[index].hr;
    // Zone floors are inclusive: zone N starts at high[N-1].
    let zone = 0;
    while (zone < 5 && hr >= high[zone]) zone += 1;
    seconds[zone === 5 && high.length > 5 && hr > high[5] ? 6 : zone] += span;
  }
  if (seconds.slice(1, 6).every((value) => value === 0)) return null;
  const buckets = ([1, 2, 3, 4, 5] as const).map((zone) => ({
    zone,
    seconds: Math.round(seconds[zone]),
    sourceLowerBpm: high[zone - 1] > 0 ? Math.round(high[zone - 1]) : null,
  }));
  return {
    garminId,
    fetchedAt,
    source: "garmin_official_estimate",
    status: "available",
    sourceTotalSeconds: buckets.reduce(
      (sum, bucket) => sum + bucket.seconds,
      0,
    ),
    buckets,
  };
}
