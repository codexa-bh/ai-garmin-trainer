import { spawn } from "node:child_process";
import { garminTokenEnvironment, inspectTokenLocation } from "./token-location";
import { getOptionalEnv } from "../env";
import {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_DEFAULT_ARGS_STRING,
  GARMIN_MCP_EXECUTABLE,
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
  GARMIN_MCP_SDK_VERSION,
  garminMcpArgs,
  garminMcpSdkConstraintStatus,
} from "./mcp-config";
import type { GarminReadOperation } from "./types";

export {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_DEFAULT_ARGS_STRING,
  GARMIN_MCP_EXECUTABLE,
  GARMIN_MCP_PACKAGE_URL,
  GARMIN_MCP_SDK_REQUIREMENT,
  GARMIN_MCP_SDK_VERSION,
  garminMcpArgs,
  garminMcpArgs as mcpArgs,
  garminMcpSdkConstraintStatus,
};
export const READ_OPERATION_ALLOWLIST = new Set<GarminReadOperation>([
  "list_activities",
  "get_sleep",
  "get_rhr",
  "get_hrv",
  "get_stress",
  "get_steps",
  "get_calories",
  "get_body_battery",
  "get_activities_by_date",
  "get_activity",
  "get_activity_splits",
  "get_activity_typed_splits",
  "get_activity_split_summaries",
  "get_activity_weather",
  "get_activity_hr_in_timezones",
  "get_activity_power_in_timezones",
  "get_activity_fit_data",
  "get_stats",
  "get_sleep_summary",
  "get_morning_training_readiness",
  "get_user_profile",
  "get_body_composition",
  "get_weigh_ins",
  "get_cycling_ftp",
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
  return inspectTokenLocation(getOptionalEnv().GARMIN_MCP_TOKEN_DIR);
}

export function spawnGarminMcp() {
  const env = getOptionalEnv();
  const presence = inspectTokenLocation(env.GARMIN_MCP_TOKEN_DIR);
  if (!presence.ok) throw new Error(presence.detail);
  const args = garminMcpArgs(env.GARMIN_MCP_ARGS);
  const child = spawn(env.GARMIN_MCP_COMMAND, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...garminTokenEnvironment(process.env),
      GARMIN_ENABLED_TOOLS:
        "get_activities_by_date,get_activity,get_activity_splits,get_activity_typed_splits,get_activity_split_summaries,get_activity_weather,get_activity_hr_in_timezones,get_activity_power_in_timezones,get_activity_fit_data,get_stats,get_sleep_summary,get_body_battery,get_morning_training_readiness,get_user_profile,get_body_composition,get_weigh_ins,get_cycling_ftp",
    },
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  return child;
}
