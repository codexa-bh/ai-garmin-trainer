import type { ActivityDashboardDetail } from "./contracts";
import type { TerrainAnalysis } from "../analytics/terrain-sections";
import { dashboardActivity, dashboardLap } from "./dashboard-projection";

export const DASHBOARD_OVERVIEW_ROW_LIMIT = 20;
const DASHBOARD_LAP_SOURCE_LIMIT = 100;
const label = (text: string | null) =>
  text !== null && text.length > 200 ? `${text.slice(0, 199)}…` : text;

/** Finite numerical allowlist: never spread raw activity, lap or stream rows. */
export function projectDashboardOverview(
  dashboard: ActivityDashboardDetail,
  terrain: TerrainAnalysis,
) {
  const activity = dashboardActivity(dashboard.activity);
  const sourceRows = dashboard.laps.length;
  const rows = dashboard.laps
    .slice(0, DASHBOARD_OVERVIEW_ROW_LIMIT)
    .map(dashboardLap);
  const { sections, ...terrainMetadata } = terrain;
  return {
    tool: "getActivityDashboard" as const,
    // Critical measurements precede optional rows in both native and legacy evidence.
    activity: {
      ...activity,
      name: label(activity.name),
      label: label(activity.label),
      sport: label(activity.sport),
      trainingEffectLabel: label(activity.trainingEffectLabel),
    },
    heartRateZones: dashboard.heartRateZones,
    detail: {
      status: dashboard.detail.status,
      hasHeartRate: dashboard.detail.hasHeartRate,
      hasElevation: dashboard.detail.hasElevation,
      hasLaps: dashboard.detail.hasLaps,
      recordCount: dashboard.detail.recordCount,
      lapCount: dashboard.detail.lapCount,
      unavailableReason: label(dashboard.detail.unavailableReason),
    },
    limits: {
      labelCharacters: 200,
      optionalRowsPerSection: DASHBOARD_OVERVIEW_ROW_LIMIT,
      note: "Labels may be shortened. Missing/unavailable values are not measured zero. Optional rows are bounded; read counts and coverage before interpreting completeness. No GPS, raw charts/streams, refresh or implicit import.",
    },
    laps: {
      returnedCount: rows.length,
      sourceReturnedCount: sourceRows,
      sourceLimit: DASHBOARD_LAP_SOURCE_LIMIT,
      // Reaching the dashboard cap cannot establish the exact stored total.
      availableCount:
        sourceRows < DASHBOARD_LAP_SOURCE_LIMIT ? sourceRows : null,
      sourceMayBeTruncated: sourceRows >= DASHBOARD_LAP_SOURCE_LIMIT,
      omittedAtLeast: sourceRows - rows.length,
      truncated: sourceRows > rows.length,
      rows,
    },
    terrain: {
      ...terrainMetadata,
      rowLimit: DASHBOARD_OVERVIEW_ROW_LIMIT,
      sections,
    },
  };
}
