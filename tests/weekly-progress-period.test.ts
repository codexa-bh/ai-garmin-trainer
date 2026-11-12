import { describe, expect, it } from "vitest";
import {
  PROGRESS_MAX_WEEKS,
  PROGRESS_PERIODS,
  progressPeriodRange,
  validWeek,
  weeklyCalendar,
} from "../src/lib/weekly/calendar";

const weeks = (from: string, through: string) =>
  (Date.parse(through) - Date.parse(from)) / (7 * 86400000) + 1;

describe("Progress preset periods", () => {
  it("counts inclusive Monday weeks and keeps 12 weeks equal to the former default", () => {
    expect(progressPeriodRange("6w", "2026-11-09")).toEqual({
      from: "2026-10-05",
      through: "2026-11-09",
    });
    expect(progressPeriodRange("12w", "2026-11-09")).toEqual({
      from: "2026-08-24",
      through: "2026-11-09",
    });
  });
  it("goes back calendar months to the Monday of that date's week across a year boundary", () => {
    // 2027-01-04 − 2 months = 2026-11-04 (Wed) → Monday 2026-11-02.
    expect(progressPeriodRange("2m", "2027-01-04")).toEqual({
      from: "2026-11-02",
      through: "2027-01-04",
    });
    // − 6 months = 2026-07-04 (Sat) → Monday 2026-06-29.
    expect(progressPeriodRange("6m", "2027-01-04").from).toBe("2026-06-29");
    // − 12 months = 2026-01-04 (Sun) → Monday 2025-12-29.
    expect(progressPeriodRange("12m", "2027-01-04").from).toBe("2025-12-29");
    expect(progressPeriodRange("6w", "2027-01-04").from).toBe("2026-11-30");
  });
  it("clamps month-end days, including leap and non-leap February", () => {
    // 2027-03-29 − 1 month logic via 2m from 2027-05-31: 2027-03-31 (Wed) → 2027-03-29.
    expect(progressPeriodRange("2m", "2027-05-31").from).toBe("2027-03-29");
    // 2028-04-30 is Sunday; use Monday 2028-05-01 − 2 → 2028-03-01 (Wed) → 2028-02-28.
    expect(progressPeriodRange("2m", "2028-05-01").from).toBe("2028-02-28");
    // Monday 2027-08-30 − 6 months → 2027-02-28 (clamped from 30, non-leap; Sun) → 2027-02-22.
    expect(progressPeriodRange("6m", "2027-08-30").from).toBe("2027-02-22");
    // Monday 2028-08-28 − 6 months → 2028-02-28 (Mon), leap year unaffected.
    expect(progressPeriodRange("6m", "2028-08-28").from).toBe("2028-02-28");
    // Monday 2029-02-26 − 12 months → 2028-02-26 (Sat) → 2028-02-21.
    expect(progressPeriodRange("12m", "2029-02-26").from).toBe("2028-02-21");
  });
  it("returns valid Monday ranges within the bound for every preset and many weeks", () => {
    let maximum = 0;
    for (let day = 0; day < 7 * 300; day += 7) {
      const current = new Date(Date.UTC(2026, 0, 5 + day))
        .toISOString()
        .slice(0, 10);
      for (const period of PROGRESS_PERIODS) {
        const range = progressPeriodRange(period, current);
        expect(validWeek(range.from) && range.through === current).toBe(true);
        maximum = Math.max(maximum, weeks(range.from, range.through));
      }
    }
    expect(maximum).toBe(PROGRESS_MAX_WEEKS);
    expect(() => progressPeriodRange("6w", "2026-11-10")).toThrow();
  });
  it("labels weeks by the device-calendar Monday across DST transitions", () => {
    for (const [instant, monday] of [
      ["2026-03-29T12:00:00Z", "2026-03-23"], // EU DST start Sunday
      ["2026-10-25T12:00:00Z", "2026-10-19"], // EU DST end Sunday
      ["2026-03-09T12:00:00Z", "2026-03-09"], // US DST start Monday
    ] as const) {
      const zone =
        monday === "2026-03-09" ? "America/New_York" : "Europe/Zagreb";
      const current = weeklyCalendar(new Date(instant), zone).weekStart;
      expect(current).toBe(monday);
      expect(progressPeriodRange("6w", current).from).toBe(
        new Date(Date.parse(`${monday}T12:00:00Z`) - 35 * 86400000)
          .toISOString()
          .slice(0, 10),
      );
    }
  });
});
