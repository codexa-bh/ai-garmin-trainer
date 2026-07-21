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
const generatedAnalysisEvidence = {
  tool: "generatedGarminAnalysis" as const,
  status: "succeeded" as const,
  criterion: "demand_score",
  requestedCount: 10,
  scriptHash: "abcdef1234567890",
  manifest: {
    generatedAt: "2026-07-21T12:00:00.000Z",
    request: "top 10 demanding activities",
    tables: [{ name: "activities", rowCount: 12 }],
    rawPayloads: [],
    limits: {
      maxRowsPerTable: 1000,
      maxRawPayloads: 100,
      maxRawPayloadBytes: 200000,
      maxOutputBytes: 12000,
    },
  },
  result: {
    kind: "ranking" as const,
    criterion: "demand_score",
    requestedCount: 10,
    returnedCount: 10,
    rows: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      garminId: `generated-${index + 1}`,
      label: `Generated activity ${index + 1}`,
      date: "2026-07-01",
      sport: "running",
      value: 100 - index,
      units: "composite score",
    })),
    limitations: [],
  },
  warnings: [],
  privacy:
    "Generated Python ran locally against an explicit read-only Garmin analysis bundle.",
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
vi.mock("@/lib/analytics/activity", () => ({
  analyzeStoredActivity: vi.fn(),
  rankActivities,
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

  it("returns final provider synthesis text after one successful tool while preserving grounding", async () => {
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
      .mockResolvedValueOnce({
        text: "Your most demanding imported effort was Source climb — Špik, with 8,802 m of elevation gain and a marathon-length distance.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank my most demanding activities in the last 365 days",
    });

    expect(result.text).toBe(
      "Your most demanding imported effort was Source climb — Špik, with 8,802 m of elevation gain and a marathon-length distance.",
    );
    expect(result.text).not.toContain("Tool step 1:");
    expect(result.text).not.toContain("Privacy:");
    expect(result.grounding?.tool).toBe("rankActivities");
    expect(result.grounding?.toolSteps?.[0]).toMatchObject({
      tool: "rankActivities",
      status: "succeeded",
    });
    expect(result.toolSteps[0]?.result).toBe(rankingEvidence);
    expect(generateText.mock.calls[1][0].system).toContain(
      "server-authored prior tool evidence",
    );
    expect(generateText.mock.calls[1][0].system).toContain(
      "Source climb — Špik",
    );
    expect(generateText.mock.calls[1][0].system).not.toContain("Tool step 1:");
  });

  it("asks a clarification instead of generated execution for ambiguous criteria", async () => {
    generateText.mockResolvedValueOnce({
      text: "What should demanding mean here: duration, elevation, average heart rate, or a disclosed composite score?",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank my top activities",
    });

    expect(runGeneratedGarminAnalysis).not.toHaveBeenCalled();
    expect(result.toolSteps).toEqual([]);
    expect(result.text).toContain("What should demanding mean");
  });

  it("uses generated analysis for top-10 ad hoc rankings without the old five-row cap", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request: "top 10 most demanding activities",
              criterion: "demand_score",
              requestedCount: 10,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Using a local composite demand score, I found ten imported activities led by Generated activity 1.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "top 10 most demanding activities",
    });

    expect(runGeneratedGarminAnalysis).toHaveBeenCalledWith({
      request: "top 10 most demanding activities",
      criterion: "demand_score",
      requestedCount: 10,
    });
    expect(result.grounding?.tool).toBe("runGeneratedGarminAnalysis");
    expect(result.toolSteps[0]?.result).toBe(generatedAnalysisEvidence);
    expect(result.toolSteps[0]?.summary).toContain("10/10 ranking rows");
    expect(result.text).toContain("ten imported activities");
  });

  it("passes hiking-only generated analysis filters through the planner tool call", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request:
                "rank my hardest hiking activities only; skip snowboarding",
              criterion: "demand_score",
              requestedCount: 5,
              activityFilter: {
                includeSports: ["hiking"],
                excludeSports: ["snowboarding"],
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Using the hiking-only local bundle, the hardest hike was Generated activity 1.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank my hardest hiking activities only; skip snowboarding",
    });

    expect(generateText.mock.calls[0][0].system).toContain(
      "activityFilter.includeSports or activityFilter.excludeSports",
    );
    expect(runGeneratedGarminAnalysis).toHaveBeenCalledWith({
      request: "rank my hardest hiking activities only; skip snowboarding",
      criterion: "demand_score",
      requestedCount: 5,
      activityFilter: {
        includeSports: ["hiking"],
        excludeSports: ["snowboarding"],
      },
    });
    expect(result.grounding?.tool).toBe("runGeneratedGarminAnalysis");
    expect(result.text).toContain("hiking-only");
  });

  it("accepts sport-aware generated analysis for resort snowboarding prompts", async () => {
    const snowboardingEvidence = {
      ...generatedAnalysisEvidence,
      criterion: "sport_aware_demand_score",
      requestedCount: 5,
      result: {
        ...generatedAnalysisEvidence.result,
        criterion: "sport_aware_demand_score",
        requestedCount: 5,
        returnedCount: 1,
        rows: [
          {
            rank: 1,
            garminId: "snowboard-effort",
            label: "Resort snowboard hard laps",
            date: "2026-02-02",
            sport: "snowboarding",
            value: 15.2,
            units: "sport-aware composite score",
            notes:
              "850 kcal; 18 km; 1,700 m descent; ascent excluded for resort context",
          },
        ],
        limitations: [],
      },
    };
    runGeneratedGarminAnalysis.mockResolvedValueOnce(snowboardingEvidence);
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runGeneratedGarminAnalysis",
            input: {
              request:
                "Which resort snowboarding days were most demanding, ignoring lift-assisted ascent?",
              criterion: "sport_aware_demand_score",
              requestedCount: 5,
              script:
                "# safe wording: import token from label is not code\nRESULT = {'kind': 'ranking', 'criterion': 'sport_aware_demand_score', 'requestedCount': 5, 'returnedCount': 0, 'rows': [], 'limitations': []}",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "For resort snowboarding, the hard-lap day leads on calories, distance, and descent; I would not treat lift ascent as the training-load driver.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "Which resort snowboarding days were most demanding, ignoring lift-assisted ascent?",
    });

    expect(runGeneratedGarminAnalysis).toHaveBeenCalledWith({
      request:
        "Which resort snowboarding days were most demanding, ignoring lift-assisted ascent?",
      criterion: "sport_aware_demand_score",
      requestedCount: 5,
      script:
        "# safe wording: import token from label is not code\nRESULT = {'kind': 'ranking', 'criterion': 'sport_aware_demand_score', 'requestedCount': 5, 'returnedCount': 0, 'rows': [], 'limitations': []}",
    });
    expect(result.toolSteps[0]?.summary).not.toContain("static_denied_token");
    expect(result.text).toContain("lift ascent");
  });

  it("falls back to deterministic ranking text when provider synthesis is empty", async () => {
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

  it("synthesizes a final answer after two successful ordered tools", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "rankActivities",
            input: { metrics: ["distanceMeters"], windowDays: 365 },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "rankActivities",
            input: { metrics: ["elevationGainMeters"], windowDays: 365 },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Across both ordered evidence steps, Source climb — Špik is the standout demanding activity.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank my most demanding activities in the last 365 days",
    });

    expect(result.text).toBe(
      "Across both ordered evidence steps, Source climb — Špik is the standout demanding activity.",
    );
    expect(result.toolSteps.map((step) => step.tool)).toEqual([
      "rankActivities",
      "rankActivities",
    ]);
    expect(result.providerCalls).toBe(3);
    expect(generateText.mock.calls[2][0]).toMatchObject({
      toolChoice: "none",
    });
    expect(generateText.mock.calls[2][0].system).toContain("Evidence step 1");
    expect(generateText.mock.calls[2][0].system).toContain("Evidence step 2");
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
      "Evidence step 1: runGarminSync succeeded",
    );
  });
});
