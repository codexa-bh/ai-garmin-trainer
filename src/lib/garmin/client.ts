import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getOptionalEnv } from "../env";
import type { GarminReadOperation } from "./types";

export const GARMIN_MCP_COMMIT = "2974244bfda1595b00836b3f942f579ec2d6f7d6";
export const READ_OPERATION_ALLOWLIST = new Set<GarminReadOperation>([
  "list_activities",
  "get_sleep",
  "get_rhr",
  "get_hrv",
  "get_stress",
  "get_steps",
  "get_calories",
  "get_body_battery",
]);

export function assertReadOperation(
  operation: string,
): asserts operation is GarminReadOperation {
  if (!READ_OPERATION_ALLOWLIST.has(operation as GarminReadOperation))
    throw new Error(`Blocked Garmin MCP operation: ${operation}`);
}

async function hasAnyFile(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch {
    return false;
  }
}

async function hasFile(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function verifyConnectorToken(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const env = getOptionalEnv();
  const defaultTokenFile = join(
    process.env.HOME ?? "",
    ".garminconnect",
    "garmin_tokens.json",
  );

  if (
    env.GARMIN_MCP_TOKEN_DIR &&
    (await hasAnyFile(env.GARMIN_MCP_TOKEN_DIR))
  ) {
    return {
      ok: true,
      detail: `Garmin token directory ${env.GARMIN_MCP_TOKEN_DIR} exists and contains local auth state. No token contents were read.`,
    };
  }

  if (await hasFile(defaultTokenFile)) {
    return {
      ok: true,
      detail:
        "Garmin auth state exists at the garmin-mcp-auth default token path (~/.garminconnect/garmin_tokens.json). No token contents were read.",
    };
  }

  const configuredDetail = env.GARMIN_MCP_TOKEN_DIR
    ? `Configured token directory ${env.GARMIN_MCP_TOKEN_DIR} is missing or empty, and default ~/.garminconnect/garmin_tokens.json was not found.`
    : "GARMIN_MCP_TOKEN_DIR is not configured and default ~/.garminconnect/garmin_tokens.json was not found.";

  return {
    ok: false,
    detail: `${configuredDetail} Run garmin-mcp-auth out of band; the app never collects your Garmin password.`,
  };
}

function mcpArgs(rawArgs: string): string[] {
  const args = rawArgs.split(" ").filter(Boolean);
  const legacyPackage = args.find((arg) => arg.startsWith("garmin-mcp@git+"));
  if (legacyPackage) {
    return [
      "--from",
      legacyPackage.replace("garmin-mcp@git+", "git+"),
      "garmin-mcp",
    ];
  }
  return args;
}

export function spawnGarminMcp() {
  const env = getOptionalEnv();
  const args = mcpArgs(env.GARMIN_MCP_ARGS);
  const child = spawn(env.GARMIN_MCP_COMMAND, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GARMIN_MCP_TOKEN_DIR: env.GARMIN_MCP_TOKEN_DIR,
      GARMIN_ENABLED_TOOLS:
        "get_activities_by_date,get_stats,get_sleep_summary",
    },
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  return child;
}
