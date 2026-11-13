import { expect, it, vi } from "vitest";
import {
  chatgptFetch,
  chatgptModel,
  ChatgptRequestError,
} from "../src/lib/ai/chatgpt-transport";
import {
  createTrainerGeneration,
  createConversationCompactionGeneration,
} from "../src/lib/ai/provider-generation";
import { chatgptText } from "../src/lib/ai/chatgpt-generation";
import { Output, TypeValidationError } from "ai";
import { z } from "zod";

it("retains only bounded safe request correlation, never raw diagnostic content", () => {
  expect(
    new ChatgptRequestError("request_failed", 403, "req-safe_1").requestId,
  ).toBe("req-safe_1");
  for (const value of ["private\nvalue", "private value", "x".repeat(129)])
    expect(
      new ChatgptRequestError("request_failed", 403, value).requestId,
    ).toBeUndefined();
});
const registrationId = "registration_11111111-1111-4111-8111-111111111111";
const admission = { registrationId, epoch: 1, model: "gpt-6.1-sol" };
const answer = "Use recovery between hard sessions.";
function events(text = answer, tool = false, ending = "response.completed") {
  const item = tool
    ? {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "getSyncStatus",
        namespace: "trainer",
        arguments: "{}",
        status: "completed",
      }
    : {
        type: "message",
        id: "msg_1",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      };
  return [
    {
      type: "response.created",
      response: { id: "resp_1", created_at: 1, model: admission.model },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: tool
        ? { ...item, arguments: "" }
        : { type: "message", id: "msg_1" },
    },
    ...(tool
      ? [
          {
            type: "response.function_call_arguments.delta",
            item_id: "fc_1",
            output_index: 0,
            delta: "{}",
          },
        ]
      : [
          {
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            delta: text,
          },
        ]),
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: ending,
      sequence_number: 5,
      response: {
        id: "resp_1",
        status: ending === "response.completed" ? "completed" : "failed",
        output: [item],
        usage: { input_tokens: 100, output_tokens: 5 },
        ...(ending !== "response.completed"
          ? {
              error: {
                code: "subscription_sharing_usage_limit_exceeded",
                message: "PRIVATE ECHO MUST NOT LEAK",
              },
            }
          : {}),
      },
    },
  ];
}
function sse(values: unknown[]) {
  const content = values
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  const bytes = new TextEncoder().encode(content);
  // Exercise arbitrary UTF8/SSE chunk boundaries, not one event per read.
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 17)
          controller.enqueue(bytes.slice(i, i + 17));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
function setup(values = events()) {
  const credential = vi.fn(async (_operation: string) => ({
    accessToken: "authored-private-token",
  }));
  const network = vi.fn(async () => sse(values));
  const model = chatgptModel(admission, undefined, network, credential);
  return { model, network, credential };
}
it.each(["planner", "final_synthesis"] as const)(
  "actual locked-SDK %s wire uses private account bearer, streaming/developer/history and no forbidden presets",
  async (purpose) => {
    const { model, network, credential } = setup();
    const result = await createTrainerGeneration(model)({
      purpose,
      system: { policy: "Trusted server policy", context: "Fresh grounding" },
      prompt: "Current question",
      conversation: {
        history: [
          { role: "user", content: "Unicode café 🏃" },
          { role: "assistant", content: "Untrusted past answer" },
        ],
        allowSoftLimit: false,
      },
    });
    expect(result.text).toBe(answer);
    expect(result.tokenUsage?.inputTokens).toBe(100);
    expect(network).toHaveBeenCalledTimes(1);
    const [url, init] = network.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer authored-private-token",
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      store: false,
      stream: true,
      model: admission.model,
    });
    expect(body.input[0].role).toBe("developer");
    expect(
      body.input.some((item: { role?: string }) => item.role === "system"),
    ).toBe(false);
    expect(JSON.stringify(body)).toContain("Unicode café 🏃");
    for (const field of [
      "temperature",
      "top_p",
      "max_output_tokens",
      "prompt_cache_options",
      "prompt_cache_retention",
      "reasoning",
      "include",
      "previous_response_id",
      "conversation",
      "metadata",
      "background",
      "user",
      "max_tool_calls",
      "service_tier",
    ])
      expect(body).not.toHaveProperty(field);
    if (purpose === "planner")
      expect(body.tools).toEqual([
        expect.objectContaining({
          type: "namespace",
          name: "trainer",
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: "function",
              name: "runReadOnlySql",
            }),
          ]),
        }),
      ]);
    else expect(body.tools).toBeUndefined();
    expect(credential.mock.calls.map((args) => args[0])).toEqual([
      "credential",
      "current",
    ]);
  },
);
it("namespaced tool response and exact call/result continuation remain paired", async () => {
  const { model, network } = setup(events("", true));
  const result = await createTrainerGeneration(model)({
    purpose: "planner",
    system: "Server policy",
    prompt: "Check sync",
  });
  expect(result.toolCalls).toEqual([
    expect.objectContaining({
      toolCallId: "call_1",
      toolName: "getSyncStatus",
      input: {},
    }),
  ]);
  const next = setup();
  await createTrainerGeneration(next.model)({
    purpose: "final_synthesis",
    system: "Server policy",
    prompt: "Check sync",
    exchanges: [
      {
        callId: "call_1",
        toolName: "getSyncStatus",
        input: {},
        output: "Bounded status",
      },
    ],
  });
  const body = JSON.parse(
    String(
      (next.network.mock.calls[0] as unknown as [string, RequestInit])[1].body,
    ),
  );
  expect(body.input).toContainEqual(
    expect.objectContaining({
      type: "function_call",
      call_id: "call_1",
      name: "getSyncStatus",
      namespace: "trainer",
      arguments: "{}",
    }),
  );
  expect(body.input).toContainEqual(
    expect.objectContaining({
      type: "function_call_output",
      call_id: "call_1",
      output: "Bounded status",
    }),
  );
  expect(network).toHaveBeenCalledTimes(1);
});
it.each(["response.failed", "response.incomplete", "eof"])(
  "%s after text is not successful and never retried",
  async (ending) => {
    const values = events(answer, false, ending);
    if (ending === "eof") values.pop();
    const { model, network } = setup(values);
    await expect(
      createTrainerGeneration(model)({
        purpose: "planner",
        system: "Policy",
        prompt: "Question",
      }),
    ).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "wrong-namespace",
  "unknown-tool",
  "duplicate-call",
  "malformed-arguments",
])("rejects %s before app tool dispatch", async (kind) => {
  const values = events("", true);
  const terminal = values.at(-1)!.response as {
    output: Record<string, unknown>[];
  };
  if (kind === "wrong-namespace") terminal.output[0].namespace = "foreign";
  if (kind === "unknown-tool")
    terminal.output[0].name = "runUnrestrictedCommand";
  if (kind === "duplicate-call")
    terminal.output.push({ ...terminal.output[0] });
  if (kind === "malformed-arguments") terminal.output[0].arguments = "{";
  const { model } = setup(values);
  await expect(
    createTrainerGeneration(model)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    }),
  ).rejects.toThrow();
});
it.each(["summary", "maintenance", "title", "compaction"])(
  "%s uses completed structured streaming without API-key/counting or incompatible parameters",
  async (purpose) => {
    const text =
      purpose === "title"
        ? '{"title":"Recovery"}'
        : purpose === "maintenance"
          ? '{"summary":"Recovery","exclude":[]}'
          : '{"summary":"Recovery"}';
    const { model, network } = setup(events(text));
    if (purpose === "compaction")
      expect(
        await createConversationCompactionGeneration(model).generate(
          "Policy",
          "Sources",
          new AbortController().signal,
        ),
      ).toBe(text);
    else {
      const schema =
        purpose === "title"
          ? z.strictObject({ title: z.string() })
          : purpose === "maintenance"
            ? z.strictObject({
                summary: z.string(),
                exclude: z.array(z.number().int()),
              })
            : z.strictObject({ summary: z.string() });
      expect(
        (
          await chatgptText({
            model,
            system: "Policy",
            prompt: "Sources",
            abortSignal: new AbortController().signal,
            output: Output.object<unknown>({ schema }),
          })
        ).text,
      ).toBe(text);
    }
    const body = JSON.parse(
      String(
        (network.mock.calls[0] as unknown as [string, RequestInit])[1].body,
      ),
    );
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.tools).toBeUndefined();
    expect(body.input[0].role).toBe("developer");
    expect(
      Object.keys(body).every((key) =>
        [
          "model",
          "input",
          "store",
          "stream",
          "parallel_tool_calls",
          "text",
        ].includes(key),
      ),
    ).toBe(true);
  },
);
it("completed inference without counters preserves unknown usage, not invented zeroes", async () => {
  const values = events();
  delete (values.at(-1)!.response as { usage?: unknown }).usage;
  const { model } = setup(values);
  const result = await createTrainerGeneration(model)({
    purpose: "planner",
    system: "Policy",
    prompt: "Question",
  });
  expect(result.text).toBe(answer);
  expect(result.tokenUsage).toBeUndefined();
});
it("classifies locked-SDK schema rejection without retaining provider output", async () => {
  const { model, network } = setup();
  const failed = {
    ...model,
    doStream: async () => {
      throw new TypeValidationError({
        value: "private-provider-output",
        cause: Error("private-detail"),
      });
    },
  };
  await expect(
    createTrainerGeneration(failed)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    }),
  ).rejects.toMatchObject({ code: "response_decoding_failed" });
  expect(network).not.toHaveBeenCalled();
});
it("still rejects a malformed delta that would otherwise lose SDK text", async () => {
  const values = events();
  Object.assign(values[2], { delta: 42 });
  const { model, network } = setup(values);
  await expect(
    createTrainerGeneration(model)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    }),
  ).rejects.toMatchObject({ code: "incomplete_sdk_decoding" });
  expect(network).toHaveBeenCalledTimes(1);
});
it("classifies native credential refusal before a provider request without leaking detail", async () => {
  const network = vi.fn();
  const model = chatgptModel(admission, undefined, network, async () => {
    throw Error("private-native-detail");
  });
  await expect(
    createTrainerGeneration(model)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    }),
  ).rejects.toMatchObject({ code: "connection_unavailable" });
  expect(network).not.toHaveBeenCalled();
});
it("sanitizes nonstandard admission errors and never echoes private detail", async () => {
  const transport = chatgptFetch(
    admission,
    undefined,
    async () => Response.json({ detail: "PRIVATE ECHO" }, { status: 403 }),
    async () => ({ accessToken: "authored-private-token" }),
  );
  const error = await transport("https://api.openai.com/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: admission.model,
      store: false,
      stream: true,
      input: [],
    }),
  }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ChatgptRequestError);
  expect(String(error)).not.toContain("PRIVATE");
  expect(String(error)).toContain("http_403");
});
