import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SPEED_RECORD_KEYS = ["speed_mps", "enhanced_speed", "speed"] as const;

type PlainRecord = Record<string, unknown>;

type FitSpeedPayload = {
  records: Array<{
    timestamp: string;
    speed_mps: number;
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

function hasTrueSpeed(record: PlainRecord): boolean {
  return SPEED_RECORD_KEYS.some(
    (key) => finiteNonNegativeNumber(record[key]) !== null,
  );
}

function timestampOf(record: PlainRecord): string | null {
  const timestamp = record.timestamp;
  return typeof timestamp === "string" && timestamp.trim()
    ? timestamp.trim()
    : null;
}

function parseFitSpeedPayload(value: unknown): FitSpeedPayload | null {
  if (!plainRecord(value) || !Array.isArray(value.records)) return null;
  const records = value.records.flatMap((item) => {
    if (!plainRecord(item)) return [];
    const timestamp = timestampOf(item);
    const speed = finiteNonNegativeNumber(item.speed_mps);
    return timestamp && speed !== null ? [{ timestamp, speed_mps: speed }] : [];
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

export function activityDetailNeedsSpeedSupplement(payload: unknown): boolean {
  if (!plainRecord(payload) || !Array.isArray(payload.records)) return false;
  const records = payload.records.filter(plainRecord);
  return records.length > 0 && records.some((record) => !hasTrueSpeed(record));
}

export function mergeFitSpeedRecords(
  payload: unknown,
  speedPayload: unknown,
): unknown {
  if (!plainRecord(payload) || !Array.isArray(payload.records)) return payload;
  const connectorRecords = payload.records.filter(plainRecord);
  const supplement = parseFitSpeedPayload(speedPayload);
  if (!supplement) return payload;

  const connectorTimestampCounts = uniqueTimestampCounts(connectorRecords);
  const supplementTimestampCounts = uniqueTimestampCounts(supplement.records);
  const speedByTimestamp = new Map(
    supplement.records
      .filter(
        (record) =>
          connectorTimestampCounts.get(record.timestamp) === 1 &&
          supplementTimestampCounts.get(record.timestamp) === 1,
      )
      .map((record) => [record.timestamp, record.speed_mps]),
  );

  let mergedCount = 0;
  const records = payload.records.map((record) => {
    if (!plainRecord(record) || hasTrueSpeed(record)) return record;
    const timestamp = timestampOf(record);
    if (!timestamp) return record;
    const speed = speedByTimestamp.get(timestamp);
    if (speed === undefined) return record;
    mergedCount += 1;
    return { ...record, speed_mps: speed };
  });

  return mergedCount > 0 ? { ...payload, records } : payload;
}

export async function fetchFitSpeedWithLocalWrapper(
  garminId: string,
): Promise<unknown> {
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "garmin_fit_speed_stream.py",
  );
  if (!existsSync(scriptPath)) return undefined;
  const command = process.env.GARMIN_FIT_SPEED_COMMAND ?? "uv";
  const args = [
    "run",
    "--python",
    "3.12",
    "--with",
    "garminconnect==0.3.2",
    "--with",
    "fitparse>=1.2.0",
    "python",
    scriptPath,
    garminId,
  ];
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return JSON.parse(stdout.trim()) as unknown;
  } catch {
    return undefined;
  }
}
