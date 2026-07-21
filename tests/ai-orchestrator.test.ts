import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
const runGarminSync = vi.fn(async () => ({
  status: "completed",
  detail: "ok",
}));
const rankingEvidence = {
  tool: "activityRanking" as const,
  privacy:
    "Computed from local normalized SQLite activity summaries only; raw FIT, GPS streams, connector payloads, and credentials were not sent to the model.",
  metrics: [
    "elevationGainMeters",
    "distanceMeters",
    "durationSec",
    "avgHeartRate",
  ] as const,
  rankings: {
    elevationGainMeters: [
      {
        garminId: "rank-elev-1",
        label: "Source climb — Špik",
        labelSource: "garmin" as const,
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
        label: "Imported running on 2026-07-02 (Garmin ID rank-distance-1)",
        labelSource: "fallback" as const,
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
        labelSource: "garmin" as const,
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
        labelSource: "garmin" as const,
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
  limitations: [],
  window: {
    label: "last 365 days",
    days: 365,
    startedAfter: "2025-07-21T00:00:00.000Z",
  },
};
const rankActivities = vi.fn(() => rankingEvidence);

vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/garmin/importer", () => ({
  runGarminSync,
  backfillActivityDetail: vi.fn(),
}));
vi.mock("@/lib/analytics/activity", () => ({
  analyzeStoredActivity: vi.fn(),
  rankActivities,
}));
vi.mock("@/lib/db/repository", () => ({
  activityDetailCoverage: vi.fn(),
  dataCounts: vi.fn(),
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline: vi.fn(),
  listActivityDetailAvailability: vi.fn(),
  listRecentActivities: vi.fn(() => []),
  verifyActivityReference: vi.fn(),
}));

describe("trainer orchestrator fail-closed policy", async () => {
  const { orchestrateTrainerChat } = await import("../src/lib/ai/orchestrator");

  beforeEach(() => {
    generateText.mockReset();
    runGarminSync.mockClear();
    rankActivities.mockReset();
    rankActivities.mockImplementation(() => rankingEvidence);
  });

  it("rejects multiple provider tool calls without executing any", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [
        { toolName: "runGarminSync", input: {} },
        { toolName: "getSyncStatus", input: {} },
      ],
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "sync and status",
    });

    expect(runGarminSync).not.toHaveBeenCalled();
    expect(result.toolSteps[0]).toMatchObject({
      status: "rejected",
      reason: "invalid_tool_cardinality",
    });
    expect(result.text).toContain("invalid_tool_cardinality");
  });

  it("rejects unknown and malformed tool inputs", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [{ toolName: "deleteEverything", input: {} }],
    });
    const unknown = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "bad",
    });
    expect(unknown.toolSteps[0]?.reason).toBe("unknown_tool");

    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "rankActivities",
          input: { metrics: ["distanceMeters"], limit: 1000 },
        },
      ],
    });
    const malformed = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "bad args",
    });
    expect(malformed.toolSteps[0]?.reason).toBe("malformed_input");
  });

  it("formats ranking fallback text while preserving grounding and tool steps", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "rankActivities",
            input: {
              metrics: [
                "elevationGainMeters",
                "distanceMeters",
                "durationSec",
                "avgHeartRate",
              ],
              windowDays: 365,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ text: "" });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank my most demanding activities in the last 365 days",
    });

    expect(result.text).toContain("Rankings by elevation gain:");
    expect(result.text).toContain("1. Source climb — Špik");
    expect(result.text).toContain("Garmin ID rank-elev-1");
    expect(result.text).toContain("8,802 m");
    expect(result.text).toContain("42.2 km");
    expect(result.text).toContain("5h 52m 23s");
    expect(result.text).toContain("158 bpm");
    expect(result.text).toContain("Window: last 365 days");
    expect(result.text).toContain("Computed from local normalized SQLite");
    expect(result.text).not.toContain("8802.34999999404m");
    expect(result.grounding?.tool).toBe("rankActivities");
    expect(result.grounding?.toolSteps?.[0]).toMatchObject({
      tool: "rankActivities",
      status: "succeeded",
    });
    expect(result.toolSteps[0]?.result).toBe(rankingEvidence);
  });

  it("prevents duplicate side-effect tools across the two-call budget", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "runGarminSync", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "runGarminSync", input: {} }],
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "sync twice",
    });

    expect(runGarminSync).toHaveBeenCalledOnce();
    expect(result.toolSteps.map((step) => step.reason)).toContain(
      "duplicate_side_effect",
    );
    expect(generateText.mock.calls[1][0].system).toContain(
      "Step 1: runGarminSync succeeded",
    );
  });
});
