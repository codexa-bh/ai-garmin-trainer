export const DEFAULT_CONVERSATION_ID = "default";
export const GENERIC_CONVERSATION_TITLES = new Set([
  "Trainer chat",
  "New chat",
]);

export function safeConversationId(value: string | null | undefined): string {
  const candidate = value?.trim() || DEFAULT_CONVERSATION_ID;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(candidate)) {
    throw new Error(
      "Conversation id must be a local opaque id with letters, numbers, dashes, underscores, dots, or colons only",
    );
  }
  return candidate;
}

export function normalizeConversationTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) throw new Error("Conversation title cannot be empty");
  return compact.length > 48 ? `${compact.slice(0, 47)}…` : compact;
}

export function initialConversationTitle(value: string): string {
  try {
    return normalizeConversationTitle(value);
  } catch {
    return "New chat";
  }
}
