export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100 || /^[+-]/.test(value))
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
function civilDate(now: Date, timeZone: string): string {
  if (!validTimeZone(timeZone)) throw new Error("invalid_time_zone");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => parts.find((item) => item.type === key)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validWeek(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}
export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function midnight(date: string, timeZone: string): string {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  // Convert civil midnight using the zone's offset at the candidate, not a fixed week duration.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (key: string) =>
      parts.find((item) => item.type === key)?.value;
    const observed = Date.parse(
      `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`,
    );
    const delta = target - observed;
    if (!delta) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new Error("unsupported_calendar_midnight");
}
export function weekInterval(weekStart: string, timeZone: string) {
  if (!validWeek(weekStart) || !validTimeZone(timeZone))
    throw new Error("invalid_week_calendar");
  return {
    from: midnight(weekStart, timeZone),
    until: midnight(addDays(weekStart, 7), timeZone),
  };
}
export function weeklyCalendar(now: Date, timeZone: string) {
  const today = civilDate(now, timeZone);
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((day + 6) % 7));
  return {
    today,
    timeZone,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    upcoming: addDays(weekStart, 7),
    sunday: day === 0,
  };
}
