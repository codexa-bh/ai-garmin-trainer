import type { GarminAthleteBaselineDto, GarminBodyMetricsDto } from "./types";
import type { ActivityDetailCoverage } from "./detail-types";

export type HealthCoverage = {
  totalRows: number;
  completeDays: number;
  partialDays: number;
  missingDays: number;
  metrics: {
    sleepDays: number;
    restingHeartRateDays: number;
    hrvDays: number;
    stressDays: number;
    stepsDays: number;
    calorieDays: number;
    intensityDays: number;
    bodyBatteryDays: number;
  };
};

export type GarminSyncResult = {
  status: "completed" | "failed";
  activitiesImported: number;
  healthDaysImported: number;
  activitiesProcessed: number;
  healthDaysRefreshed: number;
  detailsProcessed: number;
  effortDetailsProcessed: number;
  storedActivities: number;
  storedHealthRows: number;
  coverageStart: string;
  coverageEnd: string;
  healthCoverage: HealthCoverage;
  detailCoverage: ActivityDetailCoverage;
  athleteBaseline: GarminAthleteBaselineDto;
  bodyMetrics: GarminBodyMetricsDto;
  detail: string;
};

type GarminSyncProgress = {
  stage:
    | "starting"
    | "athlete"
    | "body_metrics"
    | "activities"
    | "health"
    | "detail"
    | "completed"
    | "failed";
  message: string;
  activitiesImported: number;
  healthDaysImported: number;
  detailsProcessed?: number;
  detailTotal?: number;
  page?: number;
  date?: string;
  totalHealthDays?: number;
  completedHealthDays?: number;
  athleteAvailability?: GarminAthleteBaselineDto["availability"];
  bodyMetricsAvailability?: GarminBodyMetricsDto["availability"];
};

export type ProgressReporter = (progress: GarminSyncProgress) => void;

export type ActivityEffortBackfillResult = {
  status: "completed" | "failed";
  attempted: number;
  updated: number;
  remaining: number;
  detail: string;
};

export type DetailedBackfillResult = {
  status: "completed" | "failed";
  garminId: string;
  detailStatus: "available" | "partial" | "unsupported" | "failed";
  recordCount: number;
  lapCount: number;
  preservedPrevious: boolean;
  retryable: boolean;
  detail: string;
};

export type DetailRefreshOptions = { force?: boolean };
