import { z } from "zod";

const optionalEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ALLOWED_GOOGLE_EMAILS: z.string().default(""),
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
  AI_PROVIDER: z.enum(["openai", "deepseek"]).default("openai"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
});

export type AppEnv = z.infer<typeof optionalEnvSchema>;

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
    ["BETTER_AUTH_SECRET", env.BETTER_AUTH_SECRET],
    ["GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET],
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

export function allowedEmails(
  env: Pick<AppEnv, "ALLOWED_GOOGLE_EMAILS">,
): Set<string> {
  return new Set(
    env.ALLOWED_GOOGLE_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(
  email: string,
  env: Pick<AppEnv, "ALLOWED_GOOGLE_EMAILS">,
): boolean {
  return allowedEmails(env).has(email.trim().toLowerCase());
}
