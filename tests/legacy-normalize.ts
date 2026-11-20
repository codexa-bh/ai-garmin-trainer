/**
 * Test-only normalizers for the retired MCP connector payloads. Product code
 * reads only the official Personal API (official-normalize.ts); these remain so
 * policy suites and legacy-row fixtures can author MCP-era data.
 */
import type { NormalizedDailyHealth } from "../src/lib/garmin/types";
import type { NormalizedActivityHrZoneTime } from "../src/lib/garmin/activity-hr-zone-time";
import type { PrimaryUpload } from "../src/lib/garmin/primary-upload";
import { dailyHealthAvailability } from "../src/lib/garmin/normalize";
import { shiftDate } from "../src/lib/garmin/history-policy";
import {
  discoveryDate,
  type StepsHint,
} from "../src/lib/garmin/discovery-policy";

// ---- normalize ----
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumberOrNull(value: unknown): number | null {
  const normalized = numberOrNull(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function numericStringOrNumberOrNull(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return numberOrNull(value);
}

function timestampOrNull(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNumberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = numberOrNull(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function firstNonNegativeNumberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = nonNegativeNumberOrNull(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function firstMinutesFromSecondsOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = minutesFromSecondsOrNull(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function collectBodyBatteryReadings(
  payload: unknown,
  targetDate: string,
): Array<{ timestamp: Date; value: number }> {
  const readings: Array<{ timestamp: Date; value: number }> = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      if (item.length >= 2) {
        const timestamp = timestampOrNull(item[0]);
        const value = numericStringOrNumberOrNull(item[1]);
        if (
          timestamp &&
          timestamp.toISOString().slice(0, 10) === targetDate &&
          value !== null
        ) {
          readings.push({ timestamp, value });
        }
      }
      for (const entry of item) visit(entry);
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const timestamp =
      timestampOrNull(record.start_time) ??
      timestampOrNull(record.startTime) ??
      timestampOrNull(record.timestamp) ??
      timestampOrNull(record.time);
    const value =
      numericStringOrNumberOrNull(record.body_battery_level) ??
      numericStringOrNumberOrNull(record.bodyBatteryLevel) ??
      numericStringOrNumberOrNull(record.level) ??
      numericStringOrNumberOrNull(record.value);
    if (
      timestamp &&
      timestamp.toISOString().slice(0, 10) === targetDate &&
      value !== null
    ) {
      readings.push({ timestamp, value });
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") visit(nested);
    }
  };
  visit(payload);
  return readings.sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
}

function bodyBatteryMorningEvening(
  payload: unknown,
  targetDate: string,
): { bodyBatteryMorning: number | null; bodyBatteryEvening: number | null } {
  const readings = collectBodyBatteryReadings(payload, targetDate);
  if (readings.length === 0) {
    return { bodyBatteryMorning: null, bodyBatteryEvening: null };
  }
  return {
    bodyBatteryMorning: Math.round(readings[0].value),
    bodyBatteryEvening: Math.round(readings[readings.length - 1].value),
  };
}

function sleepScoreOrNull(value: unknown): number | null {
  const score = nonNegativeNumberOrNull(value);
  if (score === null || score > 100) return null;
  return Math.round(score);
}

function minutesFromSecondsOrNull(value: unknown): number | null {
  const seconds = nonNegativeNumberOrNull(value);
  return seconds === null ? null : Math.round(seconds / 60);
}

export function normalizeDailyHealth(
  date: string,
  payloads: Record<string, unknown>,
): NormalizedDailyHealth {
  const sleepPayload = objectOrNull(payloads.sleep);
  const sleep =
    objectOrNull(sleepPayload?.dailySleepDTO) ??
    objectOrNull(sleepPayload?.dailySleepDto) ??
    sleepPayload;
  const stats = objectOrNull(payloads.stats);
  const sleepMinutes = firstMinutesFromSecondsOrNull(
    sleep?.sleepTimeSeconds,
    sleep?.sleep_seconds,
    sleep?.sleep_time_seconds,
  );
  const activeCalories = firstNonNegativeNumberOrNull(
    stats?.active_calories,
    stats?.activeCalories,
    stats?.activeKilocalories,
  );
  const restingCalories = firstNonNegativeNumberOrNull(
    stats?.bmr_calories,
    stats?.bmrCalories,
    stats?.restingCalories,
    stats?.bmrKilocalories,
  );
  const totalCalories = firstNonNegativeNumberOrNull(
    stats?.total_calories,
    stats?.totalCalories,
    stats?.wellnessTotalKilocalories,
    payloads.calories,
  );
  const moderateIntensity = firstNonNegativeNumberOrNull(
    stats?.moderate_intensity_minutes,
    stats?.moderateIntensityMinutes,
  );
  const vigorousIntensity = firstNonNegativeNumberOrNull(
    stats?.vigorous_intensity_minutes,
    stats?.vigorousIntensityMinutes,
  );
  const intensityMinutes =
    moderateIntensity !== null || vigorousIntensity !== null
      ? Math.round((moderateIntensity ?? 0) + (vigorousIntensity ?? 0))
      : null;
  const bodyBattery = bodyBatteryMorningEvening(payloads.bodyBattery, date);
  const fields = {
    sleepMinutes,
    sleepScore: sleepScoreOrNull(sleep?.sleep_score ?? sleep?.sleepScore),
    sleepDeepMinutes: firstMinutesFromSecondsOrNull(
      sleep?.deep_sleep_seconds,
      sleep?.deepSleepSeconds,
    ),
    sleepLightMinutes: firstMinutesFromSecondsOrNull(
      sleep?.light_sleep_seconds,
      sleep?.lightSleepSeconds,
    ),
    sleepRemMinutes: firstMinutesFromSecondsOrNull(
      sleep?.rem_sleep_seconds,
      sleep?.remSleepSeconds,
    ),
    sleepAwakeMinutes: firstMinutesFromSecondsOrNull(
      sleep?.awake_seconds,
      sleep?.awakeSeconds,
      sleep?.awakeSleepSeconds,
    ),
    sleepNapMinutes: firstMinutesFromSecondsOrNull(
      sleep?.nap_seconds,
      sleep?.napSeconds,
    ),
    restingHeartRate: firstNumberOrNull(
      payloads.restingHeartRate,
      stats?.resting_heart_rate_bpm,
      stats?.restingHeartRate,
      stats?.restingHR,
      sleep?.resting_heart_rate_bpm,
      sleep?.restingHeartRate,
    ),
    hrvStatus: null,
    hrvMs: firstNumberOrNull(sleep?.avg_overnight_hrv, sleep?.avgOvernightHrv),
    stressAvg: firstNumberOrNull(
      stats?.avg_stress_level,
      stats?.averageStressLevel,
    ),
    steps: firstNumberOrNull(
      stats?.total_steps,
      stats?.totalSteps,
      stats?.steps,
      payloads.steps,
    ),
    calories: totalCalories,
    activeCalories,
    restingCalories,
    totalCalories,
    intensityMinutes,
    bodyBatteryAvg: firstNumberOrNull(
      stats?.body_battery_current,
      stats?.body_battery_highest,
      stats?.bodyBatteryCurrent,
      stats?.bodyBatteryHighest,
      stats?.bodyBatteryMostRecentValue,
      stats?.bodyBatteryHighestValue,
    ),
    ...bodyBattery,
  };
  return {
    date,
    ...fields,
    availability: dailyHealthAvailability(fields),
  };
}

// ---- primary ----
type UnknownReason = Extract<PrimaryUpload, { kind: "unknown" }>["reason"];

/** Internal selection result: a validated selected identity survives an
 * unusable direct upload, so only that case may consult last-used evidence. */
type PrimarySelection =
  | { kind: "unselected"; reason: UnknownReason }
  | { kind: "selected"; primaryId: string; upload: PrimaryUpload };

const MIN_UPLOAD = 946684800000;
const ID_KEYS = new Set(["device_id", "user_device_id"]);
const unknown = (reason: UnknownReason): PrimaryUpload => ({
  kind: "unknown",
  reason,
});

/** Parses curated device replies, keeping numeric identifiers only when their
 * exact JSON spelling is a canonical safe integer (no 1.0, 1e3, rounding). */
export function parseCuratedDeviceJson(text: string): unknown {
  return JSON.parse(
    text,
    function (key, value: unknown, context?: { source?: string }) {
      if (!ID_KEYS.has(key) || typeof value !== "number") return value;
      return typeof context?.source === "string" &&
        /^[1-9]\d{0,15}$/.test(context.source) &&
        Number.isSafeInteger(value)
        ? value
        : NaN;
    },
  );
}

/** Lossless canonical identity: positive safe integer or bounded token text.
 * Cross-type equality is exact text equality of these canonical forms. */
function deviceId(id: unknown): string | null {
  if (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) return id;
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
    return String(id);
  return null;
}

function validCalendar(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function directUpload(raw: unknown, observedAt: Date): number {
  let milliseconds = NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Disjoint modern epoch ranges: no guessing numeric strings or small values.
    milliseconds =
      raw >= 946684800 && raw < 10000000000
        ? raw * 1000
        : raw >= MIN_UPLOAD
          ? raw
          : NaN;
  } else if (
    typeof raw === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(
      raw,
    ) &&
    // Reject normalized impossible calendar dates (Date.parse accepts Feb 30).
    validCalendar(raw.slice(0, 10))
  )
    milliseconds = Date.parse(raw);
  return Number.isFinite(milliseconds) &&
    milliseconds >= MIN_UPLOAD &&
    milliseconds <= observedAt.getTime()
    ? milliseconds
    : NaN;
}

/** The pinned get_devices curated wire shape. Never retain names/serials. */
export function selectPrimary(
  payload: unknown,
  observedAt: Date,
): PrimarySelection {
  const unselected = (reason: UnknownReason): PrimarySelection => ({
    kind: "unselected",
    reason,
  });
  if (!Array.isArray(payload)) return unselected("unrecognized-reply");
  if (!payload.length) return unselected("no-devices");
  if (
    payload.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    return unselected("invalid-device");
  const devices = payload as Record<string, unknown>[];
  if (
    devices.some(
      (device) =>
        device.is_primary !== undefined &&
        typeof device.is_primary !== "boolean",
    )
  )
    return unselected("invalid-device");
  const flagged = devices.filter((device) => device.is_primary === true);
  const device =
    flagged.length === 1
      ? flagged[0]
      : flagged.length === 0 && devices.length === 1
        ? devices[0]
        : null;
  if (!device) return unselected("ambiguous-primary");
  const primaryId = deviceId(device.device_id);
  if (primaryId === null) return unselected("invalid-device");
  const milliseconds = directUpload(device.last_sync_time, observedAt);
  return {
    kind: "selected",
    primaryId,
    upload: Number.isFinite(milliseconds)
      ? {
          kind: "known",
          primaryId,
          uploadedAt: new Date(milliseconds).toISOString(),
        }
      : unknown("invalid-upload"),
  };
}

/**
 * Pinned get_device_last_used curated reply, read only from the dedicated
 * connector process whose local zone is fixed to UTC. Upstream renders the
 * source epoch with `fromtimestamp(...).strftime("%Y-%m-%d %H:%M:%S")`, so the
 * text names a whole UTC second: the upload lies in [second, second + 999 ms].
 * The entire interval must precede observation; never parse it host-locally.
 */
export function lastUsedUpload(
  payload: unknown,
  primaryId: string,
  observedAt: Date,
): PrimaryUpload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return unknown("last-used-invalid");
  const reply = payload as Record<string, unknown>;
  const id = deviceId(reply.user_device_id);
  if (id === null) return unknown("last-used-invalid");
  if (id !== primaryId) return unknown("last-used-mismatch");
  const raw = reply.last_upload_time;
  const match =
    typeof raw === "string"
      ? /^(\d{4}-\d{2}-\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)$/.exec(raw)
      : null;
  if (!match || !validCalendar(match[1])) return unknown("last-used-invalid");
  const earliest = Date.parse(`${match[1]}T${match[2]}.000Z`);
  const latest = earliest + 999;
  if (
    !Number.isFinite(earliest) ||
    earliest < MIN_UPLOAD ||
    latest > observedAt.getTime()
  )
    return unknown("last-used-invalid");
  return {
    kind: "known",
    primaryId,
    uploadedAt: new Date(earliest).toISOString(),
    uploadedThrough: new Date(latest).toISOString(),
    via: "last-used",
  };
}

// ---- zones ----
type ActivityHrZoneNumber = 1 | 2 | 3 | 4 | 5;
type NormalizedActivityHrZoneTimeBucket =
  NormalizedActivityHrZoneTime["buckets"][number];

function integerZone(value: unknown): ActivityHrZoneNumber | null {
  const number = numberOrNull(value);
  if (number === null) return null;
  const zone = Math.trunc(number);
  return zone >= 1 && zone <= 5 && zone === number
    ? (zone as ActivityHrZoneNumber)
    : null;
}

function durationSeconds(value: unknown): number | null {
  const seconds = numberOrNull(value);
  if (seconds === null || seconds < 0) return null;
  return Math.round(seconds);
}

function sourceLowerBpm(value: unknown): number | null {
  const bpm = numberOrNull(value);
  if (bpm === null || bpm <= 0) return null;
  return Math.round(bpm);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(record);
  const root = record(payload);
  const candidates = [root.zones, root.timeInZones, root.hrZones, root.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(record);
  }
  return [];
}

export function normalizeActivityHrZoneTime(
  garminId: string,
  payload: unknown,
  fetchedAt = new Date(),
): NormalizedActivityHrZoneTime | null {
  const rows = payloadRows(payload);
  if (rows.length !== 5) return null;

  const seen = new Set<number>();
  const buckets: NormalizedActivityHrZoneTimeBucket[] = [];
  for (const row of rows) {
    const zone = integerZone(row.zoneNumber ?? row.zone ?? row.zone_number);
    const seconds = durationSeconds(
      row.secsInZone ?? row.seconds ?? row.durationSec ?? row.duration_s,
    );
    if (zone === null || seconds === null || seen.has(zone)) return null;
    seen.add(zone);
    buckets.push({
      zone,
      seconds,
      sourceLowerBpm: sourceLowerBpm(
        row.zoneLowBoundary ?? row.lowerBpm ?? row.lower_bpm,
      ),
    });
  }
  if (![1, 2, 3, 4, 5].every((zone) => seen.has(zone))) return null;

  buckets.sort((left, right) => left.zone - right.zone);
  return {
    garminId,
    fetchedAt,
    source: "garmin_mcp",
    status: "available",
    sourceTotalSeconds: buckets.reduce(
      (total, bucket) => total + bucket.seconds,
      0,
    ),
    buckets,
  };
}

// ---- steps ----
/** Validate the reviewed curated wrapper, never arbitrary vendor metadata. */
export function weeklyStepsHint(
  payload: unknown,
  endDate: string,
  weeks: number,
): StepsHint {
  const invalid = () =>
    new Error(
      "Garmin weekly steps protocol failed; discovery remains unknown.",
    );
  if (
    !discoveryDate(endDate) ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 52
  )
    throw invalid();
  const startDate = shiftDate(endDate, -(weeks * 7 - 1));
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw invalid();
  const envelope = payload as Record<string, unknown>;
  if (
    envelope.end_date !== endDate ||
    envelope.weeks_requested !== weeks ||
    !Array.isArray(envelope.weekly_data) ||
    envelope.weeks_returned !== envelope.weekly_data.length ||
    envelope.weekly_data.length > weeks ||
    Object.keys(envelope).some(
      (key) =>
        ![
          "end_date",
          "weeks_requested",
          "weeks_returned",
          "weekly_data",
        ].includes(key),
    )
  )
    throw invalid();
  const seen = new Set<string>();
  const positiveDates: string[] = [];
  let weeksWithData = 0;
  for (const value of envelope.weekly_data) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalid();
    const row = value as Record<string, unknown>;
    if (
      !discoveryDate(row.week_start) ||
      row.week_start > endDate ||
      row.week_start < shiftDate(startDate, -6) ||
      seen.has(row.week_start) ||
      Object.keys(row).some(
        (key) =>
          ![
            "week_start",
            "days_with_data",
            "total_steps",
            "average_steps",
            "total_distance_meters",
            "average_distance_meters",
          ].includes(key),
      )
    )
      throw invalid();
    seen.add(row.week_start);
    for (const [key, number] of Object.entries(row)) {
      if (
        key !== "week_start" &&
        (typeof number !== "number" || !Number.isFinite(number) || number < 0)
      )
        throw invalid();
    }
    if (
      row.days_with_data !== undefined &&
      (!Number.isInteger(row.days_with_data) || Number(row.days_with_data) > 7)
    )
      throw invalid();
    // A positive aggregate is only a candidate, not daily or other-family coverage.
    if (Number(row.days_with_data ?? row.total_steps ?? 0) > 0) {
      weeksWithData += 1;
      for (let index = 0; index < 7; index += 1) {
        const date = shiftDate(row.week_start, index);
        if (date >= startDate && date <= endDate) positiveDates.push(date);
      }
    }
  }
  return {
    startDate,
    endDate,
    positiveDates: [...new Set(positiveDates)].sort().reverse(),
    weeksWithData,
  };
}
