import { spawnSync } from "node:child_process";
import {
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
} from "./mcp-config";
import {
  garminTokenEnvironment,
  prepareAuthDirectory,
  resolveTokenLocation,
} from "./token-location";

export function authCommand(input: NodeJS.ProcessEnv, args: string[]) {
  if (args.length)
    throw new Error(
      "garmin:auth accepts no overrides. Configure only GARMIN_MCP_TOKEN_DIR in .env.local.",
    );
  return {
    command: "uvx",
    args: [
      "--from",
      GARMIN_MCP_PACKAGE_URL,
      "--with",
      GARMIN_MCP_SDK_REQUIREMENT,
      "garmin-mcp-auth",
    ],
    env: garminTokenEnvironment(input),
  };
}

export function runAuth(
  input: NodeJS.ProcessEnv,
  args: string[],
  interactive = Boolean(process.stdin.isTTY),
  run = spawnSync,
): number {
  const command = authCommand(input, args);
  if (!interactive)
    throw new Error(
      "garmin:auth is operator-only; run it in a private interactive terminal, not as an unattended probe.",
    );
  prepareAuthDirectory(resolveTokenLocation(input.GARMIN_MCP_TOKEN_DIR));
  const previous = process.umask(0o077);
  try {
    const result = run(command.command, command.args, {
      env: command.env,
      stdio: "inherit",
    });
    if (result.error)
      throw new Error(
        "Could not start pinned Garmin authentication; check local uvx availability.",
      );
    return result.status ?? 1;
  } finally {
    process.umask(previous);
  }
}
