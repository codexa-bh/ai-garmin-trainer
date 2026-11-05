import { generateText, Output } from "ai";
import { z } from "zod";
import { selectedModel } from "../ai/providers";
import { getOptionalEnv, type AppEnv } from "../env";
import { summaryConfiguration } from "./summary-configuration";
import type { SummaryGeneration } from "./summary-application";

const coverageReason = z.enum(["represented", "duplicate", "low-value"]);

function requiredCoverage(prompt: string): string[] {
  try {
    const value = JSON.parse(prompt) as {
      requiredCoverageSourceIds?: unknown;
      newSources?: unknown;
    };
    const ids = value.requiredCoverageSourceIds;
    const sources = value.newSources;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 20 ||
      ids.some(
        (id) => typeof id !== "string" || !id.length || id.length > 160,
      ) ||
      new Set(ids).size !== ids.length ||
      !Array.isArray(sources) ||
      sources.length !== ids.length ||
      sources.some(
        (source, index) =>
          !source ||
          typeof source !== "object" ||
          source.sourceId !== ids[index],
      )
    )
      throw new Error("summary_invalid_generation_input");
    return ids as string[];
  } catch {
    throw new Error("summary_invalid_generation_input");
  }
}
const COVERAGE_WIRE_POLICY =
  "Transport serialization: use the supplied strict output schema. For this transport ONLY, coverage is a REQUIRED closed object keyed by EVERY exact requiredCoverageSourceId, each value being its explicit represented, duplicate or low-value reason; NOT the domain array shown in policy examples. Do not omit irrelevant sources or add context IDs. The adapter restores the domain array in source order only after validating all keys/values. All item/lineage/stance/expiry rules remain unchanged; represented still requires that source in a resulting item.";

// Provider shape enforcement complements, never replaces, the domain validator's
// source lineage, coverage, authority, expiry and character-budget checks.
const summaryPatchSchema = z.strictObject({
  version: z.literal(1),
  keep: z.array(z.string()),
  upsert: z.array(
    z.strictObject({
      id: z.string(),
      text: z.string(),
      category: z.enum([
        "decision",
        "constraint",
        "goal",
        "rejected",
        "question",
        "temporary",
        "discussion",
      ]),
      stance: z.enum(["user-stated", "endorsed", "discussed-not-endorsed"]),
      sourceIds: z.array(z.string()),
      priority: z.number().int(),
      expiresAt: z.number().int().nullable(),
      replaces: z.array(z.string()),
    }),
  ),
  remove: z.array(
    z.strictObject({
      id: z.string(),
      reason: z.enum(["expired", "superseded", "duplicate", "low-value"]),
    }),
  ),
  coverage: z.array(
    z.strictObject({
      sourceId: z.string(),
      reason: coverageReason,
    }),
  ),
});
const titleSchema = z.strictObject({ title: z.string() });

/** Exact independent route; no chat/extraction/title selector or embedding import. */
export function createSummaryGeneration(
  configuration: string | AppEnv,
  transport: typeof fetch = fetch,
  current: () => boolean = () => true,
  purpose: "summary" | "title" = "summary",
  _cap = 6000,
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
      const coverageIds = purpose === "summary" ? requiredCoverage(prompt) : [];
      // A required-key object cannot logically duplicate, omit or invent source
      // dispositions. Do not ask the model to copy opaque IDs into a loose list.
      // This is transport-only: the domain patch/validator stays unchanged.
      const wireSchema = summaryPatchSchema.extend({
        coverage: z.strictObject(
          Object.fromEntries(coverageIds.map((id) => [id, coverageReason])),
        ),
      });
      const result = await generateText({
        model,
        system:
          purpose === "summary" ? `${system}\n${COVERAGE_WIRE_POLICY}` : system,
        prompt,
        output:
          purpose === "title"
            ? Output.object({ schema: titleSchema, name: "chat_title" })
            : Output.object({
                schema: wireSchema,
                name: "summary_patch",
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
      // Aggregate usage deliberately drops raw presence. This is exactly one
      // inference step, so normalize that step once, never aggregate + step.
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
        if (purpose === "title") {
          const parsed = titleSchema.safeParse(raw);
          return { patch: parsed.success ? parsed.data : null, usage };
        }
        const parsed = wireSchema.safeParse(raw);
        if (!parsed.success) return { patch: null, usage };
        return {
          patch: {
            ...parsed.data,
            coverage: coverageIds.map((sourceId) => ({
              sourceId,
              reason: parsed.data.coverage[sourceId],
            })),
          },
          usage,
        };
      } catch {
        return { patch: null, usage };
      }
    },
  };
}
