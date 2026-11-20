// Test-only legacy MCP detail supplement merge (retired product path). No process launch.

const DISTANCE_RECORD_KEYS = [
  "distance",
  "distance_m",
  "distance_meters",
  "distanceMeters",
] as const;

type PlainRecord = Record<string, unknown>;

type FitDistancePayload = {
  records: Array<{
    timestamp: string;
    distance_meters: number;
  }>;
};

function plainRecord(value: unknown): value is PlainRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function hasTrueDistance(record: PlainRecord): boolean {
  return DISTANCE_RECORD_KEYS.some(
    (key) => finiteNonNegativeNumber(record[key]) !== null,
  );
}

function timestampOf(record: PlainRecord): string | null {
  const timestamp = record.timestamp;
  return typeof timestamp === "string" && timestamp.trim()
    ? timestamp.trim()
    : null;
}

function parseFitDistancePayload(value: unknown): FitDistancePayload | null {
  if (!plainRecord(value) || !Array.isArray(value.records)) return null;
  const records = value.records.flatMap((item) => {
    if (!plainRecord(item)) return [];
    const timestamp = timestampOf(item);
    const distance = finiteNonNegativeNumber(item.distance_meters);
    return timestamp && distance !== null
      ? [{ timestamp, distance_meters: distance }]
      : [];
  });
  return records.length > 0 ? { records } : null;
}

function uniqueTimestampCounts(records: PlainRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const timestamp = timestampOf(record);
    if (!timestamp) continue;
    counts.set(timestamp, (counts.get(timestamp) ?? 0) + 1);
  }
  return counts;
}

export function activityDetailNeedsDistanceSupplement(
  payload: unknown,
): boolean {
  if (!plainRecord(payload) || !Array.isArray(payload.records)) return false;
  const records = payload.records.filter(plainRecord);
  return (
    records.length > 0 && records.some((record) => !hasTrueDistance(record))
  );
}

export function mergeFitDistanceRecords(
  payload: unknown,
  distancePayload: unknown,
): unknown {
  if (!plainRecord(payload) || !Array.isArray(payload.records)) return payload;
  const connectorRecords = payload.records.filter(plainRecord);
  const supplement = parseFitDistancePayload(distancePayload);
  if (!supplement) return payload;

  const connectorTimestampCounts = uniqueTimestampCounts(connectorRecords);
  const supplementTimestampCounts = uniqueTimestampCounts(supplement.records);
  const distanceByTimestamp = new Map(
    supplement.records
      .filter(
        (record) =>
          connectorTimestampCounts.get(record.timestamp) === 1 &&
          supplementTimestampCounts.get(record.timestamp) === 1,
      )
      .map((record) => [record.timestamp, record.distance_meters]),
  );

  let mergedCount = 0;
  const records = payload.records.map((record) => {
    if (!plainRecord(record) || hasTrueDistance(record)) return record;
    const timestamp = timestampOf(record);
    if (!timestamp) return record;
    const distance = distanceByTimestamp.get(timestamp);
    if (distance === undefined) return record;
    mergedCount += 1;
    return { ...record, distance_meters: distance };
  });

  return mergedCount > 0 ? { ...payload, records } : payload;
}
