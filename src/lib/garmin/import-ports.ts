import type { HealthCoverage } from "./import-contracts";
import type {
  GarminAthleteBaselineDto,
  GarminAthleteBaselineSnapshot,
  GarminBodyMetricsDto,
  GarminBodyMetricsSnapshot,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "./types";
import type {
  ActivityDetailAvailability,
  ActivityDetailAttemptStatus,
  ActivityDetailCoverage,
  ActivityDetailStatus,
  NormalizedActivityDetail,
} from "./detail-types";
import type { NormalizedActivityHrZoneTime } from "./activity-hr-zone-time";

// Named read capabilities, not an arbitrary MCP tool dispatcher. Wire parsing,
// FIT process supplements and redacted raw archival belong to the outer reader.
export interface GarminReader {
  start(): Promise<void>;
  close(): void;
  profile(): Promise<unknown>;
  cyclingFtp(): Promise<unknown>;
  bodyComposition(startDate: string, endDate: string): Promise<unknown>;
  weighIns(startDate: string, endDate: string): Promise<unknown>;
  activityPage(
    startDate: string,
    endDate: string,
    page: number,
  ): Promise<{
    activities: NormalizedActivity[];
    hasMore: boolean;
    nextPage?: number;
  }>;
  activityEffort(garminId: string): Promise<NormalizedActivity | null>;
  fitBaseline(garminIds: string[]): Promise<unknown>;
  dailyHealth(date: string): Promise<NormalizedDailyHealth>;
  activityDetail(garminId: string): Promise<{
    recognized: boolean;
    detail: NormalizedActivityDetail;
  }>;
  activityHrZoneTime(
    garminId: string,
  ): Promise<NormalizedActivityHrZoneTime | null>;
}

type RefreshFailure = {
  attemptedAt: Date;
  errorMessage: string;
  preservedPrevious: boolean;
};

export interface BaselineStore {
  getGarminAthleteBaseline(): GarminAthleteBaselineDto;
  getGarminBodyMetrics(): GarminBodyMetricsDto;
  recordGarminAthleteBaselineFailure(input: RefreshFailure): void;
  recordGarminBodyMetricsFailure(input: RefreshFailure): void;
  writeGarminAthleteBaselineRefresh(input: {
    snapshot: GarminAthleteBaselineSnapshot | null;
    status: GarminAthleteBaselineSnapshot["availability"];
    attemptedAt: Date;
    errorMessage: string | null;
    preservedPrevious: boolean;
  }): void;
  writeGarminBodyMetricsRefresh(input: {
    snapshot: GarminBodyMetricsSnapshot | null;
    status: GarminBodyMetricsSnapshot["availability"];
    attemptedAt: Date;
    errorMessage: string | null;
    preservedPrevious: boolean;
  }): void;
}

export interface DetailStore {
  upsertActivities(activities: NormalizedActivity[]): number;
  listActivityIdsNeedingEffortBackfill(limit: number): string[];
  upsertActivityHrZoneTime(value: NormalizedActivityHrZoneTime): void;
  getDetailAvailability(garminId: string): ActivityDetailAvailability | null;
  upsertActivityDetail(detail: NormalizedActivityDetail): void;
  recordActivityDetailAttempt(input: {
    garminId: string;
    force?: boolean;
    status: ActivityDetailAttemptStatus;
    detailStatus?: ActivityDetailStatus | null;
    retryable?: boolean;
    errorClass?: string | null;
    errorMessage?: string | null;
    preservedPrevious?: boolean;
  }): void;
}

type DateRange = { startDate: string; endDate: string };

export interface GarminImportStore extends BaselineStore, DetailStore {
  recordSyncRun(
    status: "running",
    options: { coverageStart: string; coverageEnd: string },
  ): string;
  finishSyncRun(
    id: string,
    status: "completed" | "failed",
    lastError?: string,
  ): void;
  getCheckpoint(key: string): string | null;
  saveCheckpoint(key: string, value: string): void;
  listRecentActivities(limit: number): { garminId: string }[];
  listDailyHealthMissingGapDates(input: DateRange): string[];
  listDailyHealthRepairCandidateDates(input: DateRange): string[];
  listDailyHealthIntensityRepairCandidateDates(input: DateRange): string[];
  listDailyHealthTrailingCandidateDates(input: DateRange): string[];
  upsertDailyHealth(days: NormalizedDailyHealth[]): number;
  listActivityIdsNeedingDetail(): string[];
  dataCounts(): {
    activities: number;
    healthCoverage: HealthCoverage;
    detailCoverage: ActivityDetailCoverage;
  };
}

export type GarminImportPorts = {
  store: GarminImportStore;
  createReader: () => GarminReader;
  historyStartDate: () => string;
  clock: () => Date;
};
