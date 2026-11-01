import { describe, expect, it } from "vitest";
import type { HealthDashboardDay } from "../src/app/dashboard/contracts";
import {
  dailyHealthBounds,
  dailyHealthRange,
  isHealthDate,
  resolveHealthRange,
  shiftHealthDate,
} from "../src/app/dashboard/health-daily-range";

// Calendar policy reads dates only. No private metric fixture is used.
const rows = (...dates: string[]) =>
  dates.map((date) => ({ date }) as HealthDashboardDay);
const today = "2026-11-01";

describe("Daily civil-date comparison", () => {
  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-2-01",
    "2026-01-01T00:00:00Z",
    "bad",
    "",
    "2026-00-12",
  ])("rejects malformed/impossible %s", (date) =>
    expect(isHealthDate(date)).toBe(false),
  );
  it.each([
    ["2024-03-01", -1, "2024-02-29"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-03-29", 7, "2026-04-05"],
    ["2026-11-01", -7, "2026-10-25"],
    ["2011-12-29", 1, "2011-12-30"],
  ])(
    "steps %s by %s civil days, including DST/year/leap boundaries",
    (date, offset, expected) => {
      expect(shiftHealthDate(date, offset)).toBe(expected);
    },
  );

  it("builds seven ascending calendar slots, never seven records; excludes future and invalid bounds", () => {
    const days = rows(
      "2026-11-02",
      "bad",
      "2026-02-30",
      "2026-10-31",
      "2026-10-28",
      "2026-09-01",
    );
    const range = dailyHealthRange(days, null, today)!;
    expect(range.end).toBe("2026-10-31");
    expect(range.slots.map((slot) => slot.date)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(range.slots.filter((slot) => slot.record)).toHaveLength(2);
    expect(range.slots[3].record).toBe(days[4]);
    expect(range.canPrevious).toBe(true);
    expect(range.canNext).toBe(false);
    expect(days).toHaveLength(6);
  });

  it("keeps all-absent pages inside loaded bounds and distinguishes outside history", () => {
    const days = rows("2026-10-31", "2026-10-01");
    const range = dailyHealthRange(days, "2026-10-24", today)!;
    expect(
      range.slots.every((slot) => !slot.record && !slot.outsideLoaded),
    ).toBe(true);
    expect(range.canNext).toBe(true);
    const oldest = dailyHealthRange(days, "2026-10-03", today)!;
    expect(oldest.canPrevious).toBe(false);
    expect(oldest.slots.filter((slot) => slot.outsideLoaded)).toHaveLength(4);
    expect(oldest.slots[4].record).toBe(days[1]);
  });

  it("handles one record, stale latest, current day, and future-only/empty input", () => {
    const stale = dailyHealthRange(rows("2025-01-01"), null, today)!;
    expect(stale.end).toBe("2025-01-01");
    expect(stale.canNext || stale.canPrevious).toBe(false);
    expect(stale.slots.filter((slot) => slot.outsideLoaded)).toHaveLength(6);
    const current = dailyHealthRange(rows(today), null, today)!;
    expect(current.slots[6].isCurrentDay).toBe(true);
    expect(dailyHealthRange(rows("2027-01-01"), null, today)).toBeNull();
    expect(dailyHealthRange([], null, today)).toBeNull();
  });

  it("preserves historical overlap and unaligned grid until explicit Latest; reanchors only lost/future ranges", () => {
    const days = rows("2026-10-31", "2026-09-01");
    const bounds = dailyHealthBounds(days, today);
    expect(resolveHealthRange("2026-10-20", bounds, today)).toBe("2026-10-20");
    expect(resolveHealthRange("2026-09-01", bounds, today)).toBe("2026-09-01");
    expect(resolveHealthRange("2026-11-01", bounds, today)).toBe("2026-11-01");
    expect(resolveHealthRange("2026-08-31", bounds, today)).toBe("2026-10-31");
    expect(resolveHealthRange("2026-11-02", bounds, today)).toBe("2026-10-31");
    const range = dailyHealthRange(days, "2026-10-28", today)!;
    expect(range.canNext).toBe(false);
    expect(range.end).not.toBe(range.latest);
    expect(dailyHealthRange(days, range.latest, today)?.end).toBe("2026-10-31");
  });
});
