import { expect, it, vi } from "vitest";
import { chatgptModel, receiptMismatch } from "../src/lib/ai/chatgpt-transport";
import { createTrainerGeneration } from "../src/lib/ai/provider-generation";
import {
  providerFailureDiagnostic,
  providerFailureMessage,
  safeFailureDiagnostic,
  safeReceiptDiagnostic,
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
function stream(outputs: Output[], terminal = outputs.map((o) => o.done)) {
  const values: unknown[] = [
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
    "streamed text absent from the receipt",
    () => stream([textOutput("Hi", message("Hi"))], []),
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

it("pure comparison distinguishes absence, empties, count and identity without values", () => {
  const one = { id: "call_1", name: "getSyncStatus", input: "{}" };
  const two = { id: "call_2", name: "getSyncStatus", input: "{}" };
  expect(receiptMismatch(undefined, "Hi", [one])).toEqual({
    receipt: "absent",
  });
  expect(receiptMismatch({ text: "Hi", calls: [one] }, "Hi", [one])).toBe(
    undefined,
  );
  expect(receiptMismatch({ text: "Hi", calls: [] }, "", [])).toMatchObject({
    text: "observed_empty",
    calls: "match",
  });
  expect(
    receiptMismatch({ text: "", calls: [one] }, "", [one, two]),
  ).toMatchObject({ calls: "mismatch", callDifferences: ["count", "id"] });
  expect(
    receiptMismatch({ text: "", calls: [one, two] }, "", [one, one]),
  ).toMatchObject({ callDifferences: ["id"] });
  expect(receiptMismatch({ text: "", calls: [] }, "", [])).toBeUndefined();
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
