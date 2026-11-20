/**
 * Normalized contracts for the additional Garmin evidence groups (sleep detail,
 * HRV baseline, dated VO2 max, Body Battery, stress buckets, activity Body
 * Battery delta/running dynamics, snowboard per-type split summaries and FIT
 * lap HR zones). Vendor field names stop in the official adapters; every value
 * is nullable unless a successful source reply makes a status meaningful.
 */

export type ExtraDataGroup =
  | "sleep"
  | "hrv"
  | "vo2_max"
  | "body_battery"
  | "stress"
  | "activity_body_battery"
  | "running_dynamics"
  | "snowboard_splits"
  | "lap_hr_zones";

/**
 * `populated`: stored evidence exists. `empty`: the source replied successfully
 * without this evidence. `unavailable`: the source cannot supply it for this
 * subject (no original file, ambiguous references, stored laps differ).
 * `failed`: the read failed; nothing is inferred. No row: not backfilled.
 */
type ExtraCoverageStatus = "populated" | "empty" | "unavailable" | "failed";

export type ExtraCoverage = {
  group: ExtraDataGroup;
  subjectType: "date" | "activity";
  subjectId: string;
  status: ExtraCoverageStatus;
  /** Closed short code, never vendor text. */
  reason: string | null;
};

export type SleepDetail = {
  startGmtMs: number | null;
  endGmtMs: number | null;
  /** Source local wall clock (`YYYY-MM-DDTHH:MM:SS`), never host-timezone derived. */
  startLocal: string | null;
  endLocal: string | null;
  /** Local minus GMT from the source's own timestamps. */
  utcOffsetMinutes: number | null;
  awakeCount: number | null;
  avgSleepStress: number | null;
  avgHeartRate: number | null;
  unmeasurableSeconds: number | null;
  windowConfirmationType: string | null;
  overallScore: number | null;
  overallQualifier: string | null;
  feedbackCode: string | null;
  insightCode: string | null;
  personalizedInsightCode: string | null;
};

export const SLEEP_SCORE_COMPONENTS = [
  "overall",
  "deep",
  "light",
  "rem",
  "total_duration",
  "stress",
  "awake_count",
  "restlessness",
] as const;
export type SleepScoreComponentName = (typeof SLEEP_SCORE_COMPONENTS)[number];

export type SleepScoreComponent = {
  component: SleepScoreComponentName;
  /** Only overall/deep/light/REM carry a numeric source value. */
  value: number | null;
  qualifier: string | null;
  optimalStart: number | null;
  optimalEnd: number | null;
  idealStartSeconds: number | null;
  idealEndSeconds: number | null;
};

export type HrvDetail = {
  weeklyAvgMs: number | null;
  lastNight5MinHighMs: number | null;
  baselineLowUpperMs: number | null;
  baselineBalancedLowMs: number | null;
  baselineBalancedUpperMs: number | null;
  baselineMarkerValue: number | null;
  feedbackCode: string | null;
};

export type BodyBatteryDay = {
  minLevel: number | null;
  maxLevel: number | null;
  charged: number | null;
  drained: number | null;
  latestLevel: number | null;
  endOfDayLevel: number | null;
  feedbackLevel: number | null;
  feedbackAtGmt: string | null;
  feedbackShortCode: string | null;
  feedbackLongCode: string | null;
  endOfDayFeedbackLevel: number | null;
  endOfDayFeedbackAtGmt: string | null;
  endOfDayFeedbackShortCode: string | null;
  endOfDayFeedbackLongCode: string | null;
};

export type BodyBatteryEvent = {
  /** Deterministic identity over normalized fields; no source event ID exists. */
  eventKey: string;
  eventType: string | null;
  startGmt: string | null;
  startLocal: string | null;
  durationSeconds: number | null;
  /** Signed level change attributed to the event. */
  impact: number | null;
  feedbackType: string | null;
  shortFeedback: string | null;
  /** Only when the source itself names an activity; never matched by time. */
  sourceActivityId: string | null;
};

export type StressDay = {
  avgLevel: number | null;
  maxLevel: number | null;
  qualifier: string | null;
  totalSeconds: number | null;
  restSeconds: number | null;
  activitySeconds: number | null;
  uncategorizedSeconds: number | null;
  lowSeconds: number | null;
  mediumSeconds: number | null;
  highSeconds: number | null;
  /** 0–1 fractions, or null when the source scale was not self-consistent. */
  restFraction: number | null;
  activityFraction: number | null;
  uncategorizedFraction: number | null;
  lowFraction: number | null;
  mediumFraction: number | null;
  highFraction: number | null;
};

/**
 * One day's additional evidence. `undefined` group: not part of this read;
 * `null`: the source replied without it. Child arrays are replaced only when
 * present (non-null) so an omitted source object never erases prior rows.
 */
export type DailyExtras = {
  date: string;
  sleep?: {
    detail: SleepDetail;
    components: SleepScoreComponent[] | null;
  } | null;
  hrv?: HrvDetail | null;
  bodyBattery?: {
    day: BodyBatteryDay;
    events: BodyBatteryEvent[] | null;
  } | null;
  stress?: StressDay | null;
  /** Sparse dated measurements for exactly this date; undefined when not read. */
  vo2?: Vo2Reading[];
  coverage: ExtraCoverage[];
};

export type Vo2Branch = "generic" | "cycling" | "rowing";
export type Vo2Reading = {
  date: string;
  branch: Vo2Branch;
  vo2Max: number | null;
  vo2MaxPrecise: number | null;
  sport: string | null;
  subSport: string | null;
};

export const SNOWBOARD_SPLIT_TYPES = [
  "SKI_RUN_SPLIT",
  "SKI_LIFT_SPLIT",
  "ASCENT_SPLIT",
  "DESCENT_SPLIT",
  "TRANSITION",
] as const;
type SnowboardSplitType = (typeof SNOWBOARD_SPLIT_TYPES)[number];

/** Per-type aggregate (e.g. all runs together), never an individual run. */
export type SplitTypeSummary = {
  splitType: SnowboardSplitType;
  count: number | null;
  durationSec: number | null;
  distanceMeters: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  totalAscentMeters: number | null;
  elevationLossMeters: number | null;
  avgElevationGainMeters: number | null;
  maxElevationGainMeters: number | null;
  maxDistanceMeters: number | null;
  numFalls: number | null;
  numClimbSends: number | null;
};

/** Activity-list evidence; cadence steps/min, stride centimetres. */
export type ActivityListExtras = {
  garminId: string;
  /** Signed delta over the activity, not an absolute level. */
  bodyBatteryDelta: number | null;
  avgRunCadenceSpm: number | null;
  maxRunCadenceSpm: number | null;
  avgDoubleCadenceSpm: number | null;
  maxDoubleCadenceSpm: number | null;
  avgFractionalCadenceSpm: number | null;
  maxFractionalCadenceSpm: number | null;
  avgStrideLengthCm: number | null;
  avgVerticalOscillationCm: number | null;
  avgGroundContactTimeMs: number | null;
  avgGroundContactBalancePct: number | null;
  avgVerticalRatioPct: number | null;
  avgGradeAdjustedSpeedMps: number | null;
  /** Null when the row carried no split summaries array. */
  splits: SplitTypeSummary[] | null;
  coverage: ExtraCoverage[];
};

/**
 * FIT session/lap dynamics. Cadence is FIT cycles per minute (one cycle is a
 * stride for foot sports, a revolution for cycling) including the fractional
 * part; it is never blindly doubled.
 */
export type FitDynamics = {
  avgCadenceCpm: number | null;
  maxCadenceCpm: number | null;
  totalCycles: number | null;
  avgVerticalOscillationCm: number | null;
  avgStanceTimeMs: number | null;
  avgStanceTimeBalancePct: number | null;
  avgVerticalRatioPct: number | null;
  avgStepLengthM: number | null;
  avgGradeAdjustedSpeedMps: number | null;
};

export type LapHrZoneBucket = {
  /** Source bucket index: 0 below zone 1, 1–5 zones, 6+ above. */
  bucket: number;
  zone: 1 | 2 | 3 | 4 | 5 | null;
  kind: "below" | "zone" | "above";
  seconds: number;
  lowerBpm: number | null;
  upperBpm: number | null;
};

export type LapHrZones = {
  lapNumber: number;
  calcMethod: string | null;
  sourceMaxHeartRate: number | null;
  sourceRestingHeartRate: number | null;
  buckets: LapHrZoneBucket[];
};

export type FitActivityExtras = {
  session: FitDynamics;
  /** Lap dynamics in file order; lapNumber matches the stored lap number. */
  laps: Array<{
    lapNumber: number;
    startTime: string | null;
    dynamics: FitDynamics;
  }>;
  lapZones: LapHrZones[];
  lapZoneStatus: { status: ExtraCoverageStatus; reason: string | null };
};
