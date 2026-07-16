export type ActivityDetailAvailability = {
  garminId: string;
  fetchedAt: Date | null;
  status: "not_requested" | "available" | "partial" | "unsupported" | "failed";
  hasSession: boolean;
  hasLaps: boolean;
  hasStreams: boolean;
  hasGps: boolean;
  hasElevation: boolean;
  hasHeartRate: boolean;
  hasGrade: boolean;
  hasPower: boolean;
  hasRecovery: boolean;
  recordCount: number;
  lapCount: number;
  unavailableReason: string | null;
};

export type ActivityLapDetail = {
  lapNumber: number;
  startTime: string | null;
  durationSec: number | null;
  distanceMeters: number | null;
  avgSpeedMps: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  avgPowerWatts: number | null;
  normalizedPowerWatts: number | null;
};

export type ActivityStreamPoint = {
  timestamp: string | null;
  elapsedSec: number;
  heartRate: number | null;
  speedMps: number | null;
  altitudeMeters: number | null;
  gradePct: number | null;
  lat: number | null;
  lon: number | null;
  cadence: number | null;
  powerWatts: number | null;
  temperatureC: number | null;
};

export type NormalizedActivityDetail = ActivityDetailAvailability & {
  fetchedAt: Date;
  source: "garmin-fit" | "garmin-summary";
  session: Record<string, unknown> | null;
  derived: Record<string, unknown> | null;
  laps: ActivityLapDetail[];
  stream: ActivityStreamPoint[];
};
