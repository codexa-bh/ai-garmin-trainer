/**
 * Plain read-model contracts for the additional Garmin evidence shown in the
 * existing Health and Activity views. Storage rows, interpretation and UI
 * formatting each live elsewhere; these shapes carry stored values, units and
 * source coverage only. A missing coverage row is `not_imported`, which means
 * unknown, never empty or zero.
 */

type SupplementCoverageStatus =
  "populated" | "empty" | "unavailable" | "failed" | "not_imported";

export type SupplementCoverage = {
  status: SupplementCoverageStatus;
  /** Closed short code only; never vendor text. */
  reason: string | null;
};

export const HEALTH_SUPPLEMENT_GROUPS = [
  "sleep",
  "hrv",
  "stress",
  "body_battery",
  "vo2_max",
] as const;
export type HealthSupplementGroup = (typeof HEALTH_SUPPLEMENT_GROUPS)[number];

export const ACTIVITY_SUPPLEMENT_GROUPS = [
  "activity_body_battery",
  "running_dynamics",
  "lap_hr_zones",
  "snowboard_splits",
  "snow_run_lift_splits",
] as const;
export type ActivitySupplementGroup =
  (typeof ACTIVITY_SUPPLEMENT_GROUPS)[number];

/** Stored source seconds. Activity/uncategorized time is never "high stress". */
type StressBreakdown = {
  totalSeconds: number | null;
  restSeconds: number | null;
  lowSeconds: number | null;
  mediumSeconds: number | null;
  highSeconds: number | null;
  activitySeconds: number | null;
  uncategorizedSeconds: number | null;
};

export type SleepComponentEvidence = {
  component: string;
  /** Only overall/deep/light/REM carry a numeric 0–100 source score. */
  value: number | null;
  qualifier: string | null;
};

export type HealthSupplementDay = {
  date: string;
  /** Garmin's same-date baseline band in ms; null endpoints are never invented. */
  hrv: {
    weeklyAvgMs: number | null;
    balancedLowMs: number | null;
    balancedUpperMs: number | null;
    feedbackCode: string | null;
  } | null;
  sleep: {
    overallQualifier: string | null;
    components: SleepComponentEvidence[];
  } | null;
  stress: StressBreakdown | null;
  /** Daily charged/drained points; not a level and not latest/end-of-day. */
  bodyBattery: { charged: number | null; drained: number | null } | null;
  coverage: Record<HealthSupplementGroup, SupplementCoverage>;
};

export type Vo2Point = {
  date: string;
  branch: "generic" | "cycling" | "rowing";
  vo2Max: number | null;
  vo2MaxPrecise: number | null;
  sport: string | null;
  subSport: string | null;
};

/**
 * Sparse: only dates with stored rows or coverage appear in `days`. The window is
 * the existing bounded Health history (oldest..latest of its loaded days).
 */
export type HealthSupplements = {
  from: string | null;
  to: string | null;
  days: HealthSupplementDay[];
  vo2: Vo2Point[];
};

type LapZoneBucket = {
  /** 0 below zone 1, 1–5 zones, 6+ above. */
  bucket: number;
  kind: "below" | "zone" | "above";
  zone: number | null;
  seconds: number;
  lowerBpm: number | null;
  upperBpm: number | null;
};

export type LapZoneEvidence = {
  lapNumber: number;
  calcMethod: string | null;
  sourceMaxHeartRate: number | null;
  sourceRestingHeartRate: number | null;
  buckets: LapZoneBucket[];
};

/** Per-type aggregate over the whole activity; never an individual run. */
type SnowTypeTotal = {
  splitType: string;
  count: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  bestSplitDistanceMeters: number | null;
  maxSpeedMps: number | null;
};

/** Delivered individual measured run/lift. Locations are never selected. */
export type SnowRunEntry = {
  splitKey: string;
  splitType: "run" | "lift";
  startTime: string | null;
  timerSeconds: number | null;
  distanceMeters: number | null;
  descentMeters: number | null;
  ascentMeters: number | null;
  maxSpeedMps: number | null;
};

export type ActivitySupplement = {
  /** Signed change in points over the activity. */
  bodyBatteryDelta: number | null;
  /** Source-labelled: list cadence is steps/min, stride is centimetres. */
  listCadence: {
    avgSpm: number | null;
    maxSpm: number | null;
    strideLengthCm: number | null;
  };
  /** FIT cadence is cycles/min including fractions; step length is metres. */
  fitCadence: { avgCpm: number | null; stepLengthM: number | null };
  lapZones: LapZoneEvidence[];
  snowTotals: SnowTypeTotal[];
  snowRuns: {
    total: number;
    returned: number;
    truncated: boolean;
    entries: SnowRunEntry[];
  };
  coverage: Record<ActivitySupplementGroup, SupplementCoverage>;
};

/** Bound for the individual run/lift list; omission is disclosed, never silent. */
export const SNOW_RUN_LIST_LIMIT = 60;
/** Matches the existing lap read bound so lap-zone rows cannot outgrow laps. */
export const ACTIVITY_LAP_LIMIT = 100;
