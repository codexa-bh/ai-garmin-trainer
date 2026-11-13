import { createOpenAI } from "@ai-sdk/openai";
import { nativeChatgptCredential } from "./chatgpt-connection";
import { trainerToolContracts } from "./tool-contracts";

export const CHATGPT_NAMESPACE = "trainer";
export type ChatgptAdmission = {
  registrationId: string;
  epoch: number;
  model: string;
};
export class ChatgptRequestError extends Error {
  readonly requestId?: string;
  constructor(
    readonly code: string,
    readonly status?: number,
    requestId?: string,
  ) {
    super(
      `ChatGPT plan request unavailable (${code}). Manage usage in ChatGPT settings or reconnect when required; no paid fallback.`,
    );
    this.requestId =
      requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
        ? requestId
        : undefined;
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
type Receipt = {
  usage: Record<string, unknown>;
  text: string;
  calls: { id: string; name: string; input: string }[];
};
const counter = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
const safeCode = (value: unknown): string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(value)
    ? value
    : "request_failed";
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
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    total = 0,
    completed = false;
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
        response.headers.get("x-request-id")?.slice(0, 128),
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
    }
    if (value.type === "response.completed") {
      if (!record(value.response) || value.response.status !== "completed")
        throw new ChatgptRequestError("malformed_completion");
      validateCalls(value.response.output, names);
      const output = value.response.output as Record<string, unknown>[];
      const usage = record(value.response.usage) ? value.response.usage : {};
      receipt({
        usage,
        text: output
          .filter((item) => item.type === "message")
          .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
          .filter(
            (part: unknown) => record(part) && part.type === "output_text",
          )
          .map((part: { text?: unknown }) =>
            typeof part.text === "string" ? part.text : "",
          )
          .join(""),
        calls: output
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
  return response.body!.pipeThrough(
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
): typeof fetch {
  return async (url, init) => {
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
    assertCurrent();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      init.signal ?? AbortSignal.timeout(180000),
    ]);
    let polling = false;
    const current = () => {
      signal.throwIfAborted();
      assertCurrent();
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
      throw new ChatgptRequestError("connection_unavailable");
    }
    current();
    // Disconnect/reconnect must cancel even a response whose remote socket is idle.
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      credential("current", admission.registrationId, admission.epoch, signal)
        .catch(() =>
          controller.abort(new ChatgptRequestError("connection_invalidated")),
        )
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
          response.headers.get("x-request-id")?.slice(0, 128),
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
        receipt,
      ).getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(out) {
          try {
            const next = await reader.read();
            if (next.done) {
              await credential(
                "current",
                admission.registrationId,
                admission.epoch,
                signal,
              );
              current();
              stop();
              out.close();
            } else out.enqueue(next.value);
          } catch (error) {
            stop();
            await reader.cancel().catch(() => {});
            out.error(
              error instanceof ChatgptRequestError
                ? error
                : new ChatgptRequestError("stream_interrupted"),
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
      throw error instanceof ChatgptRequestError
        ? error
        : new ChatgptRequestError("request_interrupted");
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
    let receipt: Receipt | undefined;
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
      ),
    }).responses(admission.model);
    const result = await model.doStream(options);
    let text = "";
    const calls: { id: string; name: string; input: string }[] = [];
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(part, out) {
            if (part.type === "text-delta") text += part.delta;
            if (part.type === "tool-call")
              calls.push({
                id: part.toolCallId,
                name: part.toolName,
                input: part.input,
              });
            if (part.type === "finish") {
              if (
                !receipt ||
                text !== receipt.text ||
                JSON.stringify(calls) !== JSON.stringify(receipt.calls)
              )
                throw new ChatgptRequestError("incomplete_sdk_decoding");
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
      ),
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
