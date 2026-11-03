import { describe, expect, it, vi } from "vitest";
import { trainerExecutionBudget } from "@/lib/ai/execution-budget";
import { orchestrateTrainerChat } from "@/lib/ai/orchestrator";
import {
  CONVERSATION_INPUT_LIMIT,
  CONVERSATION_OUTPUT_LIMIT,
} from "@/lib/chat/conversation-replay";

describe("fixed safety-reducing live turn envelope", () => {
  it("reserves both pre/post-compaction orchestration attempts at worst reviewed cache-write pricing", () => {
    const inference =
      (CONVERSATION_INPUT_LIMIT * 0.25 + CONVERSATION_OUTPUT_LIMIT * 0.5) /
      1_000_000;
    expect(2 * 3 * inference + 0.01).toBeLessThan(0.08);
    expect(3 * 0.08).toBeLessThanOrEqual(0.25);
  });
  it("retains normal30 and clamps finite3 with a final-answer reserve", () => {
    expect(trainerExecutionBudget(2, 3)).toMatchObject({
      hardLimit: 30,
      remaining: 25,
      exploratoryRemaining: 24,
    });
    expect(trainerExecutionBudget(1, 1, 3)).toMatchObject({
      hardLimit: 3,
      softTarget: 3,
      remaining: 1,
      exploratoryRemaining: 0,
    });
    expect(trainerExecutionBudget(30, 1, 3).remaining).toBe(0);
  });
  it("bounds repeated malformed native-generation proposals without altering default policy", async () => {
    const generate = vi.fn(async () => ({
      toolCalls: [{ toolName: "unrecognized", input: {} }],
    }));
    const executeTool = vi.fn();
    await orchestrateTrainerChat(
      {
        system: "Synthetic policy",
        userRequest: "Fictional test only",
        executionLimit: 3,
      },
      { generate, executeTool },
    );
    expect(generate.mock.calls.length).toBeGreaterThan(0);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(3);
    expect(trainerExecutionBudget(0, 0).hardLimit).toBe(30);
  });
});
