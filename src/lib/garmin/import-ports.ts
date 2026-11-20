import type { GarminReadControl } from "./history-policy";
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
import type { DayCoverageEvidence } from "./coverage-policy";
import type { GarminDataSource } from "./types";
import type {
  ActivityListExtras,
  DailyExtras,
  ExtraCoverage,
  FitActivityExtras,
} from "./extra-types";

// Named read capabilities, not an arbitrary MCP tool dispatcher. Wire parsing,
// FIT process supplements and redacted raw archival belong to the outer reader.
export interface GarminReader {
  /** Provenance of facts this reader produces; absent means the MCP reader. */
  source?: GarminDataSource;
  /** Label stored with a discovery hint; absent means `get_weekly_steps`. */
  hintSource?: "get_weekly_steps" | "official_daily_summaries";
  /**
   * Optional no-I/O hint of the dates the application will read next, so a
   * range-backed reader can batch them. Never required for correctness, and a
   * reader must not fetch outside the dates it is given.
   */
  planDailyHealth?(dates: string[]): void;
  /**
   * Optional daily read that also returns the source's coverage chronology.
   * Only the official reader provides it; its presence selects coverage-based
   * finality in place of primary-upload finality.
   */
  dailyHealthEvidence?(date: string): Promise<{
    day: NormalizedDailyHealth;
    coverage: DayCoverageEvidence;
    /** Additional groups translated from the same range replies. */
    extras?: DailyExtras;
  }>;
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
    /** Additional list-row evidence for the same activities. */
    extras?: ActivityListExtras[];
    hasMore: boolean;
    nextPage?: number;
  }>;
  activityEffort(garminId: string): Promise<NormalizedActivity | null>;
  fitBaseline(garminIds: string[]): Promise<unknown>;
  primaryUpload?(): Promise<import("./primary-upload").PrimaryUpload>;
  /** `floor` is the selected history limit; only a range reader that would
   * otherwise read below it uses it, so no request leaves the chosen bounds. */
  weeklySteps?(
    endDate: string,
    weeks: number,
    floor?: string | null,
  ): Promise<import("./discovery-policy").StepsHint>;
  dailyHealth(date: string): Promise<NormalizedDailyHealth>;
  activityDetail(garminId: string): Promise<{
    recognized: boolean;
    detail: NormalizedActivityDetail;
    /** Lap/session dynamics and lap HR zones from the same decoded file. */
    fitExtras?: FitActivityExtras;
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
    preserveAttempt?: boolean;
    snapshot: GarminAthleteBaselineSnapshot | null;
    status: GarminAthleteBaselineSnapshot["availability"];
    attemptedAt: Date;
    errorMessage: string | null;
    preservedPrevious: boolean;
  }): void;
  writeGarminBodyMetricsRefresh(input: {
    historyOnly?: boolean;
    snapshot: GarminBodyMetricsSnapshot | null;
    status: GarminBodyMetricsSnapshot["availability"];
    attemptedAt: Date;
    errorMessage: string | null;
    preservedPrevious: boolean;
  }): void;
}

/** Optional so legacy test stores remain valid; production wires all three. */
interface ExtraDataStore {
  upsertDailyExtras?(days: DailyExtras[]): number;
  upsertActivityListExtras?(items: ActivityListExtras[]): number;
  upsertFitActivityExtras?(
    garminId: string,
    extras: FitActivityExtras,
  ): { lapsMatched: boolean };
  recordExtraCoverage?(entries: ExtraCoverage[]): void;
}

export interface DetailStore extends ExtraDataStore {
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

interface GarminImportStore extends BaselineStore, DetailStore {
  recordSyncRun(
    status: "running",
    options: { coverageStart: string; coverageEnd: string },
  ): string;
  finishSyncRun(
    id: string,
    status: "completed" | "failed" | "budget-limited" | "cancelled",
    lastError?: string,
  ): void;
  healthHistoryBounds?(): {
    oldestStored: string | null;
    oldestWithMetrics: string | null;
  };
  getCheckpoint(key: string): string | null;
  /** Atomic: all entries commit together or none do. */
  saveCheckpoints(entries: [key: string, value: string][]): void;
  listRecentActivities(limit: number): { garminId: string }[];
  listStoredDailyHealthDates(): string[];
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
  createReader: (control?: GarminReadControl) => GarminReader;
  historyStartDate: () => string | undefined;
  clock: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
};
