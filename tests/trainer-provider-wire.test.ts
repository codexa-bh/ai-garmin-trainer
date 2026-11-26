import { createOpenAI } from "@ai-sdk/openai";
import { expect, it, vi } from "vitest";
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";
import { TRAINER_SYSTEM_PROMPT } from "../src/lib/ai/trainer-instructions";

it.each([
  [
    { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
    { inputTokens: 100, outputTokens: 5 },
  ],
  [
    {
      prompt_tokens: 100,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 0 },
    },
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 0,
      uncachedInputTokens: 100,
    },
  ],
  [
    {
      prompt_tokens: 100,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 80 },
    },
    {
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 80,
      uncachedInputTokens: 20,
    },
  ],
] as const)(
  "retains exact wire counter presence through locked SDK aggregation: %j",
  async (usage, expected) => {
    const network = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "authored",
            object: "chat.completion",
            created: 1,
            model: "authored",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "Authored answer" },
              },
            ],
            usage,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    const model = createOpenAI({
      apiKey: "authored-not-a-credential",
      baseURL: "http://127.0.0.1:1/v1",
      fetch: network,
    }).chat("authored");
    const generate = createTrainerGeneration(model);
    const first = await generate({
      purpose: "planner",
      system: {
        policy: TRAINER_SYSTEM_PROMPT,
        context: "date A; complete plan A",
      },
      prompt: "Authored query",
    });
    const second = await generate({
      purpose: "planner",
      system: {
        policy: TRAINER_SYSTEM_PROMPT,
        context: "date A; complete plan A; new evidence",
      },
      prompt: "Authored query",
    });
    expect(first.tokenUsage).toEqual(expected);
    expect(second.tokenUsage).toEqual(expected);
    expect(network).toHaveBeenCalledTimes(2);
    const bodies = network.mock.calls.map((call) =>
      JSON.parse(String((call as unknown as [string, RequestInit])[1].body)),
    );
    expect(bodies[0].parallel_tool_calls).toBe(true);
    expect(bodies[1].tools).toEqual(bodies[0].tools);
    // Chat Completions combines policy/context; stable policy remains the prefix.
    expect(bodies[0].messages[0].content.split("\n\ndate A")[0]).toBe(
      TRAINER_SYSTEM_PROMPT,
    );
    expect(
      bodies[1].messages[0].content.startsWith(TRAINER_SYSTEM_PROMPT),
    ).toBe(true);
  },
);
