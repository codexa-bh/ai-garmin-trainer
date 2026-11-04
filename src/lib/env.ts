import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  containsControlCharacters,
  validateChatCatalog,
} from "./model-settings/catalog";
import { GARMIN_MCP_DEFAULT_ARGS_STRING } from "./garmin/mcp-config";

const PLACEHOLDER_SECRET_PATTERNS = [
  /^\.\.\.$/,
  /^<.*>$/,
  /^(replace|replace_with|your|example|placeholder|changeme|todo)([-_\s]|$)/i,
  /([-_\s]|^)(replace|placeholder|changeme)([-_\s]|$)/i,
];

const optionalEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_PATH: z.string().default("./data/trainer.sqlite"),
  GARMIN_HISTORY_START_DATE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  ),
  GARMIN_MCP_COMMAND: z.string().default("uvx"),
  GARMIN_MCP_ARGS: z.string().default(GARMIN_MCP_DEFAULT_ARGS_STRING),
  GARMIN_MCP_TOKEN_DIR: z.string().optional(),
  AI_PROVIDER: z
    .enum(["auto", "openai", "deepseek", "ollama", "openrouter"])
    .default("auto"),
  AI_MODEL: z.string().default("gpt-6-luna"),
  // Private startup adapter only; never an editable scalar/build configuration.
  CHAT_MODEL_CATALOG: z.string().optional(),
  CHAT_SELECTION_COMPATIBILITY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-flash"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("nvidia/nemotron-3.5-lightning:free"),
  OLLAMA_MODEL: z.string().default("qwen3.5:4b"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434/v1"),
  SUMMARY_CONTRACT_VERSION: z.literal("2").default("2"),
  SUMMARY_ENABLED: z.enum(["false", "true"]).default("false"),
  SUMMARY_MODEL: z.enum(["unselected", "gpt-6-luna"]).default("unselected"),
  SUMMARY_CHAR_LIMIT: z
    .string()
    .regex(/^[0-9]+$/)
    .refine(
      (value) => Number(value) >= 1000 && Number(value) <= 20000,
      "Summary character limit must be 1000–20000.",
    )
    .default("6000"),
  MEMORY_ENABLED: z.string().default("false"),
  MEMORY_EMBEDDING_PROVIDER: z
    .enum(["openai", "deterministic", "ollama"])
    .default("openai"),
  MEMORY_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  MEMORY_EMBEDDING_BASE_URL: z.string().optional(),
  MEMORY_EMBEDDING_DIMS: z.string().default("1536"),
  MEMORY_TIMEOUT_MS: z.string().default("8000"),
  MEMORY_EXTRACTION_MODE: z
    .enum(["llm", "deterministic", "off"])
    .default("llm"),
  MEMORY_EXTRACTION_TIMEOUT_MS: z.string().default("3000"),
  LLM_DEBUG_TRACES: z.string().default("false"),
});

export type AppEnv = z.infer<typeof optionalEnvSchema>;

export function configuredSecret(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(trimmed)))
    return undefined;
  return trimmed;
}

export function hasConfiguredSecret(value: string | undefined): boolean {
  return Boolean(configuredSecret(value));
}

export function isLlmDebugTraceEnabled(
  _env: AppEnv = getOptionalEnv(),
): boolean {
  return true;
}

export function getOptionalEnv(
  input: Record<string, string | undefined> = process.env,
): AppEnv {
  if (input === process.env) {
    const cell = configurationCell();
    const captured = cell.scope.getStore() ?? cell.active?.env;
    if (captured) return captured;
  }
  return optionalEnvSchema.parse(input);
}

type LiveConfiguration = {
  env: AppEnv;
  generation: number;
  revision: string;
  projection: string;
};
type ConfigurationCell = {
  scope: AsyncLocalStorage<AppEnv>;
  boot?: string;
  base?: AppEnv;
  extractionProvider?: "openai" | "deepseek" | null;
  active?: LiveConfiguration;
};
// The launcher and compiled Next routes are separate bundles in ONE Node process.
// A process-owned, narrowly named cell (not a module singleton) crosses that boundary.
// No private values are written to process.env, build config or disk on live Save.
function configurationCell(): ConfigurationCell {
  const owner = process as typeof process & {
    __trainerLiveConfigurationV1?: ConfigurationCell;
  };
  return (owner.__trainerLiveConfigurationV1 ??= {
    scope: new AsyncLocalStorage<AppEnv>(),
  });
}
export function initializeLiveConfiguration(boot: string): void {
  const cell = configurationCell();
  if (cell.boot || !/^[a-f0-9-]{36}$/.test(boot))
    throw new Error("Live configuration boot refused.");
  const base = Object.freeze(optionalEnvSchema.parse(process.env));
  cell.boot = boot;
  cell.base = base;
  cell.extractionProvider =
    base.AI_PROVIDER === "openai" || base.AI_PROVIDER === "deepseek"
      ? base.AI_PROVIDER
      : hasConfiguredSecret(base.DEEPSEEK_API_KEY)
        ? "deepseek"
        : hasConfiguredSecret(base.OPENAI_API_KEY)
          ? "openai"
          : null;
  cell.active = {
    env: base,
    generation: 0,
    revision: "startup",
    projection: "",
  };
}
export function withConfiguration<T>(env: AppEnv, work: () => T): T {
  return configurationCell().scope.run(env, work);
}
export function liveConfigurationStatus() {
  const cell = configurationCell();
  if (!cell.boot || !cell.active)
    throw new Error("Live configuration unavailable.");
  return {
    version: 1,
    boot: cell.boot,
    generation: cell.active.generation,
    revision: cell.active.revision,
    state: "applied",
  } as const;
}
export function extractionConfiguration(env: AppEnv): AppEnv | null {
  const cell = configurationCell();
  if (!cell.boot) return env;
  return cell.extractionProvider
    ? { ...env, AI_PROVIDER: cell.extractionProvider }
    : null;
}
export function applyLiveConfiguration(input: unknown) {
  const cell = configurationCell();
  if (
    !cell.boot ||
    !cell.base ||
    !cell.active ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  )
    throw new Error("Live configuration refused.");
  const frame = input as Record<string, unknown>;
  if (
    Object.keys(frame).length !== 6 ||
    Object.keys(frame).some(
      (key) =>
        ![
          "version",
          "boot",
          "generation",
          "revision",
          "chatCatalog",
          "secrets",
        ].includes(key),
    ) ||
    frame.version !== 1 ||
    frame.boot !== cell.boot ||
    !Number.isSafeInteger(frame.generation) ||
    (frame.generation as number) < 1 ||
    typeof frame.revision !== "string" ||
    !/^[0-9-]{1,256}$/.test(frame.revision) ||
    !frame.secrets ||
    typeof frame.secrets !== "object" ||
    Array.isArray(frame.secrets)
  )
    throw new Error("Live configuration refused.");
  const catalog = validateChatCatalog(frame.chatCatalog);
  const secrets = frame.secrets as Record<string, unknown>;
  const slots = [
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
  ] as const;
  if (
    Object.keys(secrets).some(
      (key) => !slots.includes(key as (typeof slots)[number]),
    ) ||
    Object.values(secrets).some(
      (value) =>
        typeof value !== "string" ||
        Buffer.byteLength(value) > 16384 ||
        containsControlCharacters(value) ||
        !configuredSecret(value),
    )
  )
    throw new Error("Live configuration refused.");
  const env = Object.freeze({
    ...cell.base,
    CHAT_MODEL_CATALOG: JSON.stringify(catalog),
    OPENAI_API_KEY: secrets.OPENAI_API_KEY as string | undefined,
    DEEPSEEK_API_KEY: secrets.DEEPSEEK_API_KEY as string | undefined,
    OPENROUTER_API_KEY: secrets.OPENROUTER_API_KEY as string | undefined,
  });
  const projection = JSON.stringify([
    frame.revision,
    env.CHAT_MODEL_CATALOG,
    ...slots.map((slot) => env[slot] ?? null),
  ]);
  const generation = frame.generation as number;
  if (
    generation < cell.active.generation ||
    (generation === cell.active.generation &&
      projection !== cell.active.projection)
  )
    throw new Error("Stale live configuration refused.");
  if (generation > cell.active.generation)
    cell.active = { env, generation, revision: frame.revision, projection };
  return liveConfigurationStatus();
}

export function requireRuntimeEnv(
  input: Record<string, string | undefined> = process.env,
): AppEnv {
  const env = getOptionalEnv(input);
  if (!env.GARMIN_HISTORY_START_DATE) return env;
  const start = new Date(`${env.GARMIN_HISTORY_START_DATE}T00:00:00Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== env.GARMIN_HISTORY_START_DATE ||
    start > new Date()
  )
    throw new Error(
      "GARMIN_HISTORY_START_DATE must be a calendar date no later than today",
    );
  return env;
}
