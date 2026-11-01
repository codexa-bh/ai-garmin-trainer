export type ChatProvider = "openai" | "deepseek" | "ollama" | "openrouter";
export type ChatEntry = {
  id: string;
  provider: ChatProvider;
  modelId: string;
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
  version: 2;
  options: ModelOption[];
  selected: ChatModelId | null;
  defaultEntryId: ChatModelId | null;
  effective: {
    entryId: ChatModelId | null;
    provider: ChatProvider | null;
    modelName: string | null;
    source: "saved" | "env";
    available: boolean;
  };
  unavailableReason?: string;
};
export type ModelConfiguration = {
  catalog: ChatCatalog;
  configured: Record<ChatProvider, boolean>;
};
