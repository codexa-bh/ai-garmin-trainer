import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText, executeTrainerTool } = vi.hoisted(() => ({
  generateText: vi.fn(),
  executeTrainerTool: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));
vi.mock("../src/lib/ai/tool-composition", () => ({ executeTrainerTool }));
import { orchestrateTrainerChat } from "../src/lib/ai/composition";

describe("selection and turn-owned combined admission", () => {
  beforeEach(() => {
    generateText.mockReset();
    executeTrainerTool.mockReset();
  });

  it.each([false, true])(
    "counts repeated actual attempts and reserves synthesis (first failure: %s)",
    async (firstFails) => {
      const call = { toolName: "runReadOnlySql", input: { sql: "SELECT 1" } };
      generateText
        .mockResolvedValueOnce({
          toolCalls: Array.from({ length: 40 }, () => call),
        })
        .mockResolvedValueOnce({
          text: "Supported partial evidence; remaining work was not run.",
        });
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
        userRequest: "check local evidence",
      });
      expect(executeTrainerTool).toHaveBeenCalledTimes(28);
      expect(result.toolSteps.at(-1)).toMatchObject({
        index: 29,
        tool: "providerToolSelection",
        status: "rejected",
        reason: "tool_budget_exceeded",
        summary: expect.stringContaining("12 selected tool calls skipped"),
      });
      expect(result.toolSteps[0].selection).toEqual({
        reason: "multiple_tool_calls",
        count: 40,
        toolNames: ["runReadOnlySql"],
        selectedTool: "runReadOnlySql",
      });
      expect(result.progressCounters).toEqual({
        modelCalls: 2,
        toolsSucceeded: firstFails ? 27 : 28,
        toolsUnsuccessful: firstFails ? 1 : 0,
      });
      expect(generateText).toHaveBeenCalledTimes(2);
      expect(generateText.mock.calls[1][0].tools).toBeUndefined();
    },
  );

  it("preserves supported three-execution mode without executing the skipped batch tail", async () => {
    generateText
      .mockResolvedValueOnce({
        toolCalls: Array.from({ length: 4 }, () => ({
          toolName: "getSyncStatus",
          input: {},
        })),
      })
      .mockResolvedValueOnce({ text: "One status check completed." });
    executeTrainerTool.mockImplementation(async ({ index, toolName }) => ({
      index,
      tool: toolName,
      status: "succeeded",
      summary: "Authored status",
      privacy: "authored",
    }));
    const result = await orchestrateTrainerChat({
      model: "mock",
      system: "system",
      userRequest: "status",
      executionLimit: 3,
    });
    expect(executeTrainerTool).toHaveBeenCalledOnce();
    expect(result.providerCalls).toBe(2);
    expect(result.toolSteps).toHaveLength(2);
    expect(generateText.mock.calls[0][0].system).toContain(
      '"exploratoryRemaining":1',
    );
    expect(generateText.mock.calls[1][0].tools).toBeUndefined();
  });
});
