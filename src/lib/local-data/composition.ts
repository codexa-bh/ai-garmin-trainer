import * as storage from "../db/repository";
import {
  createLocalData,
  createLocalDataDeletion,
  createTerrainAnalysis,
} from "./application";

export const analyzeActivityTerrain = createTerrainAnalysis((id) =>
  storage.getActivityTerrainInput(id),
);

// Bind lazily: no SQLite, clock, environment or singleton work at import time.
// SQL/row decoding stays in the existing adapter; no generic persistence port.
export const {
  listActivitiesForDashboard,
  listRecentDailyHealth,
  listRecentActivities,
  getActivityByGarminId,
  getActivityDetailForAnalytics,
  listActivityDetailAvailability,
  activityDetailCoverage,
  dataCounts,
  importSummary,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  healthDashboard,
  verifyActivityReference,
  summarizeSyncStatus,
} = createLocalData(storage);
export function getActivityDashboardDetail(id: string) {
  const dashboard = storage.getActivityDashboardDetail(id);
  return dashboard
    ? { ...dashboard, terrainSections: analyzeActivityTerrain(id) }
    : null;
}
export const deleteLocalData = createLocalDataDeletion(storage);
