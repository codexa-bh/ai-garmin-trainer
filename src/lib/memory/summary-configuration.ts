import {
  configuredSecret,
  getOptionalEnv,
  chatgptAdmissionCurrent,
  type AppEnv,
} from "../env";
import {
  chatgptConnection,
  chatgptConnections,
} from "../ai/chatgpt-connection";
import { subscriptionEntryLabel } from "../model-settings/chatgpt-metadata";
import type { ChatEntry } from "../model-settings/contracts";
import { isLoopbackAiBaseUrl } from "../ai/providers";
import {
  legacyChatCatalog,
  validateChatCatalog,
} from "../model-settings/catalog";
import {
  resolveSummarySelection,
  summarySelection,
  encodeSummarySelection,
} from "../model-settings/summary-selection";
import type { DensifyModels } from "./summary-controls";

export function summaryEntryLabel(entry: ChatEntry, env: AppEnv): string {
  return subscriptionEntryLabel(
    entry,
    chatgptConnections(env.CHATGPT_CONNECTIONS),
  );
}
export function summaryConnectionCurrent(env: AppEnv): boolean {
  try {
    const entry = summarySelection(env.SUMMARY_MODEL);
    if (entry?.provider !== "chatgpt") return true;
    const connection = chatgptConnection(
      env.CHATGPT_CONNECTIONS,
      entry.registrationId,
      entry.modelId,
    );
    return Boolean(
      connection &&
      chatgptAdmissionCurrent(connection.id, connection.epoch, entry.modelId),
    );
  } catch {
    return false;
  }
}
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
    if (selected) label = summaryEntryLabel(selected, env);
    available = Boolean(summaryConfiguration(env));
  } catch {
    if (label === "Unselected memory model") label = "Unavailable memory model";
  }
  return {
    default: { label, available },
    options: catalog.entries
      .filter((entry) =>
        entry.provider === "chatgpt"
          ? Boolean(
              chatgptConnection(
                env.CHATGPT_CONNECTIONS,
                entry.registrationId,
                entry.modelId,
              ),
            )
          : configured[entry.provider],
      )
      .map((entry) => ({
        value: encodeSummarySelection(entry),
        label: summaryEntryLabel(entry, env),
      })),
  };
}

/** Capture identity, connection and credentials together, independently of the
 * Trainer preference. Resolution is local metadata only, never a provider probe. */
export function summaryConfiguration(env: AppEnv = getOptionalEnv()) {
  const { configured, catalog } = summaryCatalog(env);
  const entry = resolveSummarySelection(env.SUMMARY_MODEL, catalog);
  if (!entry) return null;
  if (
    entry.provider === "chatgpt"
      ? !chatgptConnection(
          env.CHATGPT_CONNECTIONS,
          entry.registrationId,
          entry.modelId,
        )
      : !configured[entry.provider]
  )
    throw new Error("summary_provider_configuration_unavailable");
  return {
    entry,
    env: {
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
    },
  };
}
