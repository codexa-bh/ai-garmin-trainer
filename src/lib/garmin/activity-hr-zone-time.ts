export type ActivityHrZoneNumber = 1 | 2 | 3 | 4 | 5;

export type NormalizedActivityHrZoneTimeBucket = {
  zone: ActivityHrZoneNumber;
  seconds: number;
  sourceLowerBpm: number | null;
};

export type NormalizedActivityHrZoneTime = {
  garminId: string;
  fetchedAt: Date;
  source: "garmin_mcp";
  status: "available";
  sourceTotalSeconds: number;
  buckets: NormalizedActivityHrZoneTimeBucket[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
