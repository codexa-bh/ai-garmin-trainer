import type {
  ActivityAnalyticsDetail,
  ActivityDashboardDetail,
  ActivityDashboardListPage,
  ActivityReferenceInput,
  ActivitySearch,
  LocalDataCounts,
  LocalImportSummary,
} from "./contracts";
import type {
  GarminAthleteBaselineDto,
  GarminBodyMetricsDto,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "../garmin/types";
import type {
  ActivityDetailAvailability,
  ActivityDetailCoverage,
} from "../garmin/detail-types";
import { interpretActivityReference } from "./activity-policy";

/** Consumer-owned synchronous reads and complete atomic lifecycle capabilities. */
export interface LocalDataReads {
  listActivitiesForDashboard(
    options?: ActivitySearch,
  ): ActivityDashboardListPage;
  getActivityDashboardDetail(garminId: string): ActivityDashboardDetail | null;
  listRecentDailyHealth(limit?: number): NormalizedDailyHealth[];
  listRecentActivities(limit?: number): NormalizedActivity[];
  listActivitiesForComparison(limit?: number): NormalizedActivity[];
  getActivityByGarminId(garminId: string): NormalizedActivity | null;
  getActivityDetailForAnalytics(garminId: string): ActivityAnalyticsDetail;
  listActivityDetailAvailability(limit?: number): ActivityDetailAvailability[];
  activityDetailCoverage(): ActivityDetailCoverage;
  dataCounts(): LocalDataCounts;
  importSummary(): LocalImportSummary;
  getGarminAthleteBaseline(): GarminAthleteBaselineDto;
  getGarminBodyMetrics(): GarminBodyMetricsDto;
}

export interface LocalDataLifecycle {
  clearChatAndProfile(): string[];
  clearGarminData(): string[];
  dataCounts(): LocalDataCounts;
}

export const HEALTH_DASHBOARD_DAY_LIMIT = 366;

export function createLocalData(reads: LocalDataReads) {
  return {
    listActivitiesForDashboard: (options?: ActivitySearch) =>
      reads.listActivitiesForDashboard(options),
    getActivityDashboardDetail: (id: string) =>
      reads.getActivityDashboardDetail(id),
    listRecentDailyHealth: (limit?: number) =>
      reads.listRecentDailyHealth(limit),
    listRecentActivities: (limit?: number) => reads.listRecentActivities(limit),
    getActivityByGarminId: (id: string) => reads.getActivityByGarminId(id),
    getActivityDetailForAnalytics: (id: string) =>
      reads.getActivityDetailForAnalytics(id),
    listActivityDetailAvailability: (limit?: number) =>
      reads.listActivityDetailAvailability(limit),
    activityDetailCoverage: () => reads.activityDetailCoverage(),
    dataCounts: () => reads.dataCounts(),
    importSummary: () => reads.importSummary(),
    getGarminAthleteBaseline: () => reads.getGarminAthleteBaseline(),
    getGarminBodyMetrics: () => reads.getGarminBodyMetrics(),
    healthDashboard() {
      const days = reads.listRecentDailyHealth(HEALTH_DASHBOARD_DAY_LIMIT);
      return { days, latestDate: days.length > 0 ? days[0].date : null };
    },
    verifyActivityReference(reference: ActivityReferenceInput, matchLimit = 5) {
      return interpretActivityReference(
        reads.listActivitiesForComparison(),
        reference,
        matchLimit,
      );
    },
    summarizeSyncStatus(limit = 10) {
      const counts = reads.dataCounts();
      const coverage = reads.activityDetailCoverage();
      const healthCoverage = counts.healthCoverage ?? {
        totalRows: counts.healthDays,
        completeDays: 0,
        partialDays: 0,
        missingDays: 0,
        metrics: {
          sleepDays: 0,
          restingHeartRateDays: 0,
          hrvDays: 0,
          stressDays: 0,
          stepsDays: 0,
          calorieDays: 0,
          intensityDays: 0,
          bodyBatteryDays: 0,
        },
      };
      const athlete = reads.getGarminAthleteBaseline();
      const bodyMetrics = reads.getGarminBodyMetrics();
      const availability = reads
        .listActivityDetailAvailability(limit)
        .map((item) => ({
          garminId: item.garminId,
          status: item.status,
          recordCount: item.recordCount,
          lapCount: item.lapCount,
          hasStreams: item.hasStreams,
          hasGps: item.hasGps,
          hasHeartRate: item.hasHeartRate,
          hasElevation: item.hasElevation,
        }));
      return {
        counts: { ...counts, healthCoverage },
        coverage,
        athlete,
        bodyMetrics,
        availability,
      };
    },
  };
}

export function createLocalDataDeletion(lifecycle: LocalDataLifecycle) {
  return (scope: unknown) => {
    if (scope !== "chat-profile" && scope !== "garmin-all") return null;
    const deleted =
      scope === "chat-profile"
        ? lifecycle.clearChatAndProfile()
        : lifecycle.clearGarminData();
    return {
      ok: true,
      deleted,
      counts: lifecycle.dataCounts(),
      detail:
        scope === "chat-profile"
          ? "Cleared local conversations, messages, and trainer profile. semantic memory and normalized Garmin data were preserved; use Clear all memory for semantic memory."
          : "Deleted normalized Garmin data, athlete baselines, sync runs, and checkpoints managed by the app. External garmin-mcp-auth tokens were not deleted because the app did not create or own them.",
    };
  };
}
