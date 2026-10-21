import type {
  ChatModelId,
  ModelConfiguration,
  ModelSettingsSnapshot,
} from "./contracts";

const catalog = [
  { id: "deepseek-flash", label: "DeepSeek Flash", provider: "deepseek" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai" },
] as const;

export function isChatModelId(value: unknown): value is ChatModelId {
  return value === "deepseek-flash" || value === "gpt-6-luna";
}

export function modelSettingsSnapshot(
  stored: string | null,
  config: ModelConfiguration,
): ModelSettingsSnapshot {
  const options = catalog
    .filter((entry) =>
      entry.provider === "deepseek"
        ? config.deepseekConfigured
        : config.openaiConfigured,
    )
    .map(({ id, label }) => ({ id, label }));
  // Empty is the reset sentinel in existing string-only app metadata.
  if (!stored) {
    return {
      options,
      selected: null,
      effective: { ...config.inherited, source: "env" },
      ...(!config.inherited.available
        ? { unavailableReason: "The configured default model is unavailable." }
        : {}),
    };
  }
  if (!isChatModelId(stored)) {
    return {
      options,
      selected: null,
      effective: {
        provider: null,
        modelName: null,
        source: "saved",
        available: false,
      },
      unavailableReason:
        "The saved model setting is invalid. Choose an available model or reset to the configured default.",
    };
  }
  const model = catalog.find((entry) => entry.id === stored)!;
  const available = options.some((entry) => entry.id === stored);
  return {
    options,
    selected: stored,
    effective: {
      provider: model.provider,
      modelName: model.id,
      source: "saved",
      available,
    },
    ...(!available
      ? {
          unavailableReason:
            "The saved model's provider key is not configured. Choose an available model or reset to the configured default.",
        }
      : {}),
  };
}
