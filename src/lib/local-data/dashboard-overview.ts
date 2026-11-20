import type { ActivityDashboardDetail } from "./contracts";
import type { ActivityGroundingExtras } from "./grounding-contracts";
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
  extras: ActivityGroundingExtras,
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
    extraEvidence: {
      source: "stored_normalized_garmin" as const,
      bodyBatteryDelta: extras.bodyBatteryDelta,
      bodyBatteryMeaning:
        "Signed activity change in points, not a level or daily charged/drained totals; no causal or pre-event inference.",
      cadence: {
        activityList: extras.activityList,
        activityListUnits:
          "Cadence steps/min; stride length centimetres. Source-reported fields are not automatically reconciled.",
        fitSession: extras.fitSession,
        fitUnits:
          "Cadence cycles/min including fractions (stride for foot sports, revolution for cycling), totalCycles cycles, step length metres; never blindly double cadence. Null optional sensors are not zero.",
      },
      coverage: extras.coverage,
      lapZoneMeaning:
        "Stored FIT lap-number association and historical file boundaries/method only; bucket 0 below, 1–5 zones, 6+ above. Never add lap buckets to session totals. Missing rows/status are not measured zeros; totals may differ from activity duration.",
      limits: {
        optionalLaps: 20,
        bucketsPerLap: 8,
        splitTypes: 5,
        codeCharacters: 64,
      },
      snowboard: {
        meaning:
          "Per-type aggregates, not individual runs/lifts. Seconds, metres and metres/second; count is number of source splits. maxDistance/maxElevationGain are best single-split facts, not totals. Never add aggregate and individual evidence.",
        sourceTypeCount: extras.snowboard.sourceTypeCount,
        returnedCount: extras.snowboard.rows.length,
        omittedCount:
          extras.snowboard.sourceTypeCount - extras.snowboard.rows.length,
        rows: extras.snowboard.rows,
      },
      laps: {
        sourceLapCount: extras.laps.sourceLapCount,
        returnedCount: extras.laps.rows.length,
        omittedCount: extras.laps.sourceLapCount - extras.laps.rows.length,
        truncated: extras.laps.sourceLapCount > extras.laps.rows.length,
        rows: extras.laps.rows.map(
          ({ sourceBucketCount, buckets, ...lap }) => ({
            ...lap,
            heartRateZones: {
              sourceBucketCount,
              returnedCount: buckets.length,
              omittedCount: sourceBucketCount - buckets.length,
              truncated: sourceBucketCount > buckets.length,
              buckets,
            },
          }),
        ),
      },
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
