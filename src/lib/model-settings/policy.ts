import type { ModelConfiguration, ModelSettingsSnapshot } from "./contracts";
import { entryLabel, isChatEntryId } from "./catalog";

export function isChatModelId(value: unknown): value is string {
  return isChatEntryId(value);
}

// New metadata presence, including the explicit empty reset sentinel, wins.
// Original legacy bytes stay untouched; only exact provider/model maps once.
export function modelSettingsSnapshot(
  stored: string | null,
  config: ModelConfiguration,
  legacy: string | null = null,
): ModelSettingsSnapshot {
  const options = config.catalog.entries.map((entry) => {
    const available = config.configured[entry.provider];
    return {
      ...entry,
      label: entryLabel(entry),
      available,
      ...(!available
        ? {
            unavailableReason:
              "Provider key is not configured. Update native Settings, quit and reopen.",
          }
        : {}),
    };
  });
  let selected: string | null = null;
  let unresolved = false;
  const saved = stored !== null ? Boolean(stored) : Boolean(legacy);
  if (stored !== null && stored !== "") {
    if (isChatEntryId(stored)) selected = stored;
    else unresolved = true;
  } else if (stored === null && legacy) {
    const provider =
      legacy === "gpt-6-luna"
        ? "openai"
        : legacy === "deepseek-flash"
          ? "deepseek"
          : null;
    const matches = options.filter(
      (entry) => entry.provider === provider && entry.modelId === legacy,
    );
    if (matches.length === 1) selected = matches[0].id;
    else unresolved = true;
  }
  const identity = saved ? selected : config.catalog.defaultEntryId;
  const entry = unresolved
    ? undefined
    : options.find((option) => option.id === identity);
  const available = Boolean(entry?.available);
  const reason = unresolved
    ? "The preserved legacy or invalid preference cannot resolve exactly. Add its exact provider/model in Settings and restart, choose another entry, or reset explicitly."
    : !entry
      ? saved
        ? "The saved entry is no longer in the activated catalog. Choose another entry or reset explicitly."
        : "No default chat model. Choose an entry, or configure the catalog/default in native Settings and restart."
      : entry.unavailableReason;
  return {
    version: 2,
    options,
    selected,
    defaultEntryId: config.catalog.defaultEntryId,
    effective: {
      entryId: identity,
      provider: entry?.provider ?? null,
      modelName: entry?.modelId ?? null,
      source: saved ? "saved" : "env",
      available,
    },
    ...(!available ? { unavailableReason: reason } : {}),
  };
}
