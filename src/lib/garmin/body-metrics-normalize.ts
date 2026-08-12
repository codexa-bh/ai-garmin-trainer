import type {
  GarminBodyMetricValues,
  GarminBodyMetricsAvailability,
  GarminBodyMetricsSnapshot,
  GarminBodyWeightHistoryRow,
  GarminBodyWeightHistorySummary,
} from "./types";

const EMPTY_HISTORY: GarminBodyWeightHistorySummary = {
  availability: "unavailable",
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

function hasCurrentFact(values: GarminBodyMetricValues): boolean {
  return values.weightKg !== null || values.heightCm !== null;
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
  const byDate = new Map<string, GarminBodyWeightHistoryRow>();
  for (const row of rows) {
    const item = objectValue(row);
    if (!item) continue;
    const date =
      normalizeDate(item.date) ??
      normalizeDate(item.calendarDate) ??
      normalizeDate(item.sampleDate) ??
      normalizeDate(item.day) ??
      normalizeDate(item.timestamp);
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

function summarizeHistory(
  rows: GarminBodyWeightHistoryRow[],
): GarminBodyWeightHistorySummary {
  if (rows.length === 0) return EMPTY_HISTORY;
  return {
    availability: "available",
    rangeStart: rows[0]?.date ?? null,
    rangeEnd: rows[rows.length - 1]?.date ?? null,
    count: rows.length,
  };
}

export function normalizeGarminBodyMetrics(input: {
  profilePayload?: unknown;
  historyPayload?: unknown;
  fetchedAt?: Date;
  historyFailed?: boolean;
}): GarminBodyMetricsSnapshot {
  const fetchedAt = input.fetchedAt ?? new Date();
  const userData = userDataFromProfile(input.profilePayload);
  const values: GarminBodyMetricValues = {
    weightKg: boundedNumber(
      userData.weight ?? userData.weightKg ?? userData.weightInKg,
      25,
      350,
    ),
    heightCm: boundedNumber(
      userData.height ?? userData.heightCm ?? userData.heightInCm,
      100,
      250,
    ),
  };
  const historyRows = historyRowsFromPayload(input.historyPayload, fetchedAt);
  const history = input.historyFailed
    ? { ...summarizeHistory(historyRows), availability: "failed" as const }
    : summarizeHistory(historyRows);
  const availability: Exclude<GarminBodyMetricsAvailability, "failed"> =
    values.weightKg !== null && values.heightCm !== null
      ? "complete"
      : hasCurrentFact(values) || historyRows.length > 0
        ? "partial"
        : "unavailable";
  return {
    availability,
    source: "garmin_mcp",
    fetchedAt,
    values,
    history,
    historyRows,
  };
}

export function hasUsableGarminBodyMetrics(
  snapshot: GarminBodyMetricsSnapshot,
): boolean {
  return (
    snapshot.availability === "complete" || snapshot.availability === "partial"
  );
}
