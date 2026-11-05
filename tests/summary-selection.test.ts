import { describe, expect, it } from "vitest";
import {
  encodeSummarySelection,
  resolveSummarySelection,
  summarySelection,
} from "@/lib/model-settings/summary-selection";
import { summaryConfiguration } from "@/lib/memory/summary-configuration";
import { getOptionalEnv } from "@/lib/env";
import { activationEnvironment } from "../scripts/desktop/settings";
import type { ChatEntry } from "@/lib/model-settings/contracts";

const entry: ChatEntry = {
  id: "entry_chosen",
  provider: "openrouter",
  modelId: "Vendor/模型:Case",
  displayName: "inert",
};
const catalog = {
  version: 1 as const,
  entries: [
    entry,
    { ...entry, id: "entry_other", provider: "ollama" as const },
  ],
  defaultEntryId: null,
};
const raw = encodeSummarySelection(entry);

describe("exact independent shared summary/title choice", () => {
  it("preserves case, Unicode, provider and identity; legacy intent has no catalog prerequisite", () => {
    expect(summarySelection(raw)).toEqual({
      id: entry.id,
      provider: entry.provider,
      modelId: entry.modelId,
    });
    expect(resolveSummarySelection(raw, catalog)).toEqual(
      summarySelection(raw),
    );
    expect(summarySelection("unselected")).toBeNull();
    expect(
      resolveSummarySelection("gpt-6-luna", { ...catalog, entries: [] }),
    ).toMatchObject({ provider: "openai", modelId: "gpt-6-luna" });
  });
  it.each([
    { ...entry, modelId: "vendor/模型:Case" },
    { ...entry, provider: "ollama" as const },
    { ...entry, id: "entry_replaced" },
  ])("refuses edit/removal rather than remap to %j", (changed) => {
    expect(() =>
      resolveSummarySelection(raw, { ...catalog, entries: [changed] }),
    ).toThrow("summary_selected_entry_changed");
  });
  it.each([
    "not-json",
    '{"version":2}',
    JSON.stringify({
      version: 1,
      entryId: entry.id,
      provider: "openrouter",
      modelId: entry.modelId,
      extra: true,
    }),
  ])("refuses unsupported saved selection without fallback: %s", (value) => {
    expect(() => getOptionalEnv({ SUMMARY_MODEL: value })).toThrow();
  });
  it("captures exact shared configuration independently of Trainer default and keys", () => {
    const env = getOptionalEnv({
      SUMMARY_MODEL: raw,
      CHAT_MODEL_CATALOG: JSON.stringify(catalog),
      OPENROUTER_API_KEY: "synthetic-router",
      AI_PROVIDER: "openai",
      AI_MODEL: "other-chat",
    });
    const captured = summaryConfiguration(env)!;
    expect(captured.entry.provider).toBe("openrouter");
    expect(captured.env).toMatchObject({
      AI_PROVIDER: "openrouter",
      OPENROUTER_MODEL: entry.modelId,
      AI_MODEL: "other-chat",
    });
    expect(() =>
      summaryConfiguration({ ...env, OPENROUTER_API_KEY: "<placeholder>" }),
    ).toThrow("summary_provider_configuration_unavailable");
    expect(captured.env.OPENROUTER_API_KEY).toBe("synthetic-router");
    expect(
      summaryConfiguration({ ...env, SUMMARY_MODEL: "unselected" }),
    ).toBeNull();
  });
  it("round-trips the existing closed native activation without new fields and keeps archived legacy fields", () => {
    const fields = {
      DATABASE_PATH: "/unused/authored.sqlite",
      SUMMARY_MODEL: raw,
      AI_MODEL: "preserved",
      SUMMARY_ENABLED: "false",
    };
    const result = activationEnvironment(
      {
        version: 3,
        fields,
        secrets: {},
        chatCatalog: catalog,
        selectionCompatibility: {
          database: null,
          catalog: { ...catalog, entries: [] },
        },
      },
      "new",
    );
    expect(result.SUMMARY_MODEL).toBe(raw);
    expect(result.AI_MODEL).toBe("preserved");
    expect(Object.keys(JSON.parse(raw))).toEqual([
      "version",
      "entryId",
      "provider",
      "modelId",
    ]);
  });
});
