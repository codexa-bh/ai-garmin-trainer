import { constants, accessSync, lstatSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, win32 } from "node:path";
import { updateInitialEnv } from "@next/env";
import { activationEnvironment } from "./settings";
import type { NextConfig } from "next";
import { getOptionalEnv } from "../../src/lib/env";
import {
  GARMIN_MCP_DEFAULT_ARGS_STRING,
  garminMcpArgs,
} from "../../src/lib/garmin/mcp-config";

function desktopNextConfiguration(base: Record<string, unknown>): NextConfig {
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

// Fixed reviewed tool locations; never the inherited PATH or a shell.
function toolDirectories(platform: NodeJS.Platform): string[] {
  if (platform !== "win32")
    return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  // Official per-user uv installer locations only.
  const home = process.env.USERPROFILE;
  return home && win32.isAbsolute(home) && /^[A-Za-z]:\\/.test(home)
    ? [win32.join(home, ".local", "bin"), win32.join(home, ".cargo", "bin")]
    : [];
}

function resolveExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const windows = platform === "win32";
  const absolute = windows
    ? /^[A-Za-z]:\\/.test(command) && win32.isAbsolute(command)
    : isAbsolute(command);
  const candidates = absolute
    ? [command]
    : command.includes("/") || command.includes("\\")
      ? []
      : /^[A-Za-z0-9_-]+$/.test(command)
        ? toolDirectories(platform).map((dir) =>
            windows ? win32.join(dir, `${command}.exe`) : join(dir, command),
          )
        : [];
  return candidates.find((path) => {
    // Windows executes only real .exe images (no .cmd/.bat shell interpreters).
    if (windows && !/\.exe$/i.test(path)) return false;
    try {
      accessSync(path, constants.X_OK);
      return lstatSync(realpathSync(path)).isFile();
    } catch {
      return false;
    }
  });
}

// An absolute path that can never exist, so no inherited PATH fallback applies.
function unavailable(tool: string): string {
  return process.platform === "win32"
    ? win32.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "unavailable-trainer-tool",
        `${tool}.exe`,
      )
    : `/unavailable-trainer-tool/${tool}`;
}

export function adoptConfiguration(snapshot: unknown): {
  uv: boolean;
  uvx: boolean;
} {
  // Native sends a bounded private frame, never an env filename. No dotenv
  // loader is invoked; private state cannot depend on cwd or adjacent files.
  Object.assign(process.env, activationEnvironment(snapshot));
  // GUI launches may inherit umask022. Keep backend and connector/FIT-created
  // files private from creation (GHSA-wjhr-76vg-2hvc), not only after chmod.
  // This owned child-process policy never changes permissions of existing files.
  // Windows has no umask: native creates private directories with inheritable
  // owner-only DACLs, so files created inside them are private from creation.
  if (process.platform !== "win32") process.umask(0o077);
  const env = getOptionalEnv();
  const reviewedArgs =
    JSON.stringify(garminMcpArgs(env.GARMIN_MCP_ARGS)) ===
    JSON.stringify(garminMcpArgs(GARMIN_MCP_DEFAULT_ARGS_STRING));
  const uvx = reviewedArgs
    ? resolveExecutable(env.GARMIN_MCP_COMMAND)
    : undefined;
  // Missing integrations do not prevent offline/persisted views. Set an absolute
  // non-existent command so no inherited PATH fallback can choose another tool.
  process.env.GARMIN_MCP_COMMAND = uvx ?? unavailable("uvx");
  const uv = resolveExecutable("uv");
  for (const key of [
    "GARMIN_FIT_BASELINE_COMMAND",
    "GARMIN_FIT_SPEED_COMMAND",
    "GARMIN_FIT_DISTANCE_COMMAND",
    "GARMIN_FIT_ALTITUDE_COMMAND",
  ]) {
    const configured = process.env[key];
    process.env[key] =
      (configured ? resolveExecutable(configured) : uv) ?? unavailable("uv");
  }
  process.env.PATH = (
    process.platform === "win32"
      ? [
          win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
          process.env.SystemRoot ?? "C:\\Windows",
        ]
      : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
  ).join(delimiter);
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
