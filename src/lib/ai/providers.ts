import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import {
  configuredSecret,
  getOptionalEnv,
  hasConfiguredSecret,
  type AppEnv,
} from "../env";

export type AiProviderName = "deepseek" | "openai";
export type AiProviderSelectionMode = "default" | "fallback" | "explicit";

export type AiProviderStatus = {
  requested: AppEnv["AI_PROVIDER"];
  selected: AiProviderName | null;
  selectionMode: AiProviderSelectionMode | null;
  modelName: string | null;
  deepseekKeyConfigured: boolean;
  openaiKeyConfigured: boolean;
  failureClass: string | null;
  remediation?: string;
};

export function aiProviderStatus(
  env: AppEnv = getOptionalEnv(),
): AiProviderStatus {
  const deepseekKeyConfigured = hasConfiguredSecret(env.DEEPSEEK_API_KEY);
  const openaiKeyConfigured = hasConfiguredSecret(env.OPENAI_API_KEY);

  if (env.AI_PROVIDER === "deepseek") {
    return deepseekKeyConfigured
      ? {
          requested: env.AI_PROVIDER,
          selected: "deepseek",
          selectionMode: "explicit",
          modelName: env.DEEPSEEK_MODEL,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          failureClass: null,
        }
      : {
          requested: env.AI_PROVIDER,
          selected: null,
          selectionMode: null,
          modelName: null,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          failureClass: "provider.missing_deepseek_key",
          remediation:
            "Set a valid DEEPSEEK_API_KEY or remove AI_PROVIDER=deepseek to allow automatic OpenAI fallback.",
        };
  }

  if (env.AI_PROVIDER === "openai") {
    return openaiKeyConfigured
      ? {
          requested: env.AI_PROVIDER,
          selected: "openai",
          selectionMode: "explicit",
          modelName: env.AI_MODEL,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          failureClass: null,
        }
      : {
          requested: env.AI_PROVIDER,
          selected: null,
          selectionMode: null,
          modelName: null,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          failureClass: "provider.missing_openai_key",
          remediation:
            "Set a valid OPENAI_API_KEY or remove AI_PROVIDER=openai to allow automatic DeepSeek-first selection.",
        };
  }

  if (deepseekKeyConfigured) {
    return {
      requested: env.AI_PROVIDER,
      selected: "deepseek",
      selectionMode: "default",
      modelName: env.DEEPSEEK_MODEL,
      deepseekKeyConfigured,
      openaiKeyConfigured,
      failureClass: null,
    };
  }

  if (openaiKeyConfigured) {
    return {
      requested: env.AI_PROVIDER,
      selected: "openai",
      selectionMode: "fallback",
      modelName: env.AI_MODEL,
      deepseekKeyConfigured,
      openaiKeyConfigured,
      failureClass: null,
    };
  }

  return {
    requested: env.AI_PROVIDER,
    selected: null,
    selectionMode: null,
    modelName: null,
    deepseekKeyConfigured,
    openaiKeyConfigured,
    failureClass: "provider.no_configured_key",
    remediation:
      "Set a valid DEEPSEEK_API_KEY for the default provider or OPENAI_API_KEY for fallback; placeholder example values are ignored.",
  };
}

export function selectedModel() {
  const env = getOptionalEnv();
  const status = aiProviderStatus(env);
  if (!status.selected)
    throw new Error(status.remediation ?? "No configured AI provider key.");

  if (status.selected === "deepseek") {
    const apiKey = configuredSecret(env.DEEPSEEK_API_KEY);
    if (!apiKey) throw new Error("DeepSeek provider key is missing.");
    const deepseek = createDeepSeek({ apiKey });
    return {
      provider: "deepseek" as const,
      selectionMode: status.selectionMode,
      model: deepseek(env.DEEPSEEK_MODEL),
    };
  }

  const apiKey = configuredSecret(env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OpenAI provider key is missing.");
  const openai = createOpenAI({ apiKey });
  return {
    provider: "openai" as const,
    selectionMode: status.selectionMode,
    model: openai(env.AI_MODEL),
  };
}
