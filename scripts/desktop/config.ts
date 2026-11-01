import { constants, accessSync, lstatSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { updateInitialEnv } from "@next/env";
import { activationEnvironment } from "./settings";
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

// Next's custom-server prepare() does not forward its direct conf option to
// the router server. Install only the trusted build configuration through the
// standalone path, and retain it with the already-private activation overlay
// across Next's environment reset. No provider values enter this JSON.
export function configureDesktopNext(
  base: Record<string, unknown>,
): NextConfig {
  const configuration = desktopNextConfiguration(base);
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(configuration);
  updateInitialEnv(process.env);
  return configuration;
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

export function adoptConfiguration(snapshot: unknown): {
  uv: boolean;
  uvx: boolean;
} {
  // Native sends a bounded private frame, never an env filename. No dotenv
  // loader is invoked; private state cannot depend on cwd or adjacent files.
  Object.assign(process.env, activationEnvironment(snapshot));
  const env = getOptionalEnv();
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
