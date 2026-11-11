import { validateChatCatalog } from "./catalog";
import type { ChatCatalog, ChatEntry } from "./contracts";

/** The existing restart-only scalar carries a versioned exact choice. Legacy
 * values remain readable without passive migration or a catalog default. */
export function summarySelection(raw: string): ChatEntry | null {
  if (!raw || raw === "unselected") return null;
  if (raw === "gpt-6-luna")
    return { id: "entry_legacy_summary", provider: "openai", modelId: raw };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const record = value as Record<string, unknown>;
    if (!(
      (record.version === 1 &&
        Object.keys(record).length === 4 &&
        record.provider !== "chatgpt") ||
      (record.version === 2 &&
        Object.keys(record).length === 5 &&
        record.provider === "chatgpt")
    ))
      throw new Error();
    return validateChatCatalog({
      version: 1,
      entries: [
        {
          id: record.entryId,
          provider: record.provider,
          modelId: record.modelId,
          ...(record.version === 2
            ? { registrationId: record.registrationId }
            : {}),
        },
      ],
      defaultEntryId: null,
    }).entries[0];
  } catch {
    throw new Error("summary_selection_unsupported_preserve_settings");
  }
}

export function resolveSummarySelection(
  raw: string,
  catalog: ChatCatalog,
): ChatEntry | null {
  const selected = summarySelection(raw);
  if (!selected || raw === "gpt-6-luna") return selected;
  const entry = catalog.entries.find((entry) => entry.id === selected.id);
  if (
    !entry ||
    entry.provider !== selected.provider ||
    entry.modelId !== selected.modelId ||
    entry.registrationId !== selected.registrationId
  )
    throw new Error("summary_selected_entry_changed_choose_explicitly");
  return selected;
}

/** Manual overrides are exact catalog choices, never the legacy default scalar. */
export function parseSummaryOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const record: unknown = JSON.parse(value);
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      ![
        "entryId,modelId,provider,version",
        "entryId,modelId,provider,registrationId,version",
      ].includes(Object.keys(record).sort().join()) ||
      !summarySelection(value)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function encodeSummarySelection(entry: ChatEntry): string {
  const raw = JSON.stringify({
    version: entry.provider === "chatgpt" ? 2 : 1,
    ...(entry.provider === "chatgpt"
      ? { registrationId: entry.registrationId }
      : {}),
    entryId: entry.id,
    provider: entry.provider,
    modelId: entry.modelId,
  });
  summarySelection(raw);
  return raw;
}
