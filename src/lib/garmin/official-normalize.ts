import type { DayCoverageEvidence } from "./coverage-policy";
import { shiftDate } from "./history-policy";
import { discoveryDate, type StepsHint } from "./discovery-policy";
import { officialProtocol } from "./official-error";
import { dailyHealthAvailability } from "./normalize";
import type { NormalizedDailyHealth } from "./types";

/**
 * Pure translation of documented Personal API replies into the shapes the
 * existing normalizers and import application already consume. Wire field names
 * stop here. Missing never becomes zero, and a malformed reply is a protocol
 * failure, never a silent empty success.
 */
type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function nonNegative(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}
function minutes(seconds: unknown): number | null {
  const parsed = nonNegative(seconds);
  return parsed === null ? null : Math.round(parsed / 60);
}
function isDate(value: unknown): value is string {
  return discoveryDate(value);
}

/** Range replies: a raw array, `{data: []}`, or an empty body; anything else is malformed. */
function rows(payload: unknown, key?: string): Row[] {
  if (payload === null || payload === undefined) return [];
  const list = Array.isArray(payload)
    ? payload
    : key && row(payload) && Array.isArray(row(payload)![key])
      ? (row(payload)![key] as unknown[])
      : null;
  if (!list) throw officialProtocol("Expected a list reply.");
  return list.map((item) => {
    const parsed = row(item);
    if (!parsed) throw officialProtocol("Expected object rows.");
    return parsed;
  });
}

function keyedByDate(
  items: Row[],
  dateKey: string,
  startDate: string,
  endDate: string,
): Map<string, Row> {
  const byDate = new Map<string, Row>();
  for (const item of items) {
    const date = item[dateKey];
    if (!isDate(date) || date < startDate || date > endDate)
      throw officialProtocol("Reply contained an out-of-range date.");
    if (byDate.has(date)) throw officialProtocol("Reply repeated a date.");
    byDate.set(date, item);
  }
  return byDate;
}

export type OfficialDailySources = {
  summaries: Map<string, Row>;
  sleep: Map<string, Row>;
  hrv: Map<string, Row>;
  bodyBattery: Map<string, Row>;
};

export function parseDailySummaries(
  payload: unknown,
  startDate: string,
  endDate: string,
) {
  return keyedByDate(rows(payload, "data"), "calendarDate", startDate, endDate);
}
export function parseSleepRange(
  payload: unknown,
  startDate: string,
  endDate: string,
) {
  return keyedByDate(rows(payload), "calendarDate", startDate, endDate);
}
export function parseHrvRange(
  payload: unknown,
  startDate: string,
  endDate: string,
) {
  return keyedByDate(
    rows(payload, "hrvSummaries"),
    "calendarDate",
    startDate,
    endDate,
  );
}
export function parseBodyBatteryRange(
  payload: unknown,
  startDate: string,
  endDate: string,
) {
  return keyedByDate(rows(payload), "date", startDate, endDate);
}

/** First and last timestamp-ordered levels of one day's body-battery report. */
function bodyBatteryLevels(report: Row | undefined): {
  morning: number | null;
  evening: number | null;
} {
  const none = { morning: null, evening: null };
  if (!report || !Array.isArray(report.bodyBatteryValuesArray)) return none;
  const descriptors = Array.isArray(report.bodyBatteryValueDescriptorDTOList)
    ? (report.bodyBatteryValueDescriptorDTOList as unknown[])
    : [];
  const indexOf = (key: string, fallback: number) => {
    const found = descriptors
      .map(row)
      .find((descriptor) => descriptor?.bodyBatteryValueDescriptorKey === key);
    return num(found?.bodyBatteryValueDescriptorIndex) ?? fallback;
  };
  const at = indexOf("timestamp", 0);
  const level = indexOf("bodyBatteryLevel", 1);
  const readings = (report.bodyBatteryValuesArray as unknown[])
    .flatMap((entry) => {
      if (!Array.isArray(entry)) return [];
      const stamp = num(entry[at]);
      const value = num(entry[level]);
      return stamp !== null && value !== null ? [{ stamp, value }] : [];
    })
    .sort((a, b) => a.stamp - b.stamp);
  if (!readings.length) return none;
  return {
    morning: Math.round(readings[0].value),
    evening: Math.round(readings[readings.length - 1].value),
  };
}

function nestedNumber(value: unknown, ...path: string[]): number | null {
  let current: unknown = value;
  for (const key of path) current = row(current)?.[key];
  return num(current);
}

export function officialDailyHealth(
  date: string,
  sources: OfficialDailySources,
): NormalizedDailyHealth {
  const summary = sources.summaries.get(date);
  const sleep = sources.sleep.get(date);
  const hrv = sources.hrv.get(date);
  const moderate = nonNegative(
    nestedNumber(summary, "intensityMinutes", "moderate"),
  );
  const vigorous = nonNegative(
    nestedNumber(summary, "intensityMinutes", "vigorous"),
  );
  const levels = bodyBatteryLevels(sources.bodyBattery.get(date));
  const score = nonNegative(
    nestedNumber(sleep, "sleepScores", "overall", "value"),
  );
  const total = nonNegative(nestedNumber(summary, "calories", "burnedTotal"));
  const status =
    typeof hrv?.status === "string" && hrv.status.length <= 120
      ? hrv.status
      : null;
  const fields = {
    sleepMinutes: minutes(sleep?.sleepTimeSeconds),
    sleepScore: score === null || score > 100 ? null : Math.round(score),
    sleepDeepMinutes: minutes(sleep?.deepSleepSeconds),
    sleepLightMinutes: minutes(sleep?.lightSleepSeconds),
    sleepRemMinutes: minutes(sleep?.remSleepSeconds),
    sleepAwakeMinutes: minutes(sleep?.awakeSleepSeconds),
    sleepNapMinutes: minutes(sleep?.napTimeSeconds),
    restingHeartRate: num(nestedNumber(summary, "heartRate", "restingValue")),
    hrvStatus: status,
    hrvMs: num(hrv?.lastNightAvg),
    stressAvg: num(nestedNumber(summary, "stress", "avgLevel")),
    steps: num(nestedNumber(summary, "movement", "steps", "value")),
    calories: total,
    activeCalories: nonNegative(
      nestedNumber(summary, "calories", "burnedActive"),
    ),
    restingCalories: nonNegative(
      nestedNumber(summary, "calories", "burnedResting"),
    ),
    totalCalories: total,
    intensityMinutes:
      moderate !== null || vigorous !== null
        ? Math.round((moderate ?? 0) + (vigorous ?? 0))
        : null,
    bodyBatteryAvg:
      num(nestedNumber(summary, "bodyBattery", "latestValue")) ??
      num(nestedNumber(summary, "bodyBattery", "maxValue")),
    bodyBatteryMorning: levels.morning,
    bodyBatteryEvening: levels.evening,
  };
  return { date, ...fields, availability: dailyHealthAvailability(fields) };
}

/** Chronology of one day's summary, or the closed reason it carries none. */
export function summaryCoverageEvidence(
  summary: Row | undefined,
): DayCoverageEvidence {
  if (!summary) return { kind: "none", reason: "not-returned" };
  if (summary.includesWellnessData === false)
    return { kind: "none", reason: "empty" };
  const chronology = row(summary.wellnessChronology);
  if (!chronology) return { kind: "none", reason: "empty" };
  const {
    startTimestampGmt,
    endTimestampGmt,
    startTimestampLocal,
    endTimestampLocal,
  } = chronology;
  const duration = num(chronology.totalDurationInMillis);
  if (
    [
      startTimestampGmt,
      endTimestampGmt,
      startTimestampLocal,
      endTimestampLocal,
    ].every((value) => value === null || value === undefined) &&
    duration === null
  )
    return { kind: "none", reason: "empty" };
  if (
    typeof startTimestampGmt !== "string" ||
    typeof endTimestampGmt !== "string" ||
    typeof startTimestampLocal !== "string" ||
    typeof endTimestampLocal !== "string" ||
    duration === null
  )
    return { kind: "none", reason: "malformed" };
  return {
    kind: "chronology",
    startGmt: startTimestampGmt,
    endGmt: endTimestampGmt,
    startLocal: startTimestampLocal,
    endLocal: endTimestampLocal,
    durationMs: duration,
  };
}

/**
 * Discovery hint from a full run of daily summaries ending at `endDate`. Every
 * requested date must be present: a null, truncated or partial range is unknown,
 * not an observed empty year. A reply of zero rows is source-emptiness.
 */
export function officialDiscoveryHint(
  payload: unknown,
  endDate: string,
  days: number,
): StepsHint {
  const startDate = shiftDate(endDate, -(days - 1));
  if (payload === null || payload === undefined)
    throw officialProtocol("Discovery range was null; coverage is unknown.");
  const byDate = parseDailySummaries(payload, startDate, endDate);
  if (byDate.size !== 0 && byDate.size !== days)
    throw officialProtocol(
      "Discovery range was truncated; coverage is unknown.",
    );
  const positive: string[] = [];
  // Seven-day buckets counted back from the end date, like the weekly hint did.
  const weeks = new Set<number>();
  const endDay = Date.parse(`${endDate}T00:00:00Z`) / 86_400_000;
  for (const [date, summary] of byDate) {
    if (summary.includesWellnessData !== true) continue;
    positive.push(date);
    weeks.add(
      Math.floor((endDay - Date.parse(`${date}T00:00:00Z`) / 86_400_000) / 7),
    );
  }
  return {
    startDate,
    endDate,
    positiveDates: positive.sort().reverse(),
    weeksWithData: weeks.size,
  };
}

/** Official activity-list/summary row mapped to the shape `normalizeActivity` reads. */
export function officialActivityPayload(list: Row): Record<string, unknown> {
  const summary = row(list.summaryDTO) ?? {};
  const pick = (key: string) => list[key] ?? summary[key];
  const local = pick("startTimeLocal");
  const type = row(list.activityType) ?? row(list.activityTypeDTO);
  return {
    activityId: list.activityId,
    activityName: list.activityName,
    activityType: type?.typeKey,
    // `YYYY-MM-DD HH:MM:SS` is local wall-clock text, kept as local, never read as UTC.
    startTimeLocal:
      typeof local === "string" ? local.replace(" ", "T") : undefined,
    duration: pick("duration"),
    distance: pick("distance"),
    calories: pick("calories"),
    averageHR: pick("averageHR"),
    maxHR: pick("maxHR"),
    steps: pick("steps"),
    elevationGain: pick("elevationGain"),
    elevationLoss: pick("elevationLoss"),
    trainingEffect: pick("aerobicTrainingEffect") ?? pick("trainingEffect"),
    anaerobicTrainingEffect: pick("anaerobicTrainingEffect"),
    trainingEffectLabel: pick("trainingEffectLabel"),
    trainingLoad: pick("activityTrainingLoad"),
    moderateIntensityMinutes: pick("moderateIntensityMinutes"),
    vigorousIntensityMinutes: pick("vigorousIntensityMinutes"),
  };
}

/** Exact per-activity HR zone seconds the activity list carries, or null. */
export function listHrZoneSeconds(list: Row): number[] | null {
  const seconds = [1, 2, 3, 4, 5].map((zone) =>
    nonNegative(list[`hrTimeInZone_${zone}`]),
  );
  return seconds.every((value) => value !== null)
    ? (seconds as number[])
    : null;
}

/** Weights arrive in grams with epoch-millisecond timestamps. */
function kilograms(grams: unknown): number | null {
  const value = nonNegative(grams);
  return value === null ? null : Number((value / 1000).toFixed(3));
}

export function officialWeighIns(payload: unknown): unknown {
  if (payload === null || payload === undefined) return {};
  const root = row(payload);
  if (!root || !Array.isArray(root.dailyWeightSummaries))
    throw officialProtocol("Weigh-in reply was unrecognized.");
  const measurements: Row[] = [];
  for (const day of root.dailyWeightSummaries) {
    const all = row(day)?.allWeightMetrics;
    if (!Array.isArray(all)) continue;
    const ordered = all
      .map(row)
      .filter((item): item is Row => item !== null)
      .sort((a, b) => (num(a.timestampGMT) ?? 0) - (num(b.timestampGMT) ?? 0));
    for (const item of ordered) {
      const weightKg = kilograms(item.weight);
      if (weightKg !== null && isDate(item.calendarDate))
        measurements.push({ date: item.calendarDate, weight_kg: weightKg });
    }
  }
  return { measurements };
}

export function officialBodyHistory(payload: unknown): unknown {
  if (payload === null || payload === undefined) return {};
  if (!Array.isArray(payload))
    throw officialProtocol("Body history reply was unrecognized.");
  const dateWeightList: Row[] = [];
  for (const item of payload) {
    const entry = row(item);
    const weight = entry ? kilograms(entry.weight) : null;
    if (entry && weight !== null && isDate(entry.calendarDate))
      dateWeightList.push({ calendarDate: entry.calendarDate, weight });
  }
  return { dateWeightList };
}

/** Settings plus configured HR zones as the athlete normalizer's profile payload. */
export function officialProfile(settings: unknown, zones: unknown): unknown {
  const root = row(settings);
  if (settings !== null && settings !== undefined && !root)
    throw officialProtocol("Profile reply was unrecognized.");
  const configured = Array.isArray(zones)
    ? (zones
        .map(row)
        .filter((entry): entry is Row => entry !== null)
        .find((entry) => entry.sport === "DEFAULT") ?? row(zones[0]))
    : null;
  return {
    userData: {
      availableTrainingDays: root?.availableTrainingDays ?? null,
      preferredLongTrainingDays: root?.preferredLongTrainingDays ?? null,
    },
    ...(configured
      ? {
          heartRateZones: {
            maxHeartRateUsed: configured.maxHeartRateUsed ?? null,
            method:
              typeof configured.trainingMethod === "string"
                ? configured.trainingMethod
                : null,
            floors: [1, 2, 3, 4, 5].map(
              (zone) => configured[`zone${zone}Floor`] ?? null,
            ),
          },
        }
      : {}),
  };
}
