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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("production chat binding captures exact runtime model before context awaits; overlapping turns never rebind", async () => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "model-turn-")), "trainer.sqlite"),
  );
  vi.stubEnv("OPENAI_API_KEY", "sentinel-openai-secret");
  vi.stubEnv("DEEPSEEK_API_KEY", "sentinel-deepseek-secret");
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
  modelSettings.save({ modelId: "deepseek-flash" });
  const first = chat.generateChatTurn(
    chat.prepareChatTurn("first", "coaching"),
    { debugTraceEnabled: true },
  );
  expect(f.context).toHaveBeenCalledOnce();
  modelSettings.save({ modelId: "gpt-6-luna" });
  await chat.generateChatTurn(chat.prepareChatTurn("second", "coaching"), {
    debugTraceEnabled: true,
  });
  expect(generate.mock.calls[0][0]).toMatchObject({
    debug: { provider: "openai", model: "gpt-6-luna" },
    model: { modelId: "gpt-6-luna" },
  });
  release("context");
  await first;
  expect(generate.mock.calls[1][0]).toMatchObject({
    debug: { provider: "deepseek", model: "deepseek-flash" },
    model: { modelId: "deepseek-flash" },
  });
  expect(generate).toHaveBeenCalledTimes(2);
  (await import("@/lib/db/connection")).getDatabase().close();
});
