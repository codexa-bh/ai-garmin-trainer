import type {
  NormalizedActivity,
  GarminAthleteBaselineDto,
  GarminBodyMetricsDto,
} from "../garmin/types";
import type {
  ActivityDetailStatus,
  ActivityDetailCoverage,
  ActivityDetailAvailability,
  ActivityLapDetail,
  ActivityStreamPoint,
} from "../garmin/detail-types";
import type {
  ActivityDashboardCharts,
  ActivityDashboardRoute,
} from "../analytics/activity-dashboard-calculations";
import type { HealthCoverage } from "../garmin/import-contracts";
import type { SplitHeartRate } from "./split-heart-rate";
type ActivityDashboardListItem = NormalizedActivity & {
  detailStatus: ActivityDetailStatus | null;
};

export type ActivityEffortCoverage = {
  total: number;
  withAnyEffortField: number;
  withIntensityMinutes: number;
  withTrainingLoad: number;
  withAnaerobicTrainingEffect: number;
  needingBackfill: number;
};

export type ActivityDashboardListPage = {
  activities: ActivityDashboardListItem[];
  nextOffset: number | null;
  totalApprox: number;
  limit: number;
  offset: number;
};

type ActivityDashboardHeartRateZoneBucket = {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string | null;
  lowerBpm: number;
  upperBpm: number | null;
  seconds: number;
  percent: number;
};

export type ActivityDashboardHeartRateZoneTime = {
  status:
    | "available"
    | "missing_zones"
    | "missing_heart_rate"
    | "insufficient_stream"
    | "missing_activity_zone_times";
  timeSource: "garmin_activity" | "local_stream" | null;
  zoneSource: "garmin_mcp" | "garmin_official" | "derived" | null;
  zoneStatus:
    "garmin_configured" | "derived_from_garmin_max_hr" | "unavailable";
  formula: string | null;
  classifiedSeconds: number;
  unclassifiedSeconds: number;
  noHeartRateSeconds: number;
  activityDurationSec: number | null;
  sourceTotalSeconds: number | null;
  buckets: ActivityDashboardHeartRateZoneBucket[];
  message: string;
};

type SnowSplitHeartRateRow = {
  splitKey: string;
  timerSeconds: number | null;
  distanceMeters: number | null;
  descentMeters: number | null;
  /** Time-weighted over supported seconds; null when unavailable (never zero). */
  avgHeartRate: number | null;
  supportSeconds: number | null;
  /** Measured window denominator, not timer/moving duration. */
  windowSeconds: number | null;
  hasLongGap: boolean | null;
  hrUnavailableReason: SplitHeartRate["unavailableReason"];
  /** [below zone 1, zone 1..5] seconds, or null when zones are unavailable. */
  zoneSeconds: number[] | null;
  zoneUnavailableReason: SplitHeartRate["zones"]["unavailableReason"];
};

export type SnowSplitHeartRateEvidence = {
  meaning: string;
  /** Activity-file zone lower bounds in bpm for zones 1–5, or null when unavailable. */
  zoneLowerBpm: number[] | null;
  perTypeLimit: number;
  types: Array<{
    splitType: "run" | "lift";
    sourceCount: number;
    returnedCount: number;
    omittedCount: number;
    rows: SnowSplitHeartRateRow[];
  }>;
};

/** Bounded nonlocation read model, independent of vendor ingestion DTOs. */
export type SnowActivityEvidence = {
  coverage: {
    status: "populated" | "empty" | "unavailable" | "failed" | "not_backfilled";
    reason: string | null;
  };
  /** Splits are never linked to Garmin laps; HR below is derived from stored samples in each split's own window. */
  hrAssociation: "no-proven-lap-link";
  /**
   * Bounded per-split derived evidence, present only on the activity overview.
   * Rows are in display order; omitted counts say exactly what was not returned.
   */
  splitHeartRate?: SnowSplitHeartRateEvidence;
  types: Array<{
    splitType: "run" | "lift";
    count: number;
    distanceMeters: number | null;
    timerSeconds: number | null;
    descentMeters: number | null;
    distanceMeasuredCount: number;
    timerMeasuredCount: number;
    descentMeasuredCount: number;
  }>;
};

export type ActivityDashboardDetail = {
  snowEvidence?: SnowActivityEvidence;
  activity: NormalizedActivity;
  detail: {
    status: ActivityDetailStatus;
    hasHeartRate: boolean;
    hasElevation: boolean;
    hasLaps: boolean;
    recordCount: number;
    lapCount: number;
    unavailableReason: string | null;
  };
  charts: ActivityDashboardCharts;
  route: ActivityDashboardRoute;
  heartRateZones: ActivityDashboardHeartRateZoneTime;
  laps: ActivityLapDetail[];
};

export type ActivityAnalyticsDetail = {
  snowEvidence?: SnowActivityEvidence;
  activity: NormalizedActivity | null;
  availability: ActivityDetailAvailability | null;
  session: Record<string, unknown> | null;
  derived: Record<string, unknown> | null;
  laps: ActivityLapDetail[];
  stream: ActivityStreamPoint[];
};

export type LocalDataCounts = {
  activities: number;
  healthDays: number;
  healthCoverage: HealthCoverage;
  detailedActivities: number;
  detailCoverage: ActivityDetailCoverage;
  activityEffortCoverage: ActivityEffortCoverage;
};

export type LocalImportSummary = {
  discovery?: import("../garmin/discovery-policy").GarminDiscoveryState | null;
  history?: import("../garmin/history-policy").GarminHistoryState | null;
  activities: number;
  healthDays: number;
  healthCoverage: HealthCoverage;
  detailedActivities: number;
  detailCoverage: ActivityDetailCoverage;
  activityEffortCoverage: ActivityEffortCoverage;
  athleteBaseline: GarminAthleteBaselineDto;
  bodyMetrics: GarminBodyMetricsDto;
  latestActivityDate: string | null;
  healthStartDate: string | null;
  healthEndDate: string | null;
};

export type ActivityReferenceInput = {
  garminId?: string | null;
  suppliedName?: string | null;
  date?: string | null;
};

export type ActivityVerificationEvidence = {
  tool: "activityVerification";
  reference: {
    garminId: string | null;
    suppliedName: string | null;
    date: string | null;
  };
  outcome: "found" | "not_found" | "ambiguous";
  matches: Array<{
    garminId: string;
    label: string;
    labelSource: "garmin" | "fallback";
    date: string;
    sport: string;
    distanceMeters: number | null;
    durationSec: number | null;
    elevationGainMeters: number | null;
    avgHeartRate: number | null;
  }>;
  importedCoverage: {
    activityCount: number;
    earliestDate: string | null;
    latestDate: string | null;
  };
  privacy: string;
};

export type ActivitySearch = {
  query?: string | null;
  limit?: number;
  offset?: number;
};
