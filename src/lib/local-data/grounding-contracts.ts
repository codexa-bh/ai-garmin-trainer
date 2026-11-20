import type { NormalizedDailyHealth } from "../garmin/types";
import type { LapHrZoneBucket, SplitTypeSummary } from "../garmin/extra-types";

/** Consumer-only selected normalized evidence, independent of UI/storage DTOs. */
export type GroundingCoverage = {
  status:
    | "populated"
    | "empty"
    | "unavailable"
    | "failed"
    | "not_imported_or_backfilled";
  reason: string | null;
};
export type RecoveryPreview = {
  sleepScore: number | null;
  sleepQualifier: string | null;
  weeklyHrvMs: number | null;
  balancedLowMs: number | null;
  balancedUpperMs: number | null;
  batteryCharged: number | null;
  batteryDrained: number | null;
  highStressSeconds: number | null;
  coverage: Record<
    "sleep" | "hrv" | "body_battery" | "stress",
    GroundingCoverage
  >;
};
export type TrainerRecoveryDay = NormalizedDailyHealth & {
  recovery?: RecoveryPreview;
};

type GroundingCadence = {
  avgCadenceCpm: number | null;
  maxCadenceCpm: number | null;
  totalCycles: number | null;
  avgStepLengthM: number | null;
};
export type ActivityGroundingExtras = {
  bodyBatteryDelta: number | null;
  activityList: {
    avgRunCadenceSpm: number | null;
    maxRunCadenceSpm: number | null;
    avgDoubleCadenceSpm: number | null;
    maxDoubleCadenceSpm: number | null;
    avgFractionalCadenceSpm: number | null;
    maxFractionalCadenceSpm: number | null;
    avgStrideLengthCm: number | null;
  };
  fitSession: GroundingCadence;
  coverage: Record<
    | "activity_body_battery"
    | "running_dynamics"
    | "snowboard_splits"
    | "lap_hr_zones",
    GroundingCoverage
  >;
  snowboard: { sourceTypeCount: number; rows: SplitTypeSummary[] };
  laps: {
    sourceLapCount: number;
    rows: Array<
      GroundingCadence & {
        lapNumber: number;
        sourceBucketCount: number;
        buckets: Array<
          LapHrZoneBucket & {
            calcMethod: string | null;
            sourceMaxHeartRate: number | null;
            sourceRestingHeartRate: number | null;
          }
        >;
      }
    >;
  };
};
