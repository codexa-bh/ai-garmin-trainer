import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-memory-route-")),
    "test.sqlite",
  );
  process.env.MEMORY_ENABLED = "false";
  process.env.MEMORY_EMBEDDING_PROVIDER = "openai";
  process.env.AI_PROVIDER = "auto";
  delete process.env.MEMORY_EXTRACTION_MODE;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.MEMORY_EMBEDDING_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it("reads only closed active metadata without a health probe, list or migration", async () => {
    process.env.MEMORY_ENABLED = "true";
    process.env.MEMORY_EMBEDDING_PROVIDER = "ollama";
    process.env.AI_PROVIDER = "ollama";
    process.env.DEEPSEEK_API_KEY = "synthetic-private-key-sentinel";
    const network = vi.fn(() => {
      throw new Error("Unexpected provider request");
    });
    vi.stubGlobal("fetch", network);
    const { sqliteMemoryPersistence } =
      await import("../src/lib/memory/sqlite-storage");
    const probe = vi.spyOn(sqliteMemoryPersistence, "probe");
    const rows = vi.spyOn(sqliteMemoryPersistence, "rows");
    const migration = vi.spyOn(sqliteMemoryPersistence, "migrationDone");
    const { GET } = await route();
    const result = await GET(
      new Request("http://localhost/api/memory?view=status"),
    );
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      configuredEnabled: true,
      userDisabled: false,
      effectiveEnabled: true,
      embeddingProvider: "ollama",
      extractionMode: "llm",
      extractionProvider: "deepseek",
      health: "not-checked",
      ageMs: null,
    });
    for (const effect of [network, probe, rows, migration])
      expect(effect).not.toHaveBeenCalled();
  });

  it("sanitizes status failures rather than returning configuration or upstream error content", async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = "private-invalid-provider-sentinel";
    const { GET } = await route();
    const response = await GET(
      new Request("http://localhost/api/memory?view=status"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Memory status unavailable; no readiness claim.",
    });
  });
  it("uses only fresh scoped cached health and clears it on runtime preference reset", async () => {
    process.env.MEMORY_ENABLED = "true";
    process.env.MEMORY_EMBEDDING_PROVIDER = "ollama";
    process.env.MEMORY_EXTRACTION_MODE = "deterministic";
    const network = vi.fn(
      async () =>
        new Response(JSON.stringify({ embeddings: [[1, 0, 0]] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", network);
    const { activeMemoryStatus, trainerMemoryStore, memoryManagement } =
      await import("../src/lib/memory/composition");
    await trainerMemoryStore().health();
    expect(activeMemoryStatus()).toMatchObject({
      health: "local-observed",
      extractionProvider: "deterministic",
    });
    expect(network).toHaveBeenCalledTimes(1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60001);
    expect(activeMemoryStatus().health).toBe("not-checked");
    clock.mockRestore();
    await memoryManagement.change({ action: "set-enabled", enabled: false });
    expect(activeMemoryStatus()).toMatchObject({
      configuredEnabled: true,
      userDisabled: true,
      effectiveEnabled: false,
      health: "disabled",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("retains exact memory vectors and unrelated data through Off/On and status reads", async () => {
    process.env.MEMORY_ENABLED = "true";
    process.env.MEMORY_EMBEDDING_PROVIDER = "deterministic";
    process.env.MEMORY_EXTRACTION_MODE = "deterministic";
    const { trainerMemoryStore, memoryManagement, activeMemoryStatus } =
      await import("../src/lib/memory/composition");
    const { getDatabase } = await import("../src/lib/db/connection");
    const store = trainerMemoryStore();
    await store.addCompletedTurn({
      conversationId: "T0241-unit",
      userMessageId: "T0241-unit-user",
      assistantMessageId: "T0241-unit-assistant",
      userText: "Remember that I prefer morning workouts.",
      assistantText: "Noted.",
      completedAt: new Date(),
    });
    const db = getDatabase();
    db.exec(
      "insert into trainer_profile(id,goals_json,updated_at) values('T0241-unit','[\"synthetic goal\"]',1); insert into training_plan(id,title,content_markdown,revised_at,updated_at) values('T0241-unit','Synthetic plan','synthetic plan',1,1); insert into conversation(id,title,created_at,updated_at) values('T0241-unit','Synthetic chat',1,1)",
    );
    const unrelated = () =>
      [
        "trainer_profile",
        "training_plan",
        "conversation",
        "activity",
        "garmin_raw_payload",
      ].map((table) => db.prepare(`select * from ${table} order by id`).all());
    const otherData = unrelated();
    const before = db
      .prepare("select * from semantic_memory order by id")
      .all();
    expect(before.length).toBeGreaterThan(0);
    const schema = db
      .prepare("select sql from sqlite_master order by name")
      .all();
    const profile = db.prepare("select * from trainer_profile").all();
    await memoryManagement.change({ action: "set-enabled", enabled: false });
    expect(activeMemoryStatus()).toMatchObject({
      effectiveEnabled: false,
      userDisabled: true,
    });
    expect(
      db.prepare("select * from semantic_memory order by id").all(),
    ).toEqual(before);
    await memoryManagement.change({ action: "set-enabled", enabled: true });
    expect(activeMemoryStatus().effectiveEnabled).toBe(true);
    expect(
      db.prepare("select * from semantic_memory order by id").all(),
    ).toEqual(before);
    expect(db.prepare("select * from trainer_profile").all()).toEqual(profile);
    expect(
      db.prepare("select sql from sqlite_master order by name").all(),
    ).toEqual(schema);
    expect(unrelated()).toEqual(otherData);
  });

  it("rejects unsupported management actions", async () => {
    const { PATCH } = await route();
    const response = await PATCH(
      jsonRequest({ action: "approve", id: "legacy" }),
    );
    expect(response.status).toBe(400);
  });
});
