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
