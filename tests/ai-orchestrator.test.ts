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
const runGeneratedGarminAnalysis = vi.fn();

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
    runGeneratedGarminAnalysis.mockReset();
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
    expect(malformed.toolSteps[0]?.reason).toBe("malformed_input");
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
              operation: "sportNormalizedDemand",
              orderBy: [
                { field: "sport_normalized_demand_score", direction: "desc" },
              ],
              limit: 10,
              outputName: "demand_scores",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        text: "The most demanding local activities are led by the long ride, using SQL rows and a bounded score.",
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
    expect(runMathAnalysis).toHaveBeenCalledTimes(1);
    expect(runGeneratedGarminAnalysis).not.toHaveBeenCalled();
    expect(result.grounding?.tool).toBe("runMathAnalysis");
    expect(result.toolSteps).toHaveLength(3);
    expect(result.text).toContain("transparent local score");
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
        columns: [{ name: "garmin_id" }, { name: "demand_score" }],
        rows: [
          {
            garmin_id: "activity-2",
            name: "Long ride",
            demand_score: 123,
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
              sql: "select garmin_id, name, duration_sec as demand_score from activity order by started_at desc",
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
    expect(result.text).toContain("transparent local score");
    expect(result.text).toContain("Long ride");
    expect(result.text).not.toContain("Tool step");
    expect(result.toolSteps.map((step) => step.status)).toEqual([
      "succeeded",
      "failed",
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

    expect(runGeneratedGarminAnalysis).not.toHaveBeenCalled();
    expect(result.toolSteps[0]).toMatchObject({
      tool: "runGeneratedGarminAnalysis",
      status: "rejected",
      reason: "generated_analysis_disabled",
    });
    expect(result.text).toContain("SQL");
  });
});
