import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
const runGarminSync = vi.fn(async () => ({
  status: "completed",
  detail: "ok",
}));

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
  rankActivities: vi.fn(() => ({
    tool: "activityRanking",
    privacy: "local summaries",
    metrics: ["distanceMeters"],
    rankings: {
      distanceMeters: [],
      elevationGainMeters: [],
      durationSec: [],
      avgHeartRate: [],
    },
    limitations: [],
    window: null,
  })),
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
