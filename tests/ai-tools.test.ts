import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ tool: (definition: unknown) => definition }));
vi.mock("@/lib/analytics/activity", () => ({
  analyzeStoredActivity: vi.fn(),
  rankActivities: vi.fn(),
}));
vi.mock("@/lib/db/repository", () => ({
  activityDetailCoverage: vi.fn(),
  dataCounts: vi.fn(),
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline: vi.fn(),
  listActivityDetailAvailability: vi.fn(),
  listRecentActivities: vi.fn(),
  verifyActivityReference: vi.fn(),
}));
vi.mock("@/lib/garmin/importer", () => ({
  backfillActivityDetail: vi.fn(),
  runGarminSync: vi.fn(),
}));

describe("trainer tool registry schemas", async () => {
  const {
    trainerToolDefinitions,
    trainerToolInputSchemas,
    validateTrainerToolCall,
  } = await import("../src/lib/ai/tools");

  it("exposes all eight non-executing provider-visible capabilities", () => {
    expect(Object.keys(trainerToolDefinitions).sort()).toEqual(
      [
        "analyzeActivity",
        "forceRefreshActivityDetail",
        "getActivityDetailAvailability",
        "getActivityDetailSlice",
        "getSyncStatus",
        "rankActivities",
        "runGarminSync",
        "verifyActivityReference",
      ].sort(),
    );
    expect(
      Object.values(trainerToolDefinitions).every(
        (definition) => !("execute" in (definition as object)),
      ),
    ).toBe(true);
  });

  it("accepts bounded typed inputs", () => {
    expect(
      trainerToolInputSchemas.rankActivities.safeParse({
        metrics: ["elevationGainMeters", "distanceMeters"],
        windowDays: 365,
        limit: 5,
      }).success,
    ).toBe(true);
    expect(
      trainerToolInputSchemas.analyzeActivity.safeParse({
        selectors: [{ garminId: "123456" }, { latest: true, sport: "running" }],
      }).success,
    ).toBe(true);
    expect(
      trainerToolInputSchemas.getActivityDetailSlice.safeParse({
        garminId: "123456",
        pointOffset: 0,
        pointLimit: 120,
      }).success,
    ).toBe(true);
  });

  it("rejects unknown, malformed, empty, and unbounded inputs", () => {
    expect(
      validateTrainerToolCall({ toolName: "deleteEverything", input: {} }),
    ).toEqual({
      ok: false,
      reason: "unknown_tool",
    });
    expect(
      validateTrainerToolCall({
        toolName: "verifyActivityReference",
        input: {},
      }),
    ).toEqual({
      ok: false,
      reason: "malformed_input",
    });
    expect(
      validateTrainerToolCall({
        toolName: "rankActivities",
        input: { metrics: ["sql"], limit: 500 },
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
    expect(
      validateTrainerToolCall({
        toolName: "getActivityDetailSlice",
        input: { garminId: "123456", pointOffset: -1, pointLimit: 1000 },
      }),
    ).toEqual({ ok: false, reason: "malformed_input" });
  });
});
