import { z } from "zod";
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
  GARMIN_HISTORY_START_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  GARMIN_MCP_COMMAND: z.string().default("uvx"),
  GARMIN_MCP_ARGS: z.string().default(GARMIN_MCP_DEFAULT_ARGS_STRING),
  GARMIN_MCP_TOKEN_DIR: z.string().optional(),
  AI_PROVIDER: z
    .enum(["auto", "openai", "deepseek", "ollama", "openrouter"])
    .default("auto"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("nvidia/nemotron-3.5-lightning:free"),
  OLLAMA_MODEL: z.string().default("qwen3.5:4b"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434/v1"),
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
  return optionalEnvSchema.parse(input);
}

export function requireRuntimeEnv(
  input: Record<string, string | undefined> = process.env,
): AppEnv {
  const env = getOptionalEnv(input);
  const missing = [
    ["GARMIN_HISTORY_START_DATE", env.GARMIN_HISTORY_START_DATE],
  ].filter(([, value]) => !value);
  if (missing.length > 0)
    throw new Error(
      `Missing required runtime environment: ${missing.map(([key]) => key).join(", ")}`,
    );
  const start = new Date(`${env.GARMIN_HISTORY_START_DATE}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start > new Date())
    throw new Error(
      "GARMIN_HISTORY_START_DATE must be a calendar date no later than today",
    );
  return env;
}
