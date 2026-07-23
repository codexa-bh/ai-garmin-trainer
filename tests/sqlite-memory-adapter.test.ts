import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-sqlite-memory-")),
    "test.sqlite",
  );
  process.env.MEMORY_ENABLED = "true";
  process.env.MEMORY_EMBEDDING_PROVIDER = "deterministic";
  process.env.MEMORY_EMBEDDING_DIMS = "64";
});

describe("embedded SQLite semantic memory adapter", () => {
  it("persists completed-turn memory and retrieves it after adapter re-creation", async () => {
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

  it("migrates only active confirmed legacy memories idempotently", async () => {
    const repository = await import("../src/lib/db/repository");
    const { LOCAL_MEMORY_USER_ID } = await import("../src/lib/memory/types");
    const module = await import("../src/lib/memory/sqlite-adapter");

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

    const store = module.trainerMemoryStore();
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
    const module = await import("../src/lib/memory/sqlite-adapter");
    const store = module.trainerMemoryStore();
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

  it("deletes conversation-scoped continuity when a conversation is deleted", async () => {
    const repository = await import("../src/lib/db/repository");
    const { LOCAL_MEMORY_USER_ID } = await import("../src/lib/memory/types");
    const module = await import("../src/lib/memory/sqlite-adapter");
    const store = module.trainerMemoryStore();
    repository.ensureConversation("delete-chat");
    await store.addCompletedTurn({
      conversationId: "delete-chat",
      userMessageId: "u-conv-delete",
      assistantMessageId: "a-conv-delete",
      userText: "We discussed blue trail shoes for wet hikes",
      assistantText:
        "Blue trail shoes were noted as part of this conversation.",
      completedAt: new Date("2026-07-23T12:00:00Z"),
    });
    expect(
      await store.search(
        "blue trail shoes",
        { userId: LOCAL_MEMORY_USER_ID },
        2,
      ),
    ).not.toEqual([]);

    repository.deleteConversation("delete-chat");
    expect(
      await store.search(
        "blue trail shoes",
        { userId: LOCAL_MEMORY_USER_ID },
        2,
      ),
    ).toEqual([]);
  });
});
