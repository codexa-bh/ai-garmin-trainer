import type {
  HeartRateZoneBoundaryDto,
  GarminAthleteBaselineDto,
} from "../garmin/types";
import type { ActivityDashboardHeartRateZoneTime } from "./contracts";
type HeartRateBaseline = GarminAthleteBaselineDto["values"]["heartRateZones"];
function emptyHeartRateZoneTime(
  input: Pick<
    ActivityDashboardHeartRateZoneTime,
    | "status"
    | "timeSource"
    | "zoneSource"
    | "zoneStatus"
    | "formula"
    | "activityDurationSec"
    | "sourceTotalSeconds"
    | "buckets"
    | "message"
  >,
): ActivityDashboardHeartRateZoneTime {
  return {
    ...input,
    classifiedSeconds: 0,
    unclassifiedSeconds: 0,
    noHeartRateSeconds: 0,
  };
}

function findHeartRateZone(
  heartRate: number,
  boundaries: HeartRateZoneBoundaryDto[],
): HeartRateZoneBoundaryDto | null {
  return (
    boundaries.find(
      (zone) =>
        heartRate >= zone.lowerBpm &&
        (zone.upperBpm === null || heartRate <= zone.upperBpm),
    ) ?? null
  );
}

export function storedHeartRateZoneTime(
  rows: Array<{
    zone: 1 | 2 | 3 | 4 | 5;
    seconds: number;
    sourceLowerBpm: number | null;
    sourceTotalSeconds: number;
  }>,
  baseline: HeartRateBaseline,
  activityDurationSec: number | null,
): ActivityDashboardHeartRateZoneTime | null {
  if (rows.length !== 5) return null;
  const boundariesByZone = new Map(
    baseline.boundaries.map((boundary) => [boundary.zone, boundary]),
  );
  const classifiedSeconds = rows.reduce((total, row) => total + row.seconds, 0);
  const buckets = rows.map((row) => {
    const boundary = boundariesByZone.get(row.zone);
    return {
      zone: row.zone,
      label: boundary?.label ?? `Zone ${row.zone}`,
      lowerBpm: boundary?.lowerBpm ?? row.sourceLowerBpm ?? 0,
      upperBpm: boundary?.upperBpm ?? null,
      seconds: row.seconds,
      percent: classifiedSeconds
        ? Math.round((row.seconds / classifiedSeconds) * 1000) / 10
        : 0,
    };
  });
  return {
    status: "available",
    timeSource: "garmin_activity",
    zoneSource: baseline.source,
    zoneStatus: baseline.status,
    formula: baseline.formula,
    classifiedSeconds,
    unclassifiedSeconds: 0,
    noHeartRateSeconds: 0,
    activityDurationSec,
    sourceTotalSeconds: rows[0]?.sourceTotalSeconds ?? classifiedSeconds,
    buckets,
    message:
      "Using Garmin activity HR-zone time totals; BPM boundaries are shown from the current Garmin baseline when available.",
  };
}

export function streamHeartRateZoneTime(
  stream: Array<{ elapsedSec: number; heartRate: number | null }>,
  baseline: HeartRateBaseline,
  activityDurationSec: number | null,
): ActivityDashboardHeartRateZoneTime {
  const boundaries = baseline.boundaries;
  if (baseline.status === "unavailable" || boundaries.length !== 5) {
    return emptyHeartRateZoneTime({
      status: "missing_zones",
      timeSource: null,
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: [],
      message:
        "Time in HR zones is unavailable because Garmin activity HR-zone totals and complete HR-zone boundaries are not available.",
    });
  }

  if (!stream.some((point) => point.heartRate !== null)) {
    return emptyHeartRateZoneTime({
      status: "missing_heart_rate",
      timeSource: "local_stream",
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: boundaries.map((zone) => ({ ...zone, seconds: 0, percent: 0 })),
      message:
        "Garmin activity HR-zone totals are unavailable, and local fallback cannot run because this activity has no heart-rate stream samples.",
    });
  }
  if (stream.length < 2) {
    return emptyHeartRateZoneTime({
      status: "insufficient_stream",
      timeSource: "local_stream",
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: boundaries.map((zone) => ({ ...zone, seconds: 0, percent: 0 })),
      message:
        "Garmin activity HR-zone totals are unavailable; local stream fallback needs at least two elapsed samples to compute durations.",
    });
  }

  const secondsByZone = new Map<number, number>();
  let classifiedSeconds = 0;
  let unclassifiedSeconds = 0;
  let noHeartRateSeconds = 0;
  for (let index = 0; index < stream.length - 1; index += 1) {
    const current = stream[index];
    const next = stream[index + 1];
    const seconds = Math.max(0, next.elapsedSec - current.elapsedSec);
    if (!seconds) continue;
    if (current.heartRate === null) {
      noHeartRateSeconds += seconds;
      continue;
    }
    const zone = findHeartRateZone(current.heartRate, boundaries);
    if (!zone) {
      unclassifiedSeconds += seconds;
      continue;
    }
    classifiedSeconds += seconds;
    secondsByZone.set(zone.zone, (secondsByZone.get(zone.zone) ?? 0) + seconds);
  }

  if (
    classifiedSeconds === 0 &&
    noHeartRateSeconds === 0 &&
    unclassifiedSeconds === 0
  ) {
    return emptyHeartRateZoneTime({
      status: "insufficient_stream",
      timeSource: "local_stream",
      zoneSource: baseline.source,
      zoneStatus: baseline.status,
      formula: baseline.formula,
      activityDurationSec,
      sourceTotalSeconds: null,
      buckets: boundaries.map((zone) => ({ ...zone, seconds: 0, percent: 0 })),
      message:
        "Garmin activity HR-zone totals are unavailable; local stream fallback needs increasing elapsed samples to compute durations.",
    });
  }

  const buckets = boundaries.map((zone) => {
    const seconds = secondsByZone.get(zone.zone) ?? 0;
    return {
      ...zone,
      seconds,
      percent: classifiedSeconds
        ? Math.round((seconds / classifiedSeconds) * 1000) / 10
        : 0,
    };
  });
  return {
    status: "available",
    timeSource: "local_stream",
    zoneSource: baseline.source,
    zoneStatus: baseline.status,
    formula: baseline.formula,
    classifiedSeconds,
    unclassifiedSeconds,
    noHeartRateSeconds,
    activityDurationSec,
    sourceTotalSeconds:
      classifiedSeconds + unclassifiedSeconds + noHeartRateSeconds,
    buckets,
    message:
      baseline.status === "garmin_configured"
        ? "Garmin activity HR-zone totals are unavailable; using local stream-derived timing with Garmin-configured HR-zone boundaries."
        : "Garmin activity HR-zone totals are unavailable; using local stream-derived timing with zones estimated from Garmin max HR.",
  };
}
