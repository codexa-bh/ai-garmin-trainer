import type {
  GarminBodyMetricValues,
  GarminBodyMetricsAvailability,
  GarminBodyMetricsSnapshot,
  GarminBodyWeightHistoryRow,
  GarminBodyWeightHistorySummary,
  GarminBodyWeightHistorySource,
  GarminCurrentWeightSource,
  GarminWeighInAvailability,
} from "./types";

const EMPTY_HISTORY: GarminBodyWeightHistorySummary = {
  availability: "unavailable",
  source: null,
  rangeStart: null,
  rangeEnd: null,
  count: 0,
};

export const EMPTY_GARMIN_BODY_METRIC_VALUES: GarminBodyMetricValues = {
  weightKg: null,
  heightCm: null,
};

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function userDataFromProfile(profilePayload: unknown): JsonObject {
  const root = objectValue(profilePayload) ?? {};
  return objectValue(root.userData) ?? root;
}

function fieldNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  const object = objectValue(value);
  if (!object) return null;
  for (const key of [
    "value",
    "weight",
    "weightKg",
    "weightInKg",
    "height",
    "heightCm",
    "heightInCm",
  ]) {
    const nested = fieldNumber(object[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function boundedNumber(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const parsed = fieldNumber(value);
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return parsed >= min && parsed <= max ? Number(parsed.toFixed(3)) : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function dateFromTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const millis = Math.abs(value) > 1e12 ? value : value * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function hasCurrentFact(values: GarminBodyMetricValues): boolean {
  return values.weightKg !== null || values.heightCm !== null;
}

function rowsFromWeightList(
  rows: unknown[],
  fetchedAt: Date,
): GarminBodyWeightHistoryRow[] {
  const byDate = new Map<string, GarminBodyWeightHistoryRow>();
  for (const row of rows) {
    const item = objectValue(row);
    if (!item) continue;
    const date =
      normalizeDate(item.date) ??
      normalizeDate(item.calendarDate) ??
      normalizeDate(item.sampleDate) ??
      normalizeDate(item.day) ??
      normalizeDate(item.timestamp) ??
      dateFromTimestamp(item.timestamp_gmt);
    const weightKg = boundedNumber(
      item.weight ?? item.weightKg ?? item.weightInKg,
      25,
      350,
    );
    if (!date || weightKg === null) continue;
    byDate.set(date, { date, weightKg, source: "garmin_mcp", fetchedAt });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function historyRowsFromPayload(
  historyPayload: unknown,
  fetchedAt: Date,
): GarminBodyWeightHistoryRow[] {
  const root = objectValue(historyPayload) ?? {};
  const rows = Array.isArray(root.dateWeightList)
    ? root.dateWeightList
    : Array.isArray(root.weightData)
      ? root.weightData
      : [];
  return rowsFromWeightList(rows, fetchedAt);
}

function weighInRowsFromPayload(
  weighInPayload: unknown,
  fetchedAt: Date,
): GarminBodyWeightHistoryRow[] {
  const root = objectValue(weighInPayload) ?? {};
  const rows = Array.isArray(root.measurements) ? root.measurements : [];
  const byDate = new Map<string, GarminBodyWeightHistoryRow>();
  for (const row of rows) {
    const item = objectValue(row);
    if (!item) continue;
    const date =
      normalizeDate(item.date) ?? dateFromTimestamp(item.timestamp_gmt);
    // get_weigh_ins reports weight_kg directly (and weight_grams alongside).
    // Prefer weight_kg; derive from grams only when kg is absent.
    const weightKg =
      item.weight_kg !== undefined
        ? boundedNumber(item.weight_kg, 25, 350)
        : (() => {
            const grams = boundedNumber(item.weight_grams, 25_000, 350_000);
            return grams === null ? null : Number((grams / 1000).toFixed(3));
          })();
    if (!date || weightKg === null) continue;
    byDate.set(date, { date, weightKg, source: "garmin_mcp", fetchedAt });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeHistoryRows(
  weighInRows: GarminBodyWeightHistoryRow[],
  bodyCompositionRows: GarminBodyWeightHistoryRow[],
): {
  rows: GarminBodyWeightHistoryRow[];
  source: GarminBodyWeightHistorySource;
} {
  const byDate = new Map<string, GarminBodyWeightHistoryRow>();
  let hasWeighIn = false;
  let hasBodyComposition = false;
  // Operator-approved priority: weigh-in (self-reported) wins on date overlap.
  for (const row of weighInRows) {
    byDate.set(row.date, row);
    hasWeighIn = true;
  }
  for (const row of bodyCompositionRows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, row);
      hasBodyComposition = true;
    }
  }
  const rows = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const source: GarminBodyWeightHistorySource =
    hasWeighIn && hasBodyComposition
      ? "mixed"
      : hasWeighIn
        ? "weigh_in"
        : hasBodyComposition
          ? "body_composition"
          : null;
  return { rows, source };
}

function currentWeightFromRows(
  weighInRows: GarminBodyWeightHistoryRow[],
  profileWeightKg: number | null,
): { weightKg: number | null; source: GarminCurrentWeightSource } {
  // Operator-approved semantics: the latest valid weigh-in is the current
  // weight whenever weigh-in data exists (weigh-in wins over both the profile
  // weight field and body-composition rows). Body-composition rows alone do
  // not change current-weight semantics; they only populate history.
  if (weighInRows.length > 0) {
    return {
      weightKg: weighInRows[weighInRows.length - 1]?.weightKg ?? null,
      source: "weigh_in",
    };
  }
  if (profileWeightKg !== null) {
    return { weightKg: profileWeightKg, source: "profile" };
  }
  return { weightKg: null, source: null };
}

function summarizeHistory(
  rows: GarminBodyWeightHistoryRow[],
  source: GarminBodyWeightHistorySource,
): GarminBodyWeightHistorySummary {
  if (rows.length === 0) return EMPTY_HISTORY;
  return {
    availability: "available",
    source,
    rangeStart: rows[0]?.date ?? null,
    rangeEnd: rows[rows.length - 1]?.date ?? null,
    count: rows.length,
  };
}

export function normalizeGarminBodyMetrics(input: {
  profilePayload?: unknown;
  historyPayload?: unknown;
  weighInPayload?: unknown;
  fetchedAt?: Date;
  historyFailed?: boolean;
  weighInFailed?: boolean;
}): GarminBodyMetricsSnapshot {
  const fetchedAt = input.fetchedAt ?? new Date();
  const userData = userDataFromProfile(input.profilePayload);
  const profileWeightKg = boundedNumber(
    userData.weight ?? userData.weightKg ?? userData.weightInKg,
    25,
    350,
  );
  const heightCm = boundedNumber(
    userData.height ?? userData.heightCm ?? userData.heightInCm,
    100,
    250,
  );
  const bodyCompositionRows = historyRowsFromPayload(
    input.historyPayload,
    fetchedAt,
  );
  const weighInRows = weighInRowsFromPayload(input.weighInPayload, fetchedAt);
  const merged = mergeHistoryRows(weighInRows, bodyCompositionRows);
  const currentWeight = currentWeightFromRows(weighInRows, profileWeightKg);
  const values: GarminBodyMetricValues = {
    weightKg: currentWeight.weightKg,
    heightCm,
  };
  const historyFailed =
    input.historyFailed === true || input.weighInFailed === true;
  const history =
    merged.rows.length === 0 && historyFailed
      ? {
          ...summarizeHistory(merged.rows, merged.source),
          availability: "failed" as const,
        }
      : summarizeHistory(merged.rows, merged.source);
  const weighInAvailability: GarminWeighInAvailability = input.weighInFailed
    ? "failed"
    : weighInRows.length > 0
      ? "available"
      : "unavailable";
  const availability: Exclude<GarminBodyMetricsAvailability, "failed"> =
    values.weightKg !== null && heightCm !== null
      ? "complete"
      : hasCurrentFact(values) || merged.rows.length > 0
        ? "partial"
        : "unavailable";
  return {
    availability,
    source: "garmin_mcp",
    fetchedAt,
    values,
    history,
    historyRows: merged.rows,
    currentWeightSource: currentWeight.source,
    weighInAvailability,
  };
}

export function hasUsableGarminBodyMetrics(
  snapshot: GarminBodyMetricsSnapshot,
): boolean {
  return (
    snapshot.availability === "complete" || snapshot.availability === "partial"
  );
}
