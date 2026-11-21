import type { NormalizedActivity } from "../garmin/types";
import type { ActivityLapDetail } from "../garmin/detail-types";
import type { ActivitySupplement } from "./supplement-contracts";

/** Explicit nonlocation run projection; timestamps, source indexes and raw rows stay internal. */
export function dashboardSupplement(
  supplement: ActivitySupplement,
): ActivitySupplement {
  const measured = (value: number | null) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    ...supplement,
    snowRuns: {
      relevant: supplement.snowRuns.relevant,
      total: supplement.snowRuns.total,
      returned: supplement.snowRuns.returned,
      truncated: supplement.snowRuns.truncated,
      entries: supplement.snowRuns.entries.map((row) => ({
        splitKey: row.splitKey,
        timerSeconds: measured(row.timerSeconds),
        distanceMeters: measured(row.distanceMeters),
        ascentMeters: measured(row.ascentMeters),
        descentMeters: measured(row.descentMeters),
        avgSpeedMps: measured(row.avgSpeedMps),
        maxSpeedMps: measured(row.maxSpeedMps),
      })),
    },
  };
}

/** Shared numerical display semantics; no route, storage or UI dependency. */
export function dashboardActivity(activity: NormalizedActivity) {
  const startedAt = activity.startedAt.toISOString();
  const date = startedAt.slice(0, 10);
  return {
    garminId: activity.garminId,
    name: activity.name,
    label: activity.name?.trim() || `${activity.sport} on ${date}`,
    sport: activity.sport,
    startedAt,
    date,
    durationSec: activity.durationSec,
    distanceMeters: activity.distanceMeters,
    calories: activity.calories,
    avgHeartRate: activity.avgHeartRate,
    maxHeartRate: activity.maxHeartRate,
    steps: activity.steps,
    elevationGainMeters: activity.elevationGainMeters,
    elevationLossMeters: activity.elevationLossMeters,
    trainingEffect: activity.trainingEffect,
    anaerobicTrainingEffect: activity.anaerobicTrainingEffect ?? null,
    trainingEffectLabel: activity.trainingEffectLabel ?? null,
    trainingLoad: activity.trainingLoad ?? null,
    moderateIntensityMinutes: activity.moderateIntensityMinutes ?? null,
    vigorousIntensityMinutes: activity.vigorousIntensityMinutes ?? null,
    totalIntensityMinutes: activity.totalIntensityMinutes ?? null,
    effortSource: "garmin_mcp_normalized",
  };
}

function finiteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function dashboardLap(lap: ActivityLapDetail) {
  const avgSpeedMps = finiteNonNegative(lap.avgSpeedMps)
    ? lap.avgSpeedMps
    : finiteNonNegative(lap.distanceMeters) &&
        typeof lap.durationSec === "number" &&
        Number.isFinite(lap.durationSec) &&
        lap.durationSec > 0
      ? lap.distanceMeters / lap.durationSec
      : null;
  return {
    lapNumber: lap.lapNumber,
    durationSec: lap.durationSec,
    distanceMeters: lap.distanceMeters,
    avgSpeedMps,
    avgHeartRate: lap.avgHeartRate,
    maxHeartRate: lap.maxHeartRate,
    elevationGainMeters: lap.elevationGainMeters,
    elevationLossMeters: lap.elevationLossMeters,
    avgPowerWatts: lap.avgPowerWatts,
    normalizedPowerWatts: lap.normalizedPowerWatts,
  };
}
