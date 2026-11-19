import { spawn } from "node:child_process";
import { garminTokenEnvironment, inspectTokenLocation } from "./token-location";
import { getOptionalEnv } from "../env";
import {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_SDK_REQUIREMENT,
  garminMcpArgs,
  garminMcpSdkConstraintStatus,
} from "./mcp-config";

export {
  GARMIN_MCP_COMMIT,
  GARMIN_MCP_SDK_REQUIREMENT,
  garminMcpArgs,
  garminMcpSdkConstraintStatus,
};

export async function verifyConnectorToken(): Promise<{
  ok: boolean;
  detail: string;
}> {
  return inspectTokenLocation(getOptionalEnv().GARMIN_MCP_TOKEN_DIR);
}

/** `reads` is the ordinary connector. `last-used` is a dedicated one-shot
 * process exposing only get_device_last_used with its local zone fixed to UTC:
 * the reviewed connector renders that upload epoch as offset-free local text,
 * so UTC0 makes the text an explicit UTC second. No other tool or process
 * changes its timezone. */
export type GarminConnectorProfile = "reads" | "last-used";

export function spawnGarminMcp(profile: GarminConnectorProfile = "reads") {
  const env = getOptionalEnv();
  const presence = inspectTokenLocation(env.GARMIN_MCP_TOKEN_DIR);
  if (!presence.ok) throw new Error(presence.detail);
  const args = garminMcpArgs(env.GARMIN_MCP_ARGS);
  const child = spawn(env.GARMIN_MCP_COMMAND, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...garminTokenEnvironment(process.env),
      ...(profile === "last-used"
        ? { GARMIN_ENABLED_TOOLS: "get_device_last_used", TZ: "UTC0" }
        : {
            GARMIN_ENABLED_TOOLS:
              "get_activities_by_date,get_activity,get_activity_splits,get_activity_typed_splits,get_activity_split_summaries,get_activity_weather,get_activity_hr_in_timezones,get_activity_power_in_timezones,get_activity_fit_data,get_stats,get_weekly_steps,get_devices,get_sleep_summary,get_body_battery,get_morning_training_readiness,get_user_profile,get_body_composition,get_weigh_ins,get_cycling_ftp",
          }),
    },
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  return child;
}
