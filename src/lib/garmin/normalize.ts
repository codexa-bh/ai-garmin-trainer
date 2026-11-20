import type {
  GarminActivityPayload,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "./types";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumberOrNull(value: unknown): number | null {
  const normalized = numberOrNull(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function boundedSourceStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= 120 ? normalized : null;
}

function sourceNameOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function dailyHealthAvailability(
  fields: Omit<NormalizedDailyHealth, "date" | "availability">,
): NormalizedDailyHealth["availability"] {
  const metricCategories = [
    fields.sleepMinutes ??
      fields.sleepScore ??
      fields.sleepDeepMinutes ??
      fields.sleepLightMinutes ??
      fields.sleepRemMinutes ??
      fields.sleepAwakeMinutes ??
      fields.sleepNapMinutes,
    fields.restingHeartRate,
    fields.hrvMs ?? fields.hrvStatus,
    fields.stressAvg,
    fields.steps,
    fields.calories ??
      fields.activeCalories ??
      fields.restingCalories ??
      fields.totalCalories,
    fields.intensityMinutes,
    fields.bodyBatteryAvg ??
      fields.bodyBatteryMorning ??
      fields.bodyBatteryEvening,
  ];
  const present = metricCategories.filter((value) => value !== null).length;
  return present === 0 ? "missing" : present >= 6 ? "complete" : "partial";
}

export function normalizeActivity(
  payload: Partial<GarminActivityPayload> & Record<string, unknown>,
): NormalizedActivity {
  const sport =
    typeof payload.activityType === "string"
      ? payload.activityType
      : payload.activityType?.typeKey;
  const garminId = payload.activityId ?? payload.id;
  const type =
    sport ?? (typeof payload.type === "string" ? payload.type : null);
  const startedRaw =
    payload.startTimeLocal ?? payload.start_time ?? payload.start_time_local;
  const startedAt =
    typeof startedRaw === "string" ? new Date(startedRaw) : null;
  if (!garminId || !type || !startedAt || Number.isNaN(startedAt.getTime()))
    throw new Error("Malformed Garmin activity payload");
  const moderateIntensityMinutes = nonNegativeNumberOrNull(
    payload.moderate_intensity_minutes ?? payload.moderateIntensityMinutes,
  );
  const vigorousIntensityMinutes = nonNegativeNumberOrNull(
    payload.vigorous_intensity_minutes ?? payload.vigorousIntensityMinutes,
  );
  const explicitTotalIntensityMinutes = nonNegativeNumberOrNull(
    payload.total_intensity_minutes ?? payload.totalIntensityMinutes,
  );
  const totalIntensityMinutes =
    explicitTotalIntensityMinutes ??
    (moderateIntensityMinutes !== null || vigorousIntensityMinutes !== null
      ? (moderateIntensityMinutes ?? 0) + (vigorousIntensityMinutes ?? 0)
      : null);
  return {
    garminId: String(garminId),
    name:
      sourceNameOrNull(payload.activityName) ?? sourceNameOrNull(payload.name),
    sport: type,
    startedAt,
    durationSec: numberOrNull(payload.duration ?? payload.duration_seconds),
    distanceMeters: numberOrNull(payload.distance ?? payload.distance_meters),
    calories: numberOrNull(payload.calories),
    avgHeartRate: numberOrNull(payload.averageHR ?? payload.avg_hr_bpm),
    maxHeartRate: numberOrNull(payload.maxHR ?? payload.max_hr_bpm),
    steps: numberOrNull(payload.steps),
    elevationGainMeters: numberOrNull(
      payload.elevationGain ?? payload.elevation_gain_meters,
    ),
    elevationLossMeters: numberOrNull(
      payload.elevationLoss ?? payload.elevation_loss_meters,
    ),
    trainingEffect: nonNegativeNumberOrNull(
      payload.training_effect ?? payload.trainingEffect,
    ),
    anaerobicTrainingEffect: nonNegativeNumberOrNull(
      payload.anaerobic_training_effect ?? payload.anaerobicTrainingEffect,
    ),
    trainingEffectLabel: boundedSourceStringOrNull(
      payload.training_effect_label ?? payload.trainingEffectLabel,
    ),
    trainingLoad: nonNegativeNumberOrNull(
      payload.training_load ?? payload.trainingLoad,
    ),
    moderateIntensityMinutes,
    vigorousIntensityMinutes,
    totalIntensityMinutes,
  };
}
