import type { NormalizedDailyHealth } from "../garmin/types";
import { dailyHealthAvailability } from "../garmin/normalize";
export function dailyHealthMetricFields(
  day: Omit<NormalizedDailyHealth, "availability">,
): Omit<NormalizedDailyHealth, "date" | "availability"> {
  return {
    sleepMinutes: day.sleepMinutes,
    sleepScore: day.sleepScore,
    sleepDeepMinutes: day.sleepDeepMinutes,
    sleepLightMinutes: day.sleepLightMinutes,
    sleepRemMinutes: day.sleepRemMinutes,
    sleepAwakeMinutes: day.sleepAwakeMinutes,
    sleepNapMinutes: day.sleepNapMinutes,
    restingHeartRate: day.restingHeartRate,
    hrvStatus: day.hrvStatus,
    hrvMs: day.hrvMs,
    stressAvg: day.stressAvg,
    steps: day.steps,
    calories: day.calories,
    activeCalories: day.activeCalories,
    restingCalories: day.restingCalories,
    totalCalories: day.totalCalories,
    intensityMinutes: day.intensityMinutes,
    bodyBatteryAvg: day.bodyBatteryAvg,
    bodyBatteryMorning: day.bodyBatteryMorning,
    bodyBatteryEvening: day.bodyBatteryEvening,
  };
}

export function mergeDailyHealth(
  previous: NormalizedDailyHealth,
  incoming: NormalizedDailyHealth,
): NormalizedDailyHealth {
  const merged = {
    date: incoming.date,
    sleepMinutes: incoming.sleepMinutes ?? previous.sleepMinutes ?? null,
    sleepScore: incoming.sleepScore ?? previous.sleepScore ?? null,
    sleepDeepMinutes:
      incoming.sleepDeepMinutes ?? previous.sleepDeepMinutes ?? null,
    sleepLightMinutes:
      incoming.sleepLightMinutes ?? previous.sleepLightMinutes ?? null,
    sleepRemMinutes:
      incoming.sleepRemMinutes ?? previous.sleepRemMinutes ?? null,
    sleepAwakeMinutes:
      incoming.sleepAwakeMinutes ?? previous.sleepAwakeMinutes ?? null,
    sleepNapMinutes:
      incoming.sleepNapMinutes ?? previous.sleepNapMinutes ?? null,
    restingHeartRate:
      incoming.restingHeartRate ?? previous.restingHeartRate ?? null,
    hrvStatus: incoming.hrvStatus ?? previous.hrvStatus ?? null,
    hrvMs: incoming.hrvMs ?? previous.hrvMs ?? null,
    stressAvg: incoming.stressAvg ?? previous.stressAvg ?? null,
    steps: incoming.steps ?? previous.steps ?? null,
    calories: incoming.calories ?? previous.calories ?? null,
    activeCalories: incoming.activeCalories ?? previous.activeCalories ?? null,
    restingCalories:
      incoming.restingCalories ?? previous.restingCalories ?? null,
    totalCalories: incoming.totalCalories ?? previous.totalCalories ?? null,
    intensityMinutes:
      incoming.intensityMinutes ?? previous.intensityMinutes ?? null,
    bodyBatteryAvg: incoming.bodyBatteryAvg ?? previous.bodyBatteryAvg ?? null,
    bodyBatteryMorning:
      incoming.bodyBatteryMorning ?? previous.bodyBatteryMorning ?? null,
    bodyBatteryEvening:
      incoming.bodyBatteryEvening ?? previous.bodyBatteryEvening ?? null,
  };
  return {
    ...merged,
    availability: dailyHealthAvailability(dailyHealthMetricFields(merged)),
  };
}

export function shiftIsoDate(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return date;
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

export const DAILY_HEALTH_MUTABLE_TRAILING_DAYS = 14;
const DAILY_HEALTH_COMPLETE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function dailyHealthTrailingCriteria(input: {
  startDate: string;
  endDate: string;
  mutableTrailingDays?: number;
  limit?: number;
}) {
  const safeLimit = Math.min(
    Math.max(Math.trunc(input.limit ?? 1000), 1),
    1000,
  );
  const mutableTrailingDays = Math.min(
    Math.max(
      Math.trunc(
        input.mutableTrailingDays ?? DAILY_HEALTH_MUTABLE_TRAILING_DAYS,
      ),
      1,
    ),
    60,
  );
  const tailStart = shiftIsoDate(input.endDate, -(mutableTrailingDays - 1));
  const startDate = input.startDate > tailStart ? input.startDate : tailStart;
  return { safeLimit, startDate };
}
export function dailyHealthRefreshCutoff(now: number) {
  return now - DAILY_HEALTH_COMPLETE_REFRESH_INTERVAL_MS;
}
