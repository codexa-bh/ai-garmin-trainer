import { requireRuntimeEnv } from "../env";
import {
  activityDetailCoverage,
  dataCounts,
  finishSyncRun,
  getActivityByGarminId,
  getActivityDetailAttempt,
  getActivityDetailForAnalytics,
  getCheckpoint,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  listActivityDetailAvailability,
  listActivityIdsNeedingDetail,
  listDailyHealthMissingGapDates,
  listDailyHealthRepairCandidateDates,
  listDailyHealthIntensityRepairCandidateDates,
  listDailyHealthTrailingCandidateDates,
  listActivityIdsNeedingEffortBackfill,
  listRecentActivities,
  recordActivityDetailAttempt,
  recordGarminAthleteBaselineFailure,
  recordGarminBodyMetricsFailure,
  recordSyncRun,
  saveCheckpoint,
  upsertActivities,
  upsertGarminRawPayload,
  upsertActivityDetail,
  upsertActivityHrZoneTime,
  upsertDailyHealth,
  writeGarminAthleteBaselineRefresh,
  writeGarminBodyMetricsRefresh,
} from "../db/repository";
import { GarminMcpClient } from "./mcp-client";
import { verifyConnectorToken } from "./client";
import { fetchFitBaselineWithLocalWrapper } from "./fit-baseline";
import { fetchFitAltitudeWithLocalWrapper } from "./fit-altitude";
import { fetchFitDistanceWithLocalWrapper } from "./fit-distance";
import { fetchFitSpeedWithLocalWrapper } from "./fit-speed";
import { createGarminImports } from "./sync-import";
import { createGarminReader } from "./reader-adapter";
import { createActivityDetailRequests } from "./detail-requests";

// Bind functions only: no environment validation, DB opening, clock capture or
// connector construction until the corresponding invocation reaches that step.
const imports = createGarminImports({
  historyStartDate: () =>
    requireRuntimeEnv().GARMIN_HISTORY_START_DATE as string,
  clock: () => new Date(),
  createReader: () =>
    createGarminReader({
      connector: new GarminMcpClient(),
      fit: {
        baseline: fetchFitBaselineWithLocalWrapper,
        altitude: fetchFitAltitudeWithLocalWrapper,
        distance: fetchFitDistanceWithLocalWrapper,
        speed: fetchFitSpeedWithLocalWrapper,
      },
      archive: upsertGarminRawPayload,
    }),
  store: {
    dataCounts,
    finishSyncRun,
    getCheckpoint,
    getGarminAthleteBaseline,
    getGarminBodyMetrics,
    listActivityIdsNeedingDetail,
    listDailyHealthMissingGapDates,
    listDailyHealthRepairCandidateDates,
    listDailyHealthIntensityRepairCandidateDates,
    listDailyHealthTrailingCandidateDates,
    listActivityIdsNeedingEffortBackfill,
    listRecentActivities,
    recordActivityDetailAttempt,
    recordGarminAthleteBaselineFailure,
    recordGarminBodyMetricsFailure,
    recordSyncRun,
    saveCheckpoint,
    upsertActivities,
    upsertActivityDetail,
    upsertActivityHrZoneTime,
    upsertDailyHealth,
    writeGarminAthleteBaselineRefresh,
    writeGarminBodyMetricsRefresh,
    getDetailAvailability: (garminId) =>
      getActivityDetailForAnalytics(garminId).availability,
  },
});

export const {
  runGarminSync,
  backfillActivityDetail,
  backfillActivityEffortFields,
} = imports;
export const verifyGarminConnection = verifyConnectorToken;
export const activityDetailRequests = createActivityDetailRequests({
  activityDetailCoverage,
  listActivityDetailAvailability,
  listRecentActivities,
  getActivityDetailAttempt,
  backfillActivityDetail,
  activityExists: (garminId) => Boolean(getActivityByGarminId(garminId)),
});
