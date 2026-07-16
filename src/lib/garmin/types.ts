export type GarminActivityPayload = {
  activityId: string | number;
  activityType?: { typeKey?: string } | string;
  startTimeLocal?: string;
  duration?: number;
  distance?: number;
  calories?: number;
  averageHR?: number;
  trainingEffect?: number;
  summaryDTO?: Record<string, unknown>;
};

export type NormalizedActivity = {
  garminId: string;
  sport: string;
  startedAt: Date;
  durationSec: number | null;
  distanceMeters: number | null;
  calories: number | null;
  avgHeartRate: number | null;
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

export type GarminReadOperation =
  | "list_activities"
  | "get_sleep"
  | "get_rhr"
  | "get_hrv"
  | "get_stress"
  | "get_steps"
  | "get_calories"
  | "get_body_battery";
