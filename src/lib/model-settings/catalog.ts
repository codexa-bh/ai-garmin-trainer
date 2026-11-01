import type { ChatCatalog, ChatEntry, ChatProvider } from "./contracts";

const providers: readonly string[] = [
  "openai",
  "deepseek",
  "ollama",
  "openrouter",
];
const ownKeys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  value.length <= limit &&
  value.trim().length > 0 &&
  !containsControlCharacters(value);

export function isChatEntryId(value: unknown): value is string {
  return typeof value === "string" && /^entry_[A-Za-z0-9_-]{1,74}$/.test(value);
}

// Boundary validation is intentionally SDK/env/storage independent. Preserve
// literal IDs: case, provider slashes and local colon tags are significant.
export function validateChatCatalog(value: unknown): ChatCatalog {
  if (
    !object(value) ||
    !ownKeys(value, ["version", "entries", "defaultEntryId"]) ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 32
  )
    throw new Error(
      "Invalid chat catalog version or size (maximum 32 entries).",
    );
  const ids = new Set<string>();
  const tuples = new Set<string>();
  const entries: ChatEntry[] = value.entries.map((raw: unknown) => {
    if (
      !object(raw) ||
      !ownKeys(raw, ["id", "provider", "modelId", "displayName"]) ||
      !isChatEntryId(raw.id) ||
      typeof raw.provider !== "string" ||
      !providers.includes(raw.provider) ||
      !text(raw.modelId, 256) ||
      (raw.displayName !== undefined && !text(raw.displayName, 80))
    )
      throw new Error(
        "Each chat entry needs a stable identity, supported provider and nonblank bounded model/name without controls.",
      );
    const tuple = JSON.stringify([raw.provider, raw.modelId]);
    if (ids.has(raw.id)) throw new Error("Duplicate chat entry identity.");
    if (tuples.has(tuple))
      throw new Error("This provider and exact model ID already exist.");
    ids.add(raw.id);
    tuples.add(tuple);
    return {
      id: raw.id,
      provider: raw.provider as ChatProvider,
      modelId: raw.modelId,
      ...(raw.displayName !== undefined
        ? { displayName: raw.displayName as string }
        : {}),
    };
  });
  if (
    value.defaultEntryId !== null &&
    (!isChatEntryId(value.defaultEntryId) || !ids.has(value.defaultEntryId))
  )
    throw new Error(
      "Choose an existing default entry or explicitly clear the default.",
    );
  return {
    version: 1,
    entries,
    defaultEntryId: value.defaultEntryId as string | null,
  };
}

export function entryLabel(entry: ChatEntry): string {
  return `${entry.displayName ? `${entry.displayName} — ` : ""}${entry.provider} / ${entry.modelId}`;
}

// Used only by legacy read-only activation/migration. Never infers catalog
// entries from old saved preference strings or chooses the first eligible row.
export function legacyChatCatalog(
  fields: Record<string, string | undefined>,
  configured: { openai: boolean; deepseek: boolean },
): ChatCatalog {
  const entries: ChatEntry[] = [
    {
      id: "entry_legacy_openai",
      provider: "openai",
      modelId: fields.AI_MODEL ?? "gpt-6-luna",
    },
    {
      id: "entry_legacy_deepseek",
      provider: "deepseek",
      modelId: fields.DEEPSEEK_MODEL ?? "deepseek-flash",
    },
    {
      id: "entry_legacy_ollama",
      provider: "ollama",
      modelId: fields.OLLAMA_MODEL ?? "qwen3.5:4b",
    },
    {
      id: "entry_legacy_openrouter",
      provider: "openrouter",
      // Legacy getOptionalEnv trimmed this one field before adapter routing.
      // Preserve its actual prior ID; new catalog IDs are never normalized.
      modelId: (
        fields.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-lightning:free"
      ).trim(),
    },
  ];
  const requested = fields.AI_PROVIDER ?? "auto";
  const provider =
    requested === "auto"
      ? configured.deepseek
        ? "deepseek"
        : configured.openai
          ? "openai"
          : null
      : requested;
  return validateChatCatalog({
    version: 1,
    entries,
    defaultEntryId:
      entries.find((entry) => entry.provider === provider)?.id ?? null,
  });
}
