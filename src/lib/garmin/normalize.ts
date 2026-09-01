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

function numericStringOrNumberOrNull(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return numberOrNull(value);
}

function timestampOrNull(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstNumberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = numberOrNull(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function firstNonNegativeNumberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = nonNegativeNumberOrNull(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function firstMinutesFromSecondsOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = minutesFromSecondsOrNull(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function collectBodyBatteryReadings(
  payload: unknown,
  targetDate: string,
): Array<{ timestamp: Date; value: number }> {
  const readings: Array<{ timestamp: Date; value: number }> = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      if (item.length >= 2) {
        const timestamp = timestampOrNull(item[0]);
        const value = numericStringOrNumberOrNull(item[1]);
        if (
          timestamp &&
          timestamp.toISOString().slice(0, 10) === targetDate &&
          value !== null
        ) {
          readings.push({ timestamp, value });
        }
      }
      for (const entry of item) visit(entry);
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const timestamp =
      timestampOrNull(record.start_time) ??
      timestampOrNull(record.startTime) ??
      timestampOrNull(record.timestamp) ??
      timestampOrNull(record.time);
    const value =
      numericStringOrNumberOrNull(record.body_battery_level) ??
      numericStringOrNumberOrNull(record.bodyBatteryLevel) ??
      numericStringOrNumberOrNull(record.level) ??
      numericStringOrNumberOrNull(record.value);
    if (
      timestamp &&
      timestamp.toISOString().slice(0, 10) === targetDate &&
      value !== null
    ) {
      readings.push({ timestamp, value });
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") visit(nested);
    }
  };
  visit(payload);
  return readings.sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
}

function bodyBatteryMorningEvening(
  payload: unknown,
  targetDate: string,
): { bodyBatteryMorning: number | null; bodyBatteryEvening: number | null } {
  const readings = collectBodyBatteryReadings(payload, targetDate);
  if (readings.length === 0) {
    return { bodyBatteryMorning: null, bodyBatteryEvening: null };
  }
  return {
    bodyBatteryMorning: Math.round(readings[0].value),
    bodyBatteryEvening: Math.round(readings[readings.length - 1].value),
  };
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

function sleepScoreOrNull(value: unknown): number | null {
  const score = nonNegativeNumberOrNull(value);
  if (score === null || score > 100) return null;
  return Math.round(score);
}

function minutesFromSecondsOrNull(value: unknown): number | null {
  const seconds = nonNegativeNumberOrNull(value);
  return seconds === null ? null : Math.round(seconds / 60);
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

export function normalizeDailyHealth(
  date: string,
  payloads: Record<string, unknown>,
): NormalizedDailyHealth {
  const sleepPayload = objectOrNull(payloads.sleep);
  const sleep =
    objectOrNull(sleepPayload?.dailySleepDTO) ??
    objectOrNull(sleepPayload?.dailySleepDto) ??
    sleepPayload;
  const stats = objectOrNull(payloads.stats);
  const sleepMinutes = firstMinutesFromSecondsOrNull(
    sleep?.sleepTimeSeconds,
    sleep?.sleep_seconds,
  );
  const activeCalories = firstNonNegativeNumberOrNull(
    stats?.active_calories,
    stats?.activeCalories,
    stats?.activeKilocalories,
  );
  const restingCalories = firstNonNegativeNumberOrNull(
    stats?.bmr_calories,
    stats?.bmrCalories,
    stats?.restingCalories,
    stats?.bmrKilocalories,
  );
  const totalCalories = firstNonNegativeNumberOrNull(
    stats?.total_calories,
    stats?.totalCalories,
    stats?.wellnessTotalKilocalories,
    payloads.calories,
  );
  const moderateIntensity = firstNonNegativeNumberOrNull(
    stats?.moderate_intensity_minutes,
    stats?.moderateIntensityMinutes,
  );
  const vigorousIntensity = firstNonNegativeNumberOrNull(
    stats?.vigorous_intensity_minutes,
    stats?.vigorousIntensityMinutes,
  );
  const intensityMinutes =
    moderateIntensity !== null || vigorousIntensity !== null
      ? Math.round((moderateIntensity ?? 0) + (vigorousIntensity ?? 0))
      : null;
  const bodyBattery = bodyBatteryMorningEvening(payloads.bodyBattery, date);
  const fields = {
    sleepMinutes,
    sleepScore: sleepScoreOrNull(sleep?.sleep_score ?? sleep?.sleepScore),
    sleepDeepMinutes: firstMinutesFromSecondsOrNull(
      sleep?.deep_sleep_seconds,
      sleep?.deepSleepSeconds,
    ),
    sleepLightMinutes: firstMinutesFromSecondsOrNull(
      sleep?.light_sleep_seconds,
      sleep?.lightSleepSeconds,
    ),
    sleepRemMinutes: firstMinutesFromSecondsOrNull(
      sleep?.rem_sleep_seconds,
      sleep?.remSleepSeconds,
    ),
    sleepAwakeMinutes: firstMinutesFromSecondsOrNull(
      sleep?.awake_seconds,
      sleep?.awakeSeconds,
      sleep?.awakeSleepSeconds,
    ),
    sleepNapMinutes: firstMinutesFromSecondsOrNull(
      sleep?.nap_seconds,
      sleep?.napSeconds,
    ),
    restingHeartRate: firstNumberOrNull(
      payloads.restingHeartRate,
      stats?.resting_heart_rate_bpm,
      stats?.restingHeartRate,
      stats?.restingHR,
      sleep?.resting_heart_rate_bpm,
      sleep?.restingHeartRate,
    ),
    hrvStatus: null,
    hrvMs: firstNumberOrNull(sleep?.avg_overnight_hrv, sleep?.avgOvernightHrv),
    stressAvg: firstNumberOrNull(
      stats?.avg_stress_level,
      stats?.averageStressLevel,
    ),
    steps: firstNumberOrNull(
      stats?.total_steps,
      stats?.totalSteps,
      payloads.steps,
    ),
    calories: totalCalories,
    activeCalories,
    restingCalories,
    totalCalories,
    intensityMinutes,
    bodyBatteryAvg: firstNumberOrNull(
      stats?.body_battery_current,
      stats?.body_battery_highest,
      stats?.bodyBatteryCurrent,
      stats?.bodyBatteryHighest,
      stats?.bodyBatteryMostRecentValue,
      stats?.bodyBatteryHighestValue,
    ),
    ...bodyBattery,
  };
  return {
    date,
    ...fields,
    availability: dailyHealthAvailability(fields),
  };
}
