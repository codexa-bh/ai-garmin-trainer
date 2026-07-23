import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-memory-route-")),
    "test.sqlite",
  );
  process.env.MEMORY_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.MEMORY_EMBEDDING_API_KEY;
});

async function route() {
  return import("../src/app/api/memory/route");
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/memory", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("semantic memory API route", () => {
  it("reports disabled semantic memory readiness without requiring vector/provider services", async () => {
    const { GET } = await route();

    const payload = (await (await GET()).json()) as {
      health: { status: string; provider: string; vectorProvider: string };
      memories: unknown[];
    };

    expect(payload.health).toMatchObject({
      status: "disabled",
      provider: "app-sqlite-vector",
      vectorProvider: "sqlite",
    });
    expect(payload.memories).toEqual([]);
  });

  it("reports enabled memory as misconfigured when OpenAI embedding key is only a placeholder", async () => {
    process.env.MEMORY_ENABLED = "true";
    process.env.MEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "replace-with-openai-key";
    const { GET } = await route();

    const payload = (await (await GET()).json()) as {
      health: {
        ready: boolean;
        status: string;
        embeddingConfigured: boolean;
        detail: string;
      };
      memories: unknown[];
    };

    expect(payload.health).toMatchObject({
      ready: false,
      status: "misconfigured",
      embeddingConfigured: false,
    });
    expect(payload.health.detail).toContain(
      "OpenAI key missing or placeholder",
    );
    expect(payload.memories).toEqual([]);
  });

  it("reports enabled Ollama memory as degraded when the local model is missing", async () => {
    process.env.MEMORY_ENABLED = "true";
    process.env.MEMORY_EMBEDDING_PROVIDER = "ollama";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'model "nomic-embed-text" not found, try pulling it first',
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const { GET } = await route();

    const payload = (await (await GET()).json()) as {
      health: {
        ready: boolean;
        status: string;
        embeddingConfigured: boolean;
        embeddingProvider: string;
        detail: string;
      };
      memories: unknown[];
    };

    expect(payload.health).toMatchObject({
      ready: false,
      status: "degraded",
      embeddingConfigured: false,
      embeddingProvider: "ollama",
    });
    expect(payload.health.detail).toContain("ollama pull nomic-embed-text");
    expect(payload.memories).toEqual([]);
  });

  it("persists the local enable/disable control separately from memory contents", async () => {
    const { PATCH } = await route();

    const disabled = (await (
      await PATCH(jsonRequest({ action: "set-enabled", enabled: false }))
    ).json()) as { health: { userDisabled: boolean; status: string } };
    expect(disabled.health.userDisabled).toBe(true);
    expect(disabled.health.status).toBe("disabled");

    const enabled = (await (
      await PATCH(jsonRequest({ action: "set-enabled", enabled: true }))
    ).json()) as { health: { userDisabled: boolean; status: string } };
    expect(enabled.health.userDisabled).toBe(false);
  });

  it("rejects unsupported management actions", async () => {
    const { PATCH } = await route();
    const response = await PATCH(
      jsonRequest({ action: "approve", id: "legacy" }),
    );
    expect(response.status).toBe(400);
  });
});
