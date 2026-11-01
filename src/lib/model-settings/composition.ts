import { isLoopbackAiBaseUrl, selectedModel } from "@/lib/ai/providers";
import { getAppMetadata, setAppMetadata } from "@/lib/db/repository";
import { getOptionalEnv, hasConfiguredSecret, type AppEnv } from "@/lib/env";
import { createModelSettings } from "./application";
import { legacyChatCatalog, validateChatCatalog } from "./catalog";
import type { ModelConfiguration } from "./contracts";

function configuration(env: AppEnv): ModelConfiguration {
  const configured = {
    openai: hasConfiguredSecret(env.OPENAI_API_KEY),
    deepseek: hasConfiguredSecret(env.DEEPSEEK_API_KEY),
    openrouter: hasConfiguredSecret(env.OPENROUTER_API_KEY),
    ollama: isLoopbackAiBaseUrl(env.OLLAMA_BASE_URL),
  };
  try {
    return {
      configured,
      catalog:
        env.CHAT_MODEL_CATALOG === undefined
          ? legacyChatCatalog(env, configured)
          : validateChatCatalog(JSON.parse(env.CHAT_MODEL_CATALOG) as unknown),
    };
  } catch {
    throw new Error(
      "Activated chat catalog invalid. Preserve settings and use a compatible build; no fallback.",
    );
  }
}
// Lazy binding; preserve original ai.chat_model. Empty v2 is explicit reset.
export const modelSettings = createModelSettings({
  readPreference: () => getAppMetadata("ai.chat_model.v2"),
  readLegacyPreference: () => getAppMetadata("ai.chat_model"),
  writePreference: (value) => setAppMetadata("ai.chat_model.v2", value),
  configuration: () => configuration(getOptionalEnv()),
});

// Resolve catalog, preference, credentials and connection once synchronously,
// before context awaits. No process/global mutation or extractor retargeting.
export function selectedTrainerModel() {
  const env = getOptionalEnv();
  const entry = modelSettings.selection(configuration(env));
  return selectedModel({
    ...env,
    AI_PROVIDER: entry.provider,
    AI_MODEL: entry.provider === "openai" ? entry.modelId : env.AI_MODEL,
    DEEPSEEK_MODEL:
      entry.provider === "deepseek" ? entry.modelId : env.DEEPSEEK_MODEL,
    OPENROUTER_MODEL:
      entry.provider === "openrouter" ? entry.modelId : env.OPENROUTER_MODEL,
    OLLAMA_MODEL:
      entry.provider === "ollama" ? entry.modelId : env.OLLAMA_MODEL,
  });
}
