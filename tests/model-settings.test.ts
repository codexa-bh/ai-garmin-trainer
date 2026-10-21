import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelSettings } from "@/lib/model-settings/application";
import type { ModelConfiguration } from "@/lib/model-settings/contracts";
import { modelSettingsSnapshot } from "@/lib/model-settings/policy";
import { getOptionalEnv, hasConfiguredSecret } from "@/lib/env";

const inherited = {
  provider: "ollama",
  modelName: "custom-local",
  available: true,
};
function fixture() {
  let stored: string | null = null;
  const config: ModelConfiguration = {
    deepseekConfigured: true,
    openaiConfigured: true,
    inherited,
  };
  const write = vi.fn((value: string) => {
    stored = value;
  });
  const app = createModelSettings({
    readPreference: () => stored,
    writePreference: write,
    configuration: () => config,
  });
  return {
    app,
    config,
    write,
    corrupt: (value: string) => {
      stored = value;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runtime model rules and application", () => {
  it.each([
    [true, true, ["deepseek-flash", "gpt-6-luna"]],
    [true, false, ["deepseek-flash"]],
    [false, true, ["gpt-6-luna"]],
    [false, false, []],
  ] as const)(
    "lists only configured models (%s/%s)",
    (deepseekConfigured, openaiConfigured, ids) => {
      const snapshot = modelSettingsSnapshot(null, {
        deepseekConfigured,
        openaiConfigured,
        inherited,
      });
      expect(snapshot.options.map((option) => option.id)).toEqual(ids);
      expect(snapshot.effective).toEqual({ ...inherited, source: "env" });
    },
  );
  it.each([
    undefined,
    "",
    "   ",
    "...",
    "<secret>",
    "replace-with-key",
    "your_api_key",
    "placeholder-key",
  ])("ignores absent/placeholder credentials: %s", (key) => {
    const env = getOptionalEnv({ OPENAI_API_KEY: key, DEEPSEEK_API_KEY: key });
    expect(
      modelSettingsSnapshot(null, {
        deepseekConfigured: hasConfiguredSecret(env.DEEPSEEK_API_KEY),
        openaiConfigured: hasConfiguredSecret(env.OPENAI_API_KEY),
        inherited,
      }).options,
    ).toEqual([]);
  });
  it("validates before mutation, fails closed on lost keys/corrupt storage, and explicitly resets", () => {
    const { app, config, write, corrupt } = fixture();
    expect(app.selection()).toBeNull();
    expect(app.save({ modelId: "deepseek-flash" })).toMatchObject({
      selected: "deepseek-flash",
      effective: {
        provider: "deepseek",
        modelName: "deepseek-flash",
        source: "saved",
        available: true,
      },
    });
    for (const body of [
      null,
      [],
      {},
      "gpt-6-luna",
      { modelId: false },
      { modelId: 3 },
      { modelId: "forged-secret" },
    ]) {
      expect(() => app.save(body)).toThrow(/Choose an available model/);
    }
    config.openaiConfigured = false;
    expect(() => app.save({ modelId: "gpt-6-luna" })).toThrow(/not configured/);
    expect(write).toHaveBeenCalledTimes(1);
    expect(app.selection()).toBe("deepseek-flash");
    config.deepseekConfigured = false;
    expect(app.read()).toMatchObject({
      options: [],
      selected: "deepseek-flash",
      effective: { available: false, source: "saved" },
    });
    expect(() => app.selection()).toThrow(/saved model/);
    config.openaiConfigured = true;
    expect(app.save({ modelId: "gpt-6-luna" }).effective.available).toBe(true);
    corrupt("secret-corrupt-stored-id");
    expect(app.read()).toMatchObject({
      selected: null,
      effective: { source: "saved", available: false },
    });
    expect(JSON.stringify(app.read())).not.toContain("secret-corrupt");
    expect(() => app.selection()).toThrow(/invalid/);
    expect(app.save({ modelId: null }).effective).toEqual({
      ...inherited,
      source: "env",
    });
    expect(app.selection()).toBeNull();
    write.mockImplementationOnce(() => {
      throw new Error("private storage details");
    });
    expect(() => app.save({ modelId: "gpt-6-luna" })).toThrow();
    expect(app.selection()).toBeNull();
  });
});

it("persists through fresh compositions/connections, preserves env/extraction and exposes only safe API DTOs/errors", async () => {
  vi.resetModules();
  const path = join(
    mkdtempSync(join(tmpdir(), "model-settings-")),
    "trainer.sqlite",
  );
  vi.stubEnv("DATABASE_PATH", path);
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_MODEL", "custom-openai-model");
  vi.stubEnv("DEEPSEEK_MODEL", "custom-deepseek-model");
  vi.stubEnv("OPENAI_API_KEY", "sentinel-openai-secret");
  vi.stubEnv("DEEPSEEK_API_KEY", "sentinel-deepseek-secret");
  const { modelSettings, selectedTrainerModel } =
    await import("@/lib/model-settings/composition");
  const providers = await import("@/lib/ai/providers");
  const network = vi.spyOn(globalThis, "fetch");
  const extraction = providers.selectedMemoryExtractionModel();
  expect(selectedTrainerModel()).toMatchObject({
    provider: "openai",
    modelName: "custom-openai-model",
  });
  const { GET, PATCH } = await import("@/app/api/model-settings/route");
  const patch = (body: unknown) =>
    PATCH(
      new Request("http://localhost/api/model-settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  expect((await patch({ modelId: "deepseek-flash" })).status).toBe(200);
  expect(selectedTrainerModel()).toMatchObject({
    provider: "deepseek",
    modelName: "deepseek-flash",
  });
  expect(providers.selectedMemoryExtractionModel()).toMatchObject({
    provider: extraction?.provider,
    modelName: extraction?.modelName,
  });
  expect(process.env.AI_MODEL).toBe("custom-openai-model");
  const { getDatabase } = await import("@/lib/db/connection");
  getDatabase().close();
  vi.resetModules();
  const fresh = await import("@/lib/model-settings/composition");
  expect(fresh.modelSettings.selection()).toBe("deepseek-flash");
  vi.stubEnv("DEEPSEEK_API_KEY", "placeholder-key");
  expect(() => fresh.selectedTrainerModel()).toThrow(/not configured/);
  const newRoute = await import("@/app/api/model-settings/route");
  const stale = await newRoute.PATCH(
    new Request("http://localhost/api/model-settings", {
      method: "PATCH",
      body: JSON.stringify({ modelId: "deepseek-flash" }),
    }),
  );
  expect(stale.status).toBe(400);
  expect(fresh.modelSettings.read().selected).toBe("deepseek-flash");
  expect(
    (
      await newRoute.PATCH(
        new Request("http://localhost/api/model-settings", {
          method: "PATCH",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  const response = newRoute.GET();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const text = await response.text();
  expect(text).not.toMatch(/sentinel-|API_KEY|DATABASE_PATH/);
  fresh.modelSettings.save({ modelId: "gpt-6-luna" });
  expect(fresh.selectedTrainerModel()).toMatchObject({
    provider: "openai",
    modelName: "gpt-6-luna",
  });
  fresh.modelSettings.save({ modelId: null });
  expect(fresh.selectedTrainerModel()).toMatchObject({
    provider: "openai",
    modelName: "custom-openai-model",
  });
  for (const provider of ["ollama", "openrouter"] as const) {
    vi.stubEnv("AI_PROVIDER", provider);
    vi.stubEnv("OPENROUTER_API_KEY", "sentinel-router-secret");
    expect(fresh.selectedTrainerModel().provider).toBe(provider);
    expect(fresh.modelSettings.read().effective).toMatchObject({
      provider,
      source: "env",
    });
  }
  expect(network).not.toHaveBeenCalled();
  const read = vi.spyOn(modelSettings, "read").mockImplementation(() => {
    throw new Error("sentinel-private-db");
  });
  expect(GET().status).toBe(503);
  expect(await GET().text()).not.toContain("sentinel");
  read.mockRestore();
  vi.spyOn(modelSettings, "save").mockImplementation(() => {
    throw new Error("sentinel-private-db");
  });
  const failed = await patch({ modelId: null });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("sentinel");
  (await import("@/lib/db/connection")).getDatabase().close();
});
