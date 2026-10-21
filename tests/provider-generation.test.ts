import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText,
}));
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";
import { trainerToolDefinitions } from "../src/lib/ai/provider-tool-definitions";
import { finalToolChoice } from "./completion-fixtures";
import {
  trainerCompletionSchema,
  trainerToolContracts,
} from "../src/lib/ai/tool-contracts";
import { TRAINER_PROVIDER_CALL_TIMEOUT_MS } from "../src/lib/ai/orchestration-ports";

beforeEach(() => {
  vi.useFakeTimers();
  generateText.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

it("maps exact planner and synthesis options while retaining selected model and raw results", async () => {
  const model = { selected: true };
  const generation = createTrainerGeneration(model);
  const raw = {
    text: " answer ",
    toolCalls: [{ name: "legacy", arguments: "bad-json" }, null],
  };
  generateText.mockResolvedValue(raw);
  expect(
    await generation({
      purpose: "planner",
      system: "system",
      prompt: "prompt",
    }),
  ).toEqual(raw);
  expect(generateText.mock.calls[0][0]).toEqual({
    model,
    system: "system",
    prompt: "prompt",
    tools: {
      ...trainerToolDefinitions,
      completeTrainerTurn: expect.objectContaining({
        inputSchema: expect.anything(),
      }),
    },
    toolChoice: "auto",
    parallelToolCalls: false,
    providerOptions: {
      openai: { parallelToolCalls: false },
      deepseek: { parallelToolCalls: false },
    },
    abortSignal: expect.any(AbortSignal),
  });
  expect(
    await generation({
      purpose: "final_synthesis",
      system: "final",
      prompt: "prompt",
    }),
  ).toEqual(raw);
  expect(generateText.mock.calls[1][0]).toEqual({
    model,
    system: "final",
    prompt: "prompt",
    tools: {
      completeTrainerTurn: expect.objectContaining({
        inputSchema: expect.anything(),
      }),
    },
    toolChoice: finalToolChoice,
    abortSignal: expect.any(AbortSignal),
  });
  expect(generateText.mock.calls[0][0].abortSignal).not.toBe(
    generateText.mock.calls[1][0].abortSignal,
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("exposes native completion field guidance without changing the terminal tool or enabling actions", async () => {
  generateText.mockResolvedValue({});
  await createTrainerGeneration("model")({
    purpose: "final_synthesis",
    system: "system",
    prompt: "prompt",
  });
  const tools = generateText.mock.calls[0][0].tools;
  expect(Object.keys(tools)).toEqual(["completeTrainerTurn"]);
  expect(tools.completeTrainerTurn.inputSchema).toBe(trainerCompletionSchema);
  const fields = trainerCompletionSchema.shape.completion.shape;
  expect(fields.kind.description).toContain(
    "incomplete whenever missingEvidence is nonempty",
  );
  expect(fields.claims.description).toContain(
    "never use runReadOnlySql or runMathAnalysis as a tool claim",
  );
  expect(fields.missingEvidence.description).toContain("Preserve genuine gaps");
  expect(tools.completeTrainerTurn).not.toHaveProperty("execute");
});

it.each([
  { provider: "deepseek.chat", modelId: "deepseek-flash" },
  { provider: "ollama.chat", modelId: "gpt-6-luna" },
  { provider: "openrouter.chat", modelId: "gpt-6-luna" },
  { provider: "openai.responses", modelId: "custom-unverified-model" },
])(
  "keeps structured shared policy without unsupported cache options for %j",
  async (model) => {
    generateText.mockResolvedValue({});
    await createTrainerGeneration(model)({
      purpose: "final_synthesis",
      system: { policy: "stable policy", context: "fresh context" },
      prompt: "question",
    });
    expect(generateText.mock.calls[0][0].system).toBe(
      "stable policy\n\nfresh context",
    );
    expect(generateText.mock.calls[0][0].providerOptions).toBeUndefined();
    expect(Object.keys(generateText.mock.calls[0][0].tools)).toEqual([
      "completeTrainerTurn",
    ]);
  },
);

it("wraps exactly the neutral descriptions/schemas without execution callbacks", () => {
  expect(Object.keys(trainerToolDefinitions)).toEqual(
    Object.keys(trainerToolContracts),
  );
  for (const name of Object.keys(
    trainerToolContracts,
  ) as (keyof typeof trainerToolContracts)[]) {
    expect(trainerToolDefinitions[name]).toEqual(trainerToolContracts[name]);
    expect(trainerToolDefinitions[name]).not.toHaveProperty("execute");
  }
});

it("aborts only the timed-out call at the unchanged deadline and never retries", async () => {
  generateText.mockImplementation(() => new Promise(() => {}));
  const generation = createTrainerGeneration("model");
  const first = generation({ purpose: "planner", system: "a", prompt: "a" });
  const failed = expect(first).rejects.toThrow("provider_timeout");
  await vi.advanceTimersByTimeAsync(TRAINER_PROVIDER_CALL_TIMEOUT_MS - 1);
  expect(generateText.mock.calls[0][0].abortSignal.aborted).toBe(false);
  generateText.mockResolvedValueOnce({ text: "other turn" });
  await generation({ purpose: "planner", system: "b", prompt: "b" });
  await vi.advanceTimersByTimeAsync(1);
  await failed;
  expect(generateText.mock.calls[0][0].abortSignal.aborted).toBe(true);
  expect(generateText.mock.calls[1][0].abortSignal.aborted).toBe(false);
  expect(generateText).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  [undefined, undefined],
  [
    { input_tokens: 100, output_tokens: 5 },
    { inputTokens: 100, outputTokens: 5 },
  ],
  [
    {
      input_tokens: 100,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 100,
    },
  ],
  [
    {
      input_tokens: 100,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 40, cache_write_tokens: 30 },
    },
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 30,
      uncachedInputTokens: 30,
    },
  ],
  [
    { input_tokens: 100, input_tokens_details: { cached_tokens: 40 } },
    { inputTokens: 100, cacheReadTokens: 40 },
  ],
  [
    {
      prompt_tokens: 100,
      completion_tokens: 5,
      prompt_cache_hit_tokens: 40,
      prompt_cache_miss_tokens: 60,
    },
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 40,
      uncachedInputTokens: 60,
    },
  ],
  [
    { prompt_tokens: 100, completion_tokens: 5 },
    { inputTokens: 100, outputTokens: 5 },
  ],
  [
    { prompt_tokens: 100, prompt_cache_hit_tokens: 0 },
    { inputTokens: 100, cacheReadTokens: 0, uncachedInputTokens: 100 },
  ],
  [
    {
      input_tokens: -1,
      output_tokens: Infinity,
      input_tokens_details: { cached_tokens: NaN, cache_write_tokens: -1 },
    },
    undefined,
  ],
  [
    { prompt_tokens: 10, prompt_cache_hit_tokens: 20 },
    { inputTokens: 10, cacheReadTokens: 20 },
  ],
])(
  "normalizes reported usage without manufacturing missing counts: %j",
  async (raw, expected) => {
    generateText.mockResolvedValue({
      text: "ok",
      usage: raw
        ? { raw, inputTokens: 0, inputTokenDetails: { cacheReadTokens: 0 } }
        : undefined,
    });
    const result = await createTrainerGeneration("model")({
      purpose: "planner",
      system: "policy",
      prompt: "question",
    });
    expect(result.tokenUsage).toEqual(expected);
    expect(result).not.toHaveProperty("usage");
    expect(generateText).toHaveBeenCalledTimes(1);
  },
);

it("uses SDK-only usage for other providers and never adds step and aggregate counts", async () => {
  generateText.mockResolvedValue({
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      inputTokenDetails: {
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
        noCacheTokens: 50,
      },
    },
    totalUsage: { inputTokens: 200 },
    steps: [{ usage: { inputTokens: 100 } }],
  });
  const result = await createTrainerGeneration("model")({
    purpose: "planner",
    system: "policy",
    prompt: "question",
  });
  expect(result.tokenUsage).toEqual({
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
    uncachedInputTokens: 50,
  });
});

it.each(["sync", "async"])(
  "preserves %s provider rejection and cleans its timer",
  async (kind) => {
    const error = new Error("provider failure");
    generateText.mockImplementation(() => {
      if (kind === "sync") throw error;
      return Promise.reject(error);
    });
    await expect(
      createTrainerGeneration("model")({
        purpose: "final_synthesis",
        system: "s",
        prompt: "p",
      }),
    ).rejects.toBe(error);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);
