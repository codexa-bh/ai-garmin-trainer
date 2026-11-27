import {
  activityDetailCoverage,
  dataCounts,
  getActivityByGarminId,
  getActivityDetailForAnalytics,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  listActivityDetailAvailability,
  listRecentActivities,
} from "../local-data/composition";
import { liveConfigurationStatus, requireRuntimeEnv } from "../env";
import {
  finishSyncRun,
  healthHistoryBounds,
  getActivityDetailAttempt,
  getCheckpoint,
  listActivityIdsNeedingDetail,
  listDailyHealthMissingGapDates,
  listDailyHealthRepairCandidateDates,
  listDailyHealthIntensityRepairCandidateDates,
  listDailyHealthTrailingCandidateDates,
  listStoredDailyHealthDates,
  listActivityIdsNeedingEffortBackfill,
  recordActivityDetailAttempt,
  recordGarminAthleteBaselineFailure,
  recordGarminBodyMetricsFailure,
  recordSyncRun,
  saveCheckpoints,
  upsertActivities,
  upsertGarminRawPayload,
  upsertActivityDetail,
  upsertActivityHrZoneTime,
  upsertDailyHealth,
  writeGarminAthleteBaselineRefresh,
  writeGarminBodyMetricsRefresh,
} from "../db/repository";
import {
  recordExtraCoverage,
  upsertActivityListExtras,
  upsertDailyExtras,
  upsertFitActivityExtras,
} from "../db/extra-data-repository";
import { createGarminImports } from "./sync-import";
import { createOfficialReader } from "./official-reader";
import {
  GARMIN_KEY_MISSING,
  garminApiKey,
  garminKeyConfigured,
  garminTransport,
} from "./connection";
import { createConnectionCheck } from "./connection-check";
import { createActivityDetailRequests } from "./detail-requests";
import { kpiMeasurements } from "../weekly/composition";
import { autoSyncLifetime } from "./auto-sync-lifetime";

// Bind functions only: no environment validation, DB opening, clock capture or
// reader construction until the corresponding invocation reaches that step.
// The official Personal API reader is the only Garmin path; the key is read
// from the startup capability only when a request is actually admitted.
const createReader = (
  control?: Parameters<typeof createOfficialReader>[0]["control"],
) =>
  createOfficialReader({
    control,
    apiKey: garminApiKey,
    fetch: garminTransport(),
    archive: upsertGarminRawPayload,
  });
const imports = createGarminImports({
  historyStartDate: () => requireRuntimeEnv().GARMIN_HISTORY_START_DATE,
  clock: () => new Date(),
  wait: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  createReader,
  store: {
    dataCounts,
    healthHistoryBounds,
    finishSyncRun,
    getCheckpoint,
    getGarminAthleteBaseline,
    getGarminBodyMetrics,
    listActivityIdsNeedingDetail,
    listDailyHealthMissingGapDates,
    listDailyHealthRepairCandidateDates,
    listDailyHealthIntensityRepairCandidateDates,
    listDailyHealthTrailingCandidateDates,
    listStoredDailyHealthDates,
    listActivityIdsNeedingEffortBackfill,
    listRecentActivities,
    recordActivityDetailAttempt,
    recordGarminAthleteBaselineFailure,
    recordGarminBodyMetricsFailure,
    recordSyncRun,
    saveCheckpoints,
    upsertActivities,
    upsertActivityDetail,
    upsertActivityHrZoneTime,
    upsertDailyHealth,
    upsertDailyExtras: (days) => upsertDailyExtras(days),
    upsertActivityListExtras: (items) => upsertActivityListExtras(items),
    upsertFitActivityExtras: (garminId, extras) =>
      upsertFitActivityExtras(garminId, extras),
    recordExtraCoverage: (entries) => recordExtraCoverage(entries),
    writeGarminAthleteBaselineRefresh,
    writeGarminBodyMetricsRefresh,
    getDetailAvailability: (garminId) =>
      getActivityDetailForAnalytics(garminId).availability,
  },
});

// After a completed sync, maintain current and previous week measurements against
// the settled import. Measurement failure never changes the sync outcome.
async function measuredAfterSync<T extends { status: string }>(
  work: Promise<T>,
): Promise<T> {
  const result = await work;
  if (result.status === "completed")
    await kpiMeasurements
      .refresh(Intl.DateTimeFormat().resolvedOptions().timeZone)
      .catch(() => undefined);
  return result;
}
export const runGarminSync = ((onProgress, options) =>
  measuredAfterSync(
    imports.runGarminSync(onProgress, options ?? {}),
  )) as typeof imports.runGarminSync;
/** Only the ready native launcher's exact boot may ask for an automatic tick. */
export function garminAutoSyncOwner(identity: string | null): boolean {
  try {
    return (
      process.env.TRAINER_DESKTOP === "1" &&
      identity === liveConfigurationStatus().boot
    );
  } catch {
    return false;
  }
}
/** Desktop owner only: local configuration and lifetime precede all DB/network work. */
export async function runGarminAutoSync(signal: AbortSignal) {
  if (
    autoSyncLifetime().stopping ||
    signal.aborted ||
    requireRuntimeEnv().GARMIN_AUTO_SYNC !== "true" ||
    !garminConnectionReady().ok
  )
    return null;
  const result = await imports.runAutoSync(
    () => autoSyncLifetime().stopping || signal.aborted,
  );
  return result ? measuredAfterSync(Promise.resolve(result)) : null;
}
export const {
  syncSummary,
  backfillActivityDetail,
  backfillActivityEffortFields,
} = imports;
export const isGarminSyncRunning = imports.isSyncRunning;
export const cancelGarminSync = imports.requestCancel;
/** Explicit user action only (one official request); never startup/summary. */
export const verifyGarminConnection = createConnectionCheck(createReader);
/** Local presence preflight before Sync; no network and no key readback. */
export const garminConnectionReady = () =>
  garminKeyConfigured()
    ? { ok: true, detail: "Garmin Personal API key configured." }
    : { ok: false, detail: GARMIN_KEY_MISSING };
export const activityDetailRequests = createActivityDetailRequests({
  activityDetailCoverage,
  listActivityDetailAvailability,
  listRecentActivities,
  getActivityDetailAttempt,
  backfillActivityDetail,
  activityExists: (garminId) => Boolean(getActivityByGarminId(garminId)),
});
