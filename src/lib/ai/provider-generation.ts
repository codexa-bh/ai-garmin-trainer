import { generateText, type LanguageModelUsage } from "ai";
import { ConversationCapacityError } from "../chat/conversation-replay";
import type { ConversationCompactionGeneration } from "../chat/conversation-replay";
import { trainerToolDefinitions } from "./provider-tool-definitions";
import {
  TRAINER_PROVIDER_CALL_TIMEOUT_MS,
  type TrainerGeneration,
  type TrainerGenerationResult,
} from "./orchestration-ports";

import type { TrainerTokenUsage } from "./debug-types";

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

function tokenUsage(usage?: LanguageModelUsage): TrainerTokenUsage | undefined {
  if (!usage) return undefined;
  const raw = usage.raw;
  const responses = raw && "input_tokens" in raw;
  const chat = raw && "prompt_tokens" in raw;
  const details = responses
    ? raw.input_tokens_details
    : chat
      ? raw.prompt_tokens_details
      : undefined;
  const inputDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? details
      : {};
  // The installed adapters default missing counts to zero. Raw presence is the
  // authority when available; never persist the raw object itself.
  const inputTokens = count(
    raw
      ? responses
        ? raw.input_tokens
        : chat
          ? raw.prompt_tokens
          : undefined
      : usage.inputTokens,
  );
  const outputTokens = count(
    raw
      ? responses
        ? raw.output_tokens
        : chat
          ? raw.completion_tokens
          : undefined
      : usage.outputTokens,
  );
  const cacheReadTokens = count(
    raw
      ? responses
        ? inputDetails.cached_tokens
        : chat
          ? (raw.prompt_cache_hit_tokens ?? inputDetails.cached_tokens)
          : undefined
      : usage.inputTokenDetails?.cacheReadTokens,
  );
  const cacheWriteTokens = count(
    raw
      ? responses
        ? inputDetails.cache_write_tokens
        : undefined
      : usage.inputTokenDetails?.cacheWriteTokens,
  );
  const reportedUncached = count(
    raw
      ? chat
        ? raw.prompt_cache_miss_tokens
        : undefined
      : usage.inputTokenDetails?.noCacheTokens,
  );
  const derivedUncached =
    inputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    (chat || cacheWriteTokens !== undefined)
      ? count(inputTokens - cacheReadTokens - (cacheWriteTokens ?? 0))
      : undefined;
  const result = {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    uncachedInputTokens: reportedUncached ?? derivedUncached,
    outputTokens,
  };
  return Object.values(result).some((value) => value !== undefined)
    ? result
    : undefined;
}

/** Only verified current direct Responses models support this cache contract. */
function explicitCaching(model: unknown): boolean {
  if (!model || typeof model !== "object") return false;
  const candidate = model as { provider?: string; modelId?: string };
  return (
    candidate.provider === "openai.responses" &&
    ["gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol"].includes(
      candidate.modelId ?? "",
    )
  );
}

function reviewedConversationModel(model: unknown): boolean {
  const identity = model as { provider?: string; modelId?: string } | null;
  return Boolean(
    identity &&
    identity.provider === "openai.responses" &&
    identity.modelId === "gpt-6-luna",
  );
}

export function createConversationCompactionGeneration(
  model: unknown,
  count: ConversationCompactionGeneration["count"],
): ConversationCompactionGeneration {
  if (!reviewedConversationModel(model))
    throw new Error("conversation_model_capability_unavailable");
  return {
    count,
    async generate(system, prompt, signal) {
      const result = await generateText({
        model: model as Parameters<typeof generateText>[0]["model"],
        system,
        prompt,
        maxRetries: 0,
        abortSignal: signal,
        providerOptions: {
          openai: {
            store: false,
            forceReasoning: true,
            reasoningEffort: "none",
            systemMessageMode: "developer",
          },
        },
      });
      return result.text;
    },
  };
}

/** Bind the already-selected model; no selection, retries or disconnect signal. */
export function createTrainerGeneration(model: unknown): TrainerGeneration {
  return async (request) => {
    if (
      request.conversation &&
      !request.conversation.memoryOnly &&
      !reviewedConversationModel(model)
    )
      throw new Error("conversation_model_capability_unavailable");
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("provider_timeout"));
      }, TRAINER_PROVIDER_CALL_TIMEOUT_MS);
    });
    try {
      const cachePolicy =
        typeof request.system !== "string" && explicitCaching(model);
      const system =
        typeof request.system === "string"
          ? request.system
          : cachePolicy
            ? [
                {
                  role: "system",
                  content: request.system.policy,
                  providerOptions: {
                    openai: { promptCacheBreakpoint: { mode: "explicit" } },
                  },
                },
                { role: "system", content: request.system.context },
              ]
            : `${request.system.policy}\n\n${request.system.context}`;
      const conversation = request.conversation;
      const structured =
        typeof request.system !== "string"
          ? request.system
          : { policy: request.system, context: "" };
      const options = {
        model,
        system: conversation
          ? [
              {
                role: "system",
                content: structured.policy,
                ...(cachePolicy
                  ? {
                      providerOptions: {
                        openai: { promptCacheBreakpoint: { mode: "explicit" } },
                      },
                    }
                  : {}),
              },
            ]
          : system,
        ...(conversation
          ? {
              messages: [
                ...conversation.history,
                {
                  role: "user",
                  content: `Fresh current-turn server grounding (historical prose never verifies this turn):\n${structured.context}`,
                },
                { role: "user", content: request.prompt },
                ...(request.exchanges ?? []).flatMap((exchange) => [
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "tool-call",
                        toolCallId: exchange.callId,
                        toolName: exchange.toolName,
                        input: exchange.input,
                      },
                    ],
                  },
                  {
                    role: "tool",
                    content: [
                      {
                        type: "tool-result",
                        toolCallId: exchange.callId,
                        toolName: exchange.toolName,
                        output: { type: "text", value: exchange.output },
                      },
                    ],
                  },
                ]),
              ],
              maxRetries: 0,
            }
          : { prompt: request.prompt }),
        ...(request.purpose === "planner"
          ? {
              tools: trainerToolDefinitions,
              toolChoice: "auto",
              parallelToolCalls: false,
              providerOptions: {
                openai: {
                  parallelToolCalls: false,
                  ...(cachePolicy
                    ? { promptCacheOptions: { mode: "explicit", ttl: "30m" } }
                    : {}),
                },
                deepseek: { parallelToolCalls: false },
              },
            }
          : {
              // Plain text only: no action tools or response certificate.
              ...(cachePolicy
                ? {
                    providerOptions: {
                      openai: {
                        promptCacheOptions: { mode: "explicit", ttl: "30m" },
                      },
                    },
                  }
                : {}),
            }),
        ...(conversation
          ? {
              providerOptions: {
                openai: {
                  store: false,
                  ...(!conversation.memoryOnly
                    ? {
                        forceReasoning: true,
                        reasoningEffort: "none",
                        systemMessageMode: "developer",
                      }
                    : {}),
                  parallelToolCalls: false,
                  ...(cachePolicy
                    ? { promptCacheOptions: { mode: "explicit", ttl: "30m" } }
                    : {}),
                },
              },
            }
          : {}),
        abortSignal: controller.signal,
      };
      // Preserve the existing SDK compatibility boundary and raw call shapes.
      const result = (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<TrainerGenerationResult & { usage?: LanguageModelUsage }>
      )(options);
      const generated = await Promise.race([result, timeout]);
      return {
        text: generated.text,
        toolCalls: generated.toolCalls,
        tokenUsage: tokenUsage(generated.usage),
      };
    } catch (error) {
      if (
        !request.conversation ||
        error instanceof ConversationCapacityError ||
        (error instanceof Error &&
          [
            "conversation_context_invalidated",
            "conversation_token_accounting_invalid",
            "conversation_token_accounting_unavailable",
            "conversation_transport_unsupported",
            "conversation_serialization_unsupported",
            "provider_timeout",
          ].includes(error.message))
      )
        throw error;
      // New replay must not put an upstream echoed prompt/body into local traces.
      throw new Error("conversation_provider_unavailable");
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
