import type { ActivityDashboardDetail } from "./contracts";

/** Interpret selected chart/lap evidence, without reading or broadening storage. */
export function buildDashboardDetail(
  activity: ActivityDashboardDetail["activity"],
  availability:
    | Pick<
        ActivityDashboardDetail["detail"],
        "status" | "recordCount" | "lapCount" | "unavailableReason"
      >
    | undefined,
  charts: ActivityDashboardDetail["charts"],
  route: ActivityDashboardDetail["route"],
  laps: ActivityDashboardDetail["laps"],
  heartRateZones: ActivityDashboardDetail["heartRateZones"],
): ActivityDashboardDetail {
  const hasHeartRate = charts.points.some((point) => point.heartRate !== null);
  const hasElevation = charts.points.some(
    (point) => point.altitudeMeters !== null,
  );
  return {
    activity,
    detail: {
      status: availability?.status ?? "not_requested",
      hasHeartRate,
      hasElevation,
      hasLaps: laps.length > 0,
      recordCount: availability?.recordCount ?? 0,
      lapCount: availability?.lapCount ?? laps.length,
      unavailableReason: availability?.unavailableReason ?? null,
    },
    charts,
    route,
    heartRateZones,
    laps,
  };
}
