import { aiProviderStatus, selectedModel } from "@/lib/ai/providers";
import { getAppMetadata, setAppMetadata } from "@/lib/db/repository";
import { getOptionalEnv, hasConfiguredSecret } from "@/lib/env";
import { createModelSettings } from "./application";

const preferenceKey = "ai.chat_model";

// Binding is lazy: opening routes never reads config/storage or constructs SDKs.
export const modelSettings = createModelSettings({
  readPreference: () => getAppMetadata(preferenceKey),
  writePreference: (value) => setAppMetadata(preferenceKey, value),
  configuration: () => {
    const env = getOptionalEnv();
    const status = aiProviderStatus(env);
    return {
      deepseekConfigured: hasConfiguredSecret(env.DEEPSEEK_API_KEY),
      openaiConfigured: hasConfiguredSecret(env.OPENAI_API_KEY),
      inherited: {
        provider: status.selected,
        modelName: status.modelName?.slice(0, 120) ?? null,
        available: status.selected !== null,
      },
    };
  },
});

// Called once per turn before asynchronous context construction. Never changes
// process.env, extraction selection, or a model already captured by another turn.
export function selectedTrainerModel() {
  const id = modelSettings.selection();
  if (id === null) return selectedModel();
  const env = getOptionalEnv();
  return selectedModel({
    ...env,
    AI_PROVIDER: id === "deepseek-flash" ? "deepseek" : "openai",
    DEEPSEEK_MODEL: "deepseek-flash",
    AI_MODEL: "gpt-6-luna",
  });
}
