import type {
  GarminAthleteBaselineAvailability,
  GarminAthleteBaselineSnapshot,
  GarminAthleteBaselineValues,
} from "./types";

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const WEEKDAY_ALIASES = new Map<string, string>([
  ["mon", "monday"],
  ["monday", "monday"],
  ["tue", "tuesday"],
  ["tues", "tuesday"],
  ["tuesday", "tuesday"],
  ["wed", "wednesday"],
  ["wednesday", "wednesday"],
  ["thu", "thursday"],
  ["thur", "thursday"],
  ["thurs", "thursday"],
  ["thursday", "thursday"],
  ["fri", "friday"],
  ["friday", "friday"],
  ["sat", "saturday"],
  ["saturday", "saturday"],
  ["sun", "sunday"],
  ["sunday", "sunday"],
]);

export const EMPTY_GARMIN_ATHLETE_VALUES: GarminAthleteBaselineValues = {
  runningLactateThresholdHeartRateBpm: null,
  cyclingLactateThresholdHeartRateBpm: null,
  rowingLactateThresholdHeartRateBpm: null,
  cyclingFtpWatts: null,
  cyclingFtpMeasuredOn: null,
  cyclingFtpSourceStale: null,
  vo2MaxRunning: null,
  vo2MaxCycling: null,
  availableTrainingDays: [],
  preferredLongTrainingDays: [],
};

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function fieldNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  const object = objectValue(value);
  if (!object) return null;
  for (const key of ["value", "bpm", "heartRate", "beatsPerMinute", "watts"]) {
    const nested = fieldNumber(object[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const parsed = fieldNumber(value);
  if (!Number.isFinite(parsed) || parsed === null) return null;
  const rounded = Math.round(parsed);
  return rounded >= min && rounded <= max ? rounded : null;
}

function boundedVo2(value: unknown): number | null {
  const parsed = fieldNumber(value);
  if (!Number.isFinite(parsed) || parsed === null) return null;
  const rounded = Math.round(parsed * 10) / 10;
  return rounded >= 10 && rounded <= 100 ? rounded : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1))
    return Boolean(value);
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

function normalizeWeekday(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return WEEKDAY_ALIASES.get(normalized) ?? null;
}

function normalizeWeekdays(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,|]/)
      : [];
  const days = new Set<string>();
  for (const item of raw) {
    const day = normalizeWeekday(item);
    if (day) days.add(day);
  }
  return WEEKDAYS.filter((day) => days.has(day));
}

function userDataFromProfile(profilePayload: unknown): JsonObject {
  const root = objectValue(profilePayload) ?? {};
  return objectValue(root.userData) ?? root;
}

function ftpData(ftpPayload: unknown): JsonObject {
  const root = objectValue(ftpPayload) ?? {};
  return objectValue(root.userData) ?? root;
}

function hasApprovedFact(values: GarminAthleteBaselineValues): boolean {
  return (
    values.runningLactateThresholdHeartRateBpm !== null ||
    values.cyclingLactateThresholdHeartRateBpm !== null ||
    values.rowingLactateThresholdHeartRateBpm !== null ||
    values.cyclingFtpWatts !== null ||
    values.vo2MaxRunning !== null ||
    values.vo2MaxCycling !== null ||
    values.availableTrainingDays.length > 0 ||
    values.preferredLongTrainingDays.length > 0
  );
}

function hasAllCoreFacts(values: GarminAthleteBaselineValues): boolean {
  return (
    values.runningLactateThresholdHeartRateBpm !== null &&
    values.cyclingLactateThresholdHeartRateBpm !== null &&
    values.rowingLactateThresholdHeartRateBpm !== null &&
    values.cyclingFtpWatts !== null &&
    values.vo2MaxRunning !== null &&
    values.vo2MaxCycling !== null &&
    values.availableTrainingDays.length > 0 &&
    values.preferredLongTrainingDays.length > 0
  );
}

export function normalizeGarminAthleteBaseline(input: {
  profilePayload?: unknown;
  ftpPayload?: unknown;
  fetchedAt?: Date;
}): GarminAthleteBaselineSnapshot {
  const userData = userDataFromProfile(input.profilePayload);
  const ftp = ftpData(input.ftpPayload);
  const sport = typeof ftp.sport === "string" ? ftp.sport.toLowerCase() : null;
  const cyclingFtpWatts =
    !sport || sport === "cycling" || sport === "bike" || sport === "biking"
      ? boundedInteger(ftp.functional_threshold_power_watts, 50, 700)
      : null;
  const values: GarminAthleteBaselineValues = {
    runningLactateThresholdHeartRateBpm: boundedInteger(
      userData.lactateThresholdHeartRate,
      80,
      230,
    ),
    cyclingLactateThresholdHeartRateBpm: boundedInteger(
      userData.lactateThresholdHeartRateCycling,
      80,
      230,
    ),
    rowingLactateThresholdHeartRateBpm: boundedInteger(
      userData.lactateThresholdHeartRateRowing,
      80,
      230,
    ),
    cyclingFtpWatts,
    cyclingFtpMeasuredOn: cyclingFtpWatts
      ? normalizeDate(ftp.calendar_date)
      : null,
    cyclingFtpSourceStale: cyclingFtpWatts
      ? normalizeBoolean(ftp.is_stale)
      : null,
    vo2MaxRunning: boundedVo2(userData.vo2MaxRunning),
    vo2MaxCycling: boundedVo2(userData.vo2MaxCycling),
    availableTrainingDays: normalizeWeekdays(userData.availableTrainingDays),
    preferredLongTrainingDays: normalizeWeekdays(
      userData.preferredLongTrainingDays,
    ),
  };
  const availability: Exclude<GarminAthleteBaselineAvailability, "failed"> =
    hasAllCoreFacts(values)
      ? "complete"
      : hasApprovedFact(values)
        ? "partial"
        : "unavailable";
  return {
    availability,
    source: "garmin_mcp",
    fetchedAt: input.fetchedAt ?? new Date(),
    values,
  };
}

export function hasUsableGarminAthleteBaseline(
  snapshot: GarminAthleteBaselineSnapshot,
): boolean {
  return (
    snapshot.availability === "complete" || snapshot.availability === "partial"
  );
}
