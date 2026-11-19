import { safeFailureDiagnostic as projectFailureDiagnostic } from "../src/lib/diagnostics/provider-failure";
function safeReceiptDiagnostic(value: unknown) {
  return projectFailureDiagnostic({
    category: "incomplete_sdk_decoding",
    stage: "sdk_decode",
    receipt: value,
  })?.receipt;
}
import { expect, it, vi } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { chatgptText } from "../src/lib/ai/chatgpt-generation";
import { chatgptModel } from "../src/lib/ai/chatgpt-transport";
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";
import {
  providerFailureDiagnostic,
  providerFailureMessage,
  safeFailureDiagnostic,
} from "../src/lib/ai/provider-errors";
import { debugProviderCall } from "../src/lib/ai/debug-trace";

// Realistic Responses SSE through the actual locked @ai-sdk/openai + ai stack:
// created / added / content or argument deltas / done / completed boundaries.
const admission = {
  registrationId: "registration_11111111-1111-4111-8111-111111111111",
  epoch: 1,
  model: "gpt-6.1-sol",
};
const privateMarker = "private_token_prompt_account_https_path";
type Item = Record<string, unknown>;
type Output = { added: Item; deltas: Item[]; done: Item };
function call(over: Item = {}): Item {
  return {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "getSyncStatus",
    namespace: "trainer",
    arguments: "{}",
    status: "completed",
    ...over,
  };
}
function withoutId(item: Item): Item {
  const rest = { ...item };
  delete rest.id;
  return rest;
}
function toolOutput(done: Item, added: Item = done): Output {
  const args = String(done.arguments);
  return {
    added: { ...added, arguments: "", status: "in_progress" },
    deltas: [
      {
        type: "response.function_call_arguments.delta",
        item_id: done.id ?? "fc_unidentified",
        delta: args.slice(0, 1),
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: done.id ?? "fc_unidentified",
        delta: args.slice(1),
      },
    ],
    done,
  };
}
function message(text: string, id = "msg_1", phase?: string): Item {
  return {
    type: "message",
    id,
    role: "assistant",
    status: "completed",
    ...(phase ? { phase } : {}),
    content: [{ type: "output_text", text, annotations: [] }],
  };
}
function textOutput(streamed: string, done: Item): Output {
  const id = String(done.id);
  return {
    added: { ...done, status: "in_progress", content: [] },
    deltas: [...streamed].map((delta) => ({
      type: "response.output_text.delta",
      item_id: id,
      content_index: 0,
      delta,
      logprobs: [],
    })),
    done,
  };
}
function stream(
  outputs: Output[],
  terminal = outputs.map((o) => o.done),
  change: (events: Item[]) => void = () => {},
) {
  const values: Item[] = [
    {
      type: "response.created",
      sequence_number: 0,
      response: { id: "resp_1", created_at: 1, model: admission.model },
    },
  ];
  outputs.forEach((output, index) => {
    values.push({
      type: "response.output_item.added",
      output_index: index,
      item: output.added,
    });
    for (const delta of output.deltas)
      values.push({ output_index: index, ...delta });
    values.push({
      type: "response.output_item.done",
      output_index: index,
      item: output.done,
    });
  });
  values.push({
    type: "response.completed",
    response: {
      id: "resp_1",
      object: "response",
      status: "completed",
      output: terminal,
      usage: { input_tokens: 40, output_tokens: 6 },
    },
  });
  change(values);
  // Multibyte UTF-8 and CRLF framing split at arbitrary byte boundaries.
  const bytes = new TextEncoder().encode(
    values
      .map((v) => `event: x\r\ndata: ${JSON.stringify(v)}\r\n\r\n`)
      .join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 13)
          controller.enqueue(bytes.slice(i, i + 13));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function generate(response: () => Response) {
  const network = vi.fn(async () => response());
  const model = chatgptModel(admission, undefined, network, async () => ({
    accessToken: privateMarker,
  }));
  const result = await createTrainerGeneration(model)({
    purpose: "planner",
    system: "Policy",
    prompt: "Question",
  }).catch((error: unknown) => ({ error }));
  return { result, network };
}
function projected(error: unknown) {
  return debugProviderCall({
    index: 1,
    purpose: "planner",
    error: providerFailureMessage("chatgpt", error),
    failure: providerFailureDiagnostic("chatgpt", error),
  });
}

it.each([
  [
    "missing message ID",
    () => {
      const output = textOutput("Hi", message("Hi"));
      delete output.added.id;
      return output;
    },
  ],
  [
    "unsupported message phase",
    () => {
      const output = textOutput("Hi", message("Hi"));
      output.added.phase = privateMarker;
      return output;
    },
  ],
  [
    "rotating message identity",
    () => {
      const output = textOutput("Hi", message("Hi"));
      output.added.id = `msg_${privateMarker}`;
      return output;
    },
  ],
] as const)(
  "locked SDK %s has closed lifecycle evidence",
  async (_label, output) => {
    const { result, network } = await generate(() => stream([output()]));
    const error = (result as { error: unknown }).error;
    expect(projected(error).failure).toMatchObject({
      category: "sdk_text_lifecycle_failed",
      stage: "sdk_decode",
      status: 200,
    });
    expect(JSON.stringify(projected(error))).not.toContain(privateMarker);
    expect(network).toHaveBeenCalledTimes(1);
  },
);

it("counts actual SDK fallback of known kinds independently of receipt differences", async () => {
  const output = toolOutput(call({ id: 7 }));
  const { result } = await generate(() => stream([output], [call()]));
  expect(projected((result as { error: unknown }).error).failure).toMatchObject(
    {
      category: "incomplete_sdk_decoding",
      dropped: [
        { kind: "response.output_item.added", count: 1 },
        { kind: "response.output_item.done", count: 1 },
      ],
      receipt: { calls: "mismatch", callDifferences: ["count"] },
    },
  );
});

it.each([
  ["added and done", true],
  ["done only", false],
] as const)(
  "id-less namespaced function_call (%s) decodes to the exact provider call",
  async (_label, addedWithoutId) => {
    const done = withoutId(call({ arguments: '{"availabilityLimit":4}' }));
    const { result, network } = await generate(() =>
      stream([
        textOutput(
          "Checking 🏃 é.",
          message("Checking 🏃 é.", "msg_1", "commentary"),
        ),
        toolOutput(
          done,
          addedWithoutId
            ? done
            : call({ arguments: '{"availabilityLimit":4}' }),
        ),
      ]),
    );
    expect(result).not.toHaveProperty("error");
    expect(result).toMatchObject({
      text: "Checking 🏃 é.",
      toolCalls: [
        {
          toolCallId: "call_1",
          toolName: "getSyncStatus",
          input: { availabilityLimit: 4 },
        },
      ],
      tokenUsage: { inputTokens: 40, outputTokens: 6 },
    });
    expect(network).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ["wrong namespace", { namespace: "foreign" }, "unsupported_tool_call"],
  ["absent namespace", { namespace: undefined }, "unsupported_tool_call"],
  ["unknown tool", { name: "runUnrestrictedCommand" }, "unsupported_tool_call"],
  ["incomplete status", { status: "incomplete" }, "unsupported_tool_call"],
  ["non-object arguments", { arguments: "[]" }, "malformed_tool_arguments"],
  ["malformed arguments", { arguments: "{" }, "malformed_tool_arguments"],
  ["missing call_id", { call_id: undefined }, "unsupported_tool_call"],
] as const)(
  "id-less repair never admits a %s call",
  async (_label, over, code) => {
    const done = withoutId(call(over));
    const { result, network } = await generate(() =>
      stream([toolOutput(done)]),
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: { code?: string } }).error.code).toBe(code);
    expect(network).toHaveBeenCalledTimes(1);
  },
);

it("id-less duplicate call ids are refused before tool dispatch", async () => {
  const done = withoutId(call());
  const { result } = await generate(() =>
    stream([toolOutput(done), toolOutput(done)]),
  );
  expect((result as { error: { code?: string } }).error.code).toBe(
    "unsupported_tool_call",
  );
});

it.each([
  [
    "same-length different text",
    () => stream([textOutput("Hi Ann", message("Hi Bob"))]),
    { text: "different", calls: "match", observedCalls: 0, receiptCalls: 0 },
  ],
  [
    "truncated observed text",
    () => stream([textOutput("Hi", message("Hi there"))]),
    { text: "observed_prefix", calls: "match" },
  ],
  [
    "streamed text contradicted by a nonempty terminal output",
    () =>
      stream(
        [textOutput("Hi", message("Hi"))],
        [{ ...message(""), content: [] }],
      ),
    { text: "receipt_empty", calls: "match" },
  ],
  [
    "same-length different arguments",
    () =>
      stream(
        [toolOutput(call({ arguments: '{"availabilityLimit":4}' }))],
        [call({ arguments: '{"availabilityLimit":5}' })],
      ),
    {
      text: "match",
      calls: "mismatch",
      observedCalls: 1,
      receiptCalls: 1,
      callDifferences: ["arguments"],
    },
  ],
  [
    "different call identity",
    () => stream([toolOutput(call())], [call({ call_id: "call_2" })]),
    { calls: "mismatch", callDifferences: ["id"] },
  ],
  [
    "different tool name",
    () =>
      stream([toolOutput(call())], [call({ name: "describeGarminDatabase" })]),
    { calls: "mismatch", callDifferences: ["name"] },
  ],
  [
    "reordered calls",
    () =>
      stream(
        [
          toolOutput(call()),
          toolOutput(call({ id: "fc_2", call_id: "call_2" })),
        ],
        [call({ id: "fc_2", call_id: "call_2" }), call()],
      ),
    {
      calls: "mismatch",
      observedCalls: 2,
      receiptCalls: 2,
      callDifferences: ["order"],
    },
  ],
  [
    "a call the SDK dropped",
    () => stream([toolOutput(call({ id: 7 }))], [call()]),
    {
      calls: "mismatch",
      observedCalls: 0,
      receiptCalls: 1,
      callDifferences: ["count"],
    },
  ],
  [
    "simultaneous text and call differences",
    () =>
      stream(
        [
          textOutput("Hi Ann", message("Hi Ann")),
          toolOutput(
            call({ id: "fc_2", arguments: '{"availabilityLimit":4}' }),
          ),
        ],
        [
          message("Hi Bob"),
          call({ id: "fc_2", arguments: '{"availabilityLimit":5}' }),
        ],
      ),
    {
      text: "different",
      calls: "mismatch",
      observedCalls: 1,
      receiptCalls: 1,
      callDifferences: ["arguments"],
    },
  ],
] as const)(
  "%s stays rejected with closed receipt dimensions only",
  async (_label, response, receipt) => {
    const { result, network } = await generate(response);
    const error = (result as { error?: unknown }).error;
    expect(error).toMatchObject({ code: "incomplete_sdk_decoding" });
    const projection = projected(error);
    expect(projection.failure).toMatchObject({
      category: "incomplete_sdk_decoding",
      stage: "sdk_decode",
      status: 200,
      receipt: { receipt: "present", ...receipt },
    });
    expect(projection.tokenUsage).toBeUndefined();
    expect(network).toHaveBeenCalledTimes(1);
  },
);

it.each([
  "response.output_item.added",
  "response.output_item.done",
  "response.output_text.delta",
])("actual SDK handler oracle for %s fallback", async (kind) => {
  const model = createOpenAI({
    apiKey: "authored",
    fetch: async () =>
      stream([textOutput("Hi", message("Hi"))], undefined, (events) => {
        for (const event of events)
          if (event.type === kind) {
            if (kind === "response.output_text.delta") event.delta = 7;
            else (event.item as Item).id = 7;
          }
      }),
  }).responses(admission.model);
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "Question" }] }],
    includeRawChunks: true,
  });
  let pending = false,
    emitted = false,
    drops = 0;
  const reader = result.stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const part = next.value;
    if (part.type === "raw") {
      if (pending && !emitted) drops++;
      pending = (part.rawValue as Item).type === kind;
      emitted = false;
    } else emitted = true;
  }
  expect(drops).toBe(kind === "response.output_text.delta" ? 2 : 1);
});

it("repeated malformed deltas count actual fallback, not valid ignored or future events", async () => {
  const { result } = await generate(() =>
    stream([textOutput("Hi", message("Hi"))], undefined, (events) => {
      for (const event of events)
        if (event.type === "response.output_text.delta")
          event.delta = { privateMarker };
      events.splice(
        1,
        0,
        { type: "response.content_part.added", privateMarker },
        { type: `future_${privateMarker}`, privateMarker },
      );
    }),
  );
  expect(projected((result as { error: unknown }).error).failure).toMatchObject(
    {
      dropped: [{ kind: "response.output_text.delta", count: 2 }],
      receipt: { text: "observed_empty" },
    },
  );
  expect(
    JSON.stringify(projected((result as { error: unknown }).error)),
  ).not.toContain(privateMarker);
});

it("retains actual drops before a typed upstream error without replacing its precedence", async () => {
  let release!: () => void;
  const consumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const network = vi.fn(async () => {
    const invalid = {
      added: { type: "message", id: 7 },
      done: { type: "message", id: 7 },
      deltas: [],
    };
    const wire = await stream(
      [invalid, textOutput("Hi", message("Hi"))],
      undefined,
      (events) => {
        events[events.length - 1] = {
          type: "response.failed",
          response: {
            error: { code: "private-error", message: privateMarker },
          },
        };
      },
    ).text();
    const at = wire.lastIndexOf("event: x");
    return new Response(
      new ReadableStream({
        start(out) {
          out.enqueue(new TextEncoder().encode(wire.slice(0, at)));
          // Fail only once actual SDK text consumption proves preceding handlers ran.
          consumed
            .then(() => {
              out.enqueue(new TextEncoder().encode(wire.slice(at)));
              out.close();
            })
            .catch((error: unknown) => out.error(error));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const error = await chatgptText({
    model: chatgptModel(admission, undefined, network, async () => ({
      accessToken: privateMarker,
    })),
    system: "Policy",
    prompt: "Question",
    onChunk: ({ chunk }: { chunk: { type: string } }) => {
      if (chunk.type === "text-delta") release();
    },
    onError: () => {},
  }).catch((error: unknown) => error);
  const failure = projected(error).failure;
  expect(failure).toMatchObject({
    category: "request_failed",
    stage: "stream_validation",
    status: 200,
    dropped: [
      { kind: "response.output_item.added", count: 1 },
      { kind: "response.output_item.done", count: 1 },
    ],
  });
  expect(JSON.stringify(failure)).not.toContain(privateMarker);
});

it("empty message identity remains an existing SDK success, not a new rejection", async () => {
  const { result } = await generate(() =>
    stream([textOutput("Hi", message("Hi", ""))]),
  );
  expect(result).toMatchObject({ text: "Hi", toolCalls: [] });
  expect(result).not.toHaveProperty("error");
});

it("observed drops alone do not reject an otherwise exact successful result", async () => {
  const { result, network } = await generate(() =>
    stream([textOutput("Hi", message("Hi"))], undefined, (events) => {
      events.splice(2, 0, {
        type: "response.output_text.delta",
        item_id: "msg_1",
        delta: 7,
      });
    }),
  );
  expect(result).toMatchObject({
    text: "Hi",
    toolCalls: [],
    tokenUsage: { inputTokens: 40, outputTokens: 6 },
  });
  expect(result).not.toHaveProperty("error");
  expect(network).toHaveBeenCalledTimes(1);
});

const responseId = "resp_67bd65392a088191a3b802a61f4fba14";
it.each([
  responseId,
  undefined,
  `resp_${privateMarker}`,
  `${responseId}\n`,
  `${responseId}extra`,
  "resp_" + "a".repeat(129),
  7,
])(
  "projects whole created correlation only for the supported format: %s",
  async (id) => {
    const { result } = await generate(() => {
      const response = stream(
        [textOutput("Hi", message("Other"))],
        undefined,
        (events) => {
          (events[0].response as Item).id = id;
        },
      );
      response.headers.set("x-request-id", "req_safe");
      return response;
    });
    const failure = projected((result as { error: unknown }).error).failure;
    expect(failure?.requestId).toBe("req_safe");
    expect(failure?.responseCorrelation).toEqual(
      id === responseId ? { source: "response.created", id } : undefined,
    );
  },
);
it("contradictory created identities suppress correlation without changing receipt rejection", async () => {
  const { result } = await generate(() =>
    stream([textOutput("Hi", message("Other"))], undefined, (events) => {
      (events[0].response as Item).id = responseId;
      events.splice(1, 0, {
        type: "response.created",
        response: {
          id: "resp_" + "a".repeat(32),
          created_at: 1,
          model: admission.model,
        },
      });
    }),
  );
  expect(projected((result as { error: unknown }).error).failure).toMatchObject(
    { category: "incomplete_sdk_decoding" },
  );
  expect(
    projected((result as { error: unknown }).error).failure
      ?.responseCorrelation,
  ).toBeUndefined();
});
it("optional closed dimensions omit invalid nested values whole, retaining independent facts", () => {
  const base = {
    category: "sdk_text_lifecycle_failed",
    stage: "sdk_decode",
    status: 200,
  };
  const valid = [{ kind: "response.output_text.delta", count: 2 }];
  for (const dropped of [
    [],
    [{ kind: privateMarker, count: 1 }],
    [{ kind: "response.output_text.delta", count: -1 }],
    [{ kind: "response.output_text.delta", count: 131073 }],
    [{ kind: "response.output_text.delta", count: Infinity }],
    [{ kind: "response.output_text.delta", count: 1, privateMarker }],
    [...valid, ...valid],
  ])
    expect(safeFailureDiagnostic({ ...base, dropped })).toEqual(base);
  for (const responseCorrelation of [
    { source: privateMarker, id: responseId },
    { source: "response.created", id: responseId, privateMarker },
    { source: "response.created", id: responseId + "\n" },
  ])
    expect(
      safeFailureDiagnostic({ ...base, dropped: valid, responseCorrelation }),
    ).toEqual({ ...base, dropped: valid });
});

it("hostile values in text, arguments, IDs and credentials never enter receipt diagnostics", async () => {
  const hostile = call({
    id: `fc_${privateMarker}`,
    call_id: `call_${privateMarker}`,
    arguments: JSON.stringify({ note: privateMarker }),
  });
  const { result } = await generate(() =>
    stream(
      [
        textOutput(
          privateMarker,
          message(privateMarker, `msg_${privateMarker}`),
        ),
        toolOutput(hostile),
      ],
      [
        message(`${privateMarker}!`, `msg_${privateMarker}`),
        {
          ...hostile,
          arguments: JSON.stringify({ note: `${privateMarker}!` }),
        },
      ],
    ),
  );
  const error = (result as { error: unknown }).error;
  const projection = projected(error);
  expect(projection.failure?.receipt).toEqual({
    receipt: "present",
    text: "observed_prefix",
    calls: "mismatch",
    observedCalls: 1,
    receiptCalls: 1,
    callDifferences: ["arguments"],
  });
  expect(JSON.stringify(projection)).not.toContain(privateMarker);
  expect(String(error)).not.toContain(privateMarker);
});

it("receipt projection validates the whole closed value and omits anything else", () => {
  const valid = {
    receipt: "present",
    text: "different",
    calls: "mismatch",
    observedCalls: 0,
    receiptCalls: 1,
    callDifferences: ["count", "arguments"],
  };
  const base = { category: "incomplete_sdk_decoding", stage: "sdk_decode" };
  expect(safeFailureDiagnostic({ ...base, receipt: valid })?.receipt).toEqual(
    valid,
  );
  expect(
    safeFailureDiagnostic({ ...base, receipt: { receipt: "absent" } })?.receipt,
  ).toEqual({ receipt: "absent" });
  const invalid: unknown[] = [
    null,
    [],
    privateMarker,
    { receipt: "absent", detail: privateMarker },
    { ...valid, detail: privateMarker },
    { ...valid, text: privateMarker },
    { ...valid, text: "match", calls: "match", callDifferences: undefined },
    { ...valid, calls: "maybe" },
    { ...valid, observedCalls: -1 },
    { ...valid, observedCalls: 0.5 },
    { ...valid, observedCalls: Infinity },
    { ...valid, observedCalls: "0" },
    { ...valid, receiptCalls: 32769 },
    { ...valid, callDifferences: [] },
    { ...valid, callDifferences: ["arguments", "count"] },
    { ...valid, callDifferences: ["count", "count"] },
    { ...valid, callDifferences: ["count", privateMarker] },
    { ...valid, callDifferences: "count" },
    { ...valid, callDifferences: ["arguments"] },
    { ...valid, observedCalls: 1, callDifferences: ["count"] },
    {
      ...valid,
      calls: "match",
      observedCalls: 1,
      receiptCalls: 1,
      callDifferences: ["id"],
    },
    { ...valid, calls: "match", observedCalls: 0, callDifferences: undefined },
  ];
  for (const receipt of invalid) {
    expect(safeReceiptDiagnostic(receipt)).toBeUndefined();
    const failure = safeFailureDiagnostic({ ...base, receipt });
    expect(failure).toEqual(base);
    expect(JSON.stringify(failure)).not.toContain(privateMarker);
  }
  // Receipt facts belong only to the receipt decision boundary.
  for (const other of [
    { category: "incomplete_sdk_decoding", stage: "stream_validation" },
    { category: "response_decoding_failed", stage: "sdk_decode" },
  ])
    expect(
      safeFailureDiagnostic({ ...other, receipt: valid }),
    ).not.toHaveProperty("receipt");
});

function idlessThen(boundary: "eof" | "after" | "failed") {
  return async () => {
    const text = await stream([toolOutput(withoutId(call()))]).text();
    const terminal = text.lastIndexOf("event: x");
    const body =
      boundary === "eof"
        ? text.slice(0, terminal)
        : boundary === "failed"
          ? text.slice(0, terminal) +
            `data: ${JSON.stringify({ type: "response.failed", sequence_number: 9, response: {} })}\n\n`
          : text +
            `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "m", delta: "x" })}\n\n`;
    return new Response(body, {
      headers: { "content-type": "text/event-stream" },
    });
  };
}
it.each([
  ["EOF before completion", "eof", "missing_completion"],
  ["events after completion", "after", "events_after_completion"],
  ["failed terminal", "failed", "request_failed"],
] as const)(
  "id-less call with %s is never admitted",
  async (_label, boundary, code) => {
    const network = vi.fn(idlessThen(boundary));
    const error = await createTrainerGeneration(
      chatgptModel(admission, undefined, network, async () => ({
        accessToken: privateMarker,
      })),
    )({ purpose: "planner", system: "Policy", prompt: "Question" }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code });
    expect(network).toHaveBeenCalledTimes(1);
  },
);

it("id-less call still fails a stale final native current check", async () => {
  const network = vi.fn(async () => stream([toolOutput(withoutId(call()))]));
  const credential = vi.fn(async (operation: string) => {
    if (operation === "current") throw Error(privateMarker);
    return { accessToken: privateMarker };
  });
  const error = await createTrainerGeneration(
    chatgptModel(admission, undefined, network, credential),
  )({ purpose: "planner", system: "Policy", prompt: "Question" }).catch(
    (e: unknown) => e,
  );
  expect(projected(error).failure).toMatchObject({
    category: "connection_invalidated",
    stage: "native_final_current",
  });
  expect(JSON.stringify(projected(error))).not.toContain(privateMarker);
});

it.each([
  [
    "text",
    () => [textOutput("Recovery 🏃 first.", message("Recovery 🏃 first."))],
  ],
  [
    "reasoning, preamble and id-less namespaced call",
    () => [
      {
        added: { type: "reasoning", id: "rs_1", summary: [] },
        deltas: [],
        done: {
          type: "reasoning",
          id: "rs_1",
          summary: [],
          encrypted_content: null,
        },
      },
      textOutput("Checking.", message("Checking.", "msg_1", "commentary")),
      toolOutput(withoutId(call({ arguments: '{"availabilityLimit":4}' }))),
    ],
  ],
] as const)(
  "subscription completed without terminal output uses completed output items as receipt: %s",
  async (label, outputs) => {
    for (const terminal of [undefined, []]) {
      const { result, network } = await generate(() => {
        const items = outputs() as Output[];
        const response = stream(items, terminal as unknown as Item[]);
        return response;
      });
      expect(result).not.toHaveProperty("error");
      if (label === "text")
        expect(result).toMatchObject({
          text: "Recovery 🏃 first.",
          toolCalls: [],
        });
      else
        expect(result).toMatchObject({
          text: "Checking.",
          toolCalls: [
            {
              toolCallId: "call_1",
              toolName: "getSyncStatus",
              input: { availabilityLimit: 4 },
            },
          ],
        });
      expect(network).toHaveBeenCalledTimes(1);
    }
  },
);

it.each([
  ["wrong namespace", { namespace: "foreign" }, "unsupported_tool_call"],
  ["malformed arguments", { arguments: "{" }, "malformed_tool_arguments"],
] as const)(
  "item-derived receipt still refuses a %s call",
  async (_label, over, code) => {
    // added passes the stream check; only the done item is invalid.
    const done = call(over);
    const { result } = await generate(() =>
      stream(
        [
          {
            ...toolOutput(done),
            added: { ...call(), arguments: "", status: "in_progress" },
          },
        ],
        [],
      ),
    );
    expect((result as { error: { code?: string } }).error.code).toBe(code);
  },
);

it("duplicate or out-of-range output_index is refused, never merged", async () => {
  for (const index of [0, -1, 5000]) {
    const network = vi.fn(async () => {
      const text = await stream([textOutput("Hi", message("Hi"))], []).text();
      const extra = `data: ${JSON.stringify({ type: "response.output_item.done", output_index: index, item: message("Hi") })}\n\n`;
      const at = text.lastIndexOf("event: x");
      return new Response(text.slice(0, at) + extra + text.slice(at), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const error = await createTrainerGeneration(
      chatgptModel(admission, undefined, network, async () => ({
        accessToken: privateMarker,
      })),
    )({ purpose: "planner", system: "Policy", prompt: "Question" }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "malformed_stream" });
  }
});
