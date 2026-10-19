import { describe, expect, it, vi } from "vitest";

// Contract/presentation consumers must not initialize execution capabilities.
vi.mock("@/lib/db/repository", () => {
  throw new Error("storage capability imported");
});
vi.mock("@/lib/db/connection", () => {
  throw new Error("connection capability imported");
});
vi.mock("@/lib/db/conversation-repository", () => {
  throw new Error("conversation storage capability imported");
});
vi.mock("@/lib/db/training-plan-repository", () => {
  throw new Error("plan storage capability imported");
});
vi.mock("@/lib/db/conversation-lifecycle", () => {
  throw new Error("conversation lifecycle capability imported");
});
vi.mock("@/lib/garmin/composition", () => {
  throw new Error("connector capability imported");
});
vi.mock("@/lib/ai/sql-analysis", () => {
  throw new Error("SQL capability imported");
});
vi.mock("ai", () => {
  throw new Error("provider SDK imported");
});
import {
  validateTrainerToolCall,
  trainerToolInputSchemas,
} from "../src/lib/ai/tool-contracts";
import {
  boundedText,
  sanitizedResultDetail,
  renderToolSteps,
  groundingForSteps,
} from "../src/lib/ai/tool-evidence";
import { renderCompleteTrainingPlan } from "../src/lib/ai/training-plan-evidence";
import type { TrainerToolStep } from "../src/lib/ai/tool-types";

describe("dependency-light contracts and evidence", () => {
  it("parses all fourteen tools with compatible defaults and strict rejection", () => {
    const inputs = {
      getWeeklyPlan: { weekStart: "2026-09-21" },
      proposeWeeklyDocuments: {
        changes: [
          {
            weekStart: "2026-09-21",
            kind: "plan",
            title: "Plan",
            contentMarkdown: "Draft",
          },
        ],
      },
      applyWeeklyProposal: { proposalId: "proposal-id" },
      runGarminSync: {},
      getSyncStatus: {},
      verifyActivityReference: { garminId: "123" },
      forceRefreshActivityDetail: { garminId: "123" },
      getActivityDetailAvailability: {},
      getActivityDetailSlice: { garminId: "123" },
      describeGarminDatabase: {},
      runReadOnlySql: { sql: "select 1" },
      runMathAnalysis: { inputResult: "rows", operation: "score" },
      getTrainingPlan: {},
      saveTrainingPlan: { contentMarkdown: "Plan" },
    };
    expect(Object.keys(inputs)).toEqual(Object.keys(trainerToolInputSchemas));
    for (const [toolName, input] of Object.entries(inputs)) {
      expect(validateTrainerToolCall({ toolName, input }).ok).toBe(true);
      expect(
        validateTrainerToolCall({ toolName, input: { ...input, extra: true } }),
      ).toEqual({ ok: false, reason: "malformed_input" });
    }
    expect(
      validateTrainerToolCall({
        toolName: "getActivityDetailSlice",
        input: { garminId: "123" },
      }),
    ).toMatchObject({ input: { pointOffset: 0, pointLimit: 60 } });
    expect(
      validateTrainerToolCall({
        toolName: "runReadOnlySql",
        input: { sql: "select 1" },
      }),
    ).toMatchObject({ input: { maxRows: 50 } });
    expect(
      validateTrainerToolCall({
        toolName: "runMathAnalysis",
        input: inputs.runMathAnalysis,
      }),
    ).toMatchObject({ input: { limit: 10 } });
    expect(
      validateTrainerToolCall({
        toolName: "getActivityDetailAvailability",
        input: {},
      }),
    ).toMatchObject({ input: { limit: 10 } });
  });

  it.each([
    { operation: "score", score: 14 },
    { operation: "normalize", normalizedScore: 0.5 },
    { operation: "aggregate", rowCount: 3, numericColumns: 2 },
  ])(
    "keeps computed math cells visible before bounded input labels: $operation",
    (row) => {
      const { operation, ...computed } = row;
      const text = renderToolSteps([
        {
          index: 2,
          tool: "runMathAnalysis",
          status: "succeeded",
          summary: "Bounded math",
          privacy: "bounded",
          result: {
            status: "succeeded",
            operation,
            inputResult: "facts",
            resultName: "scores",
            returnedRows: 1,
            rowCount: 1,
            rows: [{ label: "x".repeat(600), ...computed }],
          },
        },
      ]);
      for (const [column, value] of Object.entries(computed))
        expect(text).toContain(`"${column}":${value}`);
      expect(
        text.split("\n").find((line) => line.startsWith("1. "))!.length,
      ).toBeLessThanOrEqual(503);
    },
  );

  it("keeps redaction, row limits and metadata-only grounding independent of execution", () => {
    const text = boundedText(
      "/Users/private/token OPENAI_API_KEY=secret access_token=hidden",
    );
    expect(text).not.toMatch(/private|secret|hidden/);
    expect(
      sanitizedResultDetail({ detail: "x".repeat(1500) }).detail,
    ).toHaveLength(1200);
    const step: TrainerToolStep = {
      index: 1,
      tool: "runReadOnlySql",
      status: "succeeded",
      summary: "s".repeat(600),
      privacy: "bounded",
      activityIds: Array.from({ length: 12 }, (_, i) => String(i)),
      result: {
        status: "succeeded",
        resultName: "rows",
        returnedRows: 21,
        rowCount: 21,
        rows: Array.from({ length: 21 }, (_, i) => ({
          value: i,
          label: "x".repeat(600),
        })),
      },
    };
    const lines = renderToolSteps([step])
      .split("\n")
      .filter((line) => /^\d+\./.test(line));
    expect(lines).toHaveLength(20);
    expect(lines.every((line) => line.length <= 504)).toBe(true);
    const grounding = groundingForSteps([step]);
    expect(grounding?.summary).toHaveLength(500);
    expect(grounding?.toolSteps[0].activityIds).toHaveLength(10);
    expect(grounding?.toolSteps[0]).not.toHaveProperty("result");
    expect(
      renderCompleteTrainingPlan({
        plan: null,
        stale: true,
        staleAfterDays: 14,
      }),
    ).toContain("no saved plan");
  });
});
