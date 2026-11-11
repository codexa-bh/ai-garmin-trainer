import {
  chatgptConnection,
  chatgptConnections,
} from "@/lib/ai/chatgpt-connection";
import { subscriptionEntryLabel } from "./chatgpt-metadata";
import { isLoopbackAiBaseUrl, selectedModel } from "@/lib/ai/providers";
import {
  getAppMetadata,
  initializeAppMetadata,
  setAppMetadata,
} from "@/lib/db/repository";
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
    const catalog =
      env.CHAT_MODEL_CATALOG === undefined
        ? legacyChatCatalog(env, configured)
        : validateChatCatalog(JSON.parse(env.CHAT_MODEL_CATALOG) as unknown);
    return {
      configured,
      subscriptionLabels: Object.fromEntries(
        catalog.entries
          .filter((entry) => entry.provider === "chatgpt")
          .map((entry) => [
            entry.id,
            subscriptionEntryLabel(
              entry,
              chatgptConnections(env.CHATGPT_CONNECTIONS),
            ),
          ]),
      ),
      availableSubscriptionEntries: catalog.entries
        .filter(
          (entry) =>
            entry.provider === "chatgpt" &&
            chatgptConnection(
              env.CHATGPT_CONNECTIONS,
              entry.registrationId,
              entry.modelId,
            ),
        )
        .map((entry) => entry.id),
      ...(env.CHAT_SELECTION_COMPATIBILITY !== undefined
        ? {
            compatibilityCatalog:
              env.CHAT_SELECTION_COMPATIBILITY === "null"
                ? null
                : validateChatCatalog(
                    JSON.parse(env.CHAT_SELECTION_COMPATIBILITY) as unknown,
                  ),
          }
        : {}),
      catalog,
    };
  } catch {
    throw new Error(
      "Activated chat catalog invalid. Preserve settings and use a compatible build; no fallback.",
    );
  }
}
// Lazy binding; both original preference keys remain byte-for-byte intact.
export const modelSettings = createModelSettings({
  readChoice: () => getAppMetadata("ai.chat_model.choice"),
  initializeChoice: (value) =>
    initializeAppMetadata("ai.chat_model.choice", value),
  writeChoice: (value) => setAppMetadata("ai.chat_model.choice", value),
  readPreference: () => getAppMetadata("ai.chat_model.v2"),
  readLegacyPreference: () => getAppMetadata("ai.chat_model"),
  configuration: () => configuration(getOptionalEnv()),
});

// Resolve catalog, preference, credentials and connection once synchronously,
// before context awaits. No process/global mutation or extractor retargeting.
export function selectedTrainerModel(assertCurrent?: () => void) {
  const env = getOptionalEnv();
  const entry = modelSettings.selection(configuration(env));
  const selected = {
    ...env,
    AI_PROVIDER: entry.provider,
    ...(entry.provider === "chatgpt"
      ? {
          CHATGPT_REGISTRATION: entry.registrationId,
          CHATGPT_MODEL: entry.modelId,
        }
      : {}),
    AI_MODEL: entry.provider === "openai" ? entry.modelId : env.AI_MODEL,
    DEEPSEEK_MODEL:
      entry.provider === "deepseek" ? entry.modelId : env.DEEPSEEK_MODEL,
    OPENROUTER_MODEL:
      entry.provider === "openrouter" ? entry.modelId : env.OPENROUTER_MODEL,
    OLLAMA_MODEL:
      entry.provider === "ollama" ? entry.modelId : env.OLLAMA_MODEL,
  };
  return assertCurrent
    ? selectedModel(selected, assertCurrent)
    : selectedModel(selected);
}
