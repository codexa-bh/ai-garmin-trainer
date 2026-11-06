import { describe, expect, it, vi } from "vitest";
import { createSummaryGeneration } from "@/lib/memory/summary-provider";
import { getOptionalEnv } from "@/lib/env";
import { validSummaryValue } from "@/lib/memory/summary-policy";
import { encodeSummarySelection } from "@/lib/model-settings/summary-selection";
import type { ChatProvider } from "@/lib/model-settings/contracts";

const prompt = JSON.stringify({
  previous: "Previous complete draft",
  targetCharacters: 6000,
  newSources: [{ user: "Authored source." }],
});
const patch = { summary: "Complete revised summary with rationale." };

// Actual locked SDK wire serialization, supplied responses; no network/support or
// semantic-quality claim. Arbitrary literal identities, not a qualified-model list.
function fixture(
  provider: ChatProvider = "openai",
  options: {
    patch?: unknown;
    usage?: boolean;
    status?: number;
    legacy?: boolean;
    current?: () => boolean;
  } = {},
) {
  const entry = {
    id: "entry_summary",
    provider,
    modelId: options.legacy ? "gpt-6-luna" : "Vendor/Exact-模型:TAG",
  };
  const env = getOptionalEnv({
    SUMMARY_MODEL: options.legacy
      ? "gpt-6-luna"
      : encodeSummarySelection(entry),
    CHAT_MODEL_CATALOG: JSON.stringify({
      version: 1,
      entries: [entry],
      defaultEntryId: null,
    }),
    OPENAI_API_KEY: "synthetic-openai",
    DEEPSEEK_API_KEY: "synthetic-deepseek",
    OPENROUTER_API_KEY: "synthetic-router",
  });
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const text = JSON.stringify(options.patch ?? patch);
    const responses = provider === "openai";
    return new Response(
      JSON.stringify(
        responses
          ? {
              id: "response-summary",
              object: "response",
              created_at: 0,
              status: "completed",
              model: entry.modelId,
              output: [
                {
                  type: "message",
                  id: "msg-summary",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text, annotations: [] }],
                },
              ],
              ...(options.usage === false
                ? {}
                : {
                    usage: {
                      input_tokens: 100,
                      output_tokens: 20,
                      total_tokens: 120,
                      input_tokens_details: { cached_tokens: 0 },
                      output_tokens_details: { reasoning_tokens: 0 },
                    },
                  }),
            }
          : {
              id: "chat-summary",
              object: "chat.completion",
              created: 0,
              model: entry.modelId,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: text },
                  finish_reason: "stop",
                },
              ],
              ...(options.usage === false
                ? {}
                : {
                    usage: {
                      prompt_tokens: 100,
                      completion_tokens: 20,
                      total_tokens: 120,
                      ...(provider === "deepseek"
                        ? {
                            prompt_cache_hit_tokens: 0,
                            prompt_cache_miss_tokens: 100,
                          }
                        : { prompt_tokens_details: { cached_tokens: 0 } }),
                    },
                  }),
            },
      ),
      {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      },
    );
  });
  return {
    entry,
    env,
    requests,
    transport,
    generation: createSummaryGeneration(env, transport, options.current),
  };
}

describe("independent exact catalog summary/title serialization", () => {
  it.each(["openai", "deepseek", "openrouter", "ollama"] as const)(
    "uses exact %s route without count/price qualification, tools, persistence or fallback",
    async (provider) => {
      const { generation, requests, entry } = fixture(provider);
      const result = await generation.generate(
        "summary-only policy",
        prompt,
        new AbortController().signal,
      );
      expect(result.patch).toEqual(patch);
      expect(result.usage).toEqual({ input: 100, output: 20, cached: 0 });
      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.url).toBe(
        {
          openai: "https://api.openai.com/v1/responses",
          deepseek: "https://api.deepseek.com/chat/completions",
          openrouter: "https://openrouter.ai/api/v1/chat/completions",
          ollama: "http://127.0.0.1:11434/v1/chat/completions",
        }[provider],
      );
      expect(request.body.model).toBe(entry.modelId);
      for (const key of [
        "tools",
        "previous_response_id",
        "conversation",
        "background",
        "max_output_tokens",
        "max_tokens",
        "max_completion_tokens",
      ])
        expect(request.body).not.toHaveProperty(key);
      if (provider === "openai") expect(request.body.store).toBe(false);
      expect(JSON.stringify(request.body)).not.toMatch(
        /requiredCoverageSourceIds|summary_patch|replaces|sourceIds/,
      );
    },
  );

  it.each(["summary", "title"] as const)(
    "sends the separate strict %s contract",
    async (purpose) => {
      const f = fixture("openai", {
        patch: purpose === "title" ? { title: "Authored title" } : patch,
      });
      const generation = createSummaryGeneration(
        f.env,
        f.transport,
        () => true,
        purpose,
      );
      await generation.generate(
        "policy",
        purpose === "summary" ? prompt : "source",
        new AbortController().signal,
      );
      const text = f.requests[0]!.body.text as {
        format: {
          type: string;
          strict: boolean;
          schema: Record<string, unknown>;
          name: string;
        };
      };
      expect(text.format).toMatchObject({
        type: "json_schema",
        strict: true,
        name: purpose === "title" ? "chat_title" : "summary_text",
        schema: { additionalProperties: false },
      });
      const properties = text.format.schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      if (purpose === "summary") {
        expect(Object.keys(properties)).toEqual(["summary"]);
        expect(properties.summary).toMatchObject({ type: "string" });
        expect(text.format.schema.required).toEqual(["summary"]);
      }
    },
  );

  it("preserves scalar text without decoder-side character forcing or a token limit", async () => {
    const text = "🥾".repeat(1000);
    const f = fixture("openai", { patch: { summary: text } });
    const generation = createSummaryGeneration(
      f.env,
      f.transport,
      () => true,
      "summary",
      1000,
    );
    const result = await generation.generate(
      "Complete bounded summary",
      prompt,
      new AbortController().signal,
    );
    const format = (
      f.requests[0].body.text as {
        format: { schema: { properties: { summary: { pattern: string } } } };
      }
    ).format;
    expect(format.schema.properties.summary).not.toHaveProperty("pattern");
    expect(format.schema.properties.summary).not.toHaveProperty("maxLength");
    expect(result.patch).toEqual({ summary: text });
    expect(text.length).toBe(2000);
    expect(validSummaryValue({ version: 2, text })).toBe(true);
    expect(validSummaryValue({ version: 2, text: text + "a" })).toBe(true);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].body).not.toHaveProperty("max_output_tokens");
  });
  it("returns the complete oversized draft for application validation, without clipping or transport retry", async () => {
    const f = fixture("openai", { patch: { summary: "a".repeat(1001) } });
    const generation = createSummaryGeneration(
      f.env,
      f.transport,
      () => true,
      "summary",
      1000,
    );
    const result = await generation.generate(
      "policy",
      prompt,
      new AbortController().signal,
    );
    expect(result.patch).toEqual({ summary: "a".repeat(1001) });
    expect(validSummaryValue({ version: 2, text: "a".repeat(1001) })).toBe(
      true,
    );
    expect(f.requests).toHaveLength(1);
    expect(
      validSummaryValue({ version: 2, text: "a".repeat(1000) + "\n" }),
    ).toBe(true);
  });
  it.each([
    {},
    { summary: 42 },
    { summary: "text", extra: true },
    { version: 1, keep: [], upsert: [], remove: [], coverage: [] },
  ])(
    "rejects malformed/extra/old-ledger output without repair: %j",
    async (invalid) => {
      const f = fixture("openai", { patch: invalid });
      await expect(
        f.generation.generate("policy", prompt, new AbortController().signal),
      ).rejects.toThrow();
      expect(f.requests).toHaveLength(1);
    },
  );
  it("needs no model-managed source census and transmits the whole draft unchanged", async () => {
    const f = fixture();
    await f.generation.generate("policy", prompt, new AbortController().signal);
    expect(JSON.stringify(f.requests[0].body)).toContain(
      "Previous complete draft",
    );
    expect(f.transport).toHaveBeenCalledOnce();
  });
  it.each(["openai", "deepseek", "openrouter", "ollama"] as const)(
    "keeps absent %s usage unknown",
    async (provider) => {
      const f = fixture(provider, { usage: false });
      expect(
        (
          await f.generation.generate(
            "policy",
            prompt,
            new AbortController().signal,
          )
        ).usage,
      ).toEqual({ input: null, output: null, cached: null });
    },
  );
  it("preserves legacy Luna but removes token/output eligibility gates", async () => {
    const f = fixture("openai", { legacy: true });
    await f.generation.generate("policy", prompt, new AbortController().signal);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
    });
    expect(f.requests[0]!.body).not.toHaveProperty("max_output_tokens");
  });
  it("does not retry provider refusal or dispatch after authority cancellation", async () => {
    const f = fixture("openrouter", { status: 401 });
    await expect(
      f.generation.generate("policy", prompt, new AbortController().signal),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(1);
    const stale = fixture("ollama", { current: () => false });
    await expect(
      stale.generation.generate("policy", prompt, new AbortController().signal),
    ).rejects.toThrow();
    expect(stale.transport).not.toHaveBeenCalled();
  });
  it("rejects late results after configuration revocation", async () => {
    let current = true;
    const f = fixture();
    const generation = createSummaryGeneration(
      f.env,
      async (url, init) => {
        const result = await f.transport(url, init);
        current = false;
        return result;
      },
      () => current,
    );
    await expect(
      generation.generate("policy", prompt, new AbortController().signal),
    ).rejects.toThrow("summary_configuration_changed");
    expect(f.requests).toHaveLength(1);
  });
});
