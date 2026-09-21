import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Database } from "better-sqlite3";
import { createEmbedding, stableId } from "../src/lib/memory/embedding-adapter";

let db: Database | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "personalization-wiring-")), "test.sqlite"),
  );
  vi.stubEnv("MEMORY_ENABLED", "true");
  vi.stubEnv("MEMORY_EXTRACTION_MODE", "deterministic");
  vi.stubEnv("MEMORY_EMBEDDING_PROVIDER", "deterministic");
  vi.stubEnv("MEMORY_EMBEDDING_DIMS", "8");
});
afterEach(() => {
  db?.close();
  db = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function request(path: string, body: unknown, method = "PATCH") {
  return new Request(`http://localhost/api/${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

it("preserves pre-extraction SHA256 IDs and exact deterministic vector values", async () => {
  expect(
    stableId("semantic-candidate", [
      "u1",
      "saved_preference",
      "I prefer morning hikes",
    ]),
  ).toBe("semantic-candidate-d117d3f5ed97444e05e58b69");
  const embedding = createEmbedding({
    configuredEnabled: true,
    effectiveEnabled: true,
    userDisabled: false,
    embeddingProvider: "deterministic",
    embeddingModel: "test",
    embeddingDims: 8,
    timeoutMs: 1000,
  });
  expect(await embedding("I prefer morning hikes")).toEqual([
    -0.5, 0, 0.5, -0.5, 0.5, 0, 0, 0,
  ]);
  expect(await embedding("!!!")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

it("keeps OpenAI request options, normalized vectors, invalid response rejection and timeout behavior", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ embedding: [3, 4] }] }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const config = {
    configuredEnabled: true,
    effectiveEnabled: true,
    userDisabled: false,
    embeddingProvider: "openai" as const,
    embeddingModel: "test-model",
    embeddingApiKey: "test-key",
    embeddingBaseUrl: "https://example.invalid/v1/",
    embeddingDims: 8,
    timeoutMs: 500,
  };
  const embedding = createEmbedding(config);
  expect(await embedding("morning hikes")).toEqual([0.6, 0.8]);
  expect(fetch).toHaveBeenCalledWith("https://example.invalid/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: "Bearer test-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "test-model",
      input: "morning hikes",
      dimensions: 8,
    }),
  });
  fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ data: [{ embedding: [0, 0] }] })),
  );
  await expect(embedding("hikes")).rejects.toThrow("invalid vector");
  fetch.mockResolvedValueOnce(new Response("", { status: 429 }));
  await expect(embedding("hikes")).rejects.toThrow("memory embedding HTTP 429");
  vi.useFakeTimers();
  fetch.mockImplementationOnce(() => new Promise(() => {}));
  const failed = expect(embedding("hikes")).rejects.toThrow(
    "memory embedding timed out",
  );
  await vi.advanceTimersByTimeAsync(500);
  await failed;
});

it("wires real chat completion, Profile routes, singleton reset and memory-only mutations through SQLite", async () => {
  const repository = await import("../src/lib/db/repository");
  db = repository.getDatabase();
  const profile = await import("../src/app/api/profile/route");
  const memory = await import("../src/app/api/memory/route");
  const composition = await import("../src/lib/memory/composition");
  const chat = await import("../src/lib/chat/composition");
  const saved = await profile.POST(
    request(
      "profile",
      {
        goals: "Hike, recover",
        sports: [" walk "],
        preferences: { custom: { nested: true } },
        constraints: "weekdays",
      },
      "POST",
    ),
  );
  expect(await saved.json()).toEqual({
    ok: true,
    profile: {
      goals: ["Hike", "recover"],
      sports: ["walk"],
      preferences: { custom: { nested: true } },
      constraints: ["weekdays"],
    },
  });
  const first = composition.trainerMemoryStore();
  expect(composition.trainerMemoryStore()).toBe(first);
  const prepared = chat.prepareChatTurn(
    "t0195-wiring",
    "I prefer morning hikes",
  );
  const completed = await chat.completeChatTurn(prepared, {
    kind: "previous-failure",
    text: "Noted.",
    grounding: null,
  });
  expect(completed.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
  const page = await first.list(40);
  expect(page.memories).toHaveLength(1);
  expect(page.memories[0]).toMatchObject({
    text: "I prefer morning hikes",
    sourceMessageIds: [prepared.userRecord.id],
    conversationId: "t0195-wiring",
  });
  const id = page.memories[0]!.id;
  const before = db.prepare("select * from message order by id").all();
  const beforeProfile = await (await profile.GET()).json();
  const beforeGarmin = repository.dataCounts();
  const disabled = await memory.PATCH(
    request("memory", { action: "set-enabled", enabled: false }),
  );
  expect(await disabled.json()).toMatchObject({
    enabled: false,
    ready: false,
    memories: [],
  });
  const second = composition.trainerMemoryStore();
  expect(second).not.toBe(first);
  expect(
    await second.search("morning hikes", { userId: "local-default" }, 8),
  ).toEqual([]);
  await second.addCompletedTurn({
    conversationId: "t0195-wiring",
    userMessageId: "disabled",
    assistantMessageId: "disabled-a",
    userText: "I prefer evening walks",
    assistantText: "Noted",
    completedAt: new Date(),
  });
  expect(
    db.prepare("select count(*) as count from semantic_memory").get(),
  ).toEqual({ count: 1 });
  await memory.PATCH(request("memory", { action: "set-enabled", enabled: 0 }));
  expect((await composition.trainerMemoryStore().health()).ready).toBe(true);
  expect(
    (
      await memory.PATCH(
        request("memory", {
          action: "update",
          id,
          text: "I prefer evening hikes",
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await composition.trainerMemoryStore().list(40)).memories[0]?.text,
  ).toBe("I prefer evening hikes");
  expect(
    (await memory.PATCH(request("memory", { action: "delete", id }))).status,
  ).toBe(200);
  expect((await composition.trainerMemoryStore().list(40)).memories).toEqual(
    [],
  );
  expect(
    (await memory.PATCH(request("memory", { action: "clear" }))).status,
  ).toBe(200);
  expect(db.prepare("select * from message order by id").all()).toEqual(before);
  expect(await (await profile.GET()).json()).toEqual(beforeProfile);
  expect(repository.dataCounts()).toEqual(beforeGarmin);
  expect((await memory.PATCH(request("memory", null))).status).toBe(400);
  await expect(
    profile.POST(request("profile", null, "POST")),
  ).rejects.toThrow();
  expect(
    (
      await memory.PATCH(
        new Request("http://localhost/api/memory", {
          method: "PATCH",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  await expect(
    profile.POST(
      new Request("http://localhost/api/profile", {
        method: "POST",
        body: "{",
      }),
    ),
  ).rejects.toThrow();
});

it("retains legacy confirmation rollback, expiry/reconfirmation and missing/invalid lifecycle errors", async () => {
  const repository = await import("../src/lib/memory/legacy-composition");
  db = (await import("../src/lib/db/connection")).getDatabase();
  const proposal = (value: string, extra = {}) =>
    repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value,
      sourceType: "test",
      provenanceText: "test",
      ...extra,
    });
  const old = proposal("I prefer old hikes");
  repository.confirmTrainerMemory(old.id);
  const next = proposal("I prefer new hikes", { supersedesId: old.id });
  db.exec(
    "CREATE TRIGGER fail_confirmation BEFORE UPDATE ON trainer_memory WHEN NEW.status = 'confirmed' BEGIN SELECT RAISE(ABORT, 'test confirmation failure'); END;",
  );
  expect(() => repository.confirmTrainerMemory(next.id)).toThrow(
    "test confirmation failure",
  );
  expect(repository.getTrainerMemory(old.id)?.status).toBe("confirmed");
  expect(repository.getTrainerMemory(next.id)?.status).toBe(
    "pending_confirmation",
  );
  db.exec("DROP TRIGGER fail_confirmation");
  repository.confirmTrainerMemory(next.id);
  expect(repository.getTrainerMemory(old.id)).toMatchObject({
    status: "superseded",
    supersededById: next.id,
  });
  expect(() => repository.confirmTrainerMemory(next.id)).toThrow(
    "Only pending",
  );
  expect(() => repository.forgetTrainerMemory(old.id)).toThrow(
    "Only pending or confirmed",
  );
  expect(() => repository.rejectTrainerMemory("missing")).toThrow(
    "Memory proposal not found",
  );
  const expiring = proposal("I prefer temporary hikes", {
    expiresAt: new Date(1000),
  });
  const reconfirm = proposal("I prefer recurring hikes", {
    reconfirmAfter: new Date(1000),
  });
  repository.confirmTrainerMemory(expiring.id);
  repository.confirmTrainerMemory(reconfirm.id);
  repository.listActiveTrainerMemories(20, 1000);
  expect(repository.getTrainerMemory(expiring.id)?.status).toBe("expired");
  expect(repository.getTrainerMemory(reconfirm.id)?.status).toBe("expired");
});

it("keeps SQL upsert conflict metadata, eight-source cap and active/expiry/scope filtering", async () => {
  const { getDatabase } = await import("../src/lib/db/connection");
  db = getDatabase();
  const { sqliteMemoryPersistence: storage } =
    await import("../src/lib/memory/sqlite-storage");
  const input = {
    id: "same",
    kind: "conversation" as const,
    text: "I prefer hikes",
    source: "first",
    conversationId: "first-chat",
    sourceMessageIds: Array.from({ length: 10 }, (_, i) => `u${i}`),
    embedding: [1, 0],
    embeddingModel: "first-model",
    now: 1000,
  };
  storage.upsert(input);
  storage.upsert({
    ...input,
    kind: "temporary",
    source: "second",
    conversationId: "second-chat",
    sourceMessageIds: ["other"],
    text: "I prefer walks",
    embedding: [0, 1],
    embeddingModel: "second-model",
    now: 2000,
  });
  expect(storage.rows(2000)[0]).toEqual({
    id: "same",
    userId: "local-default",
    kind: "conversation",
    text: "I prefer walks",
    status: "active",
    embeddingJson: "[0,1]",
    embeddingModel: "second-model",
    sourceConversationId: "first-chat",
    sourceMessageIdsJson: JSON.stringify(
      Array.from({ length: 8 }, (_, i) => `u${i}`),
    ),
    source: "first",
    createdAt: 1000,
    updatedAt: 2000,
    expiresAt: null,
  });
  storage.upsert({ ...input, id: "expired", expiresAt: new Date(2000) });
  storage.upsert({ ...input, id: "wrong-user" });
  db.prepare(
    "update semantic_memory set user_id = 'other' where id = 'wrong-user'",
  ).run();
  storage.delete("same", 3000);
  expect(storage.rows(2000)).toEqual([]);
  storage.update("missing", "hikes", [1, 0], "model", 3000);
  expect(
    db.prepare("select count(*) as count from semantic_memory").get(),
  ).toEqual({ count: 3 });
});
