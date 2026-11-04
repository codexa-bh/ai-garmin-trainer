import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { countResponseInput } from "../ai/conversation-transport";
import { SUMMARY_INPUT_LIMIT, SUMMARY_OUTPUT_LIMIT } from "./summary-policy";
import type { SummaryGeneration } from "./summary-application";

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
      reason: z.enum(["represented", "duplicate", "low-value"]),
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
): SummaryGeneration {
  const outputLimit = purpose === "title" ? 120 : SUMMARY_OUTPUT_LIMIT;
  const inputLimit = purpose === "title" ? 2048 : SUMMARY_INPUT_LIMIT;
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
    const tokens = await countResponseInput(transport, init, payload);
    if (!current()) throw new Error("summary_configuration_changed");
    init.signal?.throwIfAborted();
    if (tokens > inputLimit) throw new Error("summary_input_capacity");
    return transport(url, init);
  };
  const model = createOpenAI({ apiKey, fetch: guardedFetch })("gpt-6-luna");
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
                schema: summaryPatchSchema,
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
      if (result.text.length > 65536 || result.finishReason !== "stop")
        return { patch: null, usage };
      try {
        return { patch: JSON.parse(result.text) as unknown, usage };
      } catch {
        return { patch: null, usage };
      }
    },
  };
}
