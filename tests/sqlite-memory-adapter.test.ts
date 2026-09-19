import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: aiMocks.generateText,
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-sqlite-memory-")),
    "test.sqlite",
  );
  process.env.MEMORY_ENABLED = "true";
  process.env.MEMORY_EMBEDDING_PROVIDER = "deterministic";
  process.env.MEMORY_EMBEDDING_DIMS = "64";
  delete process.env.MEMORY_EXTRACTION_MODE;
  delete process.env.MEMORY_EXTRACTION_TIMEOUT_MS;
  delete process.env.AI_PROVIDER;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  aiMocks.generateText.mockReset();
});

describe("embedded SQLite semantic memory adapter", () => {
  it("persists concise user-derived memory and retrieves it after adapter re-creation", async () => {
    const repository = await import("../src/lib/db/repository");
    const { LOCAL_MEMORY_USER_ID } = await import("../src/lib/memory/types");
    const firstModule = await import("../src/lib/memory/sqlite-adapter");
    await firstModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "older-chat",
      userMessageId: "u1",
      assistantMessageId: "a1",
      userText: "remember that I prefer sunrise hikes before strength training",
      assistantText: "I will keep sunrise hike preference in mind.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });
    const rows = repository
      .getDatabase()
      .prepare(
        "select kind, text, source_message_ids_json as sourceIds from semantic_memory",
      )
      .all() as Array<{ kind: string; text: string; sourceIds: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "saved_preference" });
    expect(rows[0]?.text).toBe(
      "I prefer sunrise hikes before strength training",
    );
    expect(rows[0]?.text).not.toContain("Assistant:");
    expect(rows[0]?.text).not.toContain("I will keep");
    expect(JSON.parse(rows[0]?.sourceIds ?? "[]")).toEqual(["u1"]);
    firstModule.resetTrainerMemoryStore();

    const secondModule = await import("../src/lib/memory/sqlite-adapter");
    const results = await secondModule
      .trainerMemoryStore()
      .search(
        "When do I prefer hikes?",
        { userId: LOCAL_MEMORY_USER_ID, conversationId: "new-chat" },
        4,
      );

    expect(results.some((item) => item.text.includes("sunrise hikes"))).toBe(
      true,
    );
    expect(results.some((item) => item.kind === "saved_preference")).toBe(true);
  });

  it("stores guarded LLM-extracted memory for nuanced natural language", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    aiMocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({
        memories: [
          {
            kind: "saved_preference",
            text: "User prefers short morning hikes and finds evening workouts disruptive to sleep.",
            confidence: "high",
          },
        ],
        noMemory: false,
      }),
      toolCalls: [],
    });
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "llm-chat",
      userMessageId: "u-llm",
      assistantMessageId: "a-llm",
      userText:
        "Evening workouts usually wreck my sleep, but short morning hikes feel fine.",
      assistantText: "I can account for that.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const rows = repository
      .getDatabase()
      .prepare("select kind, text, source from semantic_memory")
      .all() as Array<{ kind: string; text: string; source: string }>;
    expect(rows).toEqual([
      {
        kind: "saved_preference",
        text: "User prefers short morning hikes and finds evening workouts disruptive to sleep.",
        source: "llm-completed-turn-user-fact",
      },
    ]);
  });

  it("stores guarded LLM memory when latest user explicitly confirms assistant context", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    aiMocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({
        memories: [
          {
            kind: "saved_preference",
            text: "User prefers recovery hikes after long runs.",
            confidence: "high",
          },
        ],
        noMemory: false,
      }),
      toolCalls: [],
    });
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "llm-assistant-context",
      userMessageId: "u-llm-assistant-context",
      assistantMessageId: "a-llm-assistant-context",
      userText: "Yes, remember that.",
      assistantText:
        "For future coaching, use recovery hikes after long runs as your default.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const callOptions = aiMocks.generateText.mock.calls[0]?.[0] as
      { prompt?: string; toolChoice?: string } | undefined;
    expect(callOptions?.toolChoice).toBe("none");
    expect(callOptions?.prompt).toContain(
      "Latest user message (primary, user-authoritative):",
    );
    expect(callOptions?.prompt).toContain(
      "Immediately previous assistant response excerpt (lower-authority context only",
    );
    expect(callOptions?.prompt).toContain(
      "use recovery hikes after long runs as your default",
    );

    const rows = repository
      .getDatabase()
      .prepare("select kind, text, source from semantic_memory")
      .all() as Array<{ kind: string; text: string; source: string }>;
    expect(rows).toEqual([
      {
        kind: "saved_preference",
        text: "User prefers recovery hikes after long runs.",
        source: "llm-completed-turn-user-fact",
      },
    ]);
  });

  it("stores no row for strict LLM no-memory output", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    aiMocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({ memories: [], noMemory: true }),
      toolCalls: [],
    });
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "llm-none",
      userMessageId: "u-none",
      assistantMessageId: "a-none",
      userText: "What were my top activities last year?",
      assistantText: "I can analyze that from local Garmin data.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const row = repository
      .getDatabase()
      .prepare("select count(*) as count from semantic_memory")
      .get() as { count: number };
    expect(row.count).toBe(0);
  });

  it("falls back to deterministic extraction when LLM output is invalid", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    aiMocks.generateText.mockResolvedValueOnce({
      text: 'Here is JSON: {"memories":[]}',
      toolCalls: [],
    });
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "llm-fallback",
      userMessageId: "u-fallback",
      assistantMessageId: "a-fallback",
      userText: "remember that I prefer short easy runs after travel",
      assistantText: "I will account for easy post-travel runs.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const row = repository
      .getDatabase()
      .prepare("select kind, text, source from semantic_memory")
      .get() as { kind: string; text: string; source: string };
    expect(row).toMatchObject({
      kind: "saved_preference",
      text: "I prefer short easy runs after travel",
      source: "completed-turn-user-fact",
    });
  });

  it("does not run deterministic extraction or create duplicates after LLM success", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    aiMocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({
        memories: [
          {
            kind: "saved_preference",
            text: "I prefer morning hikes",
            confidence: "high",
          },
        ],
      }),
      toolCalls: [],
    });
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "llm-dedupe",
      userMessageId: "u-dedupe",
      assistantMessageId: "a-dedupe",
      userText: "I prefer morning hikes",
      assistantText: "I will account for that.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const rows = repository
      .getDatabase()
      .prepare("select text, source from semantic_memory")
      .all() as Array<{ text: string; source: string }>;
    expect(rows).toEqual([
      {
        text: "I prefer morning hikes",
        source: "llm-completed-turn-user-fact",
      },
    ]);
  });

  it("falls back deterministically instead of sending memory extraction to Ollama chat", async () => {
    process.env.AI_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "qwen3.5:4b";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "ollama-extraction-fallback",
      userMessageId: "u-ollama-extraction",
      assistantMessageId: "a-ollama-extraction",
      userText: "I prefer short easy runs after travel",
      assistantText: "I will account for that.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    expect(aiMocks.generateText).not.toHaveBeenCalled();
    const rows = repository
      .getDatabase()
      .prepare("select text, source from semantic_memory")
      .all() as Array<{ text: string; source: string }>;
    expect(rows).toEqual([
      {
        text: "I prefer short easy runs after travel",
        source: "completed-turn-user-fact",
      },
    ]);
  });

  it("honors deterministic and off memory extraction modes", async () => {
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");
    process.env.MEMORY_EXTRACTION_MODE = "deterministic";
    process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";
    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "mode-deterministic",
      userMessageId: "u-mode-1",
      assistantMessageId: "a-mode-1",
      userText: "I prefer mellow hikes on recovery days",
      assistantText: "I will account for that.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });
    expect(aiMocks.generateText).not.toHaveBeenCalled();

    process.env.MEMORY_EXTRACTION_MODE = "off";
    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "mode-off",
      userMessageId: "u-mode-2",
      assistantMessageId: "a-mode-2",
      userText: "I prefer easy spins on Fridays",
      assistantText: "I will account for that.",
      completedAt: new Date("2026-07-23T12:01:00Z"),
    });

    const rows = repository
      .getDatabase()
      .prepare("select text, source from semantic_memory order by created_at")
      .all() as Array<{ text: string; source: string }>;
    expect(rows).toEqual([
      {
        text: "I prefer mellow hikes on recovery days",
        source: "completed-turn-user-fact",
      },
    ]);
  });

  it("stores normalized semantic memory with mocked Ollama embeddings", async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = "ollama";
    delete process.env.MEMORY_EMBEDDING_MODEL;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ embeddings: [[3, 4]] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await adapterModule.trainerMemoryStore().addCompletedTurn({
      conversationId: "ollama-chat",
      userMessageId: "u-ollama",
      assistantMessageId: "a-ollama",
      userText: "remember that I prefer short easy runs after travel",
      assistantText: "I will account for easy post-travel runs.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const row = repository
      .getDatabase()
      .prepare(
        "select embedding_json as embeddingJson, embedding_model as embeddingModel from semantic_memory limit 1",
      )
      .get() as { embeddingJson: string; embeddingModel: string };
    const embedding = JSON.parse(row.embeddingJson) as number[];
    expect(row.embeddingModel).toBe("nomic-embed-text");
    expect(embedding[0]).toBeCloseTo(0.6);
    expect(embedding[1]).toBeCloseTo(0.8);
  });

  it("reports Ollama model-missing health without listing memories", async () => {
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
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    const health = await adapterModule.trainerMemoryStore().health();

    expect(health).toMatchObject({
      ready: false,
      status: "degraded",
      embeddingProvider: "ollama",
      embeddingConfigured: false,
    });
    expect(health.detail).toContain("ollama pull nomic-embed-text");
  });

  it("rejects malformed Ollama embedding vectors", async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = "ollama";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ embeddings: [[]] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    await expect(
      adapterModule.trainerMemoryStore().addCompletedTurn({
        conversationId: "ollama-invalid",
        userMessageId: "u-invalid",
        assistantMessageId: "a-invalid",
        userText: "remember that invalid vectors should fail safely",
        assistantText: "I will not persist malformed embeddings.",
        completedAt: new Date("2026-07-23T12:00:00Z"),
      }),
    ).rejects.toThrow("memory embedding Ollama response invalid vector");
  });

  it("stores concise corrections and temporary plans without assistant prose", async () => {
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");
    const store = adapterModule.trainerMemoryStore();

    await store.addCompletedTurn({
      conversationId: "correction-chat",
      userMessageId: "u-correction",
      assistantMessageId: "a-correction",
      userText: "Actually, I hate morning workouts.",
      assistantText: "I will stop suggesting morning sessions.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });
    await store.addCompletedTurn({
      conversationId: "temporary-chat",
      userMessageId: "u-temporary",
      assistantMessageId: "a-temporary",
      userText: "I did not go yesterday. I will try today. Sleep was poor.",
      assistantText: "Based on Garmin context, keep it easy and avoid heroics.",
      completedAt: new Date("2026-07-23T12:01:00Z"),
    });

    const rows = repository
      .getDatabase()
      .prepare(
        "select kind, text, expires_at as expiresAt from semantic_memory order by created_at",
      )
      .all() as Array<{ kind: string; text: string; expiresAt: number | null }>;
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "correction",
        text: "Correction: I hate morning workouts",
        expiresAt: null,
      }),
      expect.objectContaining({ kind: "temporary" }),
    ]);
    expect(rows[1]?.text).toContain("I will try today");
    expect(rows[1]?.text).not.toContain("Based on Garmin");
    expect(rows[1]?.expiresAt).toBeGreaterThan(
      new Date("2026-07-23T12:01:00Z").getTime(),
    );
  });

  it("skips Garmin/tool-heavy and low-value transient turns", async () => {
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");
    const store = adapterModule.trainerMemoryStore();

    await store.addCompletedTurn({
      conversationId: "ranking-chat",
      userMessageId: "u-ranking",
      assistantMessageId: "a-ranking",
      userText: "What are my top 10 most demanding activities this year?",
      assistantText:
        "Source climb — Špik ranks first using SQL rows and formula evidence.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });
    await store.addCompletedTurn({
      conversationId: "smalltalk-chat",
      userMessageId: "u-smalltalk",
      assistantMessageId: "a-smalltalk",
      userText: "Thanks, that helps.",
      assistantText: "Glad it helped.",
      completedAt: new Date("2026-07-23T12:01:00Z"),
    });

    const row = repository
      .getDatabase()
      .prepare("select count(*) as count from semantic_memory")
      .get() as { count: number };
    expect(row.count).toBe(0);
  });

  it("migrates only active confirmed legacy memories idempotently", async () => {
    const repository = await import("../src/lib/db/repository");
    const { LOCAL_MEMORY_USER_ID } = await import("../src/lib/memory/types");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");

    const confirmed = repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value: "Prefers easy recovery rides after long hikes.",
      sourceType: "test",
      provenanceText: "Legacy confirmed memory.",
    });
    repository.confirmTrainerMemory(confirmed.id);
    const rejected = repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value: "Rejected legacy preference.",
      sourceType: "test",
      provenanceText: "Legacy rejected memory.",
    });
    repository.rejectTrainerMemory(rejected.id);

    const store = adapterModule.trainerMemoryStore();
    await store.search(
      "What recovery rides do I prefer?",
      { userId: LOCAL_MEMORY_USER_ID },
      4,
    );
    await store.search(
      "What recovery rides do I prefer?",
      { userId: LOCAL_MEMORY_USER_ID },
      4,
    );
    const page = await store.list(20);

    expect(
      page.memories.filter((item) => item.text.includes("easy recovery rides")),
    ).toHaveLength(1);
    expect(page.memories.some((item) => item.text.includes("Rejected"))).toBe(
      false,
    );
  });

  it("delete and clear take effect before the next retrieval", async () => {
    const { LOCAL_MEMORY_USER_ID } = await import("../src/lib/memory/types");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");
    const store = adapterModule.trainerMemoryStore();
    await store.addCompletedTurn({
      conversationId: "chat-delete",
      userMessageId: "u-delete",
      assistantMessageId: "a-delete",
      userText: "I prefer easy spins on Fridays",
      assistantText: "I will account for easy Friday spins.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });
    const fridayMemories = await store.search(
      "Friday spins",
      { userId: LOCAL_MEMORY_USER_ID },
      4,
    );
    expect(fridayMemories.length).toBeGreaterThan(0);

    for (const memory of fridayMemories) await store.delete(memory.id);
    expect(
      await store.search("Friday spins", { userId: LOCAL_MEMORY_USER_ID }, 2),
    ).toEqual([]);

    await store.addCompletedTurn({
      conversationId: "chat-clear",
      userMessageId: "u-clear",
      assistantMessageId: "a-clear",
      userText: "I like mellow walks after hard runs",
      assistantText: "I will remember mellow walks after hard runs.",
      completedAt: new Date("2026-07-23T12:01:00Z"),
    });
    await store.clearAll();
    expect(
      await store.search("mellow walks", { userId: LOCAL_MEMORY_USER_ID }, 2),
    ).toEqual([]);
  });

  it("does not invent memory for generic discussion turns", async () => {
    const repository = await import("../src/lib/db/repository");
    const adapterModule = await import("../src/lib/memory/sqlite-adapter");
    const store = adapterModule.trainerMemoryStore();
    await store.addCompletedTurn({
      conversationId: "delete-chat",
      userMessageId: "u-conv-delete",
      assistantMessageId: "a-conv-delete",
      userText: "We discussed blue trail shoes for wet hikes",
      assistantText:
        "Blue trail shoes were noted as part of this conversation.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });

    const row = repository
      .getDatabase()
      .prepare("select count(*) as count from semantic_memory")
      .get() as { count: number };
    expect(row.count).toBe(0);
  });
});
