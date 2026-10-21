import { generateText, tool, type LanguageModelUsage } from "ai";
import { trainerCompletionSchema } from "./tool-contracts";
import { COMPLETION_TOOL } from "./turn-completion";

const completionTool = tool({
  description:
    "Declare the final coaching, evidence-grounded or incomplete answer. This is a response, not an action. Personal measurements require exact current-turn evidence references. Never declare unfinished tool work as completed coaching.",
  inputSchema: trainerCompletionSchema,
});
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

/** Bind the already-selected model; no selection, retries or disconnect signal. */
export function createTrainerGeneration(model: unknown): TrainerGeneration {
  return async (request) => {
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
      const options = {
        model,
        system,
        prompt: request.prompt,
        ...(request.purpose === "planner"
          ? {
              tools: {
                ...trainerToolDefinitions,
                [COMPLETION_TOOL]: completionTool,
              },
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
              tools: { [COMPLETION_TOOL]: completionTool },
              // DeepSeek thinking mode supports auto but rejects forced tool choice.
              // Only the terminal schema is exposed; no action can execute here.
              toolChoice: "auto",
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
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
