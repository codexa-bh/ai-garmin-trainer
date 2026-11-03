import {
  ConversationCapacityError,
  CONVERSATION_INPUT_LIMIT,
  COMPACTION_INPUT_LIMIT,
  type ReplayMessage,
} from "../chat/conversation-replay";

/** Internal per-request declaration; removed before either provider call. */
export const CONVERSATION_BUDGET_HEADER = "x-pivan-conversation-budget";

async function countInput(
  transport: typeof fetch,
  init: RequestInit,
  payload: Record<string, unknown>,
): Promise<number> {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > 1024 * 1024)
    throw new ConversationCapacityError();
  init.signal?.throwIfAborted();
  const response = await transport(
    "https://api.openai.com/v1/responses/input_tokens",
    { ...init, method: "POST", body },
  );
  if (!response.ok)
    throw new Error("conversation_token_accounting_unavailable");
  const text = await response.text();
  if (text.length > 4096)
    throw new Error("conversation_token_accounting_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("conversation_token_accounting_invalid");
  }
  const count =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { input_tokens?: unknown })
      : {};
  if (
    typeof count.input_tokens !== "number" ||
    !Number.isSafeInteger(count.input_tokens) ||
    count.input_tokens < 0
  )
    throw new Error("conversation_token_accounting_invalid");
  return count.input_tokens;
}

export function conversationTextCounter(
  apiKey: string,
  transport: typeof fetch = fetch,
  assertCurrent?: () => void,
) {
  return async (
    messages: ReplayMessage[],
    signal: AbortSignal,
  ): Promise<number> => {
    assertCurrent?.();
    const count = await countInput(
      transport,
      {
        signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
      },
      {
        model: "gpt-6-luna",
        input: messages.map((message) => ({
          role: message.role,
          content: [
            {
              type: message.role === "assistant" ? "output_text" : "input_text",
              text: message.content,
            },
          ],
        })),
      },
    );
    assertCurrent?.();
    return count;
  };
}

/** Exact post-SDK Responses boundary. No token guess or extra credential owner. */
export function countedConversationFetch(
  transport: typeof fetch = fetch,
  assertCurrent?: () => void,
): typeof fetch {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    const budget = headers.get(CONVERSATION_BUDGET_HEADER);
    if (!budget) return transport(url, init);
    headers.delete(CONVERSATION_BUDGET_HEADER);
    if (
      String(url) !== "https://api.openai.com/v1/responses" ||
      typeof init?.body !== "string"
    )
      throw new Error("conversation_transport_unsupported");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (
      body.model !== "gpt-6-luna" ||
      body.store !== false ||
      body.previous_response_id ||
      body.conversation ||
      body.background ||
      (body.service_tier && body.service_tier !== "default")
    )
      throw new Error("conversation_transport_unsupported");
    const payload = Object.fromEntries(
      [
        "model",
        "input",
        "instructions",
        "tools",
        "tool_choice",
        "parallel_tool_calls",
        "text",
        "reasoning",
      ]
        .filter((key) => body[key] !== undefined)
        .map((key) => [key, body[key]]),
    );
    const countedInit = { ...init, headers };
    assertCurrent?.();
    const tokens = await countInput(transport, countedInit, payload);
    assertCurrent?.();
    const declaration = JSON.parse(budget) as {
      kind: "history" | "compaction";
      historyMessages?: number;
      allowSoftLimit?: boolean;
    };
    const limit =
      declaration.kind === "compaction"
        ? COMPACTION_INPUT_LIMIT
        : CONVERSATION_INPUT_LIMIT;
    if (tokens > limit) throw new ConversationCapacityError();
    if (declaration.kind === "history" && declaration.historyMessages) {
      if (!Array.isArray(payload.input))
        throw new Error("conversation_serialization_unsupported");
      const current = await countInput(transport, countedInit, {
        model: payload.model,
        input: payload.input.slice(1 + declaration.historyMessages),
        reasoning: payload.reasoning,
      });
      assertCurrent?.();
      if (current > 8192) throw new ConversationCapacityError();
    }
    if (
      declaration.kind === "history" &&
      !declaration.allowSoftLimit &&
      declaration.historyMessages
    ) {
      if (
        !Array.isArray(payload.input) ||
        !["system", "developer"].includes(
          String((payload.input[0] as { role?: unknown })?.role),
        )
      )
        throw new Error("conversation_serialization_unsupported");
      // Same policy/tools/fresh tail, removing only the neutral historical input.
      const base = await countInput(transport, countedInit, {
        ...payload,
        input: [
          payload.input[0],
          ...payload.input.slice(1 + declaration.historyMessages),
        ],
      });
      assertCurrent?.();
      const history = Math.max(0, tokens - base);
      if (history >= 0.8 * Math.max(0, limit - base))
        throw new ConversationCapacityError();
    }
    init?.signal?.throwIfAborted();
    assertCurrent?.();
    return transport(url, { ...init, headers });
  };
}
