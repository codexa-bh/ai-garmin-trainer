import { describe, expect, it } from "vitest";
import {
  encodeSummarySelection,
  resolveSummarySelection,
  summarySelection,
} from "@/lib/model-settings/summary-selection";
import {
  summaryConfiguration,
  densifyModels,
} from "@/lib/memory/summary-configuration";
import { parseSummaryCommand } from "@/lib/memory/summary-controls";
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
  it("exposes read-only eligible manual options without substituting an unavailable default", () => {
    const env = getOptionalEnv({
      SUMMARY_MODEL: "gpt-6-luna",
      OPENAI_API_KEY: "<placeholder>",
      OPENROUTER_API_KEY: "synthetic-router",
      CHAT_MODEL_CATALOG: JSON.stringify(catalog),
    });
    const before = JSON.stringify(env);
    expect(densifyModels(env)).toEqual({
      default: { label: "openai / gpt-6-luna", available: false },
      options: [
        { value: raw, label: "openrouter / Vendor/模型:Case" },
        {
          value: encodeSummarySelection(catalog.entries[1]),
          label: "ollama / Vendor/模型:Case",
        },
      ],
    });
    expect(
      densifyModels({ ...env, SUMMARY_MODEL: "unselected" }).default,
    ).toEqual({ label: "Unselected memory model", available: false });
    expect(
      densifyModels({
        ...env,
        SUMMARY_MODEL: raw,
        CHAT_MODEL_CATALOG: JSON.stringify({ ...catalog, entries: [] }),
      }).default,
    ).toEqual({ label: "openrouter / Vendor/模型:Case", available: false });
    expect(JSON.stringify(env)).toBe(before);
    expect(JSON.stringify(densifyModels(env))).not.toContain(
      "synthetic-router",
    );
  });
  it("admits only a closed exact manual-request override; old omitted default remains valid", () => {
    const command = {
      version: 2,
      expected: { revision: 0, privacy: 0, control: 0, manual: 0 },
      action: "densify-request",
      id: "request",
    };
    expect(parseSummaryCommand(command)).not.toBeNull();
    expect(parseSummaryCommand({ ...command, model: raw })).not.toBeNull();
    for (const model of [
      null,
      {},
      1,
      "gpt-6-luna",
      "unselected",
      "bad-json",
      JSON.stringify({ ...JSON.parse(raw), extra: true }),
      JSON.stringify({ ...JSON.parse(raw), provider: "bad" }),
      JSON.stringify({ ...JSON.parse(raw), modelId: "" }),
    ]) {
      expect(parseSummaryCommand({ ...command, model })).toBeNull();
    }
    for (const action of [
      "densify-accept",
      "densify-discard",
      "densify-cancel",
      "retry",
    ]) {
      expect(
        parseSummaryCommand({ ...command, action, model: raw }),
      ).toBeNull();
    }
  });
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
