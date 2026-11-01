import { describe, expect, it } from "vitest";
import {
  entryLabel,
  legacyChatCatalog,
  validateChatCatalog,
} from "../src/lib/model-settings/catalog";
import type { ChatEntry } from "../src/lib/model-settings/contracts";

const entry = (id = "entry_one", modelId = "Vendor/Model:Tag"): ChatEntry => ({
  id,
  modelId,
  provider: "openrouter",
  displayName: "Fast",
});
const catalog = (
  entries = [entry()],
  defaultEntryId: string | null = "entry_one",
) => ({ version: 1, entries, defaultEntryId });
describe("bounded cross-provider catalog", () => {
  it("preserves literal IDs, insertion order, multiple models per provider and disambiguated labels", () => {
    const value = catalog([
      entry(),
      entry("entry_two", "Vendor/Second"),
      { ...entry("entry_local", "local:tag"), provider: "ollama" },
    ]);
    expect(validateChatCatalog(value)).toEqual(value);
    expect(entryLabel(value.entries[0])).toBe(
      "Fast — openrouter / Vendor/Model:Tag",
    );
    expect(entryLabel(value.entries[1])).toBe(
      "Fast — openrouter / Vendor/Second",
    );
    expect(validateChatCatalog(catalog([], null)).entries).toEqual([]);
  });
  it("rejects malformed versions/identities/defaults/duplicates and controls without normalization", () => {
    for (const bad of [
      null,
      [],
      {},
      { ...catalog(), version: 2 },
      { ...catalog(), secret: "no" },
      catalog([entry(), entry()]),
      catalog([entry(), entry("entry_two")]),
      catalog([], "entry_deleted"),
      catalog([entry("gpt-6-luna")]),
      catalog([entry("entry_one", " ")]),
      catalog([{ ...entry(), provider: "auto" } as unknown as ChatEntry]),
      catalog([{ ...entry(), displayName: "" }]),
      catalog([entry("entry_one", "bad\nmodel")]),
      catalog([entry("entry_one", "bad\u007fmodel")]),
      catalog([entry("entry_one", "a".repeat(257))]),
      catalog([{ ...entry(), displayName: "a".repeat(81) }]),
      catalog(
        Array.from({ length: 33 }, (_, i) => entry(`entry_${i}`, `model:${i}`)),
      ),
      catalog([{ ...entry(), endpoint: "http://private" } as ChatEntry]),
    ])
      expect(() => validateChatCatalog(bad)).toThrow();
    expect(
      validateChatCatalog(
        catalog([entry(), entry("entry_two", "vendor/model:tag")]),
      ),
    ).toBeTruthy();
  });
  it("projects exact legacy custom IDs and explicit ineligible defaults without reading secrets", () => {
    const explicit = legacyChatCatalog(
      { AI_PROVIDER: "openai", AI_MODEL: "Custom/Case:Tag" },
      { openai: false, deepseek: true },
    );
    expect(explicit.entries[0].modelId).toBe("Custom/Case:Tag");
    expect(
      legacyChatCatalog(
        { OPENROUTER_MODEL: " Vendor/Legacy:Tag " },
        { openai: false, deepseek: false },
      ).entries[3].modelId,
    ).toBe("Vendor/Legacy:Tag");
    expect(
      validateChatCatalog(catalog([entry("entry_one", " Vendor/New:Tag ")]))
        .entries[0].modelId,
    ).toBe(" Vendor/New:Tag ");
    expect(explicit.defaultEntryId).toBe("entry_legacy_openai");
    expect(
      legacyChatCatalog({}, { openai: true, deepseek: true }).defaultEntryId,
    ).toBe("entry_legacy_deepseek");
    expect(
      legacyChatCatalog({}, { openai: true, deepseek: false }).defaultEntryId,
    ).toBe("entry_legacy_openai");
    expect(
      legacyChatCatalog({}, { openai: false, deepseek: false }).defaultEntryId,
    ).toBeNull();
    for (const provider of ["ollama", "openrouter"])
      expect(
        legacyChatCatalog(
          { AI_PROVIDER: provider },
          { openai: true, deepseek: true },
        ).defaultEntryId,
      ).toBe(`entry_legacy_${provider}`);
  });
});
