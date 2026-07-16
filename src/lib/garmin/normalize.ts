import type {
  GarminActivityPayload,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "./types";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeActivity(
  payload: GarminActivityPayload,
): NormalizedActivity {
  const sport =
    typeof payload.activityType === "string"
      ? payload.activityType
      : payload.activityType?.typeKey;
  const startedAt = payload.startTimeLocal
    ? new Date(payload.startTimeLocal)
    : null;
  if (
    !payload.activityId ||
    !sport ||
    !startedAt ||
    Number.isNaN(startedAt.getTime())
  )
    throw new Error("Malformed Garmin activity payload");
  return {
    garminId: String(payload.activityId),
    sport,
    startedAt,
    durationSec: numberOrNull(payload.duration),
    distanceMeters: numberOrNull(payload.distance),
    calories: numberOrNull(payload.calories),
    avgHeartRate: numberOrNull(payload.averageHR),
    trainingEffect: numberOrNull(payload.trainingEffect),
  };
}

export function normalizeDailyHealth(
  date: string,
  payloads: Record<string, unknown>,
): NormalizedDailyHealth {
  const sleep = payloads.sleep as Record<string, unknown> | undefined;
  const hrv = payloads.hrv as Record<string, unknown> | undefined;
  const body = payloads.bodyBattery as Record<string, unknown> | undefined;
  const stress = payloads.stress as Record<string, unknown> | undefined;
  const fields = {
    sleepMinutes: numberOrNull(sleep?.sleepTimeSeconds)
      ? Math.round((sleep?.sleepTimeSeconds as number) / 60)
      : null,
    restingHeartRate: numberOrNull(payloads.restingHeartRate),
    hrvStatus: typeof hrv?.status === "string" ? hrv.status : null,
    hrvMs: numberOrNull(hrv?.weeklyAvg),
    stressAvg: numberOrNull(stress?.avgStressLevel),
    steps: numberOrNull(payloads.steps),
    calories: numberOrNull(payloads.calories),
    bodyBatteryAvg:
      numberOrNull(body?.averageStressLevel) ??
      numberOrNull(body?.averageBodyBattery),
  };
  const present = Object.values(fields).filter(
    (value) => value !== null,
  ).length;
  return {
    date,
    ...fields,
    availability:
      present === 0 ? "missing" : present >= 5 ? "complete" : "partial",
  };
}
