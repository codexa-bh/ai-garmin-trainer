import type { ModelConfiguration, ModelSettingsSnapshot } from "./contracts";
import { entryLabel, isChatEntryId } from "./catalog";

export const isChatModelId = isChatEntryId;
export type TrainerChoice =
  | { version: 1; status: "selected"; entryId: string }
  | { version: 1; status: "unselected" | "unresolved" };

// Presence is authoritative, including unsupported/corrupt records. Never repair
// those by silently reading legacy inputs or overwriting them on explicit Save.
export function decodeChoice(raw: string): TrainerChoice {
  let value: unknown;
  try {
    if (raw.length > 256) throw new Error();
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "Saved Trainer choice invalid. Preserve it and use a compatible build.",
    );
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (
      v.version === 1 &&
      ((v.status === "selected" &&
        isChatEntryId(v.entryId) &&
        Object.keys(v).length === 3) ||
        (["unselected", "unresolved"].includes(v.status as string) &&
          Object.keys(v).length === 2))
    )
      return value as TrainerChoice;
  }
  throw new Error(
    "Saved Trainer choice unsupported. Preserve it and use a compatible build.",
  );
}

// One-time, original-preserving compatibility, not the normal resolver.
export function priorChoice(
  stored: string | null,
  legacy: string | null,
  config: ModelConfiguration,
): TrainerChoice {
  const selected = (entryId: string): TrainerChoice => ({
    version: 1,
    status: "selected",
    entryId,
  });
  const unresolved: TrainerChoice = { version: 1, status: "unresolved" };
  if (stored !== null && stored !== "")
    return isChatEntryId(stored) ? selected(stored) : unresolved;
  const prior =
    config.compatibilityCatalog === undefined
      ? config.catalog
      : config.compatibilityCatalog;
  if (stored === null && legacy) {
    const provider =
      legacy === "gpt-6-luna"
        ? "openai"
        : legacy === "deepseek-flash"
          ? "deepseek"
          : null;
    const matches =
      prior?.entries.filter(
        (entry) => entry.provider === provider && entry.modelId === legacy,
      ) ?? [];
    return matches.length === 1 ? selected(matches[0].id) : unresolved;
  }
  return prior?.defaultEntryId
    ? selected(prior.defaultEntryId)
    : { version: 1, status: "unselected" };
}

export function modelSettingsSnapshot(
  choice: TrainerChoice,
  config: ModelConfiguration,
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
              "Provider key is not configured. Save in native Settings and confirm live application; retry availability.",
          }
        : {}),
    };
  });
  const selected = choice.status === "selected" ? choice.entryId : null;
  const entry = options.find((option) => option.id === selected);
  const available = Boolean(entry?.available);
  const reason =
    choice.status === "unresolved"
      ? "The preserved prior choice cannot resolve exactly. Choose an available model explicitly."
      : choice.status === "unselected"
        ? "Choose a model explicitly to use Trainer chat."
        : !entry
          ? "The selected entry is no longer in the activated catalog. Choose another model explicitly."
          : entry.unavailableReason;
  return {
    version: 3,
    options,
    selected,
    status: choice.status,
    available,
    ...(!available ? { unavailableReason: reason } : {}),
  };
}
