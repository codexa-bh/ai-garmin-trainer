import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/lib/memory/application";
import {
  createMemoryExtractor,
  type ExtractionPorts,
} from "../src/lib/memory/extraction-policy";
import type { TrainerProfile } from "../src/lib/profile/contracts";
import { createMemoryManagement } from "../src/lib/memory/management";
import { createLegacyMemory } from "../src/lib/memory/legacy-application";
import { createProfile } from "../src/lib/profile/application";
import type {
  MemoryPorts,
  MemoryPersistence,
  SemanticMemoryRow,
  LegacyMemoryRow,
} from "../src/lib/memory/ports";
import type {
  LegacyMemoryStorage,
  StoredTrainerMemory,
} from "../src/lib/memory/legacy-contracts";
import {
  LOCAL_MEMORY_USER_ID,
  type CompletedTurn,
} from "../src/lib/memory/types";

const turn: CompletedTurn = {
  conversationId: "chat",
  userMessageId: "u1",
  assistantMessageId: "a1",
  userText: "I prefer morning hikes",
  assistantText: "Noted.",
  completedAt: new Date(1000),
};
const scope = { userId: LOCAL_MEMORY_USER_ID };
function row(
  id: string,
  overrides: Partial<SemanticMemoryRow> = {},
): SemanticMemoryRow {
  return {
    id,
    userId: LOCAL_MEMORY_USER_ID,
    kind: "saved_preference",
    text: "I prefer morning hikes",
    status: "active",
    embeddingJson: "[1,0]",
    embeddingModel: "test",
    sourceConversationId: "chat",
    sourceMessageIdsJson: '["u1",3]',
    source: "test",
    createdAt: 1000,
    updatedAt: 2000,
    expiresAt: null,
    ...overrides,
  };
}
function fixture() {
  const events: string[] = [];
  let migrated = false;
  const ports = {
    settings: {
      configuredEnabled: true as boolean,
      userDisabled: false,
      effectiveEnabled: true,
      embeddingProvider: "deterministic" as const,
      embeddingModel: "test",
      embeddingConfigured: true,
      problems: [] as string[],
    },
    storage: {
      rows: vi.fn(() => [row("first"), row("second")]),
      upsert: vi.fn<MemoryPersistence["upsert"]>(() => {
        events.push("write");
      }),
      legacyRows: vi.fn((): LegacyMemoryRow[] => []),
      migrationDone: vi.fn(() => {
        events.push("migration-check");
        return migrated;
      }),
      markMigrated: vi.fn(() => {
        events.push("marker");
        migrated = true;
      }),
      update: vi.fn(),
      delete: vi.fn(),
      clearAll: vi.fn(),
      probe: vi.fn(() => {
        events.push("probe");
      }),
    },
    embedding: vi.fn(async () => {
      events.push("embed");
      return [1, 0];
    }),
    extractionMode: vi.fn((): "llm" | "off" | "deterministic" => "llm"),
    extract: vi.fn(async () => {
      events.push("extract");
      return null;
    }),
    stableId: vi.fn(
      (prefix: string, parts: string[]) => `${prefix}:${parts.join("|")}`,
    ),
    now: () => 2000,
  } satisfies MemoryPorts;
  return { ports, events, store: createMemoryStore(ports) };
}

describe("memory application with supplied capabilities", () => {
  it("migrates before extraction, embeds before synchronous writes and preserves identity inputs", async () => {
    const { ports, events, store } = fixture();
    await store.addCompletedTurn(turn);
    expect(events).toEqual([
      "migration-check",
      "marker",
      "extract",
      "embed",
      "write",
    ]);
    expect(ports.stableId).toHaveBeenCalledWith("semantic-candidate", [
      "u1",
      "saved_preference",
      "I prefer morning hikes",
    ]);
    expect(ports.storage.upsert).toHaveBeenCalledWith({
      id: "semantic-candidate:u1|saved_preference|I prefer morning hikes",
      kind: "saved_preference",
      text: "I prefer morning hikes",
      source: "completed-turn-user-fact",
      conversationId: "chat",
      sourceMessageIds: ["u1"],
      createdAt: new Date(1000),
      expiresAt: null,
      embedding: [1, 0],
      embeddingModel: "test",
      now: 2000,
    });
  });
  it("distinguishes null fallback from valid empty extraction and invocation-time off", async () => {
    const { ports, store } = fixture();
    const extract = vi.fn(async () => []);
    const emptyStore = createMemoryStore({ ...ports, extract });
    await emptyStore.addCompletedTurn(turn);
    expect(ports.storage.upsert).not.toHaveBeenCalled();
    ports.extractionMode.mockReturnValue("off");
    await store.addCompletedTurn(turn);
    expect(ports.extract).not.toHaveBeenCalled();
    expect(ports.storage.upsert).not.toHaveBeenCalled();
    ports.extractionMode.mockReturnValue("deterministic");
    await store.addCompletedTurn(turn);
    expect(ports.storage.upsert).toHaveBeenCalledOnce();
  });
  it("retains partial migration writes, retries stable IDs, and marks only after all rows", async () => {
    const { ports, store } = fixture();
    ports.extractionMode.mockReturnValue("off");
    ports.storage.legacyRows.mockReturnValue(
      ["one", "two"].map((id) => ({
        id,
        category: "temporary_constraint",
        value: `I prefer ${id} hikes`,
        status: "confirmed",
        sourceType: "test",
        sourceRef: null,
        provenanceText: "test",
        createdAt: 500,
        updatedAt: 1000,
        expiresAt: 9000,
      })),
    );
    ports.embedding
      .mockResolvedValueOnce([1, 0])
      .mockRejectedValueOnce(new Error("offline"));
    await expect(store.addCompletedTurn(turn)).rejects.toThrow("offline");
    expect(ports.storage.markMigrated).not.toHaveBeenCalled();
    expect(ports.storage.upsert).toHaveBeenCalledTimes(1);
    await store.addCompletedTurn(turn);
    expect(ports.storage.upsert).toHaveBeenCalledTimes(3);
    expect(ports.storage.upsert.mock.calls[0]).toEqual(
      ports.storage.upsert.mock.calls[1],
    );
    expect(ports.storage.upsert.mock.calls[2]?.[0]).toMatchObject({
      kind: "temporary",
      sourceMessageIds: ["legacy:two"],
      createdAt: new Date(500),
      expiresAt: new Date(9000),
    });
    expect(ports.storage.markMigrated).toHaveBeenCalledOnce();
  });
  it("short circuits disabled, wrong-scope, empty and unsafe searches before I/O", async () => {
    const { ports, store } = fixture();
    await expect(store.search(" ", scope, 8)).resolves.toEqual([]);
    await expect(
      store.search("my password is secret", scope, 8),
    ).resolves.toEqual([]);
    await expect(
      store.search(
        "hikes",
        { userId: "wrong" as typeof LOCAL_MEMORY_USER_ID },
        8,
      ),
    ).resolves.toEqual([]);
    await createMemoryStore({
      ...ports,
      settings: { ...ports.settings, effectiveEnabled: false },
    }).addCompletedTurn(turn);
    expect(ports.storage.migrationDone).not.toHaveBeenCalled();
    expect(ports.embedding).not.toHaveBeenCalled();
  });
  it("preserves ties, threshold, corrupt-vector exclusion and filtering after limiting", async () => {
    const { ports, store } = fixture();
    ports.storage.rows.mockReturnValue([
      row("unsafe", { text: "my password is secret" }),
      row("tie"),
      row("bad", { embeddingJson: "{" }),
      row("threshold", { embeddingJson: "[0.05]" }),
      row("zero", { embeddingJson: "[0]" }),
    ]);
    expect(await store.search("hikes", scope, 1)).toEqual([]);
    expect(await store.search("hikes", scope, 8)).toEqual([
      {
        id: "tie",
        text: "I prefer morning hikes",
        kind: "saved_preference",
        score: 1,
        conversationId: "chat",
        sourceMessageIds: ["u1"],
        createdAt: new Date(1000).toISOString(),
        updatedAt: new Date(2000).toISOString(),
        expiresAt: undefined,
      },
    ]);
    ports.storage.rows.mockReturnValue([row("first"), row("second")]);
    expect(
      (await store.search("hikes", scope, 8)).map((item) => item.id),
    ).toEqual(["first", "second"]);
    expect((await store.list(0)).memories).toHaveLength(1);
    expect(ports.storage.rows).toHaveBeenCalledWith(2000);
  });
  it("ranks against the query, not vector self-similarity, and preserves signed dot products", async () => {
    const { ports, store } = fixture();
    ports.storage.rows.mockReturnValue([
      row("orthogonal", { embeddingJson: "[1,0]" }),
      row("match", { embeddingJson: "[0,0.5]" }),
      row("negative", { embeddingJson: "[0,-1]" }),
      row("threshold", { embeddingJson: "[0,0.05]" }),
    ]);
    ports.embedding.mockResolvedValue([0, 1]);
    expect(
      (await store.search("different query", scope, 8)).map(
        ({ id, score }) => ({ id, score }),
      ),
    ).toEqual([{ id: "match", score: 0.5 }]);
    ports.embedding.mockResolvedValue([1, 0]);
    expect(
      (await store.search("original query", scope, 8)).map(({ id, score }) => ({
        id,
        score,
      })),
    ).toEqual([{ id: "orthogonal", score: 1 }]);
  });
  it("keeps disabled list behavior and config-error precedence", async () => {
    const { ports } = fixture();
    const disabled = createMemoryStore({
      ...ports,
      settings: { ...ports.settings, effectiveEnabled: false },
    });
    expect((await disabled.list(80)).memories).toHaveLength(2);
    expect(ports.storage.migrationDone).not.toHaveBeenCalled();
    const bad = createMemoryStore({
      ...ports,
      settings: { ...ports.settings, problems: ["bad config"] },
    });
    await expect(bad.search("", scope, 8)).rejects.toThrow("bad config");
    await expect(bad.addCompletedTurn(turn)).rejects.toThrow("bad config");
    const badDisabled = createMemoryStore({
      ...ports,
      settings: {
        ...ports.settings,
        effectiveEnabled: false,
        problems: ["bad config"],
      },
    });
    expect(await badDisabled.list(80)).toEqual({
      memories: [],
      nextCursor: null,
    });
  });
  it("updates even unknown IDs only after embedding and rejects unsafe/empty values", async () => {
    const { ports, store } = fixture();
    await expect(store.update("unknown", " ")).rejects.toThrow("required");
    await expect(store.update("unknown", "api key secret")).rejects.toThrow(
      "rejected",
    );
    expect(ports.embedding).not.toHaveBeenCalled();
    await store.update("unknown", "  I prefer   hikes  ");
    expect(ports.storage.update).toHaveBeenCalledWith(
      "unknown",
      "I prefer hikes",
      [1, 0],
      "test",
      2000,
    );
    await store.delete("unknown");
    await store.clearAll();
    expect(ports.storage.delete).toHaveBeenCalledWith("unknown", 2000);
    expect(ports.storage.clearAll).toHaveBeenCalledWith(2000);
  });
  it("probes only storage for non-Ollama readiness and never migrates", async () => {
    const { ports, events, store } = fixture();
    expect(await store.health()).toMatchObject({
      ready: true,
      status: "ready",
      llmConfigured: false,
    });
    expect(events).toEqual(["probe"]);
    const ollama = createMemoryStore({
      ...ports,
      settings: { ...ports.settings, embeddingProvider: "ollama" },
    });
    expect((await ollama.health()).ready).toBe(true);
    expect(events).toEqual(["probe", "probe", "embed"]);
    expect(ports.embedding).toHaveBeenCalledWith("memory readiness probe");
    ports.storage.probe.mockImplementation(() => {
      throw new Error("SQLite unavailable");
    });
    expect(await ollama.health()).toMatchObject({
      status: "degraded",
      vectorConfigured: false,
      embeddingConfigured: false,
    });
    expect(ports.storage.migrationDone).not.toHaveBeenCalled();
  });
  it.each([
    [
      { configuredEnabled: false },
      "disabled",
      "Memory is disabled by MEMORY_ENABLED.",
    ],
    [
      { userDisabled: true },
      "disabled",
      "Memory is disabled in local settings.",
    ],
    [
      { problems: ["invalid configuration"] },
      "misconfigured",
      "invalid configuration",
    ],
  ])(
    "readiness short-circuits configuration distinctions: %j",
    async (settings, status, detail) => {
      const { ports } = fixture();
      const health = await createMemoryStore({
        ...ports,
        settings: { ...ports.settings, ...settings },
      }).health();
      expect(health).toMatchObject({ status, detail, ready: false });
      expect(ports.storage.probe).not.toHaveBeenCalled();
      expect(ports.embedding).not.toHaveBeenCalled();
    },
  );
});

describe("extraction and management use cases", () => {
  it("uses plain generation inputs and rejects tools/provider failure without losing empty-result semantics", async () => {
    const generate = vi.fn<ExtractionPorts["generate"]>(async () => ({
      text: '{"memories":[],"noMemory":true}',
      toolCalls: [] as unknown[],
    }));
    const extract = createMemoryExtractor({ mode: () => "llm", generate });
    expect(await extract(turn)).toEqual([]);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      system: expect.stringContaining("strict JSON"),
      prompt: expect.stringContaining("I prefer morning hikes"),
    });
    generate.mockResolvedValueOnce({
      text: '{"memories":[]}',
      toolCalls: [{}],
    });
    expect(await extract(turn)).toBeNull();
    generate.mockRejectedValueOnce(new Error("offline"));
    expect(await extract(turn)).toBeNull();
    generate.mockClear();
    expect(
      await extract({ ...turn, userText: "my password is secret" }),
    ).toEqual([]);
    expect(await extract({ ...turn, userText: "" })).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });
  it("loads list only when ready and reacquires singleton after enable metadata reset", async () => {
    const { ports, store } = fixture();
    const events: string[] = [];
    const management = createMemoryManagement({
      store: () => {
        events.push("store");
        return store;
      },
      setEnabled: (enabled) => {
        events.push(`enabled:${enabled}`);
      },
    });
    await management.change({ action: "set-enabled", enabled: false });
    expect(events).toEqual(["store", "enabled:false", "store"]);
    await management.change({ action: "set-enabled", enabled: 0 });
    expect(events).toContain("enabled:true");
    expect(
      await management.change({
        action: "update",
        id: "x",
        text: "I prefer hikes",
      }),
    ).toMatchObject({ ready: true });
    await expect(management.change({ action: "delete" })).rejects.toThrow(
      "Memory id is required",
    );
    await expect(
      management.change({ action: "update", id: "x", text: "x".repeat(701) }),
    ).rejects.toThrow("700");
    ports.settings.configuredEnabled = false;
    ports.storage.rows.mockClear();
    expect((await management.read()).memories).toEqual([]);
    expect(ports.storage.rows).not.toHaveBeenCalled();
  });
  it("normalizes Profile lists but preserves the flexible preferences object and synchronous save/read", () => {
    const current = { goals: [], sports: [], constraints: [], preferences: {} };
    const storage = {
      read: vi.fn(() => current),
      save: vi.fn((profile: TrainerProfile) => profile),
    };
    const profile = createProfile(storage);
    expect(profile.read()).toBe(current);
    const preferences = { nested: { enabled: true } };
    expect(
      profile.save({
        goals: "a,b\nc",
        sports: [1, " swim "],
        preferences,
        constraints: null,
      } as unknown as Parameters<typeof profile.save>[0]),
    ).toEqual({
      goals: ["a", "b", "c"],
      sports: ["1", "swim"],
      preferences,
      constraints: [],
    });
    expect(storage.save.mock.calls[0]?.[0].preferences).toBe(preferences);
  });
});

it("legacy lifecycle remains synchronous, validates before mutation, expires before listing and delegates one atomic confirmation", () => {
  const events: string[] = [];
  const memory: StoredTrainerMemory = {
    id: "new",
    category: "learned_preference",
    value: "hikes",
    status: "pending_confirmation",
    sourceType: "test",
    sourceRef: null,
    provenanceText: "test",
    validFrom: null,
    expiresAt: null,
    reconfirmAfter: null,
    supersedesId: "old",
    supersededById: null,
    createdAt: new Date(1),
    updatedAt: new Date(1),
  };
  const storage: LegacyMemoryStorage = {
    get: vi.fn(() => {
      events.push("get");
      return memory;
    }),
    insert: vi.fn(),
    confirm: vi.fn(() => {
      events.push("atomic-confirm");
    }),
    expire: vi.fn(() => {
      events.push("expire");
      return 1;
    }),
    listActive: vi.fn(() => {
      events.push("list");
      return [memory];
    }),
    listReview: vi.fn(() => []),
    setStatus: vi.fn(),
  };
  const app = createLegacyMemory({
    storage,
    now: () => {
      events.push("now");
      return 10;
    },
    id: () => "new",
  });
  expect(app.confirm("new")).toBe(memory);
  expect(events).toEqual(["now", "get", "atomic-confirm", "get"]);
  expect(storage.confirm).toHaveBeenCalledWith("new", "old", 10);
  events.length = 0;
  app.listActive(100);
  expect(events).toEqual(["now", "expire", "list"]);
  expect(storage.listActive).toHaveBeenCalledWith(20);
  app.listReview(0);
  expect(storage.listReview).toHaveBeenCalledWith(1);
  memory.status = "confirmed";
  expect(() => app.reject("new")).toThrow("Only pending");
  expect(storage.setStatus).not.toHaveBeenCalled();
  expect(app.forget("new")).toBe(memory);
  expect(storage.setStatus).toHaveBeenCalledWith("new", "deleted", 10);
  app.propose({
    category: "commitment",
    value: "x".repeat(1100),
    sourceType: "test",
    provenanceText: "y".repeat(600),
  });
  expect(storage.insert).toHaveBeenCalledWith(
    "new",
    expect.objectContaining({
      value: "x".repeat(1000),
      provenanceText: "y".repeat(500),
    }),
    10,
  );
});
