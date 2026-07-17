import {
  getActivityDetailForAnalytics,
  listActivitiesForComparison,
  listRecentDailyHealth,
} from "@/lib/db/repository";
import type { ActivityStreamPoint } from "@/lib/garmin/detail-types";
import type { NormalizedActivity } from "@/lib/garmin/types";

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function avg(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
}

function paceMinPerKm(
  distanceMeters: number | null,
  durationSec: number | null,
): number | null {
  if (!distanceMeters || !durationSec || distanceMeters <= 0) return null;
  return durationSec / 60 / (distanceMeters / 1000);
}

function distanceFromSpeed(stream: ActivityStreamPoint[]): number | null {
  const speeds = stream
    .map((point) => point.speedMps)
    .filter((value): value is number => value !== null);
  if (!speeds.length) return null;
  return speeds.reduce((sum, speed) => sum + speed, 0);
}

function range(values: Array<number | null>): {
  min: number | null;
  max: number | null;
} {
  const present = values.filter((value): value is number => value !== null);
  return present.length
    ? { min: Math.min(...present), max: Math.max(...present) }
    : { min: null, max: null };
}

function hrZones(stream: ActivityStreamPoint[], activityMax: number | null) {
  const values = stream
    .map((point) => point.heartRate)
    .filter((value): value is number => value !== null && value > 0);
  if (!values.length) return [];
  const max = activityMax ?? Math.max(...values);
  const boundaries = [0.6, 0.7, 0.8, 0.9].map((pct) => max * pct);
  const buckets = [0, 0, 0, 0, 0];
  for (const value of values) {
    const index =
      value < boundaries[0]
        ? 0
        : value < boundaries[1]
          ? 1
          : value < boundaries[2]
            ? 2
            : value < boundaries[3]
              ? 3
              : 4;
    buckets[index] += 1;
  }
  return buckets.map((seconds, index) => ({
    zone: index + 1,
    seconds,
    percent: round((seconds / values.length) * 100),
  }));
}

function climbSegments(stream: ActivityStreamPoint[]) {
  const points = stream.filter((point) => point.altitudeMeters !== null);
  if (points.length < 2) return [];
  const climbs: Array<{
    startElapsedSec: number;
    endElapsedSec: number;
    durationSec: number;
    elevationGainMeters: number;
    avgGradePct: number | null;
    verticalSpeedMPerHour: number;
    avgHeartRate: number | null;
  }> = [];
  let start = 0;
  let gain = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].altitudeMeters ?? 0;
    const current = points[i].altitudeMeters ?? 0;
    const delta = current - prev;
    if (delta > 0) gain += delta;
    if (delta < -2 || i === points.length - 1) {
      const duration = points[i].elapsedSec - points[start].elapsedSec;
      if (gain >= 20 && duration >= 60) {
        const segment = points.slice(start, i + 1);
        const distance = distanceFromSpeed(segment);
        climbs.push({
          startElapsedSec: points[start].elapsedSec,
          endElapsedSec: points[i].elapsedSec,
          durationSec: duration,
          elevationGainMeters: round(gain),
          avgGradePct: distance
            ? round((gain / distance) * 100)
            : avg(segment.map((point) => point.gradePct)),
          verticalSpeedMPerHour: round((gain / duration) * 3600),
          avgHeartRate: avg(segment.map((point) => point.heartRate)),
        });
      }
      if (delta < -2) {
        start = i;
        gain = 0;
      }
    }
  }
  return climbs.slice(0, 10);
}

function similarEfforts(activity: NormalizedActivity | null) {
  if (!activity) return [];
  const baseDistance = activity.distanceMeters ?? 0;
  const baseDuration = activity.durationSec ?? 0;
  return listActivitiesForComparison(250)
    .filter(
      (candidate) =>
        candidate.garminId !== activity.garminId &&
        candidate.sport === activity.sport,
    )
    .map((candidate) => {
      const distanceScore =
        baseDistance && candidate.distanceMeters
          ? Math.abs(candidate.distanceMeters - baseDistance) / baseDistance
          : 0.5;
      const durationScore =
        baseDuration && candidate.durationSec
          ? Math.abs(candidate.durationSec - baseDuration) / baseDuration
          : 0.5;
      const elevationScore =
        activity.elevationGainMeters && candidate.elevationGainMeters
          ? Math.abs(
              candidate.elevationGainMeters - activity.elevationGainMeters,
            ) / activity.elevationGainMeters
          : 0.25;
      const score = distanceScore + durationScore + elevationScore;
      return {
        garminId: candidate.garminId,
        name: candidate.name,
        date: candidate.startedAt.toISOString().slice(0, 10),
        distanceKm: candidate.distanceMeters
          ? round(candidate.distanceMeters / 1000, 2)
          : null,
        durationMin: candidate.durationSec
          ? round(candidate.durationSec / 60)
          : null,
        elevationGainMeters: candidate.elevationGainMeters,
        avgHeartRate: candidate.avgHeartRate,
        similarityScore: round(score, 2),
      };
    })
    .sort((a, b) => a.similarityScore - b.similarityScore)
    .slice(0, 5);
}

export function analyzeStoredActivity(garminId: string) {
  const detail = getActivityDetailForAnalytics(garminId);
  const activity = detail.activity;
  const stream = detail.stream;
  const streamDistance = distanceFromSpeed(stream);
  const distanceMeters = activity?.distanceMeters ?? streamDistance;
  const durationSec =
    activity?.durationSec ?? (stream.length ? stream.length : null);
  const altitudeRange = range(stream.map((point) => point.altitudeMeters));
  const recoveryWindow = activity
    ? listRecentDailyHealth(30)
        .filter((day) => {
          const activityDay = activity.startedAt.toISOString().slice(0, 10);
          return day.date >= activityDay;
        })
        .slice(-3)
    : [];

  return {
    tool: "analyzeStoredActivity",
    privacy:
      "Computed from local normalized SQLite detail; raw FIT, credentials, and full history were not sent to the model.",
    activity: activity
      ? {
          garminId: activity.garminId,
          name: activity.name,
          sport: activity.sport,
          date: activity.startedAt.toISOString().slice(0, 10),
          distanceKm: distanceMeters ? round(distanceMeters / 1000, 2) : null,
          durationMin: durationSec ? round(durationSec / 60) : null,
          paceMinPerKm: paceMinPerKm(distanceMeters, durationSec),
          avgHeartRate: activity.avgHeartRate,
          maxHeartRate: activity.maxHeartRate,
          elevationGainMeters: activity.elevationGainMeters,
        }
      : null,
    availability: detail.availability,
    streamSummary: {
      records: stream.length,
      avgHeartRate: avg(stream.map((point) => point.heartRate)),
      avgSpeedMps: avg(stream.map((point) => point.speedMps)),
      avgGradePct: avg(stream.map((point) => point.gradePct)),
      minAltitudeMeters: altitudeRange.min,
      maxAltitudeMeters: altitudeRange.max,
    },
    heartRateZones: hrZones(stream, activity?.maxHeartRate ?? null),
    climbs: climbSegments(stream),
    laps: detail.laps.slice(0, 20),
    connectorDerived: detail.derived,
    similarEfforts: similarEfforts(activity),
    recoveryAfterActivity: recoveryWindow.map((day) => ({
      date: day.date,
      sleepMinutes: day.sleepMinutes,
      restingHeartRate: day.restingHeartRate,
      hrvMs: day.hrvMs,
      stressAvg: day.stressAvg,
      bodyBatteryAvg: day.bodyBatteryAvg,
      availability: day.availability,
    })),
    limitations: [
      !detail.activity
        ? "No imported local activity summary was found for this Garmin ID."
        : null,
      detail.availability
        ? null
        : "No detailed FIT/stream backfill has been run for this activity yet.",
      stream.length
        ? null
        : "No per-second stream points are available; analytics must be described as summary-only or lap/session-limited, not detailed stream analysis.",
    ].filter(Boolean),
  };
}
