import { execFile } from "node:child_process";
import { garminTokenEnvironment } from "./token-location";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALTITUDE_RECORD_KEYS = [
  "altitude_m",
  "altitude",
  "enhanced_altitude",
  "altitude_meters",
  "altitudeMeters",
] as const;

type PlainRecord = Record<string, unknown>;

type FitAltitudePayload = {
  records: Array<{
    timestamp: string;
    enhanced_altitude: number;
  }>;
};

function plainRecord(value: unknown): value is PlainRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasTrueAltitude(record: PlainRecord): boolean {
  return ALTITUDE_RECORD_KEYS.some((key) => finiteNumber(record[key]) !== null);
}

function timestampOf(record: PlainRecord): string | null {
  const timestamp = record.timestamp;
  return typeof timestamp === "string" && timestamp.trim()
    ? timestamp.trim()
    : null;
}

function parseFitAltitudePayload(value: unknown): FitAltitudePayload | null {
  if (!plainRecord(value) || !Array.isArray(value.records)) return null;
  const records = value.records.flatMap((item) => {
    if (!plainRecord(item)) return [];
    const timestamp = timestampOf(item);
    const altitude = finiteNumber(item.enhanced_altitude);
    return timestamp && altitude !== null
      ? [{ timestamp, enhanced_altitude: altitude }]
      : [];
  });
  return records.length > 0 ? { records } : null;
}

export function activityDetailNeedsAltitudeSupplement(
  payload: unknown,
): boolean {
  if (!plainRecord(payload) || !Array.isArray(payload.records)) return false;
  const records = payload.records.filter(plainRecord);
  return records.length > 0 && !records.some(hasTrueAltitude);
}

export function mergeFitAltitudeRecords(
  payload: unknown,
  altitudePayload: unknown,
): unknown {
  if (!plainRecord(payload) || !Array.isArray(payload.records)) return payload;
  const supplement = parseFitAltitudePayload(altitudePayload);
  if (!supplement) return payload;

  const altitudeByTimestamp = new Map(
    supplement.records.map((record) => [
      record.timestamp,
      record.enhanced_altitude,
    ]),
  );
  let mergedCount = 0;
  const records = payload.records.map((record) => {
    if (!plainRecord(record) || hasTrueAltitude(record)) return record;
    const timestamp = timestampOf(record);
    if (!timestamp) return record;
    const altitude = altitudeByTimestamp.get(timestamp);
    if (altitude === undefined) return record;
    mergedCount += 1;
    return { ...record, enhanced_altitude: altitude };
  });

  return mergedCount > 0 ? { ...payload, records } : payload;
}

export async function fetchFitAltitudeWithLocalWrapper(
  garminId: string,
): Promise<unknown> {
  const scriptPath = join(
    process.cwd(),
    "scripts",
    "garmin_fit_altitude_stream.py",
  );
  if (!existsSync(scriptPath)) return undefined;
  const command = process.env.GARMIN_FIT_ALTITUDE_COMMAND ?? "uv";
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
      env: garminTokenEnvironment(),
    });
    return JSON.parse(stdout.trim()) as unknown;
  } catch {
    return undefined;
  }
}
