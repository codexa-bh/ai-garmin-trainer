import type { HealthDashboardDay } from "./contracts";

/** Strict civil keys: reject impossible dates rather than normalizing them. */
export function isHealthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function shiftHealthDate(value: string, offset: number): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

export function dailyHealthBounds(days: HealthDashboardDay[], today: string) {
  const dates = days
    .map((day) => day.date)
    .filter((date) => isHealthDate(date) && date <= today)
    .sort();
  return dates.length
    ? { oldest: dates[0], latest: dates[dates.length - 1] }
    : null;
}

export function resolveHealthRange(
  end: string | null,
  bounds: ReturnType<typeof dailyHealthBounds>,
  today: string,
): string | null {
  if (!bounds) return null;
  return end &&
    isHealthDate(end) &&
    end <= today &&
    end >= bounds.oldest &&
    shiftHealthDate(end, -6) <= bounds.latest
    ? end
    : bounds.latest;
}

export function dailyHealthRange(
  days: HealthDashboardDay[],
  end: string | null,
  today: string,
) {
  const bounds = dailyHealthBounds(days, today);
  const rangeEnd = resolveHealthRange(end, bounds, today);
  if (!bounds || !rangeEnd) return null;
  const start = shiftHealthDate(rangeEnd, -6);
  const records = new Map(days.map((day) => [day.date, day]));
  return {
    end: rangeEnd,
    start,
    latest: bounds.latest,
    canPrevious: start > bounds.oldest,
    canNext: shiftHealthDate(rangeEnd, 7) <= bounds.latest,
    slots: Array.from({ length: 7 }, (_, index) => {
      const date = shiftHealthDate(start, index);
      return {
        date,
        record: records.get(date) ?? null,
        outsideLoaded: date < bounds.oldest || date > bounds.latest,
        isCurrentDay: date === today,
      };
    }),
  };
}
