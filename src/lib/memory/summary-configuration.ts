import { configuredSecret, getOptionalEnv, type AppEnv } from "../env";
import { isLoopbackAiBaseUrl } from "../ai/providers";
import {
  legacyChatCatalog,
  validateChatCatalog,
  entryLabel,
} from "../model-settings/catalog";
import {
  resolveSummarySelection,
  summarySelection,
  encodeSummarySelection,
} from "../model-settings/summary-selection";
import type { DensifyModels } from "./summary-controls";

function summaryCatalog(env: AppEnv) {
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
  return { configured, catalog };
}

/** Read-only manual options: never initialize or save the Trainer preference. */
export function densifyModels(env: AppEnv = getOptionalEnv()): DensifyModels {
  const { configured, catalog } = summaryCatalog(env);
  let label = "Unselected memory model";
  let available = false;
  try {
    const selected = summarySelection(env.SUMMARY_MODEL);
    if (selected) label = entryLabel(selected);
    available = Boolean(summaryConfiguration(env));
  } catch {
    if (label === "Unselected memory model") label = "Unavailable memory model";
  }
  return {
    default: { label, available },
    options: catalog.entries
      .filter((entry) => configured[entry.provider])
      .map((entry) => ({
        value: encodeSummarySelection(entry),
        label: entryLabel(entry),
      })),
  };
}

/** Capture identity, connection and credentials together, independently of the
 * Trainer preference. Resolution is local metadata only, never a provider probe. */
export function summaryConfiguration(env: AppEnv = getOptionalEnv()) {
  const { configured, catalog } = summaryCatalog(env);
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
