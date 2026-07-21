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

export type GarminAthleteBaselineValues = {
  runningLactateThresholdHeartRateBpm: number | null;
  cyclingLactateThresholdHeartRateBpm: number | null;
  rowingLactateThresholdHeartRateBpm: number | null;
  cyclingFtpWatts: number | null;
  cyclingFtpMeasuredOn: string | null;
  cyclingFtpSourceStale: boolean | null;
  vo2MaxRunning: number | null;
  vo2MaxCycling: number | null;
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
    configuredMaxHeartRate: true;
    completeHeartRateZoneBoundaries: true;
    reason: "not_exposed_by_pinned_connector";
  };
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
  | "get_cycling_ftp";
