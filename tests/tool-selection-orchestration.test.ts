import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText, executeTrainerTool } = vi.hoisted(() => ({
  generateText: vi.fn(),
  executeTrainerTool: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));
vi.mock("../src/lib/ai/execution-budget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/ai/execution-budget")>();
  return {
    ...actual,
    TRAINER_EXECUTION_POLICY: {
      ...actual.TRAINER_EXECUTION_POLICY,
      analyticalSuccessLimit: 1,
    },
  };
});
vi.mock("../src/lib/ai/tool-execution", () => ({ executeTrainerTool }));
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";

// Lower only the success quota to expose the real loop's live recheck without
// exhausting the independent 30-execution allowance first.
describe("selection snapshot versus turn-owned successful quota", () => {
  beforeEach(() => {
    generateText.mockReset();
    executeTrainerTool.mockReset();
  });

  it.each([false, true])(
    "rechecks after an earlier execution (first failure: %s)",
    async (firstFails) => {
      const call = { toolName: "runReadOnlySql", input: { sql: "SELECT 1" } };
      generateText.mockResolvedValueOnce({ toolCalls: [call, call, call] });
      executeTrainerTool.mockImplementation(async ({ index, toolName }) => ({
        index,
        tool: toolName,
        status: firstFails && index === 1 ? "failed" : "succeeded",
        correctionAllowed: firstFails && index === 1,
        summary: "Synthetic SQL outcome",
        privacy: "Synthetic evidence",
      }));
      const result = await orchestrateTrainerChat({
        model: "mock",
        system: "system",
        userRequest: "check local status",
      });
      const attempts = firstFails ? 2 : 1;
      expect(executeTrainerTool).toHaveBeenCalledTimes(attempts);
      expect(result.toolSteps.at(-1)).toEqual({
        index: attempts + 1,
        tool: "runReadOnlySql",
        status: "rejected",
        reason: "tool_budget_exceeded",
        summary:
          "runReadOnlySql was rejected because its per-turn budget was already exhausted.",
        privacy:
          "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
      });
      expect(result.toolSteps[0].selection).toEqual({
        reason: "multiple_tool_calls",
        count: 3,
        toolNames: ["runReadOnlySql"],
        selectedTool: "runReadOnlySql",
      });
      expect(result.progressCounters).toEqual({
        modelCalls: 1,
        toolsSucceeded: 1,
        toolsUnsuccessful: firstFails ? 1 : 0,
      });
      expect(generateText).toHaveBeenCalledTimes(1);
    },
  );
});
