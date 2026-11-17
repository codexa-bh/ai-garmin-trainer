import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, TypeValidationError, JSONParseError } from "ai";
import { nativeChatgptCredential } from "./chatgpt-connection";
import { trainerToolContracts } from "./tool-contracts";
import {
  RECEIPT_CALL_DIFFERENCES,
  SDK_DROPPED_KINDS,
  safeFailureCategory,
  safeFailureDiagnostic,
} from "./provider-errors";
import type {
  ProviderFailureDiagnostic,
  ReceiptMismatchDiagnostic,
} from "./debug-types";

export const CHATGPT_NAMESPACE = "trainer";
export type ChatgptAdmission = {
  registrationId: string;
  epoch: number;
  model: string;
};
export class ChatgptRequestError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly failure: ProviderFailureDiagnostic;
  constructor(
    code: string,
    status?: number,
    requestId?: string,
    context: Partial<ProviderFailureDiagnostic> = {},
  ) {
    const category = safeFailureCategory(code);
    super(`ChatGPT plan request unavailable (${category}). No paid fallback.`);
    this.code = category;
    this.failure = safeFailureDiagnostic({
      ...context,
      category,
      stage: context.stage ?? "generation",
      status,
      requestId,
    })!;
    this.status = this.failure.status;
    this.requestId = this.failure.requestId;
  }
}
/** Shared error recognition; never parse dynamic SDK/provider error strings. */
export function chatgptGenerationFailure(error: unknown): ChatgptRequestError {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current instanceof ChatgptRequestError) return current;
    if (
      TypeValidationError.isInstance(current) ||
      JSONParseError.isInstance(current)
    )
      return new ChatgptRequestError(
        "response_decoding_failed",
        undefined,
        undefined,
        { stage: "sdk_decode" },
      );
    if (!APICallError.isInstance(current)) break;
    if (current.cause) current = current.cause;
    else
      return new ChatgptRequestError(
        Number.isInteger(current.statusCode)
          ? `http_${current.statusCode}`
          : "provider_transport_failed",
        current.statusCode,
        undefined,
        { stage: "upstream_request" },
      );
  }
  return new ChatgptRequestError("generation_failed");
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
type ReceiptCall = { id: string; name: string; input: string };
type Receipt = {
  failure?: ProviderFailureDiagnostic;
  usage: Record<string, unknown>;
  text: string;
  calls: ReceiptCall[];
};
/**
 * Closed structural explanation of an SDK/receipt disagreement, or undefined
 * when both agree exactly. Values are compared internally only; the result
 * carries no text, arguments, IDs or hashes.
 */
export function receiptMismatch(
  receipt: Pick<Receipt, "text" | "calls"> | undefined,
  text: string,
  calls: ReceiptCall[],
): ReceiptMismatchDiagnostic | undefined {
  if (!receipt) return { receipt: "absent" };
  const textState =
    text === receipt.text
      ? "match"
      : !text
        ? "observed_empty"
        : !receipt.text
          ? "receipt_empty"
          : receipt.text.startsWith(text)
            ? "observed_prefix"
            : "different";
  const differences = new Set<string>();
  if (calls.length !== receipt.calls.length) differences.add("count");
  // Receipt call IDs are already unique; pair observed calls by ID.
  const positions = new Map(receipt.calls.map((call, i) => [call.id, i]));
  const seen = new Set<string>();
  let previous = -1;
  for (const call of calls) {
    const position = positions.get(call.id);
    if (position === undefined || seen.has(call.id)) {
      differences.add("id");
      continue;
    }
    seen.add(call.id);
    if (position <= previous) differences.add("order");
    previous = position;
    if (receipt.calls[position].name !== call.name) differences.add("name");
    if (receipt.calls[position].input !== call.input)
      differences.add("arguments");
  }
  if (textState === "match" && !differences.size) return undefined;
  return {
    receipt: "present",
    text: textState,
    calls: differences.size ? "mismatch" : "match",
    observedCalls: calls.length,
    receiptCalls: receipt.calls.length,
    ...(differences.size
      ? {
          callDifferences: RECEIPT_CALL_DIFFERENCES.filter((item) =>
            differences.has(item),
          ),
        }
      : {}),
  };
}
const counter = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
const safeCode = safeFailureCategory;
async function unsupportedResponse(
  response: Response,
): Promise<ChatgptRequestError> {
  const mime = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  let kind =
    mime === "application/json"
      ? "json"
      : mime === "text/html"
        ? "html"
        : mime
          ? "other"
          : "missing_type";
  const reader = response.body?.getReader();
  let bytes = new Uint8Array();
  if (reader) {
    try {
      if (kind === "json") {
        let truncated = false;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          if (bytes.length + part.value.length > 16384) {
            truncated = true;
            break;
          }
          const next = new Uint8Array(bytes.length + part.value.length);
          next.set(bytes);
          next.set(part.value, bytes.length);
          bytes.fill(0);
          bytes = next;
        }
        const text = new TextDecoder().decode(bytes);
        if (truncated) kind = "bounded_body";
        else if (!bytes.length)
          kind = response.url ? "empty_body" : "empty_body_no_url";
        else if (/^(?:data|event):/m.test(text)) kind = "sse_like";
        const value: unknown =
          truncated || !bytes.length || kind === "sse_like"
            ? undefined
            : JSON.parse(text);
        if (record(value)) {
          if (record(value.error)) kind = "json_error";
          else if (value.object === "response")
            kind =
              value.status === "completed"
                ? "json_completed"
                : "json_incomplete";
          else kind = "json_other";
        }
      }
    } catch {
      /* No raw body, keys or provider detail may enter diagnostics. */
    } finally {
      bytes.fill(0);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!reader) kind = response.url ? "empty_body" : "empty_body_no_url";
  return new ChatgptRequestError(
    `unsupported_response_${response.status}_${kind}`,
    response.status,
  );
}
function validateCalls(output: unknown, names: Set<string>): void {
  if (!Array.isArray(output)) throw new ChatgptRequestError("malformed_stream");
  const calls = new Set<string>();
  for (const item of output) {
    if (!record(item)) throw new ChatgptRequestError("malformed_stream");
    if (item.type === "function_call") {
      if (
        item.status !== "completed" ||
        item.namespace !== CHATGPT_NAMESPACE ||
        typeof item.name !== "string" ||
        !names.has(item.name) ||
        !Object.hasOwn(trainerToolContracts, item.name) ||
        typeof item.call_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(item.call_id) ||
        calls.has(item.call_id) ||
        typeof item.arguments !== "string" ||
        item.arguments.length > 128 * 1024
      )
        throw new ChatgptRequestError("unsupported_tool_call");
      let input: unknown;
      try {
        input = JSON.parse(item.arguments);
      } catch {
        throw new ChatgptRequestError("malformed_tool_arguments");
      }
      if (!record(input))
        throw new ChatgptRequestError("malformed_tool_arguments");
      calls.add(item.call_id);
    } else if (!["message", "reasoning"].includes(item.type as string))
      throw new ChatgptRequestError("unsupported_output");
  }
}
function validatedStream(
  response: Response,
  names: Set<string>,
  current: () => void,
  receipt: (value: Receipt) => void,
  created: (value: unknown) => void,
  failure: (
    error: unknown,
    stage: ProviderFailureDiagnostic["stage"],
  ) => ChatgptRequestError,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    total = 0,
    completed = false;
  // Completed output items in output_index order. The subscription backend's
  // terminal event may omit `output` (the official Codex client also builds
  // its result only from output_item.done), so these provider-supplied items
  // are the receipt when the terminal output is empty.
  const done: Record<string, unknown>[] = [];
  function event(text: string): string {
    const lines = text.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return "";
    if (data === "[DONE]") {
      if (!completed) throw new ChatgptRequestError("missing_completion");
      return "data: [DONE]\n\n";
    }
    if (completed) throw new ChatgptRequestError("events_after_completion");
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new ChatgptRequestError("malformed_stream");
    }
    if (!record(value) || typeof value.type !== "string")
      throw new ChatgptRequestError("malformed_stream");
    if (value.type === "response.created") created(value.response);
    if (
      ["response.failed", "response.incomplete", "error"].includes(value.type)
    ) {
      const error =
        record(value.response) && record(value.response.error)
          ? value.response.error
          : record(value.error)
            ? value.error
            : value;
      throw new ChatgptRequestError(
        value.type === "response.incomplete"
          ? "response_incomplete"
          : safeCode(error.code),
        response.status,
        response.headers.get("x-request-id") ?? undefined,
      );
    }
    if (
      value.type === "response.output_item.added" ||
      value.type === "response.output_item.done"
    ) {
      if (!record(value.item))
        throw new ChatgptRequestError("malformed_stream");
      if (
        value.item.type === "function_call" &&
        (value.item.namespace !== CHATGPT_NAMESPACE ||
          typeof value.item.name !== "string" ||
          !names.has(value.item.name) ||
          !Object.hasOwn(trainerToolContracts, value.item.name) ||
          (value.type === "response.output_item.done" &&
            value.item.status !== "completed"))
      )
        throw new ChatgptRequestError("unsupported_tool_call");
      // The Responses protocol makes a function_call item `id` optional
      // (call_id/name/arguments stay required), but the locked SDK schema
      // requires it and otherwise silently drops the whole call. The item id
      // is only SDK reference metadata (unused with store=false), so supply
      // the decoder its own call_id; identity, name and arguments still come
      // solely from the provider and are compared against the receipt.
      if (
        value.item.type === "function_call" &&
        value.item.id === undefined &&
        typeof value.item.call_id === "string"
      )
        value.item = { ...value.item, id: value.item.call_id };
      if (value.type === "response.output_item.done") {
        if (
          !Number.isSafeInteger(value.output_index) ||
          (value.output_index as number) < 0 ||
          (value.output_index as number) > 4096 ||
          done[value.output_index as number] !== undefined
        )
          throw new ChatgptRequestError("malformed_stream");
        done[value.output_index as number] = value.item as Record<
          string,
          unknown
        >;
      }
    }
    if (value.type === "response.completed") {
      if (!record(value.response) || value.response.status !== "completed")
        throw new ChatgptRequestError("malformed_completion");
      const terminal = value.response.output;
      const output =
        terminal === undefined || (Array.isArray(terminal) && !terminal.length)
          ? done.filter((item) => item !== undefined)
          : terminal;
      validateCalls(output, names);
      const usage = record(value.response.usage) ? value.response.usage : {};
      const items = output as Record<string, unknown>[];
      receipt({
        usage,
        text: items
          .filter((item) => item.type === "message")
          .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
          .filter(
            (part: unknown) => record(part) && part.type === "output_text",
          )
          .map((part: { text?: unknown }) =>
            typeof part.text === "string" ? part.text : "",
          )
          .join(""),
        calls: items
          .filter((item) => item.type === "function_call")
          .map((item) => ({
            id: item.call_id as string,
            name: item.name as string,
            input: item.arguments as string,
          })),
      });
      // The locked SDK's SSE schema requires both totals. Supply decoder-only
      // placeholders; doStream below replaces EVERY usage field with actual
      // observed presence before the SDK/application can account for it.
      value.response.usage = {
        ...usage,
        input_tokens: counter(usage.input_tokens) ?? 0,
        output_tokens: counter(usage.output_tokens) ?? 0,
      };
      completed = true;
    }
    return `data: ${JSON.stringify(value)}\n\n`;
  }
  const source = response.body!.getReader();
  const observed = new ReadableStream<Uint8Array>({
    async pull(out) {
      try {
        const next = await source.read();
        if (next.done) out.close();
        else out.enqueue(next.value);
      } catch (error) {
        out.error(failure(error, "upstream_read"));
      }
    },
    async cancel() {
      await source.cancel().catch(() => {});
    },
  });
  return observed.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        current();
        total += chunk.length;
        if (total > 4 * 1024 * 1024)
          throw new ChatgptRequestError("stream_too_large");
        pending += decoder.decode(chunk, { stream: true });
        if (pending.length > 1024 * 1024)
          throw new ChatgptRequestError("stream_event_too_large");
        for (;;) {
          const match = /\r?\n\r?\n/.exec(pending);
          if (!match) break;
          const encoded = event(pending.slice(0, match.index));
          pending = pending.slice(match.index + match[0].length);
          if (encoded) controller.enqueue(new TextEncoder().encode(encoded));
        }
      },
      flush(controller) {
        current();
        pending += decoder.decode();
        if (pending.trim())
          controller.enqueue(new TextEncoder().encode(event(pending)));
        if (!completed) throw new ChatgptRequestError("missing_completion");
      },
    }),
  );
}
export function chatgptFetch(
  admission: ChatgptAdmission,
  assertCurrent: () => void = () => {},
  transport: typeof fetch = fetch,
  credential = nativeChatgptCredential,
  receipt: (value: Receipt) => void = () => {},
  observe: (value: Partial<ProviderFailureDiagnostic>) => void = () => {},
): typeof fetch {
  return async (url, init) => {
    const started = performance.now();
    let responseStatus: number | undefined;
    let requestId: string | undefined;
    let responseCorrelation: ProviderFailureDiagnostic["responseCorrelation"];
    let createdSeen = false,
      correlationInvalid = false;
    const context = () => ({
      status: responseStatus,
      requestId,
      responseCorrelation,
    });
    const created = (value: unknown) => {
      const correlation =
        record(value) &&
        typeof value.created_at === "number" &&
        Number.isFinite(value.created_at) &&
        typeof value.model === "string"
          ? safeFailureDiagnostic({
              category: "request_failed",
              stage: "sdk_decode",
              responseCorrelation: { source: "response.created", id: value.id },
            })?.responseCorrelation
          : undefined;
      if (
        !correlation ||
        (createdSeen && correlation.id !== responseCorrelation?.id)
      )
        correlationInvalid = true;
      createdSeen = true;
      responseCorrelation = correlationInvalid ? undefined : correlation;
      observe(context());
    };
    let invalidation: ChatgptRequestError | undefined;
    const failure = (
      error: unknown,
      stage: ProviderFailureDiagnostic["stage"],
    ) => {
      const typed = error instanceof ChatgptRequestError ? error : undefined;
      const origin =
        typed?.failure.stage !== "generation"
          ? typed?.failure.stage
          : undefined;
      return new ChatgptRequestError(
        typed?.code ??
          (stage === "upstream_read"
            ? "stream_interrupted"
            : "request_interrupted"),
        typed?.status ?? responseStatus,
        typed?.requestId ?? requestId,
        {
          ...typed?.failure,
          responseCorrelation,
          stage: origin ?? stage,
          elapsedMs: Math.floor(performance.now() - started),
        },
      );
    };
    const admissionCurrent = () => {
      try {
        assertCurrent();
      } catch {
        throw failure(
          new ChatgptRequestError("admission_invalidated"),
          "local_admission",
        );
      }
    };
    if (
      String(url) !== "https://api.openai.com/v1/responses" ||
      init?.method !== "POST" ||
      typeof init.body !== "string" ||
      init.body.length > 1024 * 1024
    )
      throw new ChatgptRequestError("unsupported_request");
    const body: unknown = JSON.parse(init.body);
    const allowed = [
      "model",
      "input",
      "instructions",
      "store",
      "stream",
      "tools",
      "tool_choice",
      "parallel_tool_calls",
      "text",
    ];
    if (
      !record(body) ||
      Object.keys(body).some((key) => !allowed.includes(key)) ||
      body.model !== admission.model ||
      body.store !== false ||
      body.stream !== true ||
      !Array.isArray(body.input) ||
      body.input.some(
        (item) =>
          !record(item) ||
          item.role === "system" ||
          ![
            undefined,
            "message",
            "function_call",
            "function_call_output",
            "reasoning",
          ].includes(item.type as string | undefined),
      )
    )
      throw new ChatgptRequestError("unsupported_request");
    const names = new Set<string>();
    if (body.tools !== undefined) {
      if (!Array.isArray(body.tools) || body.tools.length !== 1)
        throw new ChatgptRequestError("unsupported_tools");
      const namespace: unknown = body.tools[0];
      if (
        !record(namespace) ||
        namespace.type !== "namespace" ||
        namespace.name !== CHATGPT_NAMESPACE ||
        !Array.isArray(namespace.tools)
      )
        throw new ChatgptRequestError("unsupported_tools");
      for (const tool of namespace.tools) {
        if (
          !record(tool) ||
          tool.type !== "function" ||
          typeof tool.name !== "string" ||
          !Object.hasOwn(trainerToolContracts, tool.name) ||
          names.has(tool.name)
        )
          throw new ChatgptRequestError("unsupported_tools");
        names.add(tool.name);
      }
    }
    for (const item of body.input) {
      if (
        record(item) &&
        item.type === "function_call" &&
        (item.namespace !== CHATGPT_NAMESPACE ||
          typeof item.name !== "string" ||
          !Object.hasOwn(trainerToolContracts, item.name) ||
          (names.size && !names.has(item.name)))
      )
        throw new ChatgptRequestError("unsupported_tool_call");
    }
    admissionCurrent();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      init.signal ?? AbortSignal.timeout(180000),
    ]);
    let polling = false;
    const current = () => {
      if (signal.aborted)
        throw (
          invalidation ??
          failure(new ChatgptRequestError("request_aborted"), "aborted")
        );
      admissionCurrent();
    };
    let accessToken: string | undefined;
    try {
      ({ accessToken } = await credential(
        "credential",
        admission.registrationId,
        admission.epoch,
        signal,
      ));
    } catch {
      if (signal.aborted) current();
      throw failure(
        new ChatgptRequestError("connection_unavailable"),
        "native_credential",
      );
    }
    current();
    // Disconnect/reconnect must cancel even a response whose remote socket is idle.
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      credential("current", admission.registrationId, admission.epoch, signal)
        .catch(() => {
          if (signal.aborted) return;
          invalidation = failure(
            new ChatgptRequestError("connection_invalidated"),
            "native_poll",
          );
          controller.abort(invalidation);
        })
        .finally(() => {
          polling = false;
        });
    }, 1000);
    const stop = () => clearInterval(timer);
    signal.addEventListener("abort", stop, { once: true });
    try {
      const response = await transport("https://api.openai.com/v1/responses", {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          Accept: "text/event-stream",
        },
        body: init.body,
        signal,
      });
      responseStatus = response.status;
      requestId = response.headers.get("x-request-id") ?? undefined;
      observe(context());
      current();
      if (!response.ok) {
        stop();
        // Never expose raw admission detail/error text or echoed prompts/tokens.
        let code = `http_${response.status}`;
        const reader = response.body?.getReader();
        if (reader) {
          let bytes = 0,
            text = "";
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.length;
              if (bytes > 16384) break;
              text += new TextDecoder().decode(part.value);
            }
            const value: unknown = JSON.parse(text);
            if (record(value) && record(value.error))
              code = safeCode(value.error.code);
          } catch {
            /* Nonstandard admission failures have no stable code. */
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
        throw new ChatgptRequestError(
          code,
          response.status,
          response.headers.get("x-request-id") ?? undefined,
        );
      }
      const media = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      if (!response.body || (media && media !== "text/event-stream"))
        throw await unsupportedResponse(response);
      // Absent metadata is not proof of a non-stream body. Always require the
      // SAME closed SSE/terminal/namespace validation and locked-SDK receipt;
      // never accept JSON, EOF or merely SSE-looking prefixes as success.
      const reader = validatedStream(
        response,
        names,
        current,
        (value) =>
          receipt({
            ...value,
            failure: failure(
              new ChatgptRequestError("incomplete_sdk_decoding"),
              "sdk_decode",
            ).failure,
          }),
        created,
        (error, stage) =>
          signal.aborted
            ? failure(
                invalidation ?? new ChatgptRequestError("request_aborted"),
                "aborted",
              )
            : failure(error, stage),
      ).getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(out) {
          try {
            const next = await reader.read();
            if (next.done) {
              try {
                await credential(
                  "current",
                  admission.registrationId,
                  admission.epoch,
                  signal,
                );
              } catch {
                if (signal.aborted) current();
                throw failure(
                  new ChatgptRequestError("connection_invalidated"),
                  "native_final_current",
                );
              }
              current();
              stop();
              out.close();
            } else out.enqueue(next.value);
          } catch (error) {
            stop();
            await reader.cancel().catch(() => {});
            out.error(
              signal.aborted
                ? failure(
                    invalidation ?? new ChatgptRequestError("request_aborted"),
                    "aborted",
                  )
                : failure(error, "stream_validation"),
            );
          }
        },
        async cancel() {
          stop();
          controller.abort();
          await reader.cancel().catch(() => {});
        },
      });
      const headers = new Headers(response.headers);
      headers.set("content-type", "text/event-stream");
      return new Response(stream, {
        status: response.status,
        headers,
      });
    } catch (error) {
      stop();
      throw signal.aborted
        ? failure(
            invalidation ?? new ChatgptRequestError("request_aborted"),
            "aborted",
          )
        : failure(error, "upstream_request");
    }
  };
}
export function chatgptModel(
  admission: ChatgptAdmission,
  assertCurrent?: () => void,
  transport?: typeof fetch,
  credential = nativeChatgptCredential,
) {
  const identity = createOpenAI({
    name: "chatgpt",
    apiKey: "native-owned-not-an-api-key",
  }).responses(admission.model);
  const doStream: typeof identity.doStream = async (options) => {
    const started = performance.now();
    let receipt: Receipt | undefined;
    let context: Partial<ProviderFailureDiagnostic> = {};
    const counts = new Map<(typeof SDK_DROPPED_KINDS)[number], number>();
    const diagnostic = (error: unknown) => {
      const failure = chatgptGenerationFailure(error);
      const mismatch = receiptMismatch(receipt, text, calls);
      return new ChatgptRequestError(
        failure.code,
        failure.status ?? context.status,
        failure.requestId ?? context.requestId,
        {
          ...context,
          ...failure.failure,
          elapsedMs: Math.floor(performance.now() - started),
          dropped: SDK_DROPPED_KINDS.filter((kind) => counts.has(kind)).map(
            (kind) => ({ kind, count: counts.get(kind)! }),
          ),
          ...(["incomplete_sdk_decoding", "sdk_text_lifecycle_failed"].includes(
            failure.code,
          )
            ? { receipt: mismatch }
            : {}),
        },
      );
    };
    const model = createOpenAI({
      name: "chatgpt",
      apiKey: "native-owned-not-an-api-key",
      fetch: chatgptFetch(
        admission,
        assertCurrent,
        transport,
        credential,
        (value) => {
          receipt = value;
        },
        (value) => {
          context = value;
        },
      ),
    }).responses(admission.model);
    const result = await model.doStream({ ...options, includeRawChunks: true });
    let text = "";
    const calls: { id: string; name: string; input: string }[] = [];
    const activeText = new Set<string>();
    let pendingKind: (typeof SDK_DROPPED_KINDS)[number] | undefined;
    const settleRaw = () => {
      if (pendingKind)
        counts.set(pendingKind, (counts.get(pendingKind) ?? 0) + 1);
      pendingKind = undefined;
    };
    const observed = result.stream
      .pipeThrough(
        new TransformStream({
          transform(part, out) {
            if (part.type === "raw") {
              settleRaw();
              const raw = part.rawValue;
              // Locked SDK 4.0.15: these exact branches ALWAYS emit a part if
              // parsed; fallback emits none. Bracket actual handler output,
              // not a second schema. Restrict item branches to message/call;
              // valid ignored event/item kinds and future kinds are not drops.
              if (record(raw)) {
                if (raw.type === "response.output_text.delta")
                  pendingKind = raw.type;
                else if (
                  (raw.type === "response.output_item.added" ||
                    raw.type === "response.output_item.done") &&
                  record(raw.item) &&
                  ["message", "function_call"].includes(raw.item.type as string)
                )
                  pendingKind = raw.type;
              }
              return; // Raw values never cross the adapter boundary.
            }
            if (part.type === "finish") settleRaw();
            else pendingKind = undefined; // Actual emitted output/error: not fallback.
            if (part.type === "error")
              part = { ...part, error: diagnostic(part.error) };
            if (part.type === "text-start") activeText.add(part.id);
            if (part.type === "text-delta" || part.type === "text-end") {
              if (!activeText.has(part.id)) {
                out.enqueue({
                  type: "error",
                  error: diagnostic(
                    new ChatgptRequestError(
                      "sdk_text_lifecycle_failed",
                      undefined,
                      undefined,
                      { stage: "sdk_decode" },
                    ),
                  ),
                });
                return; // ai would emit a private-ID missing-part string here.
              }
              if (part.type === "text-end") activeText.delete(part.id);
            }
            if (part.type === "text-delta") text += part.delta;
            if (part.type === "tool-call")
              calls.push({
                id: part.toolCallId,
                name: part.toolName,
                input: part.input,
              });
            if (part.type === "finish") {
              const mismatch = receiptMismatch(receipt, text, calls);
              if (!receipt || mismatch)
                throw diagnostic(
                  new ChatgptRequestError(
                    "incomplete_sdk_decoding",
                    undefined,
                    undefined,
                    { stage: "sdk_decode" },
                  ),
                );
              const raw = receipt.usage;
              const details = record(raw.input_tokens_details)
                ? raw.input_tokens_details
                : {};
              const input = counter(raw.input_tokens),
                output = counter(raw.output_tokens);
              part = {
                ...part,
                usage: {
                  inputTokens: {
                    total: input,
                    noCache: undefined,
                    cacheRead: counter(details.cached_tokens),
                    cacheWrite: counter(details.cache_write_tokens),
                  },
                  outputTokens: {
                    total: output,
                    text: undefined,
                    reasoning: undefined,
                  },
                  raw: {
                    ...(input !== undefined ? { input_tokens: input } : {}),
                    ...(output !== undefined ? { output_tokens: output } : {}),
                    input_tokens_details: {
                      ...(counter(details.cached_tokens) !== undefined
                        ? { cached_tokens: counter(details.cached_tokens)! }
                        : {}),
                      ...(counter(details.cache_write_tokens) !== undefined
                        ? {
                            cache_write_tokens: counter(
                              details.cache_write_tokens,
                            )!,
                          }
                        : {}),
                    },
                  },
                },
              };
            }
            out.enqueue(part);
          },
        }),
      )
      .getReader();
    return {
      ...result,
      stream: new ReadableStream({
        async pull(out) {
          try {
            const part = await observed.read();
            if (part.done) out.close();
            else out.enqueue(part.value);
          } catch (error) {
            // A typed upstream failure happens after the preceding synchronous
            // SDK handler returned. Its pending no-output raw event is fallback,
            // not a handler exception. Never infer this for an unknown SDK throw.
            if (
              error instanceof ChatgptRequestError &&
              !["generation", "sdk_decode"].includes(error.failure.stage)
            )
              settleRaw();
            // Transport/currentness precedence remains authoritative.
            out.error(diagnostic(error));
          }
        },
        cancel: (reason) => observed.cancel(reason),
      }),
    };
  };
  return {
    specificationVersion: identity.specificationVersion,
    provider: identity.provider,
    modelId: identity.modelId,
    supportedUrls: identity.supportedUrls,
    doStream,
    doGenerate: async () => {
      throw new ChatgptRequestError("streaming_required");
    },
  };
}
export function isChatgptModel(model: unknown): boolean {
  return Boolean(
    model &&
    typeof model === "object" &&
    (model as { provider?: string }).provider === "chatgpt.responses",
  );
}
