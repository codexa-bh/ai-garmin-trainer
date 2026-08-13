export type GarminActivityPayload = {
  activityId: string | number;
  activityName?: string;
  activityType?: { typeKey?: string } | string;
  startTimeLocal?: string;
  duration?: number;
  distance?: number;
  calories?: number;
  averageHR?: number;
  maxHR?: number;
  steps?: number;
  elevationGain?: number;
  elevationLoss?: number;
  trainingEffect?: number;
  training_effect?: number;
  anaerobic_training_effect?: number;
  anaerobicTrainingEffect?: number;
  training_effect_label?: string;
  trainingEffectLabel?: string;
  training_load?: number;
  trainingLoad?: number;
  moderate_intensity_minutes?: number;
  moderateIntensityMinutes?: number;
  vigorous_intensity_minutes?: number;
  vigorousIntensityMinutes?: number;
  total_intensity_minutes?: number;
  totalIntensityMinutes?: number;
  summaryDTO?: Record<string, unknown>;
};

export type NormalizedActivity = {
  garminId: string;
  name: string | null;
  sport: string;
  startedAt: Date;
  durationSec: number | null;
  distanceMeters: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  steps: number | null;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  trainingEffect: number | null;
  anaerobicTrainingEffect?: number | null;
  trainingEffectLabel?: string | null;
  trainingLoad?: number | null;
  moderateIntensityMinutes?: number | null;
  vigorousIntensityMinutes?: number | null;
  totalIntensityMinutes?: number | null;
};

export type NormalizedDailyHealth = {
  date: string;
  sleepMinutes: number | null;
  restingHeartRate: number | null;
  hrvStatus: string | null;
  hrvMs: number | null;
  stressAvg: number | null;
  steps: number | null;
  calories: number | null;
  bodyBatteryAvg: number | null;
  availability: "complete" | "partial" | "missing";
};

export type GarminAthleteBaselineAvailability =
  "complete" | "partial" | "unavailable" | "failed";

export type HeartRateZoneBoundaryDto = {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string | null;
  lowerBpm: number;
  upperBpm: number | null;
};

export type HeartRateZoneSetDto = {
  status: "garmin_configured" | "derived_from_garmin_max_hr" | "unavailable";
  source: "garmin_mcp" | "derived" | null;
  formula: string | null;
  boundaries: HeartRateZoneBoundaryDto[];
};

export type GarminAthleteBaselineValues = {
  configuredMaxHeartRateBpm: number | null;
  heartRateZones: HeartRateZoneSetDto;
  cyclingFtpWatts: number | null;
  cyclingFtpMeasuredOn: string | null;
  cyclingFtpSourceStale: boolean | null;
  availableTrainingDays: string[];
  preferredLongTrainingDays: string[];
};

export type GarminAthleteBaselineSnapshot = {
  availability: Exclude<GarminAthleteBaselineAvailability, "failed">;
  source: "garmin_mcp";
  fetchedAt: Date;
  values: GarminAthleteBaselineValues;
};

export type GarminAthleteBaselineAttempt = {
  status: GarminAthleteBaselineAvailability;
  attemptedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  preservedPrevious: boolean;
};

export type GarminAthleteBaselineDto = {
  availability: GarminAthleteBaselineAvailability;
  source: "garmin_mcp" | null;
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  preservedPrevious: boolean;
  values: GarminAthleteBaselineValues;
  unsupported: {
    configuredMaxHeartRate: boolean;
    completeHeartRateZoneBoundaries: boolean;
    reason:
      "not_exposed_by_pinned_connector" | "derived_from_garmin_max_hr" | null;
  };
};

export type GarminBodyMetricsAvailability =
  "complete" | "partial" | "unavailable" | "failed";

export type GarminBodyMetricValues = {
  weightKg: number | null;
  heightCm: number | null;
};

export type GarminBodyWeightHistoryRow = {
  date: string;
  weightKg: number;
  source: "garmin_mcp";
  fetchedAt: Date;
};

export type GarminBodyWeightHistorySummary = {
  availability: "available" | "unavailable" | "failed";
  rangeStart: string | null;
  rangeEnd: string | null;
  count: number;
};

export type GarminBodyMetricsSnapshot = {
  availability: Exclude<GarminBodyMetricsAvailability, "failed">;
  source: "garmin_mcp";
  fetchedAt: Date;
  values: GarminBodyMetricValues;
  history: GarminBodyWeightHistorySummary;
  historyRows: GarminBodyWeightHistoryRow[];
};

export type GarminBodyMetricsDto = {
  availability: GarminBodyMetricsAvailability;
  source: "garmin_mcp" | null;
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  preservedPrevious: boolean;
  values: GarminBodyMetricValues;
  history: GarminBodyWeightHistorySummary;
};

export type GarminReadOperation =
  | "list_activities"
  | "get_sleep"
  | "get_rhr"
  | "get_hrv"
  | "get_stress"
  | "get_steps"
  | "get_calories"
  | "get_body_battery"
  | "get_activities_by_date"
  | "get_activity"
  | "get_activity_splits"
  | "get_activity_typed_splits"
  | "get_activity_split_summaries"
  | "get_activity_weather"
  | "get_activity_hr_in_timezones"
  | "get_activity_power_in_timezones"
  | "get_activity_fit_data"
  | "get_stats"
  | "get_sleep_summary"
  | "get_morning_training_readiness"
  | "get_user_profile"
  | "get_body_composition"
  | "get_cycling_ftp";
