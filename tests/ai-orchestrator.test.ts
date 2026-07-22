import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedAnalysisEvidence } from "../src/lib/ai/generated-analysis";

const generateText = vi.fn();
const runGarminSync = vi.fn(async () => ({
  status: "completed",
  detail: "ok",
}));
const generatedAnalysisEvidence: GeneratedAnalysisEvidence = {
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
    runGarminSync.mockReset();
    runGarminSync.mockResolvedValue({ status: "completed", detail: "ok" });
    runGeneratedGarminAnalysis.mockReset();
    runGeneratedGarminAnalysis.mockResolvedValue(generatedAnalysisEvidence);
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

  it("lets the model choose one corrected generated-analysis call after correction feedback", async () => {
    const failedEvidence = {
      ...generatedAnalysisEvidence,
      status: "failed" as const,
      reason: "runtime_error",
      message: "NameError: name 'durationSec' is not defined",
      correctionAllowed: true,
      correctionHint:
        "Fix the Python exception by using only fields present in the selected bundle datasets and setting RESULT to bounded JSON.",
      result: undefined,
    };
    runGeneratedGarminAnalysis
      .mockResolvedValueOnce(failedEvidence)
      .mockResolvedValueOnce(generatedAnalysisEvidence);
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "top 10 longest activities",
              datasets: ["activities"],
              requestedCount: 10,
              script: "RESULT = durationSec  # missing field reference",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "top 10 longest activities",
              datasets: ["activities"],
              requestedCount: 10,
              script:
                "activities = bundle['datasets']['activities']\nRESULT = {'kind': 'ranking', 'rows': [], 'limitations': []}",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The corrected local generated script completed and produced the ranking.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "top 10 longest activities",
    });

    expect(runGeneratedGarminAnalysis).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[1][0].system).toContain("runtime_error");
    expect(generateText.mock.calls[1][0].system).toContain(
      "NameError: name 'durationSec' is not defined",
    );
    expect(generateText.mock.calls[1][0].system).toContain(
      "Common activities fields include garminId",
    );
    expect(generateText.mock.calls[1][0].system).toContain(
      "you may either select one fresh corrected runGeneratedGarminAnalysis call",
    );
    expect(result.toolSteps).toHaveLength(2);
    expect(result.toolSteps[0]).toMatchObject({
      status: "failed",
      reason: "runtime_error",
      correctionAllowed: true,
    });
    expect(result.text).toContain("corrected local generated script");
  });

  it("lets the model choose limitation prose after repairable generated-analysis failure", async () => {
    runGeneratedGarminAnalysis.mockResolvedValueOnce({
      ...generatedAnalysisEvidence,
      status: "failed" as const,
      reason: "runtime_error",
      message: "division by zero",
      correctionAllowed: true,
      correctionHint:
        "Fix the Python exception by using only fields present in the selected bundle datasets and setting RESULT to bounded JSON.",
      result: undefined,
    });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "rank activities",
              datasets: ["activities"],
              script: "RESULT = 1 / 0  # force runtime error",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "I couldn't complete that generated analysis from the local data, but you can try a narrower metric.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank activities",
    });

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(runGeneratedGarminAnalysis).toHaveBeenCalledTimes(1);
    expect(result.toolSteps).toHaveLength(1);
    expect(result.text).toContain("try a narrower metric");
    expect(result.text).not.toContain("Tool step 1");
  });

  it("stops after one generated-analysis correction attempt and renders a concise limitation", async () => {
    runGeneratedGarminAnalysis
      .mockResolvedValueOnce({
        ...generatedAnalysisEvidence,
        status: "failed" as const,
        reason: "runtime_error",
        message: "division by zero",
        correctionAllowed: true,
        correctionHint:
          "Fix the Python exception by using only fields present in the selected bundle datasets and setting RESULT to bounded JSON.",
        result: undefined,
      })
      .mockResolvedValueOnce({
        ...generatedAnalysisEvidence,
        status: "rejected" as const,
        reason: "invalid_result_shape",
        message:
          "Generated Python RESULT did not match the bounded Garmin analysis result contract.",
        correctionAllowed: true,
        correctionHint:
          "Set RESULT to an object with a nonempty kind, rows no larger than requestedCount, limitations, and only Garmin IDs from the provided activities dataset.",
        scriptHash: "123456abcdef7890",
        result: undefined,
      });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "rank activities",
              datasets: ["activities"],
              script: "RESULT = 1 / 0  # force runtime error",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "rank activities",
              datasets: ["activities"],
              script:
                "RESULT = {'kind': '', 'rows': [], 'limitations': []}  # invalid shape",
            },
          },
        ],
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank activities",
    });

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(runGeneratedGarminAnalysis).toHaveBeenCalledTimes(2);
    expect(result.text).toContain("after one correction attempt");
    expect(result.text).toContain("invalid_result_shape");
    expect(result.text).not.toContain("Tool step 2");
  });

  it("does not offer correction feedback for safety-denied generated analysis", async () => {
    runGeneratedGarminAnalysis.mockResolvedValueOnce({
      ...generatedAnalysisEvidence,
      status: "rejected" as const,
      reason: "denied_import",
      message: "Generated Python attempted to import a denied module.",
      correctionAllowed: false,
      correctionHint:
        "Correction feedback is not offered automatically for this failure; keep analysis within the local read-only dataset contract.",
      result: undefined,
    });
    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "runGeneratedGarminAnalysis",
          input: {
            request: "read files",
            datasets: ["activities"],
            script:
              "import os\nRESULT = {'kind': 'summary', 'summary': str(os.environ), 'limitations': []}",
          },
        },
      ],
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "read files",
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(runGeneratedGarminAnalysis).toHaveBeenCalledTimes(1);
    expect(result.toolSteps[0]).toMatchObject({
      reason: "denied_import",
      correctionAllowed: false,
    });
    expect(result.text).toContain("within the local safety guardrails");
  });
});
