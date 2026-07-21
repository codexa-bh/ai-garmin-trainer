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

describe("trainer deterministic ranking renderer", async () => {
  const { renderToolSteps } = await import("../src/lib/ai/tools");

  it("renders activity rankings as readable sections with humanized values", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "rankActivities",
        status: "succeeded",
        summary:
          "Deterministic ranking metrics: elevationGainMeters, distanceMeters, durationSec, avgHeartRate; 4 rows; window last 365 days.",
        privacy:
          "Computed from local normalized SQLite activity summaries only; raw FIT, GPS streams, connector payloads, and credentials were not sent to the model.",
        result: {
          tool: "activityRanking",
          privacy:
            "Computed from local normalized SQLite activity summaries only; raw FIT, GPS streams, connector payloads, and credentials were not sent to the model.",
          metrics: [
            "elevationGainMeters",
            "distanceMeters",
            "durationSec",
            "avgHeartRate",
          ],
          rankings: {
            elevationGainMeters: [
              {
                garminId: "rank-elev-1",
                label: "Source climb — Špik",
                labelSource: "garmin",
                date: "2026-07-03",
                sport: "hiking",
                value: 8802.34999999404,
                unit: "m",
                distanceMeters: 42000.7,
                durationSec: 21142.6953125,
                elevationGainMeters: 8802.34999999404,
                avgHeartRate: 157.4,
              },
            ],
            distanceMeters: [
              {
                garminId: "rank-distance-1",
                label:
                  "Imported running on 2026-07-02 (Garmin ID rank-distance-1)",
                labelSource: "fallback",
                date: "2026-07-02",
                sport: "running",
                value: 42195.12345,
                unit: "m",
                distanceMeters: 42195.12345,
                durationSec: 14400,
                elevationGainMeters: 40,
                avgHeartRate: 165,
              },
            ],
            durationSec: [
              {
                garminId: "rank-duration-1",
                label: "Long day out",
                labelSource: "garmin",
                date: "2026-06-20",
                sport: "hiking",
                value: 21142.6953125,
                unit: "s",
                distanceMeters: 39000,
                durationSec: 21142.6953125,
                elevationGainMeters: 2300,
                avgHeartRate: 132,
              },
            ],
            avgHeartRate: [
              {
                garminId: "rank-hr-1",
                label: "Tempo run",
                labelSource: "garmin",
                date: "2026-06-10",
                sport: "running",
                value: 157.6,
                unit: "bpm",
                distanceMeters: 12000,
                durationSec: 3300,
                elevationGainMeters: 120,
                avgHeartRate: 157.6,
              },
            ],
          },
          limitations: [
            "No imported activities have power values for a deterministic ranking.",
          ],
          window: {
            label: "last 365 days",
            days: 365,
            startedAfter: "2025-07-21T00:00:00.000Z",
          },
        },
      },
    ]);

    expect(text).toContain("Window: last 365 days");
    expect(text).toContain("Rankings by elevation gain:");
    expect(text).toContain("Rankings by distance:");
    expect(text).toContain("Rankings by duration:");
    expect(text).toContain("Rankings by average heart rate:");
    expect(text).toContain("1. Source climb — Špik");
    expect(text).toContain("Garmin ID rank-elev-1");
    expect(text).toContain("garmin label");
    expect(text).toContain("fallback label");
    expect(text).toContain("8,802 m");
    expect(text).toContain("42.2 km");
    expect(text).toContain("5h 52m 23s");
    expect(text).toContain("158 bpm");
    expect(text).toContain(
      "No imported activities have power values for a deterministic ranking.",
    );
    expect(text).toContain("Privacy: Computed from local normalized SQLite");
    expect(text).not.toContain("8802.34999999404m");
    expect(text).not.toContain("21142.6953125s");
  });

  it("preserves rejected tool reasons and privacy wording", () => {
    const text = renderToolSteps([
      {
        index: 1,
        tool: "rankActivities",
        status: "rejected",
        summary: "Provider tool selection was rejected: malformed_input.",
        privacy:
          "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
        reason: "malformed_input",
      },
    ]);

    expect(text).toContain("Reason: malformed_input.");
    expect(text).toContain(
      "Privacy: No Garmin connector action or local analytics tool was executed",
    );
  });
});
