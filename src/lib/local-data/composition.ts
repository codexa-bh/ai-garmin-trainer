import * as storage from "../db/repository";
import { createLocalData, createLocalDataDeletion } from "./application";

// Bind lazily: no SQLite, clock, environment or singleton work at import time.
// SQL/row decoding stays in the existing adapter; no generic persistence port.
export const {
  listActivitiesForDashboard,
  getActivityDashboardDetail,
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
export const deleteLocalData = createLocalDataDeletion(storage);
