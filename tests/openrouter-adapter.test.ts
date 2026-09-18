import { generateText, tool } from "ai";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { selectedModel } from "../src/lib/ai/providers";
import { providerFailureMessage } from "../src/lib/ai/provider-errors";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses OpenRouter chat completions and forwards the exact model and tool schema", async () => {
  vi.stubEnv("AI_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "sentinel-router-key");
  vi.stubEnv("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free");
  const fetchMock = vi.fn(async () =>
    Response.json({
      id: "mock-chat",
      object: "chat.completion",
      created: 1,
      model: "nvidia/nemotron-3.5-lightning:free",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "describeGarminDatabase", arguments: "{}" },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const selection = selectedModel();
  const result = await generateText({
    model: selection.model as Parameters<typeof generateText>[0]["model"],
    prompt: "Describe the local schema.",
    tools: {
      describeGarminDatabase: tool({
        description: "Read-only schema",
        inputSchema: z.object({}),
      }),
    },
    maxRetries: 0,
    providerOptions: { openai: { parallelToolCalls: false } },
  });
  const [url, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(new Headers(options.headers).get("authorization")).toBe(
    "Bearer sentinel-router-key",
  );
  const body = JSON.parse(String(options.body));
  expect(body.model).toBe("nvidia/nemotron-3.5-lightning:free");
  expect(body.tools[0].function.name).toBe("describeGarminDatabase");
  expect(body.parallel_tool_calls).toBe(false);
  expect(selection.provider).toBe("openrouter");
  expect(result.toolCalls[0].toolName).toBe("describeGarminDatabase");
  expect(result.toolCalls[0].input).toEqual({});
});

it.each([
  [401, /authentication/],
  [403, /permission/],
  [429, /rate limit/],
  [400, /model or chat\/tool/],
  [404, /model or chat\/tool/],
  [422, /model or chat\/tool/],
  [503, /unavailable/],
])(
  "classifies HTTP %s without copying upstream credentials or payloads",
  (statusCode, expected) => {
    const error = Object.assign(
      new Error("provider leaked sentinel-router-key and private prompt"),
      { statusCode },
    );
    const message = providerFailureMessage("openrouter", { lastError: error });
    expect(message).toMatch(expected);
    expect(message).not.toContain("sentinel-router-key");
    expect(message).not.toContain("private prompt");
  },
);

it("redacts network and malformed-response errors without silent substitution", () => {
  for (const error of [
    new Error("sentinel-router-key"),
    { statusCode: "sentinel-router-key" },
    null,
  ]) {
    expect(providerFailureMessage("openrouter", error)).toMatch(
      /unavailable or returned an invalid response/,
    );
    expect(providerFailureMessage("openrouter", error)).not.toContain(
      "sentinel-router-key",
    );
  }
});
