import { describe, expect, it, vi } from "vitest";
import { createSummaryGeneration } from "@/lib/memory/summary-provider";

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
                      text: JSON.stringify(
                        options.patch ?? {
                          version: 1,
                          keep: [],
                          upsert: [],
                          remove: [],
                          coverage: [],
                        },
                      ),
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
  it("counts the exact serialized payload and uses stateless bounded text, no tools/fallback or chat fields", async () => {
    const { generation, requests } = fixture();
    const result = await generation.generate(
      "Summary-only policy",
      "New minimized user sources",
      new AbortController().signal,
    );
    expect(result.patch).toMatchObject({ version: 1 });
    expect(result.usage).toEqual({ input: 100, output: 20, cached: 0 });
    expect(requests).toHaveLength(2);
    const [count, infer] = requests;
    expect(count!.url).toBe("https://api.openai.com/v1/responses/input_tokens");
    expect(infer!.body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      max_output_tokens: 2048,
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
  });
  it.each(["summary", "title"] as const)(
    "counts and sends the same strict closed %s output schema, including empty required arrays",
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
        "authored source",
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
          { items: Record<string, unknown> }
        >;
        for (const key of ["upsert", "remove", "coverage"])
          expect(properties[key]!.items.additionalProperties).toBe(false);
        expect(properties.upsert!.items.required).toEqual([
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
        purpose === "title" ? 120 : 2048,
      );
    },
  );
  it.each([8001, null])(
    "refuses oversized/unknown exact accounting %s before inference",
    async (count) => {
      const { generation, requests } = fixture({ count });
      await expect(
        generation.generate("policy", "source", new AbortController().signal),
      ).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );
  it("keeps missing usage unknown rather than SDK-default zero", async () => {
    const { generation } = fixture({ usage: false });
    expect(
      (
        await generation.generate(
          "policy",
          "source",
          new AbortController().signal,
        )
      ).usage,
    ).toEqual({ input: null, output: null, cached: null });
  });
  it("does not retry a deterministic provider rejection or dispatch after cancellation/config change", async () => {
    const { generation, requests } = fixture({ status: 401 });
    await expect(
      generation.generate("policy", "source", new AbortController().signal),
    ).rejects.toThrow();
    expect(requests).toHaveLength(2);
    const transport = vi.fn<typeof fetch>();
    const stale = createSummaryGeneration(
      "synthetic-not-a-key",
      transport,
      () => false,
    );
    await expect(
      stale.generate("policy", "source", new AbortController().signal),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
