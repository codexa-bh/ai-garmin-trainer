import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
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

export async function verifyConnectorToken(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const env = getOptionalEnv();
  if (!env.GARMIN_MCP_TOKEN_DIR) {
    return { ok: false, detail: "GARMIN_MCP_TOKEN_DIR is not configured" };
  }
  try {
    const entries = await readdir(env.GARMIN_MCP_TOKEN_DIR);
    if (entries.length === 0) {
      return {
        ok: false,
        detail: `Garmin token directory ${env.GARMIN_MCP_TOKEN_DIR} is empty. Run garmin-mcp-auth out of band; the app never collects your Garmin password.`,
      };
    }
    return {
      ok: true,
      detail: `Garmin token directory ${env.GARMIN_MCP_TOKEN_DIR} exists and contains local auth state. No token contents were read.`,
    };
  } catch {
    return {
      ok: false,
      detail: `Garmin token directory ${env.GARMIN_MCP_TOKEN_DIR} is missing. Run garmin-mcp-auth out of band; the app never collects your Garmin password.`,
    };
  }
}

export function spawnGarminMcp() {
  const env = getOptionalEnv();
  const args = env.GARMIN_MCP_ARGS.split(" ").filter(Boolean);
  const child = spawn(env.GARMIN_MCP_COMMAND, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GARMIN_MCP_TOKEN_DIR: env.GARMIN_MCP_TOKEN_DIR },
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  return child;
}
