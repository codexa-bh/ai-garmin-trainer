import { describe, expect, it } from "vitest";
import {
  answerPreparationMessage,
  modelWaitMessage,
  toolProgressMessage,
  validProgressCounters,
} from "../src/lib/ai/trainer-progress";
import type {
  TrainerToolName,
  TrainerToolStep,
} from "../src/lib/ai/tool-types";

const canary =
  "SELECT secret FROM /private/token; plan title; raw result; internal reasoning";
function step(
  tool: TrainerToolStep["tool"],
  status: TrainerToolStep["status"] = "succeeded",
  result?: unknown,
): TrainerToolStep {
  return {
    index: 1,
    tool,
    status,
    result,
    summary: canary,
    reason: canary,
    privacy: canary,
  };
}
const tools: TrainerToolName[] = [
  "describeGarminDatabase",
  "runReadOnlySql",
  "runMathAnalysis",
  "getSyncStatus",
  "verifyActivityReference",
  "getActivityDetailAvailability",
  "getActivityDetailSlice",
  "runGarminSync",
  "forceRefreshActivityDetail",
  "getTrainingPlan",
  "saveTrainingPlan",
];

describe("bounded contextual progress", () => {
  it.each(tools)(
    "maps %s to factual activity and outcome copy without leaking metadata",
    (tool) => {
      expect(toolProgressMessage(tool).length).toBeGreaterThan(20);
      for (const status of ["succeeded", "rejected", "failed"] as const) {
        const text = modelWaitMessage([
          step(tool, status, {
            summary: canary,
            operation: canary,
            plan: { title: canary },
            rows: [canary],
          }),
        ]);
        expect(text.length).toBeLessThan(160);
        expect(text).not.toMatch(
          /SELECT|secret|private|token|plan title|raw result|internal reasoning/,
        );
        expect(text).toMatch(/^Reviewing /);
        expect(text).not.toMatch(
          /Running|Saving|Refreshing|Choosing|model pass/,
        );
        if (status !== "succeeded") expect(text).toMatch(/rejected|failure/);
      }
    },
  );

  it.each(["runReadOnlySql", "runMathAnalysis"] as const)(
    "describes returned %s rows, empty results and truncation",
    (tool) => {
      const wait = (returnedRows: unknown, truncated = false) =>
        modelWaitMessage([
          step(tool, "succeeded", {
            status: "succeeded",
            returnedRows,
            truncated,
            rows: [canary],
            rowCount: 999999,
          }),
        ]);
      expect(wait(12)).toMatch(/12 returned (query|calculation) rows/);
      expect(wait(1)).toMatch(/1 returned (query|calculation) row for/);
      expect(wait(0)).toContain("empty result");
      expect(wait(12, true)).toContain("limited result");
      for (const value of [-1, Infinity, NaN, 201, "12", 1.5, null]) {
        expect(wait(value)).not.toMatch(/returned|NaN|Infinity|201|1.5/);
      }
      expect(wait(12)).not.toContain("activities");
    },
  );

  it("handles safe schema/empty metadata and ignores synthetic selection steps", () => {
    expect(
      modelWaitMessage([
        step("describeGarminDatabase", "succeeded", {
          tables: [{ name: canary }],
        }),
      ]),
    ).toContain("1 local data tables");
    expect(
      modelWaitMessage([step("getTrainingPlan", "succeeded", { plan: null })]),
    ).toContain("absence of a saved training plan");
    expect(
      modelWaitMessage([
        step("getActivityDetailAvailability", "succeeded", []),
      ]),
    ).toContain("empty local detail availability result");
    const actual = step("runReadOnlySql", "succeeded", {
      status: "succeeded",
      returnedRows: 12,
    });
    expect(
      modelWaitMessage([actual, step("providerToolSelection", "rejected")]),
    ).toBe(modelWaitMessage([actual]));
    expect(modelWaitMessage([step("providerToolSelection", "rejected")])).toBe(
      modelWaitMessage([]),
    );
    expect(
      modelWaitMessage([step("runReadOnlySql", "succeeded", null)]),
    ).toContain("local query result");
    expect(answerPreparationMessage(true)).toContain("with its limits");
    expect(answerPreparationMessage(false)).toContain(
      "available local results",
    );
  });

  it("accepts only finite nonnegative integer counter facts and strips extra properties", () => {
    const valid = { modelCalls: 2, toolsSucceeded: 0, toolsUnsuccessful: 1 };
    expect(validProgressCounters({ ...valid, secret: canary })).toEqual(valid);
    for (const value of [
      undefined,
      null,
      {},
      { ...valid, modelCalls: -1 },
      { ...valid, toolsSucceeded: 0.5 },
      { ...valid, toolsUnsuccessful: Infinity },
      { ...valid, modelCalls: "2" },
    ])
      expect(validProgressCounters(value)).toBeUndefined();
  });
});
