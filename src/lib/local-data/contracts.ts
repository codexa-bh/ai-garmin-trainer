import type {
  NormalizedActivity,
  NormalizedDailyHealth,
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
export type ActivityDashboardListItem = NormalizedActivity & {
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

export type ActivityDashboardHeartRateZoneBucket = {
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
  zoneSource: "garmin_mcp" | "derived" | null;
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

export type ActivityDashboardDetail = {
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

export type DailyHealthFreshnessEvidence = {
  date: string;
  availability: NormalizedDailyHealth["availability"] | null;
  hasStatsPayload: boolean;
  hasSleepPayload: boolean;
  hasBodyBatteryPayload: boolean;
};

export type ActivitySearch = {
  query?: string | null;
  limit?: number;
  offset?: number;
};
