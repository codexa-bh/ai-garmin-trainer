import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ context: vi.fn<() => Promise<string>>() }));
vi.mock("@/lib/chat/context", () => ({ createChatContext: () => f.context }));
vi.mock("@/lib/weekly/composition", () => ({
  weekly: { context: () => null },
}));

afterEach(() => {
  delete (
    process as typeof process & { __trainerLiveConfigurationV1?: unknown }
  ).__trainerLiveConfigurationV1;
  f.context.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  ["deepseek", "deepseek-flash", "openai", "gpt-6-luna"],
  ["openai", "Custom/First:Tag", "openai", "Custom/Second:Tag"],
  ["openrouter", "Vendor/Exact:free", "ollama", "Local:tag"],
] as const)(
  "captures %s/%s before context awaits while %s/%s is selected",
  async (firstProvider, firstModel, secondProvider, secondModel) => {
    vi.resetModules();
    vi.stubEnv(
      "DATABASE_PATH",
      join(mkdtempSync(join(tmpdir(), "model-turn-")), "trainer.sqlite"),
    );
    vi.stubEnv("OPENAI_API_KEY", "sentinel-openai-secret");
    vi.stubEnv("DEEPSEEK_API_KEY", "sentinel-deepseek-secret");
    vi.stubEnv("OPENROUTER_API_KEY", "sentinel-router-secret");
    vi.stubEnv(
      "CHAT_MODEL_CATALOG",
      JSON.stringify({
        version: 1,
        entries: [
          { id: "entry_first", provider: firstProvider, modelId: firstModel },
          {
            id: "entry_second",
            provider: secondProvider,
            modelId: secondModel,
          },
        ],
        defaultEntryId: null,
      }),
    );
    const ai = await import("@/lib/ai/composition");
    const generate = vi.spyOn(ai, "orchestrateTrainerChat").mockResolvedValue({
      text: "answer",
      grounding: null,
      toolSteps: [],
      providerCalls: 1,
      progressCounters: {
        modelCalls: 1,
        toolsSucceeded: 0,
        toolsUnsuccessful: 0,
      },
    });
    const { modelSettings } = await import("@/lib/model-settings/composition");
    const chat = await import("@/lib/chat/composition");
    let release!: (value: string) => void;
    f.context
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue("context");
    modelSettings.save({ modelId: "entry_first" });
    const first = chat.generateChatTurn(
      chat.prepareChatTurn("first", "coaching"),
      { debugTraceEnabled: true },
    );
    expect(f.context).toHaveBeenCalledOnce();
    modelSettings.save({ modelId: "entry_second" });
    await chat.generateChatTurn(chat.prepareChatTurn("second", "coaching"), {
      debugTraceEnabled: true,
    });
    expect(generate.mock.calls[0][0]).toMatchObject({
      debug: { provider: secondProvider, model: secondModel },
      model: { modelId: secondModel },
    });
    release("context");
    await first;
    expect(generate.mock.calls[1][0]).toMatchObject({
      debug: { provider: firstProvider, model: firstModel },
      model: { modelId: firstModel },
    });
    expect(generate).toHaveBeenCalledTimes(2);
    (await import("@/lib/db/connection")).getDatabase().close();
  },
);

it("initializes a late-read explicit choice only from frozen startup compatibility, not the live catalog", async () => {
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "live-choice-")), "trainer.sqlite"),
  );
  vi.stubEnv("OPENAI_API_KEY", "synthetic-choice-key");
  const prior = {
    version: 1,
    entries: [
      { id: "entry_original", provider: "openai", modelId: "Original/Exact" },
    ],
    defaultEntryId: "entry_original",
  };
  vi.stubEnv("CHAT_MODEL_CATALOG", JSON.stringify(prior));
  vi.stubEnv("CHAT_SELECTION_COMPATIBILITY", JSON.stringify(prior));
  const env = await import("@/lib/env");
  const boot = "12345678-1234-1234-1234-123456789abc";
  env.initializeLiveConfiguration(boot);
  const metadata = await import("@/lib/db/repository");
  expect(metadata.getAppMetadata("ai.chat_model.choice")).toBeNull();
  env.applyLiveConfiguration({
    version: 1,
    boot,
    generation: 1,
    revision: "1-2-3",
    chatCatalog: {
      version: 1,
      entries: [{ id: "entry_new", provider: "openai", modelId: "New/Exact" }],
      defaultEntryId: null,
    },
    secrets: { OPENAI_API_KEY: "synthetic-next-choice-key" },
  });
  expect(metadata.getAppMetadata("ai.chat_model.choice")).toBeNull();
  const { modelSettings } = await import("@/lib/model-settings/composition");
  expect(modelSettings.read()).toMatchObject({
    version: 3,
    selected: "entry_original",
    status: "selected",
    available: false,
  });
  expect(metadata.getAppMetadata("ai.chat_model.v2")).toBeNull();
  expect(metadata.getAppMetadata("ai.chat_model")).toBeNull();
  expect(() => modelSettings.save({ modelId: null })).toThrow();
  expect(modelSettings.save({ modelId: "entry_new" })).toMatchObject({
    selected: "entry_new",
    available: true,
  });
  (await import("@/lib/db/connection")).getDatabase().close();
});

it("retains the admitted live revision for production turn retrieval, post-answer ingestion and delayed titles", async () => {
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "live-parent-")), "trainer.sqlite"),
  );
  vi.stubEnv("OPENAI_API_KEY", "synthetic-parent-old-key");
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("MEMORY_ENABLED", "false");
  const firstCatalog = {
    version: 1,
    entries: [{ id: "entry_first", provider: "openai", modelId: "Old/Exact" }],
    defaultEntryId: "entry_first",
  };
  vi.stubEnv("CHAT_MODEL_CATALOG", JSON.stringify(firstCatalog));
  const env = await import("@/lib/env");
  const boot = "12345678-1234-1234-1234-123456789abc";
  env.initializeLiveConfiguration(boot);
  const old = env.getOptionalEnv();
  const memory = await import("@/lib/memory/composition");
  const originalStore = memory.trainerMemoryStore;
  const captured: string[] = [];
  vi.spyOn(memory, "trainerMemoryStore").mockImplementation(() => {
    captured.push(env.getOptionalEnv().OPENAI_API_KEY ?? "absent");
    return originalStore();
  });
  const title = await import("@/lib/chat/title-adapter");
  vi.spyOn(title, "generateConversationTitle").mockImplementation(async () => {
    expect(env.getOptionalEnv()).toBe(old);
    return null;
  });
  const ai = await import("@/lib/ai/composition");
  const generate = vi
    .spyOn(ai, "orchestrateTrainerChat")
    .mockImplementation(async (input) => {
      expect(env.getOptionalEnv()).toBe(old);
      expect(input.debug).toMatchObject({
        provider: "openai",
        model: "Old/Exact",
      });
      return {
        text: "answer",
        grounding: null,
        toolSteps: [],
        providerCalls: 1,
        progressCounters: {
          modelCalls: 1,
          toolsSucceeded: 0,
          toolsUnsuccessful: 0,
        },
      };
    });
  const chat = await import("@/lib/chat/composition");
  let release!: (value: string) => void;
  f.context.mockImplementation(() => {
    expect(env.getOptionalEnv()).toBe(old);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const prepared = chat.prepareChatTurn("live-parent", "coaching");
  const running = chat.generateChatTurn(prepared, { debugTraceEnabled: true });
  env.applyLiveConfiguration({
    version: 1,
    boot,
    generation: 1,
    revision: "1-2-3",
    chatCatalog: {
      ...firstCatalog,
      entries: [{ ...firstCatalog.entries[0], modelId: "New/Exact" }],
    },
    secrets: { OPENAI_API_KEY: "synthetic-parent-new-key" },
  });
  release("context");
  const answer = await running;
  await chat.completeChatTurn(prepared, answer);
  await chat.completeConversationTitle(prepared);
  expect(generate).toHaveBeenCalledOnce();
  expect(captured).toEqual(["synthetic-parent-old-key"]);
  expect(title.generateConversationTitle).toHaveBeenCalledOnce();
  expect(env.getOptionalEnv().OPENAI_API_KEY).toBe("synthetic-parent-new-key");
  (await import("@/lib/db/connection")).getDatabase().close();
});
