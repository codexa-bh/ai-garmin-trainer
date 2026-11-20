import * as storage from "../db/repository";
import {
  getActivitySupplement,
  getHealthSupplements,
} from "../db/supplement-repository";
import { activityImageSource } from "./activity-image-renderer";
import {
  createActivityDashboard,
  createActivityDashboardEvidence,
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
  listTrainerRecoveryPreview,
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
  activitySupplement,
  verifyActivityReference,
  summarizeSyncStatus,
} = createLocalData({
  ...storage,
  getActivitySupplement,
  getHealthSupplements,
});
export function getActivityDashboardDetail(id: string) {
  const dashboard = storage.getActivityDashboardDetail(id);
  return dashboard
    ? { ...dashboard, terrainSections: analyzeActivityTerrain(id) }
    : null;
}
export const getActivityDashboard = createActivityDashboard(
  (id) => storage.getActivityDashboardDetail(id),
  analyzeActivityTerrain,
  (id) => storage.getActivityGroundingExtras(id),
);
const captureActivityDashboard = createActivityDashboardEvidence(
  (id) => storage.getActivityDashboardDetail(id),
  analyzeActivityTerrain,
  (id) => storage.getActivityGroundingExtras(id),
);
export function getActivityDashboardEvidence(id: string) {
  const captured = captureActivityDashboard(id);
  return captured
    ? { ...captured, source: activityImageSource(captured.visualInput) }
    : null;
}
export const deleteLocalData = createLocalDataDeletion(storage);
