export type ChatProvider =
  "openai" | "deepseek" | "ollama" | "openrouter" | "chatgpt";
export type ChatEntry = {
  id: string;
  provider: ChatProvider;
  modelId: string;
  /** Required only for ChatGPT plan access; opaque, never an OAuth client ID. */
  registrationId?: string;
  /** Inert legacy metadata; retained for settings compatibility, never a label. */
  displayName?: string;
};
export type ChatCatalog = {
  version: 1;
  entries: ChatEntry[];
  defaultEntryId: string | null;
};
export type ChatModelId = string;
export type ModelOption = ChatEntry & {
  label: string;
  available: boolean;
  unavailableReason?: string;
};
export type ModelSettingsSnapshot = {
  version: 3;
  options: ModelOption[];
  selected: ChatModelId | null;
  status: "selected" | "unselected" | "unresolved";
  available: boolean;
  unavailableReason?: string;
};
export type ModelConfiguration = {
  catalog: ChatCatalog;
  // Undefined only for old activation/CLI inputs. Null means processed fresh configuration.
  compatibilityCatalog?: ChatCatalog | null;
  configured: Record<Exclude<ChatProvider, "chatgpt">, boolean> & {
    chatgpt?: boolean;
  };
  availableSubscriptionEntries?: string[];
  subscriptionLabels?: Record<string, string>;
};
