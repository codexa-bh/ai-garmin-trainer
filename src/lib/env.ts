import { z } from "zod";

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
  GARMIN_MCP_ARGS: z
    .string()
    .default(
      "garmin-mcp@git+https://github.com/Taxuspt/garmin_mcp.git@2974244bfda1595b00836b3f942f579ec2d6f7d6",
    ),
  GARMIN_MCP_TOKEN_DIR: z.string().default("./.garmin-token"),
  AI_PROVIDER: z.enum(["auto", "openai", "deepseek"]).default("auto"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  MEMORY_ENABLED: z.string().default("false"),
  MEMORY_EMBEDDING_PROVIDER: z
    .enum(["openai", "deterministic"])
    .default("openai"),
  MEMORY_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  MEMORY_EMBEDDING_BASE_URL: z.string().optional(),
  MEMORY_EMBEDDING_DIMS: z.string().default("1536"),
  MEMORY_TIMEOUT_MS: z.string().default("8000"),
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
