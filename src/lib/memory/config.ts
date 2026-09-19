import { getAppMetadata } from "../db/repository";
import { configuredSecret, getOptionalEnv, type AppEnv } from "../env";

const DISABLED_METADATA_KEY = "memory.user_disabled";
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

type EmbeddingProvider = "openai" | "deterministic" | "ollama";

export type MemoryRuntimeConfig = {
  configuredEnabled: boolean;
  userDisabled: boolean;
  effectiveEnabled: boolean;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  embeddingApiKey?: string;
  embeddingBaseUrl?: string;
  embeddingDims: number;
  timeoutMs: number;
};

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isLoopbackUrl(rawUrl: string): boolean {
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

function embeddingModel(provider: EmbeddingProvider, env: AppEnv): string {
  if (
    provider === "ollama" &&
    env.MEMORY_EMBEDDING_MODEL === "text-embedding-3-small"
  )
    return OLLAMA_DEFAULT_EMBEDDING_MODEL;
  return env.MEMORY_EMBEDDING_MODEL;
}

function memoryUserDisabled(): boolean {
  return getAppMetadata(DISABLED_METADATA_KEY) === "true";
}

export { DISABLED_METADATA_KEY };

export function memoryRuntimeConfig(
  env: AppEnv = getOptionalEnv(),
): MemoryRuntimeConfig {
  const configuredEnabled = enabled(env.MEMORY_ENABLED);
  const userDisabled = memoryUserDisabled();
  const embeddingProvider = env.MEMORY_EMBEDDING_PROVIDER;
  const embeddingApiKey =
    embeddingProvider === "openai"
      ? configuredSecret(env.OPENAI_API_KEY)
      : undefined;
  return {
    configuredEnabled,
    userDisabled,
    effectiveEnabled: configuredEnabled && !userDisabled,
    embeddingProvider,
    embeddingModel: embeddingModel(embeddingProvider, env),
    embeddingApiKey,
    embeddingBaseUrl:
      embeddingProvider === "ollama"
        ? (optional(env.MEMORY_EMBEDDING_BASE_URL) ?? OLLAMA_DEFAULT_BASE_URL)
        : optional(env.MEMORY_EMBEDDING_BASE_URL),
    embeddingDims: integer(env.MEMORY_EMBEDDING_DIMS, 1536),
    timeoutMs: integer(env.MEMORY_TIMEOUT_MS, 8000),
  };
}

export function memoryConfigProblems(config: MemoryRuntimeConfig): string[] {
  const problems: string[] = [];
  if (!config.configuredEnabled) return problems;
  if (config.embeddingProvider === "openai" && !config.embeddingApiKey)
    problems.push("memory embedding OpenAI key missing or placeholder");
  if (
    config.embeddingProvider === "ollama" &&
    (!config.embeddingBaseUrl || !isLoopbackUrl(config.embeddingBaseUrl))
  )
    problems.push("memory embedding Ollama base URL must be loopback/local");
  if (config.embeddingDims < 8)
    problems.push("memory embedding dims too small");
  return problems;
}
