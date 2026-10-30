import {
  constants,
  accessSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { processEnv, updateInitialEnv } from "@next/env";
import type { NextConfig } from "next";
import { getOptionalEnv } from "../../src/lib/env";
import {
  GARMIN_MCP_DEFAULT_ARGS_STRING,
  garminMcpArgs,
} from "../../src/lib/garmin/mcp-config";

export function desktopNextConfiguration(
  base: Record<string, unknown>,
): NextConfig {
  return {
    ...base,
    distDir: ".next",
    cacheMaxMemorySize: 50 * 1024 * 1024,
    experimental: {
      ...((base.experimental ?? {}) as object),
      isrFlushToDisk: false,
    },
    images: { ...((base.images ?? {}) as object), unoptimized: true },
  };
}

export function explicitPath(value: string, base: string): string {
  if (
    !value.trim() ||
    /[~$]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value.includes("://")
  )
    throw new Error("A literal local path is required.");
  return resolve(base, value);
}

export function inspectPrivateConfig(path: string): string {
  if (!isAbsolute(path) || realpathSync(path) !== path)
    throw new Error("Select an absolute unaliased config file.");
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size > 128 * 1024
  )
    throw new Error(
      "Configuration must be a small owner-private regular file.",
    );
  return readFileSync(path, "utf8");
}

export function resolveExecutable(command: string): string | undefined {
  const candidates = isAbsolute(command)
    ? [command]
    : command.includes("/")
      ? []
      : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map((dir) =>
          join(dir, command),
        );
  return candidates.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return lstatSync(realpathSync(path)).isFile();
    } catch {
      return false;
    }
  });
}

export function adoptConfiguration(path: string): {
  uv: boolean;
  uvx: boolean;
} {
  const contents = inspectPrivateConfig(path);
  // The native child starts with a cleared environment. Load exactly the selected
  // file with Next's normal dotenv expansion, never adjacent files/fallbacks.
  processEnv(
    [{ path, contents, env: {} }],
    dirname(path),
    {
      info() {},
      error() {
        throw new Error("Invalid private configuration.");
      },
    },
    true,
  );
  const env = getOptionalEnv();
  const base = dirname(path);
  // Unlike source first-run setup, desktop adoption never defaults to a blank DB.
  if (!process.env.DATABASE_PATH)
    throw new Error("An existing database must be explicitly configured.");
  process.env.DATABASE_PATH = explicitPath(env.DATABASE_PATH, base);
  if (env.GARMIN_MCP_TOKEN_DIR)
    process.env.GARMIN_MCP_TOKEN_DIR = explicitPath(
      env.GARMIN_MCP_TOKEN_DIR,
      base,
    );
  const reviewedArgs =
    JSON.stringify(garminMcpArgs(env.GARMIN_MCP_ARGS)) ===
    JSON.stringify(garminMcpArgs(GARMIN_MCP_DEFAULT_ARGS_STRING));
  const uvx = reviewedArgs
    ? resolveExecutable(env.GARMIN_MCP_COMMAND)
    : undefined;
  // Missing integrations do not prevent offline/persisted views. Set an absolute
  // non-existent command so no inherited PATH fallback can choose another tool.
  process.env.GARMIN_MCP_COMMAND = uvx ?? "/unavailable-trainer-tool/uvx";
  const uv = resolveExecutable("uv");
  for (const key of [
    "GARMIN_FIT_BASELINE_COMMAND",
    "GARMIN_FIT_SPEED_COMMAND",
    "GARMIN_FIT_DISTANCE_COMMAND",
    "GARMIN_FIT_ALTITUDE_COMMAND",
  ]) {
    const configured = process.env[key];
    process.env[key] =
      (configured ? resolveExecutable(configured) : uv) ??
      "/unavailable-trainer-tool/uv";
  }
  process.env.PATH = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(delimiter);
  process.env.UV_PYTHON_DOWNLOADS = "never";
  process.env.PYTHONDONTWRITEBYTECODE = "1";
  process.env.TRAINER_DESKTOP = "1";
  Object.assign(process.env, { NODE_ENV: "production" });
  // These internal control values can never be selected by the private env file.
  delete process.env.NODE_OPTIONS;
  delete process.env.NODE_PATH;
  // Next prepare() resets process.env to its initial snapshot before loading
  // framework config. Make the validated absolute adoption overlay that snapshot;
  // otherwise it can silently restore source defaults and create an empty DB.
  updateInitialEnv(process.env);
  return { uv: Boolean(uv), uvx: Boolean(uvx) };
}
