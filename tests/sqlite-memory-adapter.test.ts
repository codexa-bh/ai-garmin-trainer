import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(
      mkdtempSync(join(tmpdir(), "trainer-memory-management-")),
      "test.sqlite",
    ),
  );
  vi.stubEnv("MEMORY_ENABLED", "true");
  vi.stubEnv("MEMORY_EMBEDDING_PROVIDER", "deterministic");
  vi.stubEnv("MEMORY_EMBEDDING_DIMS", "64");
  vi.stubEnv("MEMORY_EXTRACTION_MODE", "deterministic");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function fixture() {
  const { getDatabase } = await import("../src/lib/db/connection");
  const { seedSemanticMemory, seedLegacyMemory } =
    await import("./memory-fixture");
  const { memoryManagement } = await import("../src/lib/memory/composition");
  return {
    db: getDatabase(),
    seedSemanticMemory,
    seedLegacyMemory,
    management: memoryManagement,
  };
}

describe("production SQLite memory management", () => {
  it("reads preserved rows after module re-creation without ingesting a turn", async () => {
    const { management, seedSemanticMemory } = await fixture();
    seedSemanticMemory();
    const first = await management.read();
    expect(first.memories).toHaveLength(1);
    expect(first.memories[0]).toMatchObject({
      text: "I prefer morning hikes",
      sourceMessageIds: ["authored-user"],
      conversationId: "authored-chat",
    });
    vi.resetModules();
    const { memoryManagement } = await import("../src/lib/memory/composition");
    expect((await memoryManagement.read()).memories).toEqual(first.memories);
  });
  it("migrates only confirmed legacy rows once, preserving original records", async () => {
    const { management, seedLegacyMemory, db } = await fixture();
    seedLegacyMemory(
      "confirmed",
      "confirmed",
      "Prefers easy recovery rides after long hikes.",
    );
    seedLegacyMemory("rejected", "rejected", "Rejected legacy preference.");
    const before = db.prepare("select * from trainer_memory order by id").all();
    const first = await management.read();
    const second = await management.read();
    expect(
      first.memories.filter((m) => m.text.includes("easy recovery rides")),
    ).toHaveLength(1);
    expect(second.memories).toEqual(first.memories);
    expect(second.memories.some((m) => m.text.includes("Rejected"))).toBe(
      false,
    );
    expect(
      db.prepare("select * from trainer_memory order by id").all(),
    ).toEqual(before);
  });
  it("normalizes update embeddings through the production change entrypoint", async () => {
    vi.stubEnv("MEMORY_EMBEDDING_PROVIDER", "ollama");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ embeddings: [[3, 4]] })),
    );
    const { management, seedSemanticMemory, db } = await fixture();
    const id = seedSemanticMemory();
    const result = await management.change({
      action: "update",
      id,
      text: "I prefer short easy runs after travel",
    });
    expect(result.memories[0].text).toBe(
      "I prefer short easy runs after travel",
    );
    const row = db
      .prepare(
        "select embedding_json as vector, embedding_model as model from semantic_memory where id=?",
      )
      .get(id) as { vector: string; model: string };
    expect(JSON.parse(row.vector)).toEqual([0.6, 0.8]);
    expect(row.model).toBe("nomic-embed-text");
  });
  it("reports missing Ollama health without listing preserved rows", async () => {
    vi.stubEnv("MEMORY_EMBEDDING_PROVIDER", "ollama");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: 'model "nomic-embed-text" not found, try pulling it first' },
          { status: 404 },
        ),
      ),
    );
    const { management, seedSemanticMemory } = await fixture();
    seedSemanticMemory();
    const result = await management.read();
    expect(result.health).toMatchObject({
      ready: false,
      status: "degraded",
      embeddingProvider: "ollama",
      embeddingConfigured: false,
    });
    expect(result.health.detail).toContain("ollama pull nomic-embed-text");
    expect(result.memories).toEqual([]);
  });
  it("refuses malformed update vectors before changing persisted memory", async () => {
    vi.stubEnv("MEMORY_EMBEDDING_PROVIDER", "ollama");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ embeddings: [[]] })),
    );
    const { management, seedSemanticMemory, db } = await fixture();
    const id = seedSemanticMemory();
    const before = db.prepare("select * from semantic_memory").all();
    await expect(
      management.change({ action: "update", id, text: "I prefer easy spins" }),
    ).rejects.toThrow("memory embedding Ollama response invalid vector");
    expect(db.prepare("select * from semantic_memory").all()).toEqual(before);
  });
  it("deletes and clears before the next list while Off/On preserves rows", async () => {
    const { management, seedSemanticMemory, db } = await fixture();
    const id = seedSemanticMemory();
    const before = db.prepare("select * from semantic_memory").all();
    expect(
      (await management.change({ action: "set-enabled", enabled: false }))
        .memories,
    ).toEqual([]);
    expect(db.prepare("select * from semantic_memory").all()).toEqual(before);
    expect(
      (await management.change({ action: "set-enabled", enabled: true }))
        .memories,
    ).toHaveLength(1);
    expect(
      (await management.change({ action: "delete", id })).memories,
    ).toEqual([]);
    seedSemanticMemory("second", "I prefer mellow walks after hard runs");
    expect((await management.change({ action: "clear" })).memories).toEqual([]);
    expect((await management.read()).memories).toEqual([]);
  });
});
