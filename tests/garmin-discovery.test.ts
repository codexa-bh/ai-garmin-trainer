import { describe, expect, it, vi } from "vitest";
import {
  discoveryState,
  weeklyStepsHint,
} from "../src/lib/garmin/discovery-policy";
import { createGarminReader } from "../src/lib/garmin/reader-adapter";

const envelope = (weekly_data: unknown[] = []) => ({
  end_date: "2026-09-07",
  weeks_requested: 52,
  weeks_returned: weekly_data.length,
  weekly_data,
});

describe("reviewed weekly steps hints, never health coverage", () => {
  it("uses positive weeks including genuine zero totals only as date candidates", () => {
    const hint = weeklyStepsHint(
      envelope([
        { week_start: "2026-02-23", days_with_data: 2, total_steps: 0 },
      ]),
      "2026-09-07",
      52,
    );
    expect(hint.weeksWithData).toBe(1);
    expect(hint.positiveDates).toHaveLength(7);
    expect(hint.positiveDates).toContain("2026-02-28");
    expect(hint.positiveDates).toContain("2026-03-01");
    expect(weeklyStepsHint(envelope(), "2026-09-07", 52).positiveDates).toEqual(
      [],
    );
    // February/leap/calendar month lengths are not disguised daily calls.
    expect(
      weeklyStepsHint(
        {
          end_date: "2024-03-03",
          weeks_requested: 1,
          weeks_returned: 1,
          weekly_data: [{ week_start: "2024-02-26", days_with_data: 7 }],
        },
        "2024-03-03",
        1,
      ).positiveDates,
    ).toContain("2024-02-29");
  });
  it.each([
    { end_date: "2026-09-08" },
    { weeks_requested: 53 },
    { weeks_returned: 1 },
    {
      weekly_data: [{ week_start: "2026-02-30", days_with_data: 1 }],
      weeks_returned: 1,
    },
    {
      weekly_data: [{ week_start: "2027-01-01", days_with_data: 1 }],
      weeks_returned: 1,
    },
    {
      weekly_data: [{ week_start: "2026-09-07", days_with_data: 8 }],
      weeks_returned: 1,
    },
    {
      weekly_data: [{ week_start: "2026-09-07", total_steps: "2" }],
      weeks_returned: 1,
    },
    {
      weekly_data: [{ week_start: "2026-09-07", private: "opaque" }],
      weeks_returned: 1,
    },
    {
      weekly_data: [{ week_start: "2026-09-07" }, { week_start: "2026-09-07" }],
      weeks_returned: 2,
    },
    { error: "private" },
  ])(
    "refuses malformed, wrong-range, duplicate or unreviewed shape %#",
    (change) => {
      expect(() =>
        weeklyStepsHint({ ...envelope(), ...change }, "2026-09-07", 52),
      ).toThrow("protocol");
    },
  );
  it("performs one named range dispatch, admits it, and never archives hints", async () => {
    const connector = {
      start: vi.fn(async () => {}),
      close: vi.fn(),
      callTool: vi.fn(async () => JSON.stringify(envelope())),
    };
    const admit = vi.fn();
    const archive = vi.fn();
    const noop = async () => undefined;
    const reader = createGarminReader({
      connector,
      archive,
      fit: { baseline: noop, altitude: noop, distance: noop, speed: noop },
      control: { admit, cancelled: () => false, remainingMs: () => 1000 },
    });
    expect(await reader.weeklySteps!("2026-09-07", 52)).toMatchObject({
      weeksWithData: 0,
      positiveDates: [],
    });
    expect(connector.callTool).toHaveBeenCalledExactlyOnceWith(
      "get_weekly_steps",
      { end_date: "2026-09-07", weeks: 52 },
    );
    expect(admit).toHaveBeenCalledOnce();
    expect(archive).not.toHaveBeenCalled();
    connector.callTool.mockResolvedValue(
      "No weekly steps data found for 52 weeks ending 2026-09-07",
    );
    expect((await reader.weeklySteps!("2026-09-07", 52)).positiveDates).toEqual(
      [],
    );
    connector.callTool.mockResolvedValue(
      "No weekly steps data found for 52 weeks ending 2020-01-01",
    );
    await expect(reader.weeklySteps!("2026-09-07", 52)).rejects.toThrow();
    reader.close();
  });
});

describe("additive discovery compatibility", () => {
  it("leaves v1 untouched and refuses unknown/corrupt discovery instead of resetting", () => {
    const state = discoveryState(null, null, "2026-09-07");
    expect(discoveryState(JSON.stringify(state), null, null)).toEqual(state);
    expect(() =>
      discoveryState(JSON.stringify({ ...state, version: 2 }), null, null),
    ).toThrow("preserve");
    expect(() =>
      discoveryState(
        JSON.stringify({ ...state, positiveDates: ["bad"] }),
        null,
        null,
      ),
    ).toThrow("preserve");
    expect(() =>
      discoveryState(
        JSON.stringify({ ...state, operation: { outcome: "running" } }),
        null,
        null,
      ),
    ).toThrow("preserve");
    expect(
      discoveryState(JSON.stringify(state), "2025-01-01", "2026-09-07"),
    ).toMatchObject({ limit: "2025-01-01", hint: null });
  });
});
