import { delimiter, win32 } from "node:path";
import { updateInitialEnv } from "@next/env";
import { activationEnvironment, garminActivationKey } from "./settings";
import type { NextConfig } from "next";
import { installGarminConnection } from "../../src/lib/garmin/connection";

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

export function adoptConfiguration(snapshot: unknown): void {
  // Native sends a bounded private frame, never an env filename. No dotenv
  // loader is invoked; private state cannot depend on cwd or adjacent files.
  Object.assign(process.env, activationEnvironment(snapshot));
  // The Garmin key is a process-owned capability, never an environment value,
  // so no child process, framework reset or diagnostic can inherit it.
  installGarminConnection({
    key: garminActivationKey(snapshot),
    fixture: garminFixture(snapshot),
  });
  // GUI launches may inherit umask022. Keep backend-created files private from
  // creation (GHSA-wjhr-76vg-2hvc), not only after chmod. This owned process
  // policy never changes permissions of existing files. Windows has no umask:
  // native creates private directories with inheritable owner-only DACLs, so
  // files created inside them are private from creation.
  if (process.platform !== "win32") process.umask(0o077);
  process.env.PATH = (
    process.platform === "win32"
      ? [
          win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
          process.env.SystemRoot ?? "C:\\Windows",
        ]
      : ["/usr/bin", "/bin"]
  ).join(delimiter);
  process.env.TRAINER_DESKTOP = "1";
  Object.assign(process.env, { NODE_ENV: "production" });
  // These internal control values can never be selected by the private env file.
  delete process.env.NODE_OPTIONS;
  delete process.env.NODE_PATH;
  // Next prepare() resets process.env to its initial snapshot before loading
  // framework config. Make the validated absolute adoption overlay that snapshot;
  // otherwise it can silently restore source defaults and create an empty DB.
  updateInitialEnv(process.env);
}

/**
 * Native adds this only for an admitted isolated synthetic run (never from
 * saved settings): an owned loopback stand-in for the official origin.
 */
function garminFixture(
  snapshot: unknown,
): { origin: string; capability: string } | undefined {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !("garminFixture" in snapshot)
  )
    return undefined;
  const fixture = snapshot.garminFixture as Record<string, unknown> | null;
  const origin = typeof fixture?.origin === "string" ? fixture.origin : "";
  const capability =
    typeof fixture?.capability === "string" ? fixture.capability : "";
  if (
    !fixture ||
    Object.keys(fixture).length !== 2 ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin) ||
    !/^[a-f0-9]{64}$/.test(capability)
  )
    throw new Error("Invalid Garmin fixture.");
  return { origin, capability };
}
