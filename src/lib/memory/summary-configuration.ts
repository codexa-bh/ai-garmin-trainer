import { configuredSecret, getOptionalEnv, type AppEnv } from "../env";
import { isLoopbackAiBaseUrl } from "../ai/providers";
import {
  legacyChatCatalog,
  validateChatCatalog,
} from "../model-settings/catalog";
import { resolveSummarySelection } from "../model-settings/summary-selection";

/** Capture identity, connection and credentials together, independently of the
 * Trainer preference. Resolution is local metadata only, never a provider probe. */
export function summaryConfiguration(env: AppEnv = getOptionalEnv()) {
  const configured = {
    openai: Boolean(configuredSecret(env.OPENAI_API_KEY)),
    deepseek: Boolean(configuredSecret(env.DEEPSEEK_API_KEY)),
    openrouter: Boolean(configuredSecret(env.OPENROUTER_API_KEY)),
    ollama: isLoopbackAiBaseUrl(env.OLLAMA_BASE_URL),
  };
  const catalog =
    env.CHAT_MODEL_CATALOG === undefined
      ? legacyChatCatalog(env, configured)
      : validateChatCatalog(JSON.parse(env.CHAT_MODEL_CATALOG) as unknown);
  const entry = resolveSummarySelection(env.SUMMARY_MODEL, catalog);
  if (!entry) return null;
  if (!configured[entry.provider])
    throw new Error("summary_provider_configuration_unavailable");
  return {
    entry,
    env: {
      ...env,
      AI_PROVIDER: entry.provider,
      AI_MODEL: entry.provider === "openai" ? entry.modelId : env.AI_MODEL,
      DEEPSEEK_MODEL:
        entry.provider === "deepseek" ? entry.modelId : env.DEEPSEEK_MODEL,
      OPENROUTER_MODEL:
        entry.provider === "openrouter" ? entry.modelId : env.OPENROUTER_MODEL,
      OLLAMA_MODEL:
        entry.provider === "ollama" ? entry.modelId : env.OLLAMA_MODEL,
    },
  };
}
