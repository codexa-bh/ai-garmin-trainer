import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { countResponseInput } from "../ai/conversation-transport";
import { summaryLimits } from "./summary-policy";
import { ConversationCapacityError } from "../chat/conversation-replay";
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
  apiKey: string,
  transport: typeof fetch = fetch,
  current: () => boolean = () => true,
  purpose: "summary" | "title" = "summary",
  cap = 6000,
): SummaryGeneration {
  const limits = summaryLimits(cap);
  const outputLimit = purpose === "title" ? 120 : limits.output;
  const inputLimit = purpose === "title" ? 2048 : limits.input;
  const guardedFetch: typeof fetch = async (url, init) => {
    if (!current() || init?.signal?.aborted)
      throw new Error("summary_configuration_changed");
    if (
      String(url) !== "https://api.openai.com/v1/responses" ||
      typeof init?.body !== "string"
    )
      throw new Error("summary_transport_unsupported");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (
      body.model !== "gpt-6-luna" ||
      body.store !== false ||
      body.previous_response_id ||
      body.conversation ||
      body.background ||
      body.tools ||
      body.service_tier ||
      body.max_output_tokens !== outputLimit
    )
      throw new Error("summary_transport_unsupported");
    const payload = Object.fromEntries(
      ["model", "input", "instructions", "text", "reasoning"]
        .filter((key) => body[key] !== undefined)
        .map((key) => [key, body[key]]),
    );
    let tokens: number;
    try {
      tokens = await countResponseInput(transport, init, payload);
    } catch (error) {
      if (error instanceof ConversationCapacityError)
        throw new Error("summary_input_capacity");
      throw error;
    }
    if (!current()) throw new Error("summary_configuration_changed");
    init.signal?.throwIfAborted();
    if (tokens > inputLimit) throw new Error("summary_input_capacity");
    return transport(url, init);
  };
  const model = createOpenAI({ apiKey, fetch: guardedFetch })("gpt-6-luna");
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
        maxOutputTokens: outputLimit,
        maxRetries: 0,
        abortSignal: signal,
        providerOptions: {
          openai: {
            store: false,
            forceReasoning: true,
            reasoningEffort: "none",
            systemMessageMode: "system",
          },
        },
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
      const details = raw?.input_tokens_details;
      const cached =
        details && typeof details === "object"
          ? (details as Record<string, unknown>).cached_tokens
          : undefined;
      const usage = {
        input: counter(raw?.input_tokens),
        output: counter(raw?.output_tokens),
        cached: counter(cached),
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
