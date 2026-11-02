import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createModelSettings } from "@/lib/model-settings/application";
import type { ModelConfiguration } from "@/lib/model-settings/contracts";
import { decodeChoice, priorChoice } from "@/lib/model-settings/policy";
import { getOptionalEnv, hasConfiguredSecret } from "@/lib/env";
const config = (): ModelConfiguration => ({
  catalog: {
    version: 1,
    entries: [
      { id: "entry_openai", provider: "openai", modelId: "gpt-6-luna" },
      { id: "entry_deepseek", provider: "deepseek", modelId: "deepseek-flash" },
      { id: "entry_local", provider: "ollama", modelId: "Vendor/Local:Tag" },
    ],
    defaultEntryId: "entry_local",
  },
  configured: { openai: true, deepseek: true, ollama: true, openrouter: false },
});
function fixture(v2: string | null = null, legacy: string | null = null) {
  let current: string | null = null;
  const configuration = config();
  const write = vi.fn((value: string) => {
    current = value;
  });
  const initialize = vi.fn((value: string) => {
    if (current === null) current = value;
  });
  const app = createModelSettings({
    readChoice: () => current,
    initializeChoice: initialize,
    writeChoice: write,
    readPreference: () => v2,
    readLegacyPreference: () => legacy,
    configuration: () => configuration,
  });
  return {
    app,
    configuration,
    initialize,
    write,
    corrupt: (value: string) => {
      current = value;
    },
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each([
  ["entry_openai", "deepseek-flash", "selected", "entry_openai"],
  ["entry_deleted", null, "selected", "entry_deleted"],
  ["private-corrupt", null, "unresolved", undefined],
  [null, "gpt-6-luna", "selected", "entry_openai"],
  [null, "deepseek-flash", "selected", "entry_deepseek"],
  [null, "unknown-private", "unresolved", undefined],
  ["", "gpt-6-luna", "selected", "entry_local"],
  [null, null, "selected", "entry_local"],
])("captures exact prior intent once: %s/%s", (v2, legacy, status, entryId) => {
  expect(priorChoice(v2, legacy, config())).toEqual({
    version: 1,
    status,
    ...(entryId ? { entryId } : {}),
  });
  const f = fixture(v2, legacy);
  const first = f.app.read();
  expect(first.status).toBe(status);
  expect(first.selected).toBe(entryId ?? null);
  f.configuration.catalog.defaultEntryId = "entry_deepseek";
  expect(f.app.read()).toEqual(first);
  expect(f.initialize).toHaveBeenCalledOnce();
  expect(f.write).not.toHaveBeenCalled();
  expect(JSON.stringify(first)).not.toMatch(
    /private-corrupt|unknown-private|defaultEntryId|effective|source/,
  );
});
it("does not provider-only map a custom or ambiguous legacy identity", () => {
  const c = config();
  c.catalog.entries[0].modelId = "Custom:Tag";
  expect(priorChoice(null, "gpt-6-luna", c).status).toBe("unresolved");
  c.catalog.entries.push({ ...c.catalog.entries[1], id: "entry_duplicate" });
  expect(priorChoice(null, "deepseek-flash", c).status).toBe("unresolved");
});
it.each([null, ""])(
  "processes no prior default without first-row selection (%s)",
  (v2) => {
    const f = fixture(v2);
    f.configuration.catalog.defaultEntryId = null;
    expect(f.app.read()).toMatchObject({
      selected: null,
      status: "unselected",
      available: false,
    });
    f.configuration.catalog.defaultEntryId = "entry_local";
    expect(f.app.read().selected).toBeNull();
    expect(() => f.app.selection()).toThrow(/Choose a model/);
  },
);
it("retains original catalog solely for same-DB compatibility after Settings Save/removal", () => {
  const f = fixture(null, "gpt-6-luna");
  f.configuration.compatibilityCatalog = structuredClone(
    f.configuration.catalog,
  );
  f.configuration.catalog = { version: 1, entries: [], defaultEntryId: null };
  expect(f.app.read()).toMatchObject({
    selected: "entry_openai",
    available: false,
  });
  const c = config();
  c.compatibilityCatalog = null;
  expect(priorChoice(null, null, c).status).toBe("unselected");
});
it("keeps exact missing/deleted choice through keys/catalog changes and rejects null reset", () => {
  const f = fixture("entry_openai");
  f.configuration.configured.openai = false;
  expect(f.app.read()).toMatchObject({
    selected: "entry_openai",
    available: false,
  });
  expect(() => f.app.selection()).toThrow(/key/);
  f.configuration.configured.openai = true;
  expect(f.app.selection().id).toBe("entry_openai");
  f.configuration.catalog.entries.shift();
  expect(f.app.read()).toMatchObject({
    selected: "entry_openai",
    available: false,
  });
  for (const body of [
    null,
    [],
    {},
    { modelId: null },
    { modelId: false },
    { modelId: "invalid" },
    { modelId: "entry_local", key: "no" },
  ])
    expect(() => f.app.save(body)).toThrow(/Choose an activated/);
  expect(() => f.app.save({ modelId: "entry_deleted" })).toThrow(/absent/);
  f.configuration.configured.deepseek = false;
  expect(() => f.app.save({ modelId: "entry_deepseek" })).toThrow(/ineligible/);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.app.save({ modelId: "entry_local" })).toMatchObject({
    selected: "entry_local",
    available: true,
  });
  f.write.mockImplementationOnce(() => {
    throw Error("private storage");
  });
  expect(() => f.app.save({ modelId: "entry_local" })).toThrow();
});
it.each([
  '{"version":99,"status":"unselected"}',
  "private-corrupt",
  '{"version":1,"status":"selected","entryId":"invalid"}',
  '{"version":1,"status":"unselected","extra":true}',
])("does not overwrite unknown authority: %s", (raw) => {
  const f = fixture();
  f.corrupt(raw);
  expect(() => f.app.read()).toThrow();
  expect(() => f.app.save({ modelId: "entry_local" })).toThrow();
  expect(f.initialize).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});
it("fails closed on initialization failure or no committed result; concurrent explicit winner wins", () => {
  const f = fixture();
  f.initialize.mockImplementationOnce(() => {
    throw Error("private storage");
  });
  expect(() => f.app.selection()).toThrow();
  f.initialize.mockImplementationOnce(() => {});
  expect(() => f.app.read()).toThrow(/initialized/);
  f.initialize.mockImplementationOnce(() =>
    f.corrupt(
      JSON.stringify({
        version: 1,
        status: "selected",
        entryId: "entry_deepseek",
      }),
    ),
  );
  expect(f.app.selection().id).toBe("entry_deepseek");
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
  expect(
    hasConfiguredSecret(getOptionalEnv({ OPENAI_API_KEY: key }).OPENAI_API_KEY),
  ).toBe(false);
});

it("persists current choice on reopen, isolates DBs and preserves original preference bytes/independent extraction", async () => {
  const root = mkdtempSync(join(tmpdir(), "trainer-choice-"));
  vi.stubEnv("DATABASE_PATH", join(root, "a.sqlite"));
  vi.stubEnv("OPENAI_API_KEY", "sentinel-private-secret");
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_MODEL", "independent-extractor");
  vi.stubEnv("CHAT_MODEL_CATALOG", JSON.stringify(config().catalog));
  const repo = await import("@/lib/db/repository");
  repo.setAppMetadata("ai.chat_model", "original-private-unresolved");
  repo.setAppMetadata("ai.chat_model.v2", "");
  const { modelSettings, selectedTrainerModel } =
    await import("@/lib/model-settings/composition");
  const ai = await import("@/lib/ai/providers");
  const extraction = ai.selectedMemoryExtractionModel();
  expect(modelSettings.selection().id).toBe("entry_local");
  modelSettings.save({ modelId: "entry_openai" });
  expect(selectedTrainerModel()).toMatchObject({
    provider: "openai",
    modelName: "gpt-6-luna",
  });
  expect(ai.selectedMemoryExtractionModel()).toMatchObject({
    provider: extraction?.provider,
    modelName: extraction?.modelName,
  });
  expect(repo.getAppMetadata("ai.chat_model")).toBe(
    "original-private-unresolved",
  );
  expect(repo.getAppMetadata("ai.chat_model.v2")).toBe("");
  const committed = repo.getAppMetadata("ai.chat_model.choice")!;
  repo.initializeAppMetadata(
    "ai.chat_model.choice",
    JSON.stringify({ version: 1, status: "unselected" }),
  );
  expect(repo.getAppMetadata("ai.chat_model.choice")).toBe(committed);
  (await import("@/lib/db/connection")).getDatabase().close();
  vi.resetModules();
  expect(
    (await import("@/lib/model-settings/composition")).modelSettings.selection()
      .id,
  ).toBe("entry_openai");
  (await import("@/lib/db/connection")).getDatabase().close();
  vi.resetModules();
  vi.stubEnv("DATABASE_PATH", join(root, "b.sqlite"));
  vi.stubEnv("CHAT_SELECTION_COMPATIBILITY", "null");
  const b = await import("@/lib/model-settings/composition");
  expect(b.modelSettings.read()).toMatchObject({
    selected: null,
    status: "unselected",
    available: false,
  });
  const network = vi.spyOn(globalThis, "fetch");
  const route = await import("@/app/api/model-settings/route");
  expect(route.GET().headers.get("Cache-Control")).toBe("no-store");
  expect(await route.GET().text()).not.toMatch(
    /sentinel|API_KEY|DATABASE_PATH|independent-extractor|original-private/,
  );
  expect(
    (
      await route.PATCH(
        new Request("http://localhost/api/model-settings", {
          method: "PATCH",
          body: JSON.stringify({ modelId: null }),
        }),
      )
    ).status,
  ).toBe(400);
  expect(network).not.toHaveBeenCalled();
  expect(
    decodeChoice(
      (await import("@/lib/db/repository")).getAppMetadata(
        "ai.chat_model.choice",
      )!,
    ).status,
  ).toBe("unselected");
  (await import("@/lib/db/connection")).getDatabase().close();
});
it("keeps route errors safe and noncacheable including unknown write outcome", async () => {
  const { modelSettings } = await import("@/lib/model-settings/composition");
  const route = await import("@/app/api/model-settings/route");
  vi.spyOn(modelSettings, "read").mockImplementation(() => {
    throw Error("private-storage");
  });
  const read = route.GET();
  expect(read.status).toBe(503);
  expect(read.headers.get("Cache-Control")).toBe("no-store");
  expect(await read.text()).not.toContain("private-storage");
  const bad = await route.PATCH(
    new Request("http://localhost/api/model-settings", {
      method: "PATCH",
      body: "{",
    }),
  );
  expect(bad.status).toBe(400);
  expect(bad.headers.get("Cache-Control")).toBe("no-store");
  vi.spyOn(modelSettings, "save").mockImplementation(() => {
    throw Error("private-storage");
  });
  const save = await route.PATCH(
    new Request("http://localhost/api/model-settings", {
      method: "PATCH",
      body: '{"modelId":"entry_local"}',
    }),
  );
  expect(save.status).toBe(503);
  expect(await save.text()).not.toContain("private-storage");
});
