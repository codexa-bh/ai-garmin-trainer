import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelSettings } from "@/lib/model-settings/application";
import type {
  ChatCatalog,
  ChatProvider,
  ModelConfiguration,
} from "@/lib/model-settings/contracts";
import { modelSettingsSnapshot } from "@/lib/model-settings/policy";
import { getOptionalEnv, hasConfiguredSecret } from "@/lib/env";

const catalog: ChatCatalog = {
  version: 1,
  entries: [
    { id: "entry_deepseek", provider: "deepseek", modelId: "deepseek-flash" },
    { id: "entry_openai", provider: "openai", modelId: "gpt-6-luna" },
    { id: "entry_local", provider: "ollama", modelId: "custom-local" },
  ],
  defaultEntryId: "entry_local",
};
function configuration(): ModelConfiguration {
  return {
    catalog: structuredClone(catalog),
    configured: {
      deepseek: true,
      openai: true,
      ollama: true,
      openrouter: false,
    },
  };
}
function fixture() {
  let stored: string | null = null;
  let legacy: string | null = null;
  const config = configuration();
  const write = vi.fn((value: string) => {
    stored = value;
  });
  const app = createModelSettings({
    readPreference: () => stored,
    readLegacyPreference: () => legacy,
    writePreference: write,
    configuration: () => config,
  });
  return {
    app,
    config,
    write,
    corrupt: (value: string | null) => {
      stored = value;
    },
    legacy: (value: string) => {
      legacy = value;
    },
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("activated catalog rules and preference application", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("keeps ineligible entries visible (%s/%s)", (deepseek, openai) => {
    const config = configuration();
    config.configured.deepseek = deepseek;
    config.configured.openai = openai;
    const state = modelSettingsSnapshot(null, config);
    expect(state.options.map((entry) => entry.id)).toEqual(
      catalog.entries.map((entry) => entry.id),
    );
    expect(state.options.map((entry) => entry.available)).toEqual([
      deepseek,
      openai,
      true,
    ]);
    expect(state.effective).toEqual({
      entryId: "entry_local",
      provider: "ollama",
      modelName: "custom-local",
      available: true,
      source: "env",
    });
  });
  it.each([
    undefined,
    "",
    "   ",
    "...",
    "<secret>",
    "replace-with-key",
    "your_api_key",
    "placeholder-key",
  ])("rejects placeholder eligibility: %s", (key) => {
    const env = getOptionalEnv({ OPENAI_API_KEY: key, DEEPSEEK_API_KEY: key });
    expect(hasConfiguredSecret(env.OPENAI_API_KEY)).toBe(false);
    expect(hasConfiguredSecret(env.DEEPSEEK_API_KEY)).toBe(false);
  });
  it("validates before mutation; keeps removed/ineligible/corrupt intent; resets only the override", () => {
    const { app, config, write, corrupt } = fixture();
    expect(app.selection().modelId).toBe("custom-local");
    expect(app.save({ modelId: "entry_deepseek" })).toMatchObject({
      selected: "entry_deepseek",
      effective: {
        provider: "deepseek",
        modelName: "deepseek-flash",
        available: true,
        source: "saved",
      },
    });
    for (const body of [
      null,
      [],
      {},
      "entry_openai",
      { modelId: false },
      { modelId: 3 },
      { modelId: "raw-forged-secret" },
      { modelId: "entry_openai", key: "no" },
    ])
      expect(() => app.save(body)).toThrow(/Choose an activated/);
    config.configured.openai = false;
    expect(() => app.save({ modelId: "entry_openai" })).toThrow(/ineligible/);
    expect(() => app.save({ modelId: "entry_deleted" })).toThrow(/absent/);
    expect(write).toHaveBeenCalledTimes(1);
    config.configured.deepseek = false;
    expect(app.read()).toMatchObject({
      selected: "entry_deepseek",
      effective: { available: false, source: "saved" },
    });
    expect(() => app.selection()).toThrow(/key/);
    config.catalog.entries.splice(0, 1);
    expect(app.read()).toMatchObject({
      selected: "entry_deepseek",
      effective: { available: false, provider: null },
    });
    expect(() => app.selection()).toThrow(/no longer/);
    corrupt("secret-corrupt-stored-id");
    expect(app.read().selected).toBeNull();
    expect(JSON.stringify(app.read())).not.toContain("secret-corrupt");
    expect(() => app.selection()).toThrow(/invalid/);
    app.save({ modelId: null });
    expect(app.selection().id).toBe("entry_local");
    config.catalog.defaultEntryId = null;
    expect(app.read().effective.available).toBe(false);
    expect(() => app.selection()).toThrow(/No default/);
    write.mockImplementationOnce(() => {
      throw new Error("private storage details");
    });
    expect(() => app.save({ modelId: null })).toThrow();
  });
  it("maps legacy only by exact provider and literal model; v2 reset/selection has precedence without original writes", () => {
    const { app, config, legacy, write, corrupt } = fixture();
    legacy("gpt-6-luna");
    expect(app.read().selected).toBe("entry_openai");
    expect(write).not.toHaveBeenCalled();
    config.catalog.entries[1].modelId = "custom-openai";
    expect(app.read().effective.available).toBe(false);
    expect(app.read().selected).toBeNull();
    app.save({ modelId: null });
    expect(app.selection().id).toBe("entry_local");
    config.catalog.entries[1].modelId = "gpt-6-luna";
    expect(app.read().selected).toBeNull(); // explicit v2 reset beats legacy
    corrupt(null);
    legacy("unknown-private-original");
    expect(JSON.stringify(app.read())).not.toContain("unknown-private");
    expect(app.read().effective.available).toBe(false);
    config.catalog.entries = [];
    config.catalog.defaultEntryId = null;
    app.save({ modelId: null });
    expect(app.read().options).toEqual([]);
    expect(() => app.selection()).toThrow(/No default/);
  });
});

it("keeps every model settings error non-cacheable without disclosing private failures", async () => {
  vi.resetModules();
  const { modelSettings } = await import("@/lib/model-settings/composition");
  const { ModelSettingsValidationError } =
    await import("@/lib/model-settings/application");
  const route = await import("@/app/api/model-settings/route");
  vi.spyOn(modelSettings, "read").mockImplementation(() => {
    throw new Error("private-storage-details");
  });
  const failedRead = route.GET();
  expect(failedRead.status).toBe(503);
  expect(failedRead.headers.get("Cache-Control")).toBe("no-store");
  expect(await failedRead.text()).not.toContain("private-storage");
  const malformed = await route.PATCH(
    new Request("http://localhost/api/model-settings", {
      method: "PATCH",
      body: "{",
    }),
  );
  expect(malformed.status).toBe(400);
  expect(malformed.headers.get("Cache-Control")).toBe("no-store");
  const save = vi.spyOn(modelSettings, "save").mockImplementation(() => {
    throw new ModelSettingsValidationError("Entry unavailable");
  });
  const request = () =>
    new Request("http://localhost/api/model-settings", {
      method: "PATCH",
      body: JSON.stringify({ modelId: "entry_missing" }),
    });
  const rejected = await route.PATCH(request());
  expect(rejected.status).toBe(400);
  expect(rejected.headers.get("Cache-Control")).toBe("no-store");
  save.mockImplementation(() => {
    throw new Error("private-storage-details");
  });
  const uncertain = await route.PATCH(request());
  expect(uncertain.status).toBe(503);
  expect(uncertain.headers.get("Cache-Control")).toBe("no-store");
  expect(await uncertain.text()).not.toContain("private-storage");
});

it("persists exact multi-model/provider selection and reset; preserves extraction, original metadata and redacted API boundaries", async () => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "model-settings-")), "trainer.sqlite"),
  );
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_MODEL", "independent-extraction");
  for (const key of [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
  ])
    vi.stubEnv(key, "sentinel-provider-secret");
  const providers: ChatProvider[] = [
    "openai",
    "deepseek",
    "ollama",
    "openrouter",
  ];
  const entries = providers.flatMap((provider) =>
    [0, 1].map((i) => ({
      id: `entry_${provider}_${i}`,
      provider,
      modelId: `${provider}/Exact:Model${i}`,
      displayName: "Same name",
    })),
  );
  vi.stubEnv(
    "CHAT_MODEL_CATALOG",
    JSON.stringify({ version: 1, entries, defaultEntryId: entries[0].id }),
  );
  const { modelSettings, selectedTrainerModel } =
    await import("@/lib/model-settings/composition");
  const adapters = await import("@/lib/ai/providers");
  const repository = await import("@/lib/db/repository");
  repository.setAppMetadata("ai.chat_model", "gpt-6-luna");
  expect(() => selectedTrainerModel()).toThrow(/resolve exactly/); // no provider-only mapping
  modelSettings.save({ modelId: null });
  const network = vi.spyOn(globalThis, "fetch");
  const extraction = adapters.selectedMemoryExtractionModel();
  const { GET, PATCH } = await import("@/app/api/model-settings/route");
  const patch = (body: unknown) =>
    PATCH(
      new Request("http://localhost/api/model-settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  for (const entry of entries) {
    expect((await patch({ modelId: entry.id })).status).toBe(200);
    expect(selectedTrainerModel()).toMatchObject({
      provider: entry.provider,
      modelName: entry.modelId,
      model: { modelId: entry.modelId },
    });
    expect(adapters.selectedMemoryExtractionModel()).toMatchObject({
      provider: extraction?.provider,
      modelName: extraction?.modelName,
    });
  }
  expect(repository.getAppMetadata("ai.chat_model")).toBe("gpt-6-luna");
  expect(process.env.AI_MODEL).toBe("independent-extraction");
  (await import("@/lib/db/connection")).getDatabase().close();
  vi.resetModules();
  const fresh = await import("@/lib/model-settings/composition");
  expect(fresh.modelSettings.selection().id).toBe("entry_openrouter_1");
  vi.stubEnv("OPENROUTER_API_KEY", "placeholder-key");
  expect(() => fresh.selectedTrainerModel()).toThrow(/key/);
  const freshRoute = await import("@/app/api/model-settings/route");
  expect(
    (
      await freshRoute.PATCH(
        new Request("http://localhost/api/model-settings", {
          method: "PATCH",
          body: JSON.stringify({ modelId: "entry_openrouter_1" }),
        }),
      )
    ).status,
  ).toBe(400);
  expect(fresh.modelSettings.read().selected).toBe("entry_openrouter_1");
  expect(
    (
      await freshRoute.PATCH(
        new Request("http://localhost/api/model-settings", {
          method: "PATCH",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect(freshRoute.GET().headers.get("Cache-Control")).toBe("no-store");
  expect(await freshRoute.GET().text()).not.toMatch(
    /sentinel-|API_KEY|DATABASE_PATH|independent-extraction/,
  );
  fresh.modelSettings.save({ modelId: null });
  expect(fresh.selectedTrainerModel()).toMatchObject({
    provider: "openai",
    modelName: entries[0].modelId,
  });
  // Pending disk saves cannot change this immutable startup process catalog.
  expect(network).not.toHaveBeenCalled();
  vi.spyOn(modelSettings, "read").mockImplementation(() => {
    throw new Error("sentinel-private-db");
  });
  expect(GET().status).toBe(503);
  expect(await GET().text()).not.toContain("sentinel");
  vi.spyOn(modelSettings, "save").mockImplementation(() => {
    throw new Error("sentinel-private-db");
  });
  const failed = await patch({ modelId: null });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("sentinel");
  (await import("@/lib/db/connection")).getDatabase().close();
});
