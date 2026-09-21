import { describe, expect, it } from "vitest";
import {
  canToolRunWithinBudget,
  selectSafeToolCalls,
} from "../src/lib/ai/tool-selection";
import { TRAINER_EXECUTION_POLICY } from "../src/lib/ai/execution-budget";
import type {
  TrainerToolCall,
  TrainerToolName,
  TrainerToolStep,
} from "../src/lib/ai/tool-types";

const schema: TrainerToolCall = {
  toolName: "describeGarminDatabase",
  input: {},
};
const sql: TrainerToolCall = {
  toolName: "runReadOnlySql",
  input: { sql: " SELECT 1 " },
};
const math: TrainerToolCall = {
  toolName: "runMathAnalysis",
  input: { inputResult: "rows", operation: "summarize" },
};
const status: TrainerToolCall = { toolName: "getSyncStatus", input: {} };
const limit = TRAINER_EXECUTION_POLICY.analyticalSuccessLimit;
const privacy =
  "No Garmin connector action or local analytics tool was executed for the rejected provider response.";

function step(
  tool: TrainerToolName,
  status: TrainerToolStep["status"] = "succeeded",
): TrainerToolStep {
  return { index: 1, tool, status, summary: "synthetic", privacy: "synthetic" };
}
function select(
  toolCalls: readonly TrainerToolCall[],
  overrides: Partial<Parameters<typeof selectSafeToolCalls>[0]> = {},
) {
  return selectSafeToolCalls({
    toolCalls,
    priorSteps: [],
    analysisToolCounts: new Map(),
    exploratoryRemaining: 30,
    ...overrides,
  });
}
function selected(
  toolCalls: readonly TrainerToolCall[],
  overrides: Partial<Parameters<typeof selectSafeToolCalls>[0]> = {},
) {
  const result = select(toolCalls, overrides);
  if (!result.ok) throw new Error(result.step.reason);
  return result;
}

describe("deterministic trainer tool selection", () => {
  it.each(["unknownTool", "toString", "constructor", "__proto__"])(
    "rejects %s without exposing input and preserves first-invalid precedence",
    (toolName) => {
      const result = select(
        [
          status,
          { toolName, input: { secret: "private-value" } },
          { ...sql, input: {} },
        ],
        {
          priorSteps: [step("getSyncStatus")],
          exploratoryRemaining: 1,
        },
      );
      expect(result).toEqual({
        ok: false,
        step: {
          index: 2,
          tool: "providerToolSelection",
          status: "rejected",
          reason: "unknown_tool",
          privacy,
          summary: `Provider selected 3 tools (getSyncStatus, ${toolName}, runReadOnlySql); call 2 was rejected as unknown_tool, so no tools from that provider response were executed.`,
        },
      });
      expect(JSON.stringify(result)).not.toContain("private-value");
    },
  );

  it.each([0, 1])(
    "validates malformed quota-filtered input before capacity %s or later unknown calls",
    (exploratoryRemaining) => {
      expect(
        select(
          [status, { ...sql, input: {} }, { toolName: "unknown", input: {} }],
          {
            exploratoryRemaining,
            analysisToolCounts: new Map([["runReadOnlySql", limit]]),
          },
        ),
      ).toEqual({
        ok: false,
        step: {
          index: 1,
          tool: "runReadOnlySql",
          status: "rejected",
          reason: "malformed_input",
          privacy,
          summary:
            "Provider selected 3 tools (getSyncStatus, runReadOnlySql, unknown); call 2 was rejected as malformed_input, so no tools from that provider response were executed.",
        },
      });
    },
  );

  it("preserves call identity while using real schema defaults and trimming", () => {
    const calls = [
      sql,
      {
        toolName: "getActivityDetailSlice",
        input: { garminId: " synthetic-id " },
      },
      { toolName: "getActivityDetailAvailability", input: {} },
      math,
    ];
    const result = selected(calls);
    expect(result.calls.find((item) => item.call === sql)?.accepted).toEqual({
      ok: true,
      toolName: "runReadOnlySql",
      input: { sql: "SELECT 1", maxRows: 50 },
    });
    expect(result.calls.map((item) => item.accepted.input)).toContainEqual({
      garminId: "synthetic-id",
      pointOffset: 0,
      pointLimit: 60,
    });
    expect(result.calls.map((item) => item.accepted.input)).toContainEqual({
      limit: 10,
    });
    expect(
      result.calls.find((item) => item.call === math)?.accepted.input,
    ).toEqual({ inputResult: "rows", operation: "summarize", limit: 10 });
  });

  it.each([
    { history: [], order: [schema, sql, math, status] },
    {
      history: [
        step("describeGarminDatabase", "failed"),
        step("runReadOnlySql", "rejected"),
      ],
      order: [schema, sql, math, status],
    },
    {
      history: [step("describeGarminDatabase")],
      order: [sql, math, schema, status],
    },
    {
      history: [step("describeGarminDatabase"), step("runReadOnlySql")],
      order: [math, sql, schema, status],
    },
    {
      history: [
        step("describeGarminDatabase"),
        step("runReadOnlySql"),
        step("runMathAnalysis"),
      ],
      order: [sql, math, schema, status],
    },
    // Two priority-zero tools: provider order breaks ties, not a prerequisite gate.
    { history: [step("runReadOnlySql")], order: [math, schema, sql, status] },
  ])(
    "orders only from successful prior history: $history",
    ({ history, order }) => {
      expect(
        selected([status, math, sql, schema], {
          priorSteps: history,
        }).calls.map((item) => item.call),
      ).toEqual(order);
    },
  );

  it("retains repeated calls and equal-priority provider ordering", () => {
    const secondStatus = { ...status, input: { availabilityLimit: 2 } };
    const plan = { toolName: "getTrainingPlan", input: {} };
    expect(
      selected([status, plan, secondStatus, status]).calls.map(
        (item) => item.call,
      ),
    ).toEqual([status, plan, secondStatus, status]);
  });

  it.each([
    "describeGarminDatabase",
    "runReadOnlySql",
    "runMathAnalysis",
  ] as const)(
    "uses successful quota edges for %s without reserving a batch",
    (toolName) => {
      expect(canToolRunWithinBudget(toolName, new Map())).toBe(true);
      const call = [schema, sql, math].find(
        (item) => item.toolName === toolName,
      )!;
      const counts = new Map<TrainerToolName, number>([[toolName, limit - 1]]);
      expect(
        selected([call, call], { analysisToolCounts: counts }).calls,
      ).toHaveLength(2);
      expect(counts.get(toolName)).toBe(limit - 1);
      for (const count of [limit, limit + 1]) {
        counts.set(toolName, count);
        expect(canToolRunWithinBudget(toolName, counts)).toBe(false);
        expect(
          select([call], {
            analysisToolCounts: counts,
            exploratoryRemaining: 0,
          }),
        ).toEqual({
          ok: false,
          step: {
            index: 1,
            tool: "providerToolSelection",
            status: "rejected",
            reason: "multiple_tool_calls_no_safe_tool",
            privacy,
            summary: `Provider selected 1 tools (${toolName}); none was a safe valid next tool within the remaining per-tool budgets.`,
          },
        });
      }
    },
  );

  it.each([0, -1])(
    "reports capacity %s only after validation and candidate eligibility",
    (exploratoryRemaining) => {
      expect(select([status], { exploratoryRemaining })).toEqual({
        ok: false,
        step: {
          index: 1,
          tool: "providerToolSelection",
          status: "rejected",
          reason: "tool_budget_exceeded",
          privacy,
          summary: `Provider selected 1 tools (getSyncStatus), but the per-turn limit of ${TRAINER_EXECUTION_POLICY.hardLimit} total planner/tool executions was already exhausted.`,
        },
      });
    },
  );

  it("characterizes empty direct input as no-candidates rejection", () => {
    expect(select([], { exploratoryRemaining: 0 })).toEqual({
      ok: false,
      step: {
        index: 1,
        tool: "providerToolSelection",
        status: "rejected",
        reason: "multiple_tool_calls_no_safe_tool",
        privacy,
        summary:
          "Provider selected 0 tools (none recognized); none was a safe valid next tool within the remaining per-tool budgets.",
      },
    });
  });

  it.each([1, 2, 3, 4])(
    "truncates eligible calls to %s, excluding quota-filtered tools from skipped counts",
    (exploratoryRemaining) => {
      const result = selected([status, schema, status, status], {
        exploratoryRemaining,
        analysisToolCounts: new Map([
          ["describeGarminDatabase", limit],
          ["getSyncStatus", limit + 1],
        ]),
      });
      expect(result.calls).toHaveLength(Math.min(exploratoryRemaining, 3));
      expect(result.skippedForTurnBudget).toBe(
        Math.max(0, 3 - exploratoryRemaining),
      );
      expect(result.calls[0].metadata).toEqual({
        reason: "multiple_tool_calls",
        count: 4,
        toolNames: ["getSyncStatus", "describeGarminDatabase"],
        selectedTool: "getSyncStatus",
      });
    },
  );

  it("derives metadata from original cardinality and first unique names capped at eight", () => {
    const calls = [
      status,
      status,
      math,
      sql,
      schema,
      { toolName: "runGarminSync", input: {} },
      { toolName: "getTrainingPlan", input: {} },
      { toolName: "getActivityDetailAvailability", input: {} },
      { toolName: "getActivityDetailSlice", input: { garminId: "synthetic" } },
      { toolName: "verifyActivityReference", input: { garminId: "synthetic" } },
    ];
    const counts = new Map<TrainerToolName, number>([
      ["runReadOnlySql", limit],
    ]);
    const result = selected(calls, { analysisToolCounts: counts });
    for (const item of result.calls)
      expect(item.metadata).toEqual({
        reason: "multiple_tool_calls",
        count: calls.length,
        toolNames: [
          "getSyncStatus",
          "runMathAnalysis",
          "runReadOnlySql",
          "describeGarminDatabase",
          "runGarminSync",
          "getTrainingPlan",
          "getActivityDetailAvailability",
          "getActivityDetailSlice",
        ],
        selectedTool: item.accepted.toolName,
      });
    expect(
      selected([status], { priorSteps: [step("runReadOnlySql")] }).calls[0]
        .metadata,
    ).toBeUndefined();
  });

  it("does not apply analytical counts to any non-analytical tool", () => {
    const names: TrainerToolName[] = [
      "runGarminSync",
      "getSyncStatus",
      "verifyActivityReference",
      "forceRefreshActivityDetail",
      "getActivityDetailAvailability",
      "getActivityDetailSlice",
      "getTrainingPlan",
      "saveTrainingPlan",
    ];
    for (const name of names)
      expect(canToolRunWithinBudget(name, new Map([[name, limit + 1]]))).toBe(
        true,
      );
  });

  it("preserves arrays, nested inputs, prior steps and map entries on success and rejection", () => {
    const nestedCall = {
      toolName: "runMathAnalysis",
      input: {
        inputResult: " rows ",
        operation: "summarize",
        orderBy: [{ field: " duration ", direction: "desc" }],
      },
    };
    Object.freeze(nestedCall.input.orderBy[0]);
    Object.freeze(nestedCall.input.orderBy);
    Object.freeze(nestedCall.input);
    Object.freeze(nestedCall);
    const toolCalls = Object.freeze([nestedCall, sql]);
    const priorSteps = Object.freeze([
      Object.freeze(step("describeGarminDatabase")),
    ]);
    const analysisToolCounts = new Map<TrainerToolName, number>([
      ["runReadOnlySql", 1],
    ]);
    const before = structuredClone({
      toolCalls,
      priorSteps,
      analysisToolCounts,
    });
    selected(toolCalls, { priorSteps, analysisToolCounts });
    select([...toolCalls, { toolName: "unknown", input: {} }], {
      priorSteps,
      analysisToolCounts,
    });
    expect({ toolCalls, priorSteps, analysisToolCounts }).toEqual(before);
  });
});
