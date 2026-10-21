import { afterEach, expect, it, vi } from "vitest";
import { selectedModel } from "../src/lib/ai/providers";
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";

const terminalInput = {
  completion: {
    kind: "coaching",
    answer: "Build intensity gradually and allow recovery.",
    claims: [],
    missingEvidence: [],
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["planner", "final_synthesis"] as const)(
  "serializes exact Luna Responses trainer %s tools and decodes native completion",
  async (purpose) => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL", "gpt-6-luna");
    vi.stubEnv("OPENAI_API_KEY", "sentinel-openai-key");
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "resp-test",
        model: "gpt-6-luna",
        output: [
          {
            type: "function_call",
            id: "fc-test",
            call_id: "call-test",
            name: "completeTrainerTurn",
            arguments: JSON.stringify(terminalInput),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const selection = selectedModel();
    const result = await createTrainerGeneration(selection.model)({
      purpose,
      system: "Use the structured trainer completion contract.",
      prompt: "Give general recovery advice without personal measurements.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer sentinel-openai-key",
    );
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.tool_choice).toBe("auto");
    expect(body.reasoning).toBeUndefined();
    const terminal = body.tools.find(
      (entry: { name: string }) => entry.name === "completeTrainerTurn",
    );
    expect(terminal).toMatchObject({
      type: "function",
      parameters: {
        type: "object",
        required: ["completion"],
        properties: { completion: { type: "object" } },
      },
    });
    if (purpose === "planner") {
      expect(body.parallel_tool_calls).toBe(false);
      expect(body.tools).toContainEqual(
        expect.objectContaining({ name: "runReadOnlySql" }),
      );
      expect(body.tools).toContainEqual(
        expect.objectContaining({ name: "runMathAnalysis" }),
      );
    } else {
      expect(body.tools).toHaveLength(1);
    }
    expect(result.toolCalls?.[0]).toMatchObject({
      toolName: "completeTrainerTurn",
      input: terminalInput,
    });
  },
);

it("forwards exact Flash through the direct DeepSeek trainer adapter", async () => {
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
  vi.stubEnv("DEEPSEEK_API_KEY", "sentinel-deepseek-key");
  const fetchMock = vi.fn(async () =>
    Response.json({
      id: "chat-test",
      object: "chat.completion",
      created: 1,
      model: "deepseek-flash",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-test",
                type: "function",
                function: {
                  name: "completeTrainerTurn",
                  arguments: JSON.stringify(terminalInput),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await createTrainerGeneration(selectedModel().model)({
    purpose: "planner",
    system: "Use structured completion.",
    prompt: "Give general recovery advice.",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
  expect(new Headers(options.headers).get("authorization")).toBe(
    "Bearer sentinel-deepseek-key",
  );
  const body = JSON.parse(String(options.body));
  expect(body.model).toBe("deepseek-flash");
  expect(body.tool_choice).toBe("auto");
  expect(body.tools).toContainEqual(
    expect.objectContaining({
      function: expect.objectContaining({ name: "completeTrainerTurn" }),
    }),
  );
  expect(result.toolCalls?.[0]).toMatchObject({
    toolName: "completeTrainerTurn",
    input: terminalInput,
  });
});
