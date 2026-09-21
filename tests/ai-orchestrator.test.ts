import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainerProgressCounters } from "../src/lib/ai/trainer-progress";

const generateText = vi.fn();
const runGarminSync = vi.fn(async () => ({
  status: "completed",
  detail: "ok",
}));
const describeGarminDatabase = vi.fn(() => ({
  tool: "describeGarminDatabase",
  status: "succeeded",
  tables: [{ name: "activity", rowCount: 12, columns: [] }],
  forbiddenDataClasses: ["auth/session/account/verification rows"],
  examples: [],
  limits: {},
  privacy: "schema privacy",
}));
const runReadOnlySql = vi.fn((): Record<string, unknown> => ({
  status: "succeeded",
  resultName: "activity_rows",
  columns: [{ name: "garmin_id" }, { name: "duration_sec" }],
  rows: [
    {
      garmin_id: "activity-1",
      name: "Hill run",
      duration_sec: 3600,
      elevation_gain_meters: 450,
    },
    {
      garmin_id: "activity-2",
      name: "Long ride",
      duration_sec: 7200,
      elevation_gain_meters: 600,
    },
  ],
  rowCount: 2,
  returnedRows: 2,
  truncated: false,
  privacy: "sql privacy",
}));
const runMathAnalysis = vi.fn(({ rowsByResult, inputResult, operation }) => ({
  status: "succeeded",
  resultName: "demand_scores",
  inputResult,
  operation: operation ?? "score",
  rows: (rowsByResult.get(inputResult) ?? []).map(
    (row: Record<string, unknown>, index: number) => ({
      ...row,
      rank: index + 1,
      score: index === 0 ? 10 : 9,
    }),
  ),
  rowCount: 2,
  returnedRows: 2,
  truncated: false,
  privacy: "math privacy",
}));
const dataCounts = vi.fn(() => ({
  activities: 12,
  healthDays: 3,
  healthCoverage: undefined,
}));
const activityDetailCoverage = vi.fn(() => ({
  total: 2,
  pending: 0,
  available: 2,
  partial: 0,
  unsupported: 0,
  retryableFailures: 0,
  preservedFailures: 0,
  inProgress: 0,
  terminal: 2,
}));
const getGarminAthleteBaseline = vi.fn(() => ({
  availability: "not_available",
}));
const getGarminBodyMetrics = vi.fn(() => null);
const listActivityDetailAvailability = vi.fn(() => []);
let savedTrainingPlan: ReturnType<typeof replaceTrainingPlan> | null = null;
const replaceTrainingPlan = vi.fn(
  (input: { title?: string; contentMarkdown: string }) => ({
    title: input.title ?? "Training Plan",
    contentMarkdown: input.contentMarkdown,
    revisedAt: "2026-09-01T19:00:00.000Z",
  }),
);
vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/garmin/composition", () => ({
  runGarminSync,
  backfillActivityDetail: vi.fn(),
}));
vi.mock("@/lib/ai/sql-analysis", () => ({
  describeGarminDatabase,
  runReadOnlySql,
}));
vi.mock("@/lib/ai/math-analysis", () => ({
  runMathAnalysis,
}));
vi.mock("@/lib/db/repository", () => ({
  activityDetailCoverage,
  dataCounts,
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  listActivityDetailAvailability,
  TRAINING_PLAN_CONTENT_MAX_LENGTH: 32000,
  TRAINING_PLAN_TITLE_MAX_LENGTH: 120,
  verifyActivityReference: vi.fn(),
}));
vi.mock("@/lib/db/training-plan-repository", () => ({
  getTrainingPlan: () => savedTrainingPlan,
  persistTrainingPlan: (input: { title: string; contentMarkdown: string }) => {
    savedTrainingPlan = replaceTrainingPlan({
      title: input.title,
      contentMarkdown: input.contentMarkdown,
    });
  },
}));

describe("trainer orchestrator fail-closed policy", async () => {
  const { orchestrateTrainerChat } = await import("../src/lib/ai/composition");
  const { trainerOrchestrationLimits } =
    await import("../src/lib/ai/orchestrator");

  beforeEach(() => {
    generateText.mockReset();
    runGarminSync.mockReset();
    runGarminSync.mockResolvedValue({ status: "completed", detail: "ok" });
    describeGarminDatabase.mockClear();
    runReadOnlySql.mockClear();
    runMathAnalysis.mockClear();
    dataCounts.mockClear();
    activityDetailCoverage.mockClear();
    getGarminAthleteBaseline.mockClear();
    getGarminBodyMetrics.mockClear();
    listActivityDetailAvailability.mockClear();
    replaceTrainingPlan.mockClear();
    savedTrainingPlan = null;
  });

  it("emits truthful progress at awaited boundaries and counts repeated tools", async () => {
    const statuses: string[] = [];
    const counters: (TrainerProgressCounters | undefined)[] = [];
    generateText
      .mockImplementationOnce(async () => {
        expect(statuses.at(-1)).toBe(
          "Considering your request with the available local context…",
        );
        expect(counters.at(-1)).toEqual({
          modelCalls: 1,
          toolsSucceeded: 0,
          toolsUnsuccessful: 0,
        });
        return { toolCalls: [{ toolName: "runGarminSync", input: {} }] };
      })
      .mockImplementationOnce(async () => {
        expect(statuses.at(-1)).toBe(
          "Reviewing the completed sync outcome for your response…",
        );
        return {
          toolCalls: [
            { toolName: "getSyncStatus", input: {} },
            { toolName: "getSyncStatus", input: {} },
          ],
        };
      })
      .mockImplementationOnce(async () => {
        expect(statuses.at(-1)).toBe(
          "Reviewing the local import and sync coverage for your response…",
        );
        return { text: "Local status checked." };
      });
    runGarminSync.mockImplementationOnce(async () => {
      expect(statuses.at(-1)).toBe("Running the requested Garmin sync action…");
      return { status: "completed", detail: "ok" };
    });
    await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "sync and status",
      onStatus: (message, snapshot) => {
        statuses.push(message);
        counters.push(snapshot);
      },
    });
    expect(statuses).toEqual([
      "Considering your request with the available local context…",
      "Running the requested Garmin sync action…",
      "Reviewing the completed sync outcome for your response…",
      "Checking imported data and local sync coverage…",
      "Checking imported data and local sync coverage…",
      "Reviewing the local import and sync coverage for your response…",
      "Formatting the completed answer…",
    ]);
    expect(
      counters.map((c) => [
        c?.modelCalls,
        c?.toolsSucceeded,
        c?.toolsUnsuccessful,
      ]),
    ).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [2, 1, 0],
      [2, 1, 0],
      [2, 2, 0],
      [3, 3, 0],
      [3, 3, 0],
    ]);
    expect(generateText).toHaveBeenCalledTimes(3);
  });

  it("keeps progress best-effort and does not announce rejected selections as running", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [{ toolName: "unknownTool", input: { secret: "not-public" } }],
    });
    const statuses: string[] = [];
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "status",
      onStatus: (message) => {
        statuses.push(message);
        throw new Error("observer failed");
      },
    });
    expect(statuses).toEqual([
      "Considering your request with the available local context…",
    ]);
    expect(result.toolSteps[0].status).toBe("rejected");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("executes multiple provider-selected tools sequentially when one has side effects", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          { toolName: "runGarminSync", input: {} },
          { toolName: "getSyncStatus", input: {} },
        ],
      })
      .mockResolvedValueOnce({
        text: "I synced Garmin and then checked the refreshed local status.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "sync and status",
    });

    expect(runGarminSync).toHaveBeenCalledOnce();
    expect(dataCounts).toHaveBeenCalledOnce();
    expect(result.toolSteps.map((step) => step.tool)).toEqual([
      "runGarminSync",
      "getSyncStatus",
    ]);
    expect(result.toolSteps.every((step) => step.status === "succeeded")).toBe(
      true,
    );
    expect(result.toolSteps[0]?.selection).toMatchObject({
      reason: "multiple_tool_calls",
      count: 2,
      selectedTool: "runGarminSync",
      toolNames: ["runGarminSync", "getSyncStatus"],
    });
    expect(result.text).toContain("synced Garmin");
    expect(result.text).not.toContain("selected more than one tool");
    expect(result.text).not.toContain("multiple_tool_calls_with_side_effect");
    expect(result.text).not.toContain("Tool step");
    expect(generateText.mock.calls[0][0]).toMatchObject({
      parallelToolCalls: false,
      providerOptions: {
        openai: { parallelToolCalls: false },
        deepseek: { parallelToolCalls: false },
      },
    });
  });

  it("captures bounded debug traces only when requested", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: `select garmin_id, name from activity where name like '${"x".repeat(3000)}'`,
              resultName: "activity_rows",
              maxRows: 20,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ text: "The debug-enabled final answer." });

    const disabled = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "most demanding activities",
    });
    expect(disabled.debugTrace).toBeUndefined();

    generateText.mockReset();
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: `select garmin_id, name from activity where name like '${"x".repeat(3000)}'`,
              resultName: "activity_rows",
              maxRows: 20,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ text: "The debug-enabled final answer." });

    const enabled = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "most demanding activities",
      debug: { enabled: true, provider: "deepseek", model: "deepseek-chat" },
    });

    expect(enabled.debugTrace).toMatchObject({
      schemaVersion: 1,
      provider: "deepseek",
      model: "deepseek-chat",
      finalAnswer: "The debug-enabled final answer.",
    });
    expect(enabled.debugTrace?.providerCalls[0]).toMatchObject({
      purpose: "planner",
      toolCalls: [{ toolName: "runReadOnlySql", truncated: true }],
    });
    expect(enabled.debugTrace?.toolSteps[0]).toMatchObject({
      tool: "runReadOnlySql",
      status: "succeeded",
      result: expect.objectContaining({ resultName: "activity_rows" }),
    });
    expect(JSON.stringify(enabled.debugTrace)).not.toContain("Tool step");
  });

  it("does not accept no-tool planning preambles as final local-data answers", async () => {
    generateText.mockResolvedValueOnce({
      text: "I'll pull up your yesterday hike details first. Next, I'll compare it with nearby variations and then analyze how demanding it was.",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "ok check my yesterdays hike. I did one of the variations near to my home.",
    });

    expect(result.text).not.toContain("I'll pull up");
    expect(result.text).not.toContain("Next");
    expect(result.text).toContain("couldn't complete that local Garmin");
    expect(result.text).not.toContain("model returned a plan");
    expect(result.text).not.toContain("safe local-data tool");
    expect(result.toolSteps).toEqual([]);
    expect(result.grounding).toBeNull();
    expect(describeGarminDatabase).not.toHaveBeenCalled();
    expect(runReadOnlySql).not.toHaveBeenCalled();
    expect(runMathAnalysis).not.toHaveBeenCalled();
  });

  it("does not accept no-tool planning preambles for sleep and recovery local-data requests", async () => {
    generateText.mockResolvedValueOnce({
      text: "I'll check your sleep, HRV, and body battery for today and yesterday first, then I'll summarize what that means for recovery.",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "Can you check my sleep stats and recovery for today and yesterday?",
    });

    expect(result.text).toContain("local Garmin or recovery check");
    expect(result.text).not.toContain("I'll check");
    expect(result.text).not.toContain("planner");
    expect(result.text).not.toContain("safe local-data tool");
    expect(result.toolSteps).toEqual([]);
    expect(result.grounding).toBeNull();
  });

  it("rejects no-tool direct answers for personal Garmin metric totals", async () => {
    generateText.mockResolvedValueOnce({
      text: "Your July total was 3 activities and August had 7, with about 120 km and 8,000 m ascent across both months.",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "I need totals for July and August: km done in activities, ascent in activities, calories burned in activities, steps, and times in each HRZ",
      debug: { enabled: true, provider: "ollama", model: "qwen3.5:4b" },
    });

    expect(result.text).toContain("current-turn local Garmin verification");
    expect(result.text).toContain("can't verify any totals");
    expect(result.text).not.toContain("3 activities");
    expect(result.text).not.toContain("7");
    expect(result.toolSteps).toEqual([]);
    expect(result.grounding).toBeNull();
    expect(result.debugTrace?.finalAnswerSource).toBe("deterministic_fallback");
  });

  it("rejects no-tool correction rationalization for disputed Garmin aggregation", async () => {
    generateText.mockResolvedValueOnce({
      text: "That lower July count can still make sense because a few hard recovery-heavy activities can feel like more than the raw total.",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system:
        "Active transcript: user asked for July and August activity totals, calories, steps, and HRZ; assistant previously claimed July had 3 activities and August had 7.",
      userRequest:
        "You made a grave mistake when you did not aggregate all my activities properly; please verify the counts again.",
    });

    expect(result.text).toContain("current-turn local Garmin verification");
    expect(result.text).not.toContain("can still make sense");
    expect(result.toolSteps).toEqual([]);
    expect(result.grounding).toBeNull();
  });

  it("fails closed instead of accepting final prose after unresolved SQL metric failures", async () => {
    runReadOnlySql
      .mockReturnValueOnce({
        status: "succeeded",
        resultName: "partial_monthly_totals",
        columns: [{ name: "month" }, { name: "activity_km" }],
        rows: [{ month: "2026-07", activity_km: 42 }],
        rowCount: 1,
        returnedRows: 1,
        truncated: false,
        privacy: "sql privacy",
      })
      .mockReturnValueOnce({
        status: "failed",
        resultName: "monthly_activity_counts",
        columns: [],
        rows: [],
        rowCount: 0,
        returnedRows: 0,
        truncated: false,
        reason: "unknown_column",
        message:
          "SQLite rejected the query because it referenced an unknown column.",
        correctionAllowed: false,
        privacy: "sql privacy",
      });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select month, activity_km from activity",
              resultName: "partial_monthly_totals",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select activity_id, count(*) from activity group by month",
              resultName: "monthly_activity_counts",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Verified totals: July had 3 activities and August had 7 activities.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "Please compare my July and August activity count, km, ascent, calories, steps, and HRZ totals.",
      debug: { enabled: true, provider: "deepseek", model: "deepseek-chat" },
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(2);
    expect(result.text).toContain("couldn't complete");
    expect(result.text).not.toContain("Verified totals");
    expect(result.text).not.toContain("3 activities");
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "failed",
    ]);
    expect(result.debugTrace?.finalAnswerSource).toBe("deterministic_fallback");
  });

  it("repairs no-clock direct answers when server current-date context is present", async () => {
    generateText.mockResolvedValueOnce({
      text: "I don't have an independent real-time clock, so I can only ground today against the freshest Garmin data timestamps.",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system:
        'system\nServer current date basis: 2026-08-14 (server-local date; ISO date-time 2026-08-14T09:30:00.000Z; UTC offset +00:00). Use this server-owned date for relative terms like "today" and derive "yesterday" from it; Garmin import freshness and newest activity/health rows are separate evidence.',
      userRequest: "Are you aware of today's date?",
    });

    expect(result.text).toContain(
      "server-provided current date basis: 2026-08-14",
    );
    expect(result.text).toContain(
      "Garmin activity or daily-health row dates are separate",
    );
    expect(result.text).not.toContain("independent real-time clock");
    expect(result.text).not.toContain("freshest Garmin data timestamps");
    expect(result.toolSteps).toEqual([]);
    expect(result.grounding).toBeNull();
  });

  it("accepts complete direct no-tool coaching when local Garmin evidence is not required", async () => {
    generateText.mockResolvedValueOnce({
      text: "Keep tomorrow easy: 30 to 45 minutes conversational, then add mobility if soreness stays low.",
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "How should I train tomorrow if my legs feel a little flat?",
    });

    expect(result.text).toBe(
      "Keep tomorrow easy: 30 to 45 minutes conversational, then add mobility if soreness stays low.",
    );
    expect(result.toolSteps).toEqual([]);
    expect(result.grounding).toBeNull();
  });

  it("executes valid analytical multi-tool responses in a safe sequence", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "describeGarminDatabase", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runMathAnalysis",
            input: {
              inputResult: "activity_rows",
              operation: "score",
              formula: "duration_sec",
            },
          },
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, duration_sec from activity order by duration_sec desc",
              resultName: "activity_rows",
              maxRows: 20,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The SQL and math answer is grounded and concise.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "invent more generic criteria for demanding activities",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(runMathAnalysis).toHaveBeenCalledTimes(1);
    expect(result.toolSteps.map((step) => step.tool)).toEqual([
      "describeGarminDatabase",
      "runReadOnlySql",
      "runMathAnalysis",
    ]);
    expect(result.toolSteps[1]?.selection).toMatchObject({
      reason: "multiple_tool_calls",
      count: 2,
      selectedTool: "runReadOnlySql",
      toolNames: ["runMathAnalysis", "runReadOnlySql"],
    });
    expect(result.toolSteps[2]?.selection).toMatchObject({
      selectedTool: "runMathAnalysis",
    });
    expect(result.text).not.toContain("Tool step");
    expect(result.grounding?.toolSteps?.[1]?.selection?.selectedTool).toBe(
      "runReadOnlySql",
    );
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
    expect(removed.toolSteps[0]).toMatchObject({
      tool: "providerToolSelection",
      reason: "unknown_tool",
    });

    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "runMathAnalysis",
          input: {
            inputResult: "missing",
            operation: "score",
            formula: "process.env",
          },
        },
      ],
    });
    const malformed = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "bad args",
    });
    expect(malformed.toolSteps[0]).toMatchObject({
      tool: "runMathAnalysis",
      reason: "malformed_input",
    });
  });

  it("uses schema, read-only SQL, and bounded math for ad hoc rankings", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "describeGarminDatabase", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, duration_sec, elevation_gain_meters from activity order by started_at desc",
              maxRows: 50,
              resultName: "activity_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runMathAnalysis",
            input: {
              inputResult: "activity_rows",
              operation: "score",
              formula: "duration_sec + elevation_gain_meters * 2",
              orderBy: [{ field: "score", direction: "desc" }],
              limit: 10,
              outputName: "criteria_scores",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The most demanding local activities are led by Long ride, using model-selected duration plus elevation criteria over SQL rows and a bounded score.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "top 10 most demanding activities in the last 365 days",
    });

    expect(generateText.mock.calls[0][0].system).toContain(
      "guarded SQL/math by default",
    );
    expect(generateText.mock.calls[0][0].system).toContain(
      "model-selected scores",
    );
    expect(generateText.mock.calls[0][0].system).not.toContain(
      "sportNormalizedDemand",
    );
    expect(generateText.mock.calls[0][0].system).not.toContain(
      "LLM-authored Python script over explicit named datasets",
    );
    expect(describeGarminDatabase).toHaveBeenCalledTimes(1);
    expect(runReadOnlySql).toHaveBeenCalledWith({
      sql: "select garmin_id, name, duration_sec, elevation_gain_meters from activity order by started_at desc",
      maxRows: 50,
      resultName: "activity_rows",
    });
    expect(runMathAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "score",
        formula: "duration_sec + elevation_gain_meters * 2",
      }),
    );
    expect(result.grounding?.tool).toBe("runMathAnalysis");
    expect(result.toolSteps).toHaveLength(3);
    expect(result.text).toContain("bounded score");
    expect(result.text).toContain("Long ride");
  });

  it("allows a correctable SQL schema error to lead to one corrected SQL call and final synthesis", async () => {
    const statuses: string[] = [];
    runReadOnlySql
      .mockReturnValueOnce({
        status: "failed",
        resultName: "bad_rows",
        columns: [],
        rows: [],
        rowCount: 0,
        returnedRows: 0,
        truncated: false,
        reason: "unknown_column",
        message:
          "SQLite rejected the query because it referenced an unknown column. Referenced identifier: activity_id. Allowed activity columns: garmin_id, name, sport, started_at.",
        correctionAllowed: true,
        correctionHint:
          "Use exact activity columns such as garmin_id and started_at.",
        privacy: "sql privacy",
      })
      .mockReturnValueOnce({
        status: "succeeded",
        resultName: "demand_rows",
        columns: [{ name: "garmin_id" }, { name: "criteria_score" }],
        rows: [
          {
            garmin_id: "activity-2",
            name: "Long ride",
            criteria_score: 123,
          },
        ],
        rowCount: 1,
        returnedRows: 1,
        truncated: false,
        privacy: "sql privacy",
      });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "describeGarminDatabase", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select activity_id from activity order by start_time desc",
              resultName: "bad_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, name, duration_sec as criteria_score from activity order by started_at desc",
              resultName: "demand_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Using the corrected SQL columns, your most demanding activity is Long ride.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      onStatus: (message) => statuses.push(message),
      userRequest: "top 10 most demanding activities in the last 365 days",
    });

    expect(statuses).toContain(
      "Reviewing the local query failure and available evidence…",
    );
    expect(statuses).toContain(
      "Reviewing 1 returned query row for your response…",
    );
    expect(statuses.join(" ")).not.toMatch(
      /activity_id|bad_rows|select |unknown_column/,
    );
    expect(runReadOnlySql).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[2][0].system).toContain("unknown_column");
    expect(generateText.mock.calls[2][0].system).toContain(
      "Allowed activity columns",
    );
    expect(result.progressCounters).toEqual({
      modelCalls: 4,
      toolsSucceeded: 2,
      toolsUnsuccessful: 1,
    });
    expect(result.text).toContain("corrected SQL columns");
    expect(result.text).toContain("Long ride");
    expect(result.text).not.toContain("Tool step");
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "failed",
      "succeeded",
    ]);
  });

  it("corrects a benign wrong monthly activity-calorie table and synthesizes incomplete-month prose", async () => {
    runReadOnlySql
      .mockReturnValueOnce({
        status: "rejected",
        resultName: "monthly_activity_calories",
        columns: [],
        rows: [],
        rowCount: 0,
        returnedRows: 0,
        truncated: false,
        reason: "disallowed_table",
        message:
          "The query referenced a table outside the analytical allowlist. Referenced table: activities. Allowed analytical tables: activity. Allowed activity columns: garmin_id, started_at, calories.",
        correctionAllowed: true,
        correctionHint:
          "Correct the SQL using activity.started_at and activity.calories for activity calories by month.",
        privacy: "sql privacy",
      })
      .mockReturnValueOnce({
        status: "succeeded",
        resultName: "monthly_activity_calories",
        columns: [
          { name: "month" },
          { name: "activities" },
          { name: "activity_calories_kcal" },
        ],
        rows: [
          { month: "2026-01", activities: 2, activity_calories_kcal: 800 },
          { month: "2026-08", activities: 1, activity_calories_kcal: 300 },
        ],
        rowCount: 2,
        returnedRows: 2,
        truncated: false,
        privacy: "sql privacy",
      });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "describeGarminDatabase", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month, sum(calories) from activities group by month",
              resultName: "monthly_activity_calories",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month, count(*) as activities, sum(calories) as activity_calories_kcal from activity where strftime('%Y', started_at / 1000, 'unixepoch') = '2026' group by month order by month",
              resultName: "monthly_activity_calories",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "From local activity calories, January totaled 800 kcal and August is 300 kcal month-to-date because August is incomplete.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "By the monthly spent calories during activities, can we compare this year month by month, including August which is incomplete?",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[2][0].system).toContain("disallowed_table");
    expect(generateText.mock.calls[2][0].system).toContain(
      "activity.started_at",
    );
    expect(result.text).toContain("activity calories");
    expect(result.text).toContain("August");
    expect(result.text).toContain("month-to-date");
    expect(result.text).not.toContain("Tool step");
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "rejected",
      "succeeded",
    ]);
  });

  it("synthesizes a multi-metric monthly aggregate answer from SQL evidence", async () => {
    runReadOnlySql.mockReturnValueOnce({
      status: "succeeded",
      resultName: "monthly_garmin_totals",
      columns: [
        { name: "month" },
        { name: "steps" },
        { name: "active_calories_kcal" },
        { name: "resting_calories_kcal" },
        { name: "activity_km" },
        { name: "ascent_meters" },
        { name: "zone" },
        { name: "hr_zone_seconds" },
      ],
      rows: [
        {
          month: "2026-07",
          steps: 11000,
          active_calories_kcal: 900,
          resting_calories_kcal: 1600,
          activity_km: 84,
          ascent_meters: 1350,
          zone: 2,
          hr_zone_seconds: 3600,
        },
        {
          month: "2026-08",
          steps: 9000,
          active_calories_kcal: 700,
          resting_calories_kcal: 1600,
          activity_km: 42,
          ascent_meters: 520,
          zone: 5,
          hr_zone_seconds: 400,
        },
      ],
      rowCount: 2,
      returnedRows: 2,
      truncated: false,
      privacy: "sql privacy",
    });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "describeGarminDatabase", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select strftime('%Y-%m', a.started_at / 1000, 'unixepoch') as month, sum(daily_health.active_calories) as active_calories_kcal, sum(activity.elevation_gain_meters) as ascent_meters, z.zone, sum(z.seconds) as hr_zone_seconds from activity a join activity_hr_zone_time z on z.garmin_id = a.garmin_id left join daily_health on daily_health.date = date(a.started_at / 1000, 'unixepoch') group by month, z.zone",
              resultName: "monthly_garmin_totals",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "July has 11,000 steps, 900 active kcal, 1,600 resting kcal, 84 km of activities, 1,350 m ascent, and Zone 2 totals. August is month-to-date with 9,000 steps, 700 active kcal, 42 km, 520 m ascent, and Zone 5 totals from available HR-zone rows.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "Please give me totals for August and July: steps, active/resting calories, activity ascent, activity kilometers, and each HRZ.",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(runReadOnlySql).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("activity_hr_zone_time"),
      }),
    );
    expect(runReadOnlySql).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("active_calories"),
      }),
    );
    expect(result.text).toContain("July");
    expect(result.text).toContain("August");
    expect(result.text).toContain("month-to-date");
    expect(result.text).not.toContain("SQL unavailable");
    expect(result.text).not.toContain("Tool step");
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("returns user-facing prose after repeated SQL failure instead of raw tool steps", async () => {
    runReadOnlySql.mockReturnValue({
      status: "failed",
      resultName: "bad_rows",
      columns: [],
      rows: [],
      rowCount: 0,
      returnedRows: 0,
      truncated: false,
      reason: "unknown_column",
      message:
        "SQLite rejected the query because it referenced an unknown column.",
      correctionAllowed: true,
      correctionHint:
        "Use exact activity columns such as garmin_id and started_at.",
      privacy: "sql privacy",
    });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select activity_id from activity",
              resultName: "bad_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select activity_id from activity",
              resultName: "bad_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ text: "Tool step 1: raw debug" })
      .mockResolvedValueOnce({
        text: "I couldn't complete that ranking from local SQL after a correction, but I can retry with duration, distance, elevation, or calories.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "top 10 most demanding activities",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(2);
    expect(result.text).not.toContain("Tool step");
    expect(result.text).toContain("couldn't complete");
  });

  it("answers simpler analytics with SQL only", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select sport, count(*) as activities from activity group by sport",
              resultName: "sport_counts",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Your local activities are grouped by sport from SQL evidence.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "count activities by sport",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(runMathAnalysis).not.toHaveBeenCalled();
    expect(result.grounding?.tool).toBe("runReadOnlySql");
    expect(result.text).toContain("SQL evidence");
  });

  it("allows repeated provider-selected side-effect tools within the turn cap", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "runGarminSync", input: {} }],
      })
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "runGarminSync", input: {} }],
      })
      .mockResolvedValueOnce({
        text: "Both local Garmin sync selections completed sequentially.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "sync twice",
    });

    expect(runGarminSync).toHaveBeenCalledTimes(2);
    expect(result.grounding?.tool).toBe("runGarminSync");
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(result.text).toContain("completed sequentially");
    expect(result.text).not.toContain("duplicate_side_effect");
    expect(result.text).not.toContain("already used in this turn");
  });

  it("reports the original side-effect failure without leaking connector token paths", async () => {
    runGarminSync.mockResolvedValueOnce({
      status: "failed",
      detail:
        "temporary connector error. Trying to login using token data from directory '/Users/example/.garminconnect'. Tokens will be saved to: /Users/example/.garminconnect",
    });
    generateText.mockResolvedValueOnce({
      toolCalls: [{ toolName: "runGarminSync", input: {} }],
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "sync my most recent data",
    });

    expect(runGarminSync).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("sync_failed");
    expect(result.text).toContain("temporary connector error");
    expect(JSON.stringify(result.toolSteps)).not.toContain("/Users/example");
    expect(JSON.stringify(result.toolSteps)).not.toContain(".garminconnect");
    expect(JSON.stringify(result.toolSteps)).not.toContain(
      "token data from directory '/",
    );
    expect(result.text).not.toContain("duplicate_side_effect");
    expect(result.text).not.toContain("already used in this turn");
  });

  it.each([
    ["toString", {}, "unknown_tool", "providerToolSelection"],
    [
      "getSyncStatus",
      { availabilityLimit: 0 },
      "malformed_input",
      "getSyncStatus",
    ],
  ])(
    "validates %s beyond truncation before executing a valid prefix",
    async (toolName, input, reason, tool) => {
      generateText.mockResolvedValueOnce({
        toolCalls: [
          ...Array.from({ length: 30 }, () => ({
            toolName: "getSyncStatus",
            input: {},
          })),
          { toolName, input },
        ],
      });
      const result = await orchestrateTrainerChat({
        model: "mock",
        system: "system",
        userRequest: "check local status",
      });
      expect(dataCounts).not.toHaveBeenCalled();
      expect(result.toolSteps).toEqual([
        {
          index: 1,
          tool,
          status: "rejected",
          reason,
          summary:
            `Provider selected 31 tools (getSyncStatus, ${toolName}); call 31 was rejected as ${reason}, so no tools from that provider response were executed.`.replace(
              "getSyncStatus, getSyncStatus",
              "getSyncStatus",
            ),
          privacy:
            "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
        },
      ]);
      expect(result.progressCounters).toEqual({
        modelCalls: 1,
        toolsSucceeded: 0,
        toolsUnsuccessful: 0,
      });
    },
  );

  it("rejects generated Python because the default path is SQL/math", async () => {
    generateText.mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "runGeneratedGarminAnalysis",
          input: {
            request: "rank activities",
            datasets: ["activities"],
            script:
              "RESULT = {'kind': 'ranking', 'rows': [], 'limitations': []}",
          },
        },
      ],
    });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "rank activities",
    });

    expect(result.toolSteps[0]).toMatchObject({
      tool: "providerToolSelection",
      status: "rejected",
      reason: "unknown_tool",
    });
    expect(result.text).toContain("safe local Garmin tool");
  });

  it("does not consume the SQL budget for a failed runReadOnlySql and still executes a later SQL call", async () => {
    runReadOnlySql
      .mockReturnValueOnce({
        status: "failed",
        resultName: "bad_rows",
        columns: [],
        rows: [],
        rowCount: 0,
        returnedRows: 0,
        truncated: false,
        reason: "unknown_column",
        message:
          "SQLite rejected the query because it referenced an unknown column.",
        correctionAllowed: true,
        correctionHint: "Use exact activity columns such as garmin_id.",
        privacy: "sql privacy",
      })
      .mockReturnValueOnce({
        status: "succeeded",
        resultName: "monthly_rows",
        columns: [{ name: "month" }, { name: "calories" }],
        rows: [
          { month: "2026-05", calories: 1200 },
          { month: "2026-06", calories: 1500 },
        ],
        rowCount: 2,
        returnedRows: 2,
        truncated: false,
        privacy: "sql privacy",
      });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select activity_id from activity",
              resultName: "bad_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select month, calories from activity",
              resultName: "monthly_rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "Your monthly calories from the corrected query are 1200 and 1500.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "compare my monthly calories",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(2);
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(result.text).toContain("monthly calories");
    expect(result.text).not.toContain("tool_budget_exceeded");
  });

  it("completes a turn with three successful runReadOnlySql executions", async () => {
    runReadOnlySql.mockReturnValue({
      status: "succeeded",
      resultName: "rows",
      columns: [{ name: "garmin_id" }, { name: "calories" }],
      rows: [{ garmin_id: "activity-1", calories: 900 }],
      rowCount: 1,
      returnedRows: 1,
      truncated: false,
      privacy: "sql privacy",
    });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, calories from activity",
              resultName: "rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, calories from activity",
              resultName: "rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select garmin_id, calories from activity",
              resultName: "rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "All three SQL queries returned evidence; here is the combined answer.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "query activity calories three ways",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(3);
    expect(result.toolSteps.every((step) => step.status === "succeeded")).toBe(
      true,
    );
    expect(result.text).toContain("combined answer");
    expect(result.text).not.toContain("tool_budget_exceeded");
  });

  it("executes saveTrainingPlan when it appears in a valid multi-tool response", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "saveTrainingPlan",
            input: {
              title: "September Plan",
              contentMarkdown: "# September Plan\n- Easy aerobic work",
            },
          },
          { toolName: "getSyncStatus", input: {} },
        ],
      })
      .mockResolvedValueOnce({
        text: "Saved the Training Plan and checked local status without raw tool output.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "Save this Training Plan and tell me sync status",
    });

    expect(replaceTrainingPlan).toHaveBeenCalledWith({
      title: "September Plan",
      contentMarkdown: "# September Plan\n- Easy aerobic work",
    });
    expect(dataCounts).toHaveBeenCalledOnce();
    expect(result.toolSteps.map((step) => step.tool)).toEqual([
      "saveTrainingPlan",
      "getSyncStatus",
    ]);
    expect(result.text).toContain("Saved the Training Plan");
    expect(result.text).not.toContain("Tool step");
  });

  it("reserves synthesis within 30 actual executions for oversized multi-tool responses", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: Array.from({ length: 40 }, (_, index) => ({
          toolName: "runReadOnlySql",
          input: {
            sql: `select garmin_id, calories from activity limit ${index + 1}`,
            resultName: `rows_${index + 1}`,
          },
        })),
      })
      .mockResolvedValueOnce({
        text: "The available activity evidence supports a cautious approach; the remaining requested checks are unverified.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "run many local Garmin checks",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(28);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.providerCalls).toBe(generateText.mock.calls.length);
    expect(
      generateText.mock.calls.length + runReadOnlySql.mock.calls.length,
    ).toBe(30);
    expect(generateText.mock.calls[1][0]).toMatchObject({ toolChoice: "none" });
    expect(result.toolSteps).toHaveLength(29); // 28 attempts + non-execution diagnostic
    expect(result.toolSteps.at(-1)).toMatchObject({
      tool: "providerToolSelection",
      status: "rejected",
      reason: "tool_budget_exceeded",
    });
    expect(result.text).toContain("supports a cautious approach");
    expect(result.text).not.toContain("Tool step");
  });

  it("allows necessary exploration beyond the soft target and updates every live snapshot", async () => {
    let planner = 0;
    generateText.mockImplementation(async () =>
      ++planner <= 11
        ? { toolCalls: [{ toolName: "getSyncStatus", input: {} }] }
        : {
            text: "The local status checks are complete; here are the available coverage limitations.",
          },
    );
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "check local status",
    });
    expect(dataCounts).toHaveBeenCalledTimes(11);
    expect(generateText).toHaveBeenCalledTimes(12);
    expect(result.providerCalls).toBe(12);
    expect(result.text).toContain("checks are complete");
    for (const [index, [options]] of generateText.mock.calls.entries()) {
      expect(options.system).toContain(
        "the current planning call is already counted",
      );
      expect(options.system).toContain(`"consumed":${index * 2 + 1},`);
      expect(options.system).toContain(`"remaining":${29 - index * 2},`);
      expect(options.system).toContain(
        `"exploratoryRemaining":${28 - index * 2}`,
      );
      expect(options.system).toContain('"finalAnswerReserve":1');
      expect(options.system).toContain('"softTarget":20');
      expect(options.system).toContain('"hardLimit":30');
    }
  });

  it("stops an endless planner loop at the reserve and produces coaching without metric evidence", async () => {
    generateText.mockImplementation(async (options) =>
      options.toolChoice === "none"
        ? {
            text: "I could not verify your Garmin metrics. Based on your description, keep the family outing comfortable and adjust to fatigue; exact effort remains unverified.",
          }
        : { toolCalls: [{ toolName: "describeGarminDatabase", input: {} }] },
    );
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest:
        "This was a quiet week, yesterday a medium-effort hike; today my family hike has 600 m ascent and Z3/Z4 with rests. Advice?",
    });
    expect(describeGarminDatabase).toHaveBeenCalledTimes(14);
    expect(generateText).toHaveBeenCalledTimes(16);
    expect(result.providerCalls).toBe(16);
    expect(result.text).toContain("Based on your description");
    expect(result.toolSteps.at(-1)?.reason).toBe("tool_budget_exceeded");
    const final = generateText.mock.calls.at(-1)![0];
    expect(final.tools).toBeUndefined();
    expect(final.system).toContain("personal Garmin metrics are unverified");
    expect(final.system).toContain("Evidence gathering has stopped");
    expect(final.prompt).toContain("600 m ascent");
  });

  it("counts failed SQL correction attempts but not successful quotas, reserving synthesis at the boundary", async () => {
    runReadOnlySql.mockReturnValue({
      status: "failed",
      resultName: "bad",
      rows: [],
      columns: [],
      returnedRows: 0,
      rowCount: 0,
      reason: "unknown_column",
      correctionAllowed: true,
      correctionHint: "Use schema columns.",
      privacy: "sql privacy",
    });
    generateText.mockImplementation(async (options) =>
      options.toolChoice === "none"
        ? {
            text: "The queries failed, so your personal activity totals remain unverified. General pacing guidance does not establish those metrics.",
          }
        : {
            toolCalls: [
              {
                toolName: "runReadOnlySql",
                input: {
                  sql: "select unknown_column from activity",
                  resultName: "bad",
                },
              },
            ],
          },
    );
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "compare my weekly activity totals",
    });
    expect(runReadOnlySql).toHaveBeenCalledTimes(14);
    expect(generateText).toHaveBeenCalledTimes(16);
    expect(result.providerCalls + runReadOnlySql.mock.calls.length).toBe(30);
    expect(result.text).toContain("remain unverified");
    expect(generateText.mock.calls[14][0].system).toContain(
      '"analyticalSuccessCounts":{}',
    );
    expect(generateText.mock.calls[14][0].system).toContain(
      '"runReadOnlySql":30',
    );
  });

  it.each([
    ["provider error", () => Promise.reject(new Error("provider failure"))],
    ["empty answer", () => Promise.resolve({ text: " " })],
    [
      "tool calls",
      () => Promise.resolve({ text: "Done", toolCalls: [{ nonsense: true }] }),
    ],
    [
      "raw evidence",
      () => Promise.resolve({ text: "Tool step 1: runReadOnlySql succeeded" }),
    ],
    ["JSON dump", () => Promise.resolve({ text: '{"rows": [1, 2]}' })],
    [
      "unfinished promise",
      () =>
        Promise.resolve({ text: "I will check your Garmin activity next." }),
    ],
  ])(
    "uses bounded truthful fallback after budget synthesis returns %s",
    async (_label, finalResponse) => {
      generateText.mockImplementation(async (options) =>
        options.toolChoice === "none"
          ? finalResponse()
          : {
              toolCalls: Array.from({ length: 40 }, () => ({
                toolName: "getSyncStatus",
                input: {},
              })),
            },
      );
      const result = await orchestrateTrainerChat({
        model: "mock",
        system: "system",
        userRequest: "check my Garmin activity",
        debug: { enabled: true },
      });
      expect(dataCounts).toHaveBeenCalledTimes(28);
      expect(generateText).toHaveBeenCalledTimes(2);
      expect(result.providerCalls).toBe(2);
      expect(result.text).toContain("30-execution allowance");
      expect(result.text).toContain("remain unverified");
      expect(result.text).not.toMatch(/narrower|Tool step|\{"rows"/);
      expect(result.debugTrace?.finalAnswerSource).toBe(
        "deterministic_fallback",
      );
    },
  );

  it("counts a timed-out final synthesis and never retries beyond the hard cap", async () => {
    vi.useFakeTimers();
    try {
      generateText.mockImplementation(async (options) =>
        options.toolChoice === "none"
          ? new Promise(() => {})
          : {
              toolCalls: Array.from({ length: 40 }, () => ({
                toolName: "getSyncStatus",
                input: {},
              })),
            },
      );
      const pending = orchestrateTrainerChat({
        model: "mock",
        system: "system",
        userRequest: "check my Garmin activity",
      });
      await vi.advanceTimersByTimeAsync(
        trainerOrchestrationLimits.providerCallTimeoutMs,
      );
      const result = await pending;
      expect(generateText).toHaveBeenCalledTimes(2);
      expect(dataCounts).toHaveBeenCalledTimes(28);
      expect(result.providerCalls).toBe(2);
      expect(result.text).toContain("remain unverified");
      expect(generateText.mock.calls[1][0].abortSignal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts explicit invalid-prose repair synthesis independently of tool steps", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: [{ toolName: "getSyncStatus", input: {} }],
      })
      .mockResolvedValueOnce({ text: "Tool step 1: raw evidence" })
      .mockResolvedValueOnce({
        text: "Local data is available, but coverage has limitations.",
      });
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "check status",
    });
    expect(generateText).toHaveBeenCalledTimes(3);
    expect(result.providerCalls).toBe(3);
    expect(dataCounts).toHaveBeenCalledOnce();
    expect(result.text).toContain("coverage has limitations");
  });

  it("synthesizes partial evidence after an oversized batch of admitted SQL corrections", async () => {
    runReadOnlySql.mockReturnValue({
      status: "failed",
      resultName: "rows",
      rows: [],
      columns: [],
      returnedRows: 0,
      rowCount: 0,
      reason: "unknown_column",
      correctionAllowed: true,
      privacy: "sql privacy",
    });
    runReadOnlySql.mockReturnValueOnce({
      status: "succeeded",
      resultName: "rows",
      rows: [{ duration_sec: 3600 }],
      columns: [{ name: "duration_sec" }],
      returnedRows: 1,
      rowCount: 1,
      privacy: "sql privacy",
    });
    generateText
      .mockResolvedValueOnce({
        toolCalls: Array.from({ length: 40 }, () => ({
          toolName: "runReadOnlySql",
          input: {
            sql: "select duration_sec from activity",
            resultName: "rows",
          },
        })),
      })
      .mockResolvedValueOnce({
        text: "One activity duration was retrieved, but subsequent queries failed. That partial evidence does not establish your weekly total; use your reported fatigue as context rather than assuming recovery is verified.",
      });
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "compare my weekly activity totals",
    });
    expect(runReadOnlySql).toHaveBeenCalledTimes(28);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.providerCalls).toBe(2);
    expect(result.toolSteps[0].status).toBe("succeeded");
    expect(result.toolSteps[27].status).toBe("failed");
    expect(result.text).toContain("does not establish your weekly total");
    expect(generateText.mock.calls[1][0].system).toContain(
      "runReadOnlySql succeeded",
    );
    expect(generateText.mock.calls[1][0].system).toContain(
      "runReadOnlySql failed",
    );
    expect(result.grounding).not.toBeNull();
  });

  it("counts non-budget analytical failure synthesis and keeps rejected tools terminal", async () => {
    runReadOnlySql.mockReturnValueOnce({
      status: "rejected",
      reason: "unsafe_query",
      resultName: "rows",
      rows: [],
      columns: [],
      returnedRows: 0,
      rowCount: 0,
      privacy: "sql privacy",
    });
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "runReadOnlySql",
            input: {
              sql: "select duration_sec from activity",
              resultName: "rows",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The query was rejected; no activity metrics were retrieved.",
      });
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "inspect activities",
    });
    expect(runReadOnlySql).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.providerCalls).toBe(2);
    expect(result.toolSteps[0].status).toBe("rejected");
    expect(generateText.mock.calls[1][0]).toMatchObject({ toolChoice: "none" });
  });

  it("never replays a completed plan save while wrapping up after budget exhaustion", async () => {
    const progress: { message: string; counters?: TrainerProgressCounters }[] =
      [];
    generateText
      .mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: "saveTrainingPlan",
            input: { contentMarkdown: "# Plan\nEasy aerobic work" },
          },
          ...Array.from({ length: 39 }, () => ({
            toolName: "getSyncStatus",
            input: {},
          })),
        ],
      })
      .mockRejectedValueOnce(new Error("synthesis unavailable"));
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "Save this Training Plan and check status",
      onStatus: (message, counters) => progress.push({ message, counters }),
    });
    expect(progress.some((p) => p.message.startsWith("Checking whether"))).toBe(
      false,
    );
    expect(progress.at(-1)).toEqual({
      message:
        "Preparing an answer from the available evidence, with its limits…",
      counters: { modelCalls: 2, toolsSucceeded: 28, toolsUnsuccessful: 0 },
    });
    expect(result.toolSteps).toHaveLength(29); // Synthetic diagnostic is not an executed tool.
    expect(replaceTrainingPlan).toHaveBeenCalledOnce();
    expect(dataCounts).toHaveBeenCalledTimes(27);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.text).toContain("Completed local actions: saveTrainingPlan");
    expect(result.text).toContain("not repeated");
  });

  it("reports the hard ceiling, soft target and synthesis reserve", async () => {
    expect(trainerOrchestrationLimits).toEqual({
      maxTotalTurnExecutions: 30,
      softTargetExecutions: 20,
      finalAnswerReserve: 1,
      maxPlannerCalls: 30,
      maxToolCalls: 30,
      maxGeneralToolCalls: 30,
      maxSchemaCalls: 30,
      maxSqlCalls: 30,
      maxMathCalls: 30,
      providerCallTimeoutMs: 180000,
    });
  });
});
