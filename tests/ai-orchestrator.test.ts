import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/garmin/importer", () => ({
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
  activityDetailCoverage: vi.fn(),
  dataCounts: vi.fn(),
  getActivityByGarminId: vi.fn(),
  getActivityDetailForAnalytics: vi.fn(),
  getGarminAthleteBaseline: vi.fn(),
  listActivityDetailAvailability: vi.fn(),
  replaceTrainingPlan: vi.fn(),
  TRAINING_PLAN_CONTENT_MAX_LENGTH: 32000,
  TRAINING_PLAN_TITLE_MAX_LENGTH: 120,
  verifyActivityReference: vi.fn(),
}));

describe("trainer orchestrator fail-closed policy", async () => {
  const { orchestrateTrainerChat } = await import("../src/lib/ai/orchestrator");

  beforeEach(() => {
    generateText.mockReset();
    runGarminSync.mockReset();
    runGarminSync.mockResolvedValue({ status: "completed", detail: "ok" });
    describeGarminDatabase.mockClear();
    runReadOnlySql.mockClear();
    runMathAnalysis.mockClear();
  });

  it("fails closed for multiple provider tool calls with a side-effect tool", async () => {
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
      tool: "providerToolSelection",
      status: "rejected",
      reason: "multiple_tool_calls_with_side_effect",
    });
    expect(result.text).toContain("selected more than one tool");
    expect(result.text).not.toContain("Tool step");
    expect(result.text).not.toContain("invalid_tool_cardinality");
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

  it("selects one safe analytical tool from multiple provider tool calls", async () => {
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
        text: "The SQL-only answer is grounded and concise.",
      });

    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "invent more generic criteria for demanding activities",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(1);
    expect(runMathAnalysis).not.toHaveBeenCalled();
    expect(result.toolSteps.map((step) => step.tool)).toEqual([
      "describeGarminDatabase",
      "runReadOnlySql",
    ]);
    expect(result.toolSteps[1]?.selection).toMatchObject({
      reason: "multiple_tool_calls",
      count: 2,
      selectedTool: "runReadOnlySql",
      toolNames: ["runMathAnalysis", "runReadOnlySql"],
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
      userRequest: "top 10 most demanding activities in the last 365 days",
    });

    expect(runReadOnlySql).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[2][0].system).toContain("unknown_column");
    expect(generateText.mock.calls[2][0].system).toContain(
      "Allowed activity columns",
    );
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

  it("prevents duplicate side-effect tools across the tool budget", async () => {
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
});
