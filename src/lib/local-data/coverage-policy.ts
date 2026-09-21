import type { ActivityEffortCoverage } from "./contracts";
import type { HealthCoverage } from "../garmin/import-contracts";
export function interpretEffortCoverage(
  row: Record<keyof ActivityEffortCoverage, number | null>,
): ActivityEffortCoverage {
  return {
    total: row.total ?? 0,
    withAnyEffortField: row.withAnyEffortField ?? 0,
    withIntensityMinutes: row.withIntensityMinutes ?? 0,
    withTrainingLoad: row.withTrainingLoad ?? 0,
    withAnaerobicTrainingEffect: row.withAnaerobicTrainingEffect ?? 0,
    needingBackfill: row.needingBackfill ?? 0,
  };
}

export function interpretHealthCoverage(
  row: Omit<HealthCoverage, "metrics"> & HealthCoverage["metrics"],
): HealthCoverage {
  return {
    totalRows: row.totalRows,
    completeDays: row.completeDays,
    partialDays: row.partialDays,
    missingDays: row.missingDays,
    metrics: {
      sleepDays: row.sleepDays,
      restingHeartRateDays: row.restingHeartRateDays,
      hrvDays: row.hrvDays,
      stressDays: row.stressDays,
      stepsDays: row.stepsDays,
      calorieDays: row.calorieDays,
      intensityDays: row.intensityDays,
      bodyBatteryDays: row.bodyBatteryDays,
    },
  };
}
