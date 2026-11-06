import { generateText, Output } from "ai";
import { z } from "zod";
import { selectedModel } from "../ai/providers";
import { getOptionalEnv, type AppEnv } from "../env";
import { summaryConfiguration } from "./summary-configuration";
import { summaryCap } from "./summary-policy";
import type { SummaryGeneration } from "./summary-application";

const summarySchema = z.strictObject({ summary: z.string() });
const titleSchema = z.strictObject({ title: z.string() });

/** Exact independent route; no fallback, source-fate schema or generated IDs. */
export function createSummaryGeneration(
  configuration: string | AppEnv,
  transport: typeof fetch = fetch,
  current: () => boolean = () => true,
  purpose: "summary" | "title" = "summary",
  cap?: number,
): SummaryGeneration {
  const env =
    typeof configuration === "string"
      ? getOptionalEnv({
          OPENAI_API_KEY: configuration,
          SUMMARY_MODEL: "gpt-6-luna",
        })
      : configuration;
  const selected = summaryConfiguration(env);
  if (!selected) throw new Error("summary_model_unselected");
  // Validate configuration, but never force decoder termination at the cap:
  // real output then ended mid-word. The application validates complete text
  // and may make one explicitly accounted known-oversize condensation.
  summaryCap(cap ?? Number(env.SUMMARY_CHAR_LIMIT));
  const guardedFetch: typeof fetch = async (url, init) => {
    if (!current() || init?.signal?.aborted)
      throw new Error("summary_configuration_changed");
    if (typeof init?.body !== "string")
      throw new Error("summary_transport_unsupported");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (
      body.model !== selected.entry.modelId ||
      (selected.entry.provider === "openai" && body.store !== false) ||
      body.previous_response_id ||
      body.conversation ||
      body.background ||
      body.tools ||
      body.service_tier
    )
      throw new Error("summary_transport_unsupported");
    return transport(url, init);
  };
  const model = selectedModel(selected.env, undefined, guardedFetch)
    .model as Parameters<typeof generateText>[0]["model"];
  return {
    async generate(system, prompt, signal) {
      const result = await generateText({
        model,
        system,
        prompt,
        output:
          purpose === "title"
            ? Output.object({ schema: titleSchema, name: "chat_title" })
            : Output.object({
                schema: summarySchema,
                name: "summary_text",
              }),
        maxRetries: 0,
        abortSignal: signal,
        ...(selected.entry.provider === "openai"
          ? {
              providerOptions: {
                openai: {
                  store: false,
                  ...(selected.entry.modelId === "gpt-6-luna"
                    ? {
                        forceReasoning: true,
                        reasoningEffort: "none",
                        systemMessageMode: "system",
                      }
                    : {}),
                },
              },
            }
          : {}),
      });
      signal.throwIfAborted();
      if (!current()) throw new Error("summary_configuration_changed");
      const raw = result.steps[0]?.usage.raw;
      const counter = (value: unknown): number | null =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? value
          : null;
      const responses = raw && "input_tokens" in raw;
      const details = responses
        ? raw?.input_tokens_details
        : raw?.prompt_tokens_details;
      const cached =
        details && typeof details === "object"
          ? (details as Record<string, unknown>).cached_tokens
          : undefined;
      const usage = {
        input: counter(responses ? raw?.input_tokens : raw?.prompt_tokens),
        output: counter(
          responses ? raw?.output_tokens : raw?.completion_tokens,
        ),
        cached: counter(raw?.prompt_cache_hit_tokens ?? cached),
      };
      if (result.text.length > 1024 * 1024 || result.finishReason !== "stop")
        return { patch: null, usage };
      try {
        const raw: unknown = JSON.parse(result.text);
        const parsed =
          purpose === "title"
            ? titleSchema.safeParse(raw)
            : summarySchema.safeParse(raw);
        return { patch: parsed.success ? parsed.data : null, usage };
      } catch {
        return { patch: null, usage };
      }
    },
  };
}
