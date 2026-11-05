import { describe, expect, it, vi } from "vitest";
import { createSummaryGeneration } from "@/lib/memory/summary-provider";
import { summaryLimits } from "@/lib/memory/summary-policy";

const ids = ["original:authored-a", "turn-b:1"];
const prompt = JSON.stringify({
  now: 1700000000000,
  characterCap: 6000,
  previous: [],
  requiredCoverageSourceIds: ids,
  newSources: ids.map((sourceId) => ({ sourceId, user: "Authored source." })),
});
const wirePatch = {
  version: 1,
  keep: [],
  upsert: [],
  remove: [],
  coverage: Object.fromEntries(ids.map((id) => [id, "low-value"])),
};

// Real SDK serialization with a supplied synthetic transport, not a live model
// or a semantic-selection certificate.
function fixture(
  options: {
    count?: number | null;
    usage?: boolean;
    status?: number;
    patch?: Record<string, unknown>;
  } = {},
) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), body });
    const counting = String(url).endsWith("/input_tokens");
    return new Response(
      JSON.stringify(
        counting
          ? options.count === null
            ? {}
            : { input_tokens: options.count ?? 100 }
          : {
              id: "response-summary",
              object: "response",
              created_at: 0,
              status: "completed",
              model: "gpt-6-luna",
              output: [
                {
                  type: "message",
                  id: "msg-summary",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify(options.patch ?? wirePatch),
                      annotations: [],
                    },
                  ],
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
            },
      ),
      {
        status: counting ? 200 : (options.status ?? 200),
        headers: { "content-type": "application/json" },
      },
    );
  });
  return {
    requests,
    transport,
    generation: createSummaryGeneration("synthetic-not-a-key", transport),
  };
}

describe("independent actual SDK Luna summary serialization", () => {
  it("counts the exact dynamic schema/payload and uses stateless bounded text, no tools/fallback or chat fields", async () => {
    const { generation, requests } = fixture();
    const result = await generation.generate(
      "Summary-only policy",
      prompt,
      new AbortController().signal,
    );
    expect(result.patch).toEqual({
      ...wirePatch,
      coverage: ids.map((sourceId) => ({ sourceId, reason: "low-value" })),
    });
    expect(result.usage).toEqual({ input: 100, output: 20, cached: 0 });
    expect(requests).toHaveLength(2);
    const [count, infer] = requests;
    expect(count!.url).toBe("https://api.openai.com/v1/responses/input_tokens");
    expect(infer!.body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      max_output_tokens: summaryLimits(6000).output,
    });
    for (const key of ["input", "model", "text", "reasoning"])
      expect(count!.body[key]).toEqual(infer!.body[key]);
    for (const key of [
      "tools",
      "previous_response_id",
      "conversation",
      "background",
      "service_tier",
    ])
      expect(infer!.body).not.toHaveProperty(key);
    expect(JSON.stringify(infer!.body.input)).toContain(
      "For this transport ONLY",
    );
  });
  it.each(["summary", "title"] as const)(
    "counts and sends the same strict closed %s schema",
    async (purpose) => {
      const { transport, requests } = fixture(
        purpose === "title" ? { patch: { title: "Authored title" } } : {},
      );
      const generation = createSummaryGeneration(
        "synthetic-not-a-key",
        transport,
        () => true,
        purpose,
      );
      await generation.generate(
        "policy",
        purpose === "summary" ? prompt : "authored source",
        new AbortController().signal,
      );
      const text = requests[1]!.body.text as {
        format: {
          type: string;
          strict: boolean;
          name: string;
          schema: Record<string, unknown>;
        };
      };
      expect(requests[0]!.body.text).toEqual(text);
      expect(text.format).toMatchObject({
        type: "json_schema",
        strict: true,
        name: purpose === "title" ? "chat_title" : "summary_patch",
        schema: { type: "object", additionalProperties: false },
      });
      expect(text.format.schema.required).toEqual(
        purpose === "title"
          ? ["title"]
          : ["version", "keep", "upsert", "remove", "coverage"],
      );
      if (purpose === "summary") {
        const properties = text.format.schema.properties as Record<
          string,
          Record<string, unknown>
        >;
        expect(properties.coverage).toMatchObject({
          type: "object",
          additionalProperties: false,
          required: ids,
        });
        expect(Object.keys(properties.coverage!.properties as object)).toEqual(
          ids,
        );
        for (const value of Object.values(
          properties.coverage!.properties as Record<string, unknown>,
        ))
          expect(value).toMatchObject({
            type: "string",
            enum: ["represented", "duplicate", "low-value"],
          });
        for (const key of ["upsert", "remove"])
          expect(
            (properties[key]!.items as Record<string, unknown>)
              .additionalProperties,
          ).toBe(false);
        expect(
          (properties.upsert!.items as Record<string, unknown>).required,
        ).toEqual([
          "id",
          "text",
          "category",
          "stance",
          "sourceIds",
          "priority",
          "expiresAt",
          "replaces",
        ]);
      }
      expect(requests[1]!.body.max_output_tokens).toBe(
        purpose === "title" ? 120 : summaryLimits(6000).output,
      );
    },
  );
  it.each([
    {},
    { [ids[0]!]: "low-value" },
    { ...wirePatch.coverage, foreign: "low-value" },
    { [ids[0]!]: "unknown", [ids[1]!]: "low-value" },
    ids.map((sourceId) => ({ sourceId, reason: "low-value" })),
  ])(
    "rejects missing/foreign/invalid/legacy coverage rather than filling dispositions: %j",
    async (coverage) => {
      const { generation, requests } = fixture({
        patch: { ...wirePatch, coverage },
      });
      // The real SDK rejects the strict wire schema before exposing a result.
      // Do not invent observed usage or normalize a missing disposition.
      await expect(
        generation.generate("policy", prompt, new AbortController().signal),
      ).rejects.toThrow();
      expect(requests).toHaveLength(2);
    },
  );
  it("normalizes a validated map in exact input order without changing explicit dispositions", async () => {
    const { generation } = fixture({
      patch: {
        ...wirePatch,
        coverage: { [ids[1]!]: "duplicate", [ids[0]!]: "low-value" },
      },
    });
    const result = await generation.generate(
      "policy",
      prompt,
      new AbortController().signal,
    );
    expect(result.patch).toMatchObject({
      coverage: [
        { sourceId: ids[0], reason: "low-value" },
        { sourceId: ids[1], reason: "duplicate" },
      ],
    });
  });
  it.each([
    "not JSON",
    JSON.stringify({ requiredCoverageSourceIds: [], newSources: [] }),
    JSON.stringify({
      requiredCoverageSourceIds: [ids[0], ids[0]],
      newSources: [{ sourceId: ids[0] }, { sourceId: ids[0] }],
    }),
    JSON.stringify({
      requiredCoverageSourceIds: ids,
      newSources: [{ sourceId: "other" }, { sourceId: ids[1] }],
    }),
  ])(
    "refuses unsupported/ambiguous source census before network: %s",
    async (input) => {
      const { generation, transport } = fixture();
      await expect(
        generation.generate("policy", input, new AbortController().signal),
      ).rejects.toThrow("summary_invalid_generation_input");
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it.each([summaryLimits(6000).input + 1, null])(
    "refuses oversized/unknown exact accounting %s before inference",
    async (count) => {
      const { generation, requests } = fixture({ count });
      await expect(
        generation.generate("policy", prompt, new AbortController().signal),
      ).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );
  it("refuses dispatch when authority is revoked during exact count", async () => {
    const { transport, requests } = fixture();
    let current = true;
    const controlled: typeof fetch = async (url, init) => {
      const response = await transport(url, init);
      if (String(url).endsWith("/input_tokens")) current = false;
      return response;
    };
    const generation = createSummaryGeneration(
      "synthetic-not-a-key",
      controlled,
      () => current,
      "summary",
      20000,
    );
    await expect(
      generation.generate("policy", prompt, new AbortController().signal),
    ).rejects.toThrow("summary_configuration_changed");
    expect(requests).toHaveLength(1);
  });
  it("keeps missing usage unknown rather than SDK-default zero", async () => {
    const { generation } = fixture({ usage: false });
    expect(
      (
        await generation.generate(
          "policy",
          prompt,
          new AbortController().signal,
        )
      ).usage,
    ).toEqual({ input: null, output: null, cached: null });
  });
  it("does not retry provider rejection or dispatch after configuration cancellation", async () => {
    const { generation, requests } = fixture({ status: 401 });
    await expect(
      generation.generate("policy", prompt, new AbortController().signal),
    ).rejects.toThrow();
    expect(requests).toHaveLength(2);
    const transport = vi.fn<typeof fetch>();
    const stale = createSummaryGeneration(
      "synthetic-not-a-key",
      transport,
      () => false,
    );
    await expect(
      stale.generate("policy", prompt, new AbortController().signal),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
