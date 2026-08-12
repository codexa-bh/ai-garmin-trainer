import type {
  ActivityLapDetail,
  ActivityStreamPoint,
  NormalizedActivityDetail,
} from "./detail-types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const ALTITUDE_RECORD_KEYS = [
  "altitude_m",
  "altitude",
  "enhanced_altitude",
  "altitude_meters",
  "altitudeMeters",
] as const;

const DISTANCE_RECORD_KEYS = [
  "distance",
  "distance_m",
  "distance_meters",
  "distanceMeters",
] as const;

function finiteNonNegativeNumberOrNull(value: unknown): number | null {
  const numericValue = numberOrNull(value);
  return numericValue !== null && numericValue >= 0 ? numericValue : null;
}

function altitudeMetersFromRecord(
  payload: Record<string, unknown>,
): number | null {
  for (const key of ALTITUDE_RECORD_KEYS) {
    const value = numberOrNull(payload[key]);
    if (value !== null) return value;
  }
  return null;
}

function distanceMetersFromRecord(
  payload: Record<string, unknown>,
): number | null {
  for (const key of DISTANCE_RECORD_KEYS) {
    const value = finiteNonNegativeNumberOrNull(payload[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeLap(
  payload: Record<string, unknown>,
  index: number,
): ActivityLapDetail {
  return {
    lapNumber:
      numberOrNull(payload.lap_number) ??
      numberOrNull(payload.lapIndex) ??
      index + 1,
    startTime: stringOrNull(payload.start_time ?? payload.startTimeGMT),
    durationSec: numberOrNull(
      payload.total_elapsed_time_s ??
        payload.duration_seconds ??
        payload.duration,
    ),
    distanceMeters: numberOrNull(
      payload.total_distance_m ?? payload.distance_meters ?? payload.distance,
    ),
    avgSpeedMps: numberOrNull(payload.avg_speed_mps ?? payload.averageSpeed),
    avgHeartRate: numberOrNull(payload.avg_heart_rate_bpm ?? payload.averageHR),
    maxHeartRate: numberOrNull(payload.max_hr_bpm ?? payload.maxHR),
    elevationGainMeters: numberOrNull(
      payload.total_ascent_m ??
        payload.elevation_gain_meters ??
        payload.elevationGain,
    ),
    elevationLossMeters: numberOrNull(
      payload.total_descent_m ??
        payload.elevation_loss_meters ??
        payload.elevationLoss,
    ),
    avgPowerWatts: numberOrNull(
      payload.avg_power_w ?? payload.avg_power_watts ?? payload.averagePower,
    ),
    normalizedPowerWatts: numberOrNull(
      payload.normalized_power_w ??
        payload.normalized_power_watts ??
        payload.normalizedPower,
    ),
  };
}

function timestampMillisFromRecord(
  payload: Record<string, unknown>,
): number | null {
  const timestamp = stringOrNull(payload.timestamp);
  if (timestamp === null) return null;
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? millis : null;
}

function explicitElapsedSecFromRecord(
  payload: Record<string, unknown>,
): number | null {
  const elapsed = numberOrNull(
    payload.elapsed_time_s ??
      payload.elapsedTime ??
      payload.elapsed_time ??
      payload.duration_s,
  );
  return elapsed !== null && elapsed >= 0 ? Math.round(elapsed) : null;
}

function elapsedSecFromRecord(
  payload: Record<string, unknown>,
  index: number,
  firstStreamTimestampMillis: number | null,
): number {
  const explicitElapsed = explicitElapsedSecFromRecord(payload);
  if (explicitElapsed !== null) return explicitElapsed;

  const timestampMillis = timestampMillisFromRecord(payload);
  if (
    firstStreamTimestampMillis !== null &&
    timestampMillis !== null &&
    timestampMillis >= firstStreamTimestampMillis
  ) {
    return Math.round((timestampMillis - firstStreamTimestampMillis) / 1000);
  }

  return index;
}

function normalizePoint(
  payload: Record<string, unknown>,
  index: number,
  firstStreamTimestampMillis: number | null,
): ActivityStreamPoint {
  return {
    timestamp: stringOrNull(payload.timestamp),
    elapsedSec: elapsedSecFromRecord(
      payload,
      index,
      firstStreamTimestampMillis,
    ),
    distanceMeters: distanceMetersFromRecord(payload),
    heartRate: numberOrNull(payload.heart_rate_bpm),
    speedMps: numberOrNull(payload.speed_mps),
    altitudeMeters: altitudeMetersFromRecord(payload),
    gradePct: numberOrNull(payload.grade_pct),
    lat: numberOrNull(payload.lat_deg),
    lon: numberOrNull(payload.lon_deg),
    cadence: numberOrNull(payload.cadence_rpm),
    powerWatts: numberOrNull(payload.power_w),
    temperatureC: numberOrNull(payload.temperature_c),
  };
}

export function normalizeActivityDetail(
  garminId: string,
  payload: unknown,
): NormalizedActivityDetail {
  const root = record(payload);
  const session = record(root.session);
  const laps = array(root.laps).map(normalizeLap);
  const records = array(root.records);
  const firstStreamTimestampMillis =
    records
      .map(timestampMillisFromRecord)
      .find((timestampMillis) => timestampMillis !== null) ?? null;
  const stream = records.map((payload, index) =>
    normalizePoint(payload, index, firstStreamTimestampMillis),
  );
  const derived: Record<string, unknown> = {};
  for (const key of [
    "climbs",
    "power_duration_curve",
    "shift_summary",
    "hrv",
    "rider_weight_kg",
  ]) {
    if (root[key] !== undefined) derived[key] = root[key];
  }
  for (const key of ["grade_analysis", "hr_drift", "temperature_stats"]) {
    if (session[key] !== undefined) derived[key] = session[key];
  }

  const hasGps = stream.some(
    (point) => point.lat !== null && point.lon !== null,
  );
  const hasElevation =
    stream.some((point) => point.altitudeMeters !== null) ||
    session.total_ascent_m !== undefined ||
    session.total_descent_m !== undefined;
  const hasHeartRate =
    stream.some((point) => point.heartRate !== null) ||
    session.avg_heart_rate_bpm !== undefined;
  const hasGrade =
    stream.some((point) => point.gradePct !== null) ||
    derived.grade_analysis !== undefined;
  const hasPower =
    stream.some((point) => point.powerWatts !== null) ||
    session.avg_power_w !== undefined ||
    derived.power_duration_curve !== undefined;
  const hasSession = Object.keys(session).length > 0;
  const hasStreams = stream.length > 0;
  const hasLaps = laps.length > 0;
  const hasRecovery =
    session.hr_drift !== undefined || derived.hrv !== undefined;
  const status =
    hasSession || hasLaps || hasStreams ? "available" : "unsupported";

  return {
    garminId,
    fetchedAt: new Date(),
    source: "garmin-fit",
    status,
    hasSession,
    hasLaps,
    hasStreams,
    hasGps,
    hasElevation,
    hasHeartRate,
    hasGrade,
    hasPower,
    hasRecovery,
    recordCount: stream.length,
    lapCount: laps.length,
    unavailableReason:
      status === "unsupported"
        ? "Connector returned no parseable FIT detail."
        : null,
    session: hasSession ? session : null,
    derived: Object.keys(derived).length ? derived : null,
    laps,
    stream,
  };
}

export function normalizeUnsupportedActivityDetail(
  garminId: string,
  reason: string,
): NormalizedActivityDetail {
  return {
    garminId,
    fetchedAt: new Date(),
    source: "garmin-summary",
    status: "unsupported",
    hasSession: false,
    hasLaps: false,
    hasStreams: false,
    hasGps: false,
    hasElevation: false,
    hasHeartRate: false,
    hasGrade: false,
    hasPower: false,
    hasRecovery: false,
    recordCount: 0,
    lapCount: 0,
    unavailableReason: reason.slice(0, 1000),
    session: null,
    derived: null,
    laps: [],
    stream: [],
  };
}
