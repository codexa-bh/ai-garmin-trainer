import { beforeEach, describe, expect, it, vi } from "vitest";

const day = (date: string, overrides: Record<string, unknown> = {}) => ({
  date,
  sleepMinutes: 444,
  sleepScore: 86,
  sleepDeepMinutes: 74,
  sleepLightMinutes: 244,
  sleepRemMinutes: 96,
  sleepAwakeMinutes: 30,
  sleepNapMinutes: 0,
  restingHeartRate: 52,
  hrvStatus: "Balanced",
  hrvMs: 41.2,
  stressAvg: 38,
  steps: 8412,
  calories: 2310,
  activeCalories: 710,
  restingCalories: 1600,
  totalCalories: 2310,
  intensityMinutes: 38,
  bodyBatteryAvg: 74,
  bodyBatteryMorning: 88,
  bodyBatteryEvening: 42,
  availability: "complete",
  ...overrides,
});

const listRecentDailyHealth = vi.fn(() => [
  day("2026-07-21"),
  day("2026-07-20", { sleepMinutes: null, availability: "partial" }),
]);

vi.mock("@/lib/db/repository", () => ({
  listRecentDailyHealth,
}));

describe("health dashboard route", () => {
  beforeEach(() => {
    listRecentDailyHealth.mockClear();
    vi.resetModules();
  });

  it("returns bounded newest-first days and the latest date", async () => {
    const { GET, HEALTH_DASHBOARD_DAY_LIMIT } =
      await import("../src/app/api/health-dashboard/route");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(HEALTH_DASHBOARD_DAY_LIMIT).toBe(366);
    expect(listRecentDailyHealth).toHaveBeenCalledWith(366);
    expect(payload.latestDate).toBe("2026-07-21");
    expect(payload.days).toHaveLength(2);
    expect(payload.days[0].date).toBe("2026-07-21");
    expect(payload.days[1].date).toBe("2026-07-20");
  });

  it("returns a null latestDate when no daily health rows exist", async () => {
    listRecentDailyHealth.mockReturnValueOnce([]);
    const { GET } = await import("../src/app/api/health-dashboard/route");

    const payload = await (await GET()).json();

    expect(payload.days).toEqual([]);
    expect(payload.latestDate).toBeNull();
  });

  it("exposes only normalized daily-health fields — no raw payload, env, or connector data", async () => {
    const { GET } = await import("../src/app/api/health-dashboard/route");

    const payload = await (await GET()).json();

    const allowedDayKeys = [
      "date",
      "sleepMinutes",
      "sleepScore",
      "sleepDeepMinutes",
      "sleepLightMinutes",
      "sleepRemMinutes",
      "sleepAwakeMinutes",
      "sleepNapMinutes",
      "restingHeartRate",
      "hrvStatus",
      "hrvMs",
      "stressAvg",
      "steps",
      "calories",
      "activeCalories",
      "restingCalories",
      "totalCalories",
      "intensityMinutes",
      "bodyBatteryAvg",
      "bodyBatteryMorning",
      "bodyBatteryEvening",
      "availability",
    ];
    for (const row of payload.days) {
      expect(Object.keys(row).sort()).toEqual([...allowedDayKeys].sort());
    }
    expect(Object.keys(payload).sort()).toEqual(["days", "latestDate"].sort());
    expect(JSON.stringify(payload)).not.toMatch(
      /token|secret|password|sqlite|env|connector|\.sqlite|payload/i,
    );
  });
});
