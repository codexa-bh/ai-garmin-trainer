import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
const runGarminSync = vi.fn(async () => ({
  status: "completed",
  detail: "ok",
}));
const generatedAnalysisEvidence = {
  tool: "generatedGarminAnalysis" as const,
  status: "succeeded" as const,
  requestedCount: 10,
  scriptHash: "abcdef1234567890",
  manifest: {
    generatedAt: "2026-07-21T12:00:00.000Z",
    request: "top 10 longest activities",
    selectedDatasets: ["activities"],
    datasets: [{ name: "activities", rowCount: 12, description: "" }],
    tables: [{ name: "activities", rowCount: 12 }],
    rawPayloads: [],
    limits: {
      maxRowsPerTable: 1000,
      maxRawPayloads: 100,
      maxRawPayloadBytes: 200000,
      maxOutputBytes: 12000,
    },
    scriptContract: {
      resultVariable: "RESULT" as const,
      allowedImports: ["math", "statistics"],
      forbiddenAccess: ["filesystem"],
    },
  },
  result: {
    kind: "ranking",
    title: "Longest activities",
    requestedCount: 10,
    returnedCount: 10,
    rows: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      garminId: `generated-${index + 1}`,
      label: `Generated activity ${index + 1}`,
      date: "2026-07-01",
      sport: "running",
      value: 100 - index,
      units: "minutes",
    })),
    limitations: [],
  },
  warnings: [],
  privacy:
    "Generated Python ran locally against explicit read-only Garmin datasets.",
};
const runGeneratedGarminAnalysis = vi.fn(async () => generatedAnalysisEvidence);

vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/garmin/importer", () => ({
  runGarminSync,
  backfillActivityDetail: vi.fn(),
}));
vi.mock("@/lib/ai/generated-analysis", () => ({
  runGeneratedGarminAnalysis,
}));
vi.mock("@/lib/db/repository", () => ({
  activityDetailCoverage: vi.fn(),
  dataCounts: vi.fn(),
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline: vi.fn(),
  listActivityDetailAvailability: vi.fn(),
  verifyActivityReference: vi.fn(),
}));

describe("trainer orchestrator fail-closed policy", async () => {
  const { orchestrateTrainerChat } = await import("../src/lib/ai/orchestrator");

  beforeEach(() => {
    generateText.mockReset();
    runGarminSync.mockClear();
    runGeneratedGarminAnalysis.mockClear();
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

  it("rejects removed fixed-analysis tools and malformed generic inputs", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [{ toolName: "rankActivities", input: {} }],
    });
    const removed = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank my activities",
    });
    expect(removed.toolSteps[0]?.reason).toBe("unknown_tool");

    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "runGeneratedGarminAnalysis",
          input: { request: "rank activities", criterion: "demand_score" },
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

  it("uses generated dataset scripts for ad hoc rankings", async () => {
    const script = `
activities = bundle["datasets"]["activities"]
ranked = sorted(activities, key=lambda item: item.get("durationSec") or 0, reverse=True)[:requestedCount]
RESULT = {"kind": "ranking", "title": "Longest activities", "rows": [{"rank": index + 1, "garminId": row["garminId"], "value": row.get("durationSec"), "units": "s"} for index, row in enumerate(ranked)], "limitations": []}
`;
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "top 10 longest activities",
              datasets: ["activities"],
              requestedCount: 10,
              script,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Using a local generated script, I found ten imported activities led by Generated activity 1.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "top 10 longest activities",
    });

    expect(generateText.mock.calls[0][0].system).toContain(
      "LLM-authored Python script over explicit named datasets",
    );
    expect(generateText.mock.calls[0][0].system).not.toContain(
      "sport_aware_demand_score",
    );
    expect(runGeneratedGarminAnalysis).toHaveBeenCalledWith({
      request: "top 10 longest activities",
      datasets: ["activities"],
      requestedCount: 10,
      script: script.trim(),
    });
    expect(result.grounding?.tool).toBe("runGeneratedGarminAnalysis");
    expect(result.toolSteps[0]?.summary).toContain("dataset script");
    expect(result.text).toContain("generated script");
  });

  it("passes generic activity selection through planner tool calls", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "count hiking activities only",
              datasets: ["activities"],
              requestedCount: 5,
              activitySelection: { includeText: ["hiking"] },
              script:
                "activities = bundle['datasets']['activities']\nRESULT = {'kind': 'summary', 'summary': str(len(activities)), 'rows': [], 'limitations': []}",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The generated script counted the hiking-only local bundle.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "count hiking activities only",
    });

    expect(generateText.mock.calls[0][0].system).toContain(
      "activitySelection.includeText/excludeText",
    );
    expect(runGeneratedGarminAnalysis).toHaveBeenCalledWith({
      request: "count hiking activities only",
      datasets: ["activities"],
      requestedCount: 5,
      activitySelection: { includeText: ["hiking"] },
      script:
        "activities = bundle['datasets']['activities']\nRESULT = {'kind': 'summary', 'summary': str(len(activities)), 'rows': [], 'limitations': []}",
    });
    expect(result.grounding?.tool).toBe("runGeneratedGarminAnalysis");
    expect(result.text).toContain("hiking-only");
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

    expect(runGarminSync).toHaveBeenCalledTimes(1);
    expect(result.toolSteps.at(-1)?.reason).toBe("duplicate_side_effect");
  });
});
