import { expect, it, vi } from "vitest";
import {
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
import {
  providerFailureDiagnostic,
  providerFailureMessage,
  safeFailureDiagnostic,
} from "../src/lib/ai/provider-errors";
import { debugProviderCall } from "../src/lib/ai/debug-trace";

it("retains only bounded safe request correlation, never raw diagnostic content", () => {
  expect(
    new ChatgptRequestError("request_failed", 403, "req-safe_1").requestId,
  ).toBe("req-safe_1");
  for (const value of [
    "private\nvalue",
    "private value",
    "x".repeat(129),
    "req-safe\n",
    "req-safe\r",
  ])
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
function setup(values = events(), declaredMedia = true) {
  const credential = vi.fn(async (_operation: string) => ({
    accessToken: "authored-private-token",
  }));
  const network = vi.fn(async () => {
    const response = sse(values);
    if (!declaredMedia) response.headers.delete("content-type");
    return response;
  });
  const model = chatgptModel(admission, undefined, network, credential);
  return { model, network, credential };
}
it.each([
  ["planner", true],
  ["planner", false],
  ["final_synthesis", true],
  ["final_synthesis", false],
] as const)(
  "actual locked-SDK %s wire, declared media=%s, requires complete validated SSE/SDK receipt",
  async (purpose, declaredMedia) => {
    const { model, network, credential } = setup(events(), declaredMedia);
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
    expect(new Headers(init.headers).get("accept")).toBe("text/event-stream");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer authored-private-token",
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      store: false,
      stream: true,
      model: admission.model,
    });
    expect(body.parallel_tool_calls).toBe(purpose === "planner");
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
it.each([
  ["response.failed", true],
  ["response.failed", false],
  ["response.incomplete", true],
  ["response.incomplete", false],
  ["eof", true],
  ["eof", false],
] as const)(
  "%s with declared media=%s is not successful and never retried",
  async (ending, declaredMedia) => {
    const values = events(answer, false, ending);
    if (ending === "eof") values.pop();
    const { model, network } = setup(values, declaredMedia);
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
  ["wrong-namespace", true],
  ["wrong-namespace", false],
  ["unknown-tool", true],
  ["unknown-tool", false],
  ["duplicate-call", true],
  ["duplicate-call", false],
  ["malformed-arguments", true],
  ["malformed-arguments", false],
] as const)(
  "rejects %s with declared media=%s before app tool dispatch",
  async (kind, declaredMedia) => {
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
    const { model } = setup(values, declaredMedia);
    await expect(
      createTrainerGeneration(model)({
        purpose: "planner",
        system: "Policy",
        prompt: "Question",
      }),
    ).rejects.toThrow();
  },
);
it.each([
  ["summary", true],
  ["summary", false],
  ["maintenance", true],
  ["maintenance", false],
  ["title", true],
  ["title", false],
  ["compaction", true],
  ["compaction", false],
] as const)(
  "%s with declared media=%s requires completed structured streaming without API-key/counting",
  async (purpose, declaredMedia) => {
    const text =
      purpose === "title"
        ? '{"title":"Recovery"}'
        : purpose === "maintenance"
          ? '{"summary":"Recovery","exclude":[]}'
          : '{"summary":"Recovery"}';
    const { model, network } = setup(events(text), declaredMedia);
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
it("preserves distinct repeated-tool calls and ordered paired outputs through the locked SDK", async () => {
  const first = events("", true);
  const second = events("", true)
    .slice(1, -1)
    .map((event) =>
      JSON.parse(
        JSON.stringify(event)
          .replaceAll("fc_1", "fc_2")
          .replaceAll("call_1", "call_2")
          .replaceAll('"output_index":0', '"output_index":1'),
      ),
    );
  const terminal = first.at(-1)!;
  const receipt = terminal.response as { output: unknown[] };
  receipt.output.push({
    ...(receipt.output[0] as object),
    id: "fc_2",
    call_id: "call_2",
  });
  const { model, network } = setup([
    ...first.slice(0, -1),
    ...second,
    terminal,
  ]);
  const generate = createTrainerGeneration(model);
  const result = await generate({
    purpose: "planner",
    system: { policy: "Stable", context: "Fresh" },
    prompt: "Question",
  });
  expect(result.toolCalls).toMatchObject([
    { toolName: "getSyncStatus", toolCallId: "call_1" },
    { toolName: "getSyncStatus", toolCallId: "call_2" },
  ]);
  await generate({
    purpose: "planner",
    system: { policy: "Stable", context: "Fresh follow-up" },
    prompt: "Question",
    exchanges: [
      {
        callId: "call_1",
        toolName: "getSyncStatus",
        input: {},
        output: "first result",
      },
      {
        callId: "call_2",
        toolName: "getSyncStatus",
        input: {},
        output: "second result",
      },
    ],
  });
  const bodies = network.mock.calls.map((call) =>
    JSON.parse(String((call as unknown as [string, RequestInit])[1].body)),
  );
  expect(bodies[0].parallel_tool_calls).toBe(true);
  expect(bodies[0].input[0]).toEqual(bodies[1].input[0]);
  expect(bodies[0].tools).toEqual(bodies[1].tools);
  expect(bodies[1].input.slice(-4)).toMatchObject([
    { type: "function_call", call_id: "call_1", name: "getSyncStatus" },
    { type: "function_call_output", call_id: "call_1", output: "first result" },
    { type: "function_call", call_id: "call_2", name: "getSyncStatus" },
    {
      type: "function_call_output",
      call_id: "call_2",
      output: "second result",
    },
  ]);
});

it.each([undefined, 0, 80])(
  "keeps subscription wire cache-counter presence through the locked SDK: %s",
  async (cached) => {
    const values = events();
    Object.assign(values.at(-1)!.response!, {
      usage: {
        input_tokens: 100,
        output_tokens: 5,
        ...(cached !== undefined
          ? { input_tokens_details: { cached_tokens: cached } }
          : {}),
      },
    });
    const { model } = setup(values);
    const result = await createTrainerGeneration(model)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    });
    if (cached === undefined) {
      expect(result.tokenUsage?.cacheReadTokens).toBeUndefined();
      expect(JSON.parse(JSON.stringify(result.tokenUsage))).not.toHaveProperty(
        "cacheReadTokens",
      );
    } else expect(result.tokenUsage?.cacheReadTokens).toBe(cached);
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
  ).rejects.toMatchObject({
    code: "incomplete_sdk_decoding",
    failure: {
      stage: "sdk_decode",
      status: 200,
      elapsedMs: expect.any(Number),
    },
  });
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
it.each([
  [
    { object: "response", status: "completed", output: "PRIVATE DETAIL" },
    "json_completed",
  ],
  [{ object: "response", status: "in_progress" }, "json_incomplete"],
  [{ error: { message: "PRIVATE DETAIL" } }, "json_error"],
  [{ unexpected: "PRIVATE DETAIL" }, "json_other"],
] as const)(
  "non-stream response keeps only a closed shape category, never accepts JSON as stream success: %s",
  async (body, kind) => {
    const model = chatgptModel(
      admission,
      undefined,
      async () => Response.json(body),
      async () => ({ accessToken: "authored-private-token" }),
    );
    const error = await createTrainerGeneration(model)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ChatgptRequestError);
    expect((error as ChatgptRequestError).code).toBe(
      `unsupported_response_200_${kind}`,
    );
    expect(String(error)).not.toContain("PRIVATE");
  },
);
it.each([
  ["", "missing_completion"],
  ["data: PRIVATE DETAIL\n\n", "malformed_stream"],
  ['{"object":"response","status":"completed"}', "missing_completion"],
] as const)(
  "absent media type still refuses empty, malformed and JSON-as-stream bodies without private echo: %s",
  async (body, kind) => {
    const model = chatgptModel(
      admission,
      undefined,
      async () => new Response(new TextEncoder().encode(body)),
      async () => ({ accessToken: "authored-private-token" }),
    );
    const error = await createTrainerGeneration(model)({
      purpose: "planner",
      system: "Policy",
      prompt: "Question",
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ChatgptRequestError);
    expect((error as ChatgptRequestError).code).toBe(kind);
    expect(String(error)).not.toContain("PRIVATE");
  },
);
it("sanitizes nonstandard admission errors and never echoes private detail", async () => {
  const model = chatgptModel(
    admission,
    undefined,
    async () => Response.json({ detail: "PRIVATE ECHO" }, { status: 403 }),
    async () => ({ accessToken: "authored-private-token" }),
  );
  const error = await createTrainerGeneration(model)({
    purpose: "planner",
    system: "Policy",
    prompt: "Question",
  }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ChatgptRequestError);
  expect(String(error)).not.toContain("PRIVATE");
  expect(String(error)).toContain("http_403");
});

const privateMarker = "private_token_prompt_account_https_path";
const question = {
  purpose: "planner" as const,
  system: "Policy",
  prompt: "Question",
};
function projected(error: unknown) {
  return debugProviderCall({
    index: 1,
    purpose: "planner",
    error: providerFailureMessage("chatgpt", error),
    failure: providerFailureDiagnostic("chatgpt", error),
  });
}
it.each([
  "upstream_request",
  "upstream_read",
  "native_credential",
  "native_final_current",
  "local_admission",
  "stream_validation",
] as const)(
  "locked SDK retains safe observed %s boundary with no replay",
  async (stage) => {
    const network = vi.fn(async () => {
      if (stage === "upstream_request") throw Error(privateMarker);
      if (stage === "upstream_read")
        return new Response(
          new ReadableStream({
            pull(c) {
              c.error(Error(privateMarker));
            },
          }),
          {
            headers: {
              "content-type": "text/event-stream",
              "x-request-id": "req-safe_1",
            },
          },
        );
      const result = sse(
        stage === "stream_validation"
          ? [{ type: "error", code: privateMarker, message: privateMarker }]
          : events(),
      );
      result.headers.set("x-request-id", "req-safe_1");
      return result;
    });
    const credential = vi.fn(async (operation: string) => {
      if (
        stage === "native_credential" ||
        (stage === "native_final_current" && operation === "current")
      )
        throw Error(privateMarker);
      return { accessToken: privateMarker };
    });
    const model = chatgptModel(
      admission,
      () => {
        if (stage === "local_admission") throw privateMarker;
      },
      network,
      credential,
    );
    const error = await createTrainerGeneration(model)(question).catch(
      (e: unknown) => e,
    );
    const call = projected(error);
    expect(call.failure).toMatchObject({
      stage,
      elapsedMs: expect.any(Number),
    });
    if (
      ["upstream_read", "native_final_current", "stream_validation"].includes(
        stage,
      )
    )
      expect(call.failure).toMatchObject({
        status: 200,
        requestId: "req-safe_1",
      });
    expect(JSON.stringify(call)).not.toContain(privateMarker);
    expect(call.tokenUsage).toBeUndefined();
    expect(network).toHaveBeenCalledTimes(
      ["native_credential", "local_admission"].includes(stage) ? 0 : 1,
    );
  },
);
it.each([0, 1, 4])(
  "read failure after %i authored events remains an upstream read, never accepted partial success",
  async (count) => {
    const bytes = new TextEncoder().encode(
      events()
        .slice(0, count)
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join(""),
    );
    let sent = false;
    const network = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              if (!sent) {
                sent = true;
                c.enqueue(bytes);
              } else c.error(privateMarker);
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const error = await createTrainerGeneration(
      chatgptModel(admission, undefined, network, async () => ({
        accessToken: privateMarker,
      })),
    )(question).catch((e: unknown) => e);
    expect(projected(error).failure?.stage).toBe("upstream_read");
    expect(network).toHaveBeenCalledTimes(1);
  },
);
it.each([false, true])(
  "idle polling invalidation and caller-abort race, caller first=%s",
  async (callerFirst) => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      let rejectPoll!: (e: unknown) => void;
      const credential = vi.fn(async (operation: string) => {
        if (operation === "current")
          await new Promise((_, reject) => {
            rejectPoll = reject;
          });
        return { accessToken: privateMarker };
      });
      const network = vi.fn(
        async (_url: unknown, init?: RequestInit) =>
          new Response(
            new ReadableStream({
              start(c) {
                init!.signal!.addEventListener(
                  "abort",
                  () => c.error(Error(privateMarker)),
                  { once: true },
                );
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      );
      const result = chatgptText({
        model: chatgptModel(admission, undefined, network, credential),
        system: "Policy",
        prompt: "Question",
        abortSignal: caller.signal,
      }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      if (callerFirst) caller.abort();
      rejectPoll(Error(privateMarker));
      await vi.advanceTimersByTimeAsync(0);
      const error = await result;
      // The SDK can settle caller cancellation without an error event; still fail closed.
      expect(projected(error).failure?.stage).toBe(
        callerFirst ? "aborted" : "native_poll",
      );
      expect(network).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(projected(error))).not.toContain(privateMarker);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);
it("cancels a pending poll before final verification and ignores its late failure", async () => {
  vi.useFakeTimers();
  try {
    let rejectPoll!: (error: Error) => void;
    let releaseResponse!: () => void;
    let pollSignal: AbortSignal | undefined;
    let currents = 0;
    const credential = vi.fn(
      async (
        operation: string,
        _id: string,
        _epoch: number,
        signal: AbortSignal,
      ) => {
        if (operation === "credential") return { accessToken: privateMarker };
        currents += 1;
        if (currents === 1) {
          pollSignal = signal;
          await new Promise<void>((_, reject) => {
            rejectPoll = reject;
          });
        }
        return {};
      },
    );
    const network = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      return sse(events());
    });
    const result = createTrainerGeneration(
      chatgptModel(admission, undefined, network, credential),
    )(question);
    await vi.advanceTimersByTimeAsync(1000);
    releaseResponse();
    const output = await result;
    expect(output.text).toBe(answer);
    expect(pollSignal?.aborted).toBe(true);
    expect(currents).toBe(2);
    rejectPoll(Error(privateMarker));
    await vi.advanceTimersByTimeAsync(0);
    expect(network).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it.each(["x".repeat(129), "req safe", "req\tbad"])(
  "rejects the entire invalid request id rather than accepting a truncated prefix: %s",
  async (id) => {
    const network = vi.fn(async () => {
      const r = sse([{ type: "error", code: privateMarker }]);
      r.headers.set("x-request-id", id);
      return r;
    });
    const error = await createTrainerGeneration(
      chatgptModel(admission, undefined, network, async () => ({
        accessToken: privateMarker,
      })),
    )(question).catch((e: unknown) => e);
    expect(projected(error).failure?.requestId).toBeUndefined();
    expect(projected(error).failure?.category).toBe("request_failed");
    expect(JSON.stringify(projected(error))).not.toContain(privateMarker);
  },
);
it("neutral diagnostic projection rejects hostile fields and invalid bounds without trusting legacy message text", () => {
  const failure = safeFailureDiagnostic({
    category: privateMarker,
    stage: "upstream_read",
    status: 999,
    elapsedMs: Infinity,
    requestId: "x".repeat(129),
    message: privateMarker,
    cause: { token: privateMarker },
  });
  expect(failure).toEqual({
    category: "request_failed",
    stage: "upstream_read",
  });
  for (const category of ["http_403\n", "unsupported_response_200_json\n"])
    expect(new ChatgptRequestError(category).code).toBe("request_failed");
  expect(
    safeFailureDiagnostic({ category: "request_failed", stage: privateMarker }),
  ).toBeUndefined();
  for (const elapsedMs of [-1, 0.5, NaN, 86400001])
    expect(
      safeFailureDiagnostic({
        category: "request_failed",
        stage: "generation",
        elapsedMs,
      })?.elapsedMs,
    ).toBeUndefined();
  expect(
    providerFailureMessage(
      "chatgpt",
      Error(`ChatGPT plan request unavailable (${privateMarker}).`),
    ),
  ).not.toContain(privateMarker);
});
