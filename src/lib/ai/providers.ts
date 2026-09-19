import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import {
  configuredSecret,
  getOptionalEnv,
  hasConfiguredSecret,
  type AppEnv,
} from "../env";

export const OLLAMA_CHAT_DEFAULT_MODEL = "qwen3.5:4b";
export const OLLAMA_CHAT_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

type AiProviderName = "deepseek" | "openai" | "ollama" | "openrouter";
type AiProviderSelectionMode = "default" | "fallback" | "explicit";

export type AiProviderStatus = {
  requested: AppEnv["AI_PROVIDER"];
  selected: AiProviderName | null;
  selectionMode: AiProviderSelectionMode | null;
  modelName: string | null;
  deepseekKeyConfigured: boolean;
  openaiKeyConfigured: boolean;
  openrouterKeyConfigured: boolean;
  ollamaBaseUrlLoopback: boolean | null;
  failureClass: string | null;
  remediation?: string;
};

export type SelectedAiModel = {
  provider: AiProviderName;
  selectionMode: AiProviderSelectionMode | null;
  modelName: string;
  model: unknown;
};

export function isLoopbackAiBaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function cloudProviderStatus(
  env: AppEnv,
): Omit<AiProviderStatus, "openrouterKeyConfigured"> {
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
          ollamaBaseUrlLoopback: null,
          failureClass: null,
        }
      : {
          requested: env.AI_PROVIDER,
          selected: null,
          selectionMode: null,
          modelName: null,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          ollamaBaseUrlLoopback: null,
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
          ollamaBaseUrlLoopback: null,
          failureClass: null,
        }
      : {
          requested: env.AI_PROVIDER,
          selected: null,
          selectionMode: null,
          modelName: null,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          ollamaBaseUrlLoopback: null,
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
      ollamaBaseUrlLoopback: null,
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
      ollamaBaseUrlLoopback: null,
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
    ollamaBaseUrlLoopback: null,
    failureClass: "provider.no_configured_key",
    remediation:
      "Set a valid DEEPSEEK_API_KEY for the default provider or OPENAI_API_KEY for fallback; placeholder example values are ignored.",
  };
}

export function aiProviderStatus(
  env: AppEnv = getOptionalEnv(),
): AiProviderStatus {
  const openrouterKeyConfigured = hasConfiguredSecret(env.OPENROUTER_API_KEY);
  if (env.AI_PROVIDER === "openrouter") {
    return {
      requested: "openrouter",
      selected: openrouterKeyConfigured ? "openrouter" : null,
      selectionMode: openrouterKeyConfigured ? "explicit" : null,
      modelName: openrouterKeyConfigured ? env.OPENROUTER_MODEL : null,
      deepseekKeyConfigured: hasConfiguredSecret(env.DEEPSEEK_API_KEY),
      openaiKeyConfigured: hasConfiguredSecret(env.OPENAI_API_KEY),
      openrouterKeyConfigured,
      ollamaBaseUrlLoopback: null,
      failureClass: openrouterKeyConfigured
        ? null
        : "provider.missing_openrouter_key",
      ...(!openrouterKeyConfigured
        ? {
            remediation:
              "Set a valid OPENROUTER_API_KEY for explicit OpenRouter chat; placeholder keys are ignored. No other provider will be substituted.",
          }
        : {}),
    };
  }
  if (env.AI_PROVIDER === "ollama") {
    const deepseekKeyConfigured = hasConfiguredSecret(env.DEEPSEEK_API_KEY);
    const openaiKeyConfigured = hasConfiguredSecret(env.OPENAI_API_KEY);
    const ollamaBaseUrlLoopback = isLoopbackAiBaseUrl(env.OLLAMA_BASE_URL);
    return ollamaBaseUrlLoopback
      ? {
          requested: env.AI_PROVIDER,
          selected: "ollama",
          selectionMode: "explicit",
          modelName: env.OLLAMA_MODEL,
          openrouterKeyConfigured,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          ollamaBaseUrlLoopback,
          failureClass: null,
        }
      : {
          requested: env.AI_PROVIDER,
          selected: null,
          selectionMode: null,
          modelName: null,
          deepseekKeyConfigured,
          openaiKeyConfigured,
          ollamaBaseUrlLoopback,
          openrouterKeyConfigured,
          failureClass: "provider.ollama_non_loopback",
          remediation:
            "Set OLLAMA_BASE_URL to a loopback OpenAI-compatible endpoint such as http://127.0.0.1:11434/v1; LAN and public Ollama endpoints are unsupported.",
        };
  }

  return { ...cloudProviderStatus(env), openrouterKeyConfigured };
}

function selectedCloudModel(
  env: AppEnv,
  status: Pick<AiProviderStatus, "selected" | "selectionMode" | "remediation">,
): SelectedAiModel {
  if (!status.selected)
    throw new Error(status.remediation ?? "No configured AI provider key.");

  if (status.selected === "deepseek") {
    const apiKey = configuredSecret(env.DEEPSEEK_API_KEY);
    if (!apiKey) throw new Error("DeepSeek provider key is missing.");
    const deepseek = createDeepSeek({ apiKey });
    return {
      provider: "deepseek",
      selectionMode: status.selectionMode,
      modelName: env.DEEPSEEK_MODEL,
      model: deepseek(env.DEEPSEEK_MODEL),
    };
  }

  if (status.selected === "openai") {
    const apiKey = configuredSecret(env.OPENAI_API_KEY);
    if (!apiKey) throw new Error("OpenAI provider key is missing.");
    const openai = createOpenAI({ apiKey });
    return {
      provider: "openai",
      selectionMode: status.selectionMode,
      modelName: env.AI_MODEL,
      model: openai(env.AI_MODEL),
    };
  }

  throw new Error("Memory extraction requires a DeepSeek or OpenAI provider.");
}

export function selectedModel(): SelectedAiModel {
  const env = getOptionalEnv();
  const status = aiProviderStatus(env);
  if (!status.selected)
    throw new Error(status.remediation ?? "No configured AI provider key.");

  if (status.selected === "openrouter") {
    const openrouter = createOpenAI({
      apiKey: configuredSecret(env.OPENROUTER_API_KEY),
      baseURL: "https://openrouter.ai/api/v1",
      name: "openrouter",
    });
    return {
      provider: "openrouter",
      selectionMode: status.selectionMode,
      modelName: env.OPENROUTER_MODEL,
      model: openrouter.chat(env.OPENROUTER_MODEL),
    };
  }

  if (status.selected === "ollama") {
    const ollama = createOpenAI({
      apiKey: "ollama",
      baseURL: env.OLLAMA_BASE_URL,
      name: "ollama",
    });
    return {
      provider: "ollama",
      selectionMode: status.selectionMode,
      modelName: env.OLLAMA_MODEL,
      model: ollama.chat(env.OLLAMA_MODEL),
    };
  }

  return selectedCloudModel(env, status);
}

export function selectedMemoryExtractionModel(): SelectedAiModel | null {
  const env = getOptionalEnv();
  const extractionEnv: AppEnv =
    env.AI_PROVIDER === "ollama" || env.AI_PROVIDER === "openrouter"
      ? { ...env, AI_PROVIDER: "auto" }
      : env;
  const status = cloudProviderStatus(extractionEnv);
  if (!status.selected) return null;
  return selectedCloudModel(extractionEnv, status);
}
