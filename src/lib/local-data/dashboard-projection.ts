import type { NormalizedActivity } from "../garmin/types";
import type { ActivityLapDetail } from "../garmin/detail-types";

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
