import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type FitBaselinePayload = {
  zones_target?: {
    max_heart_rate?: number | null;
    threshold_heart_rate?: number | null;
    source?: string;
  } | null;
};

function hasZonesTarget(value: unknown): value is FitBaselinePayload {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "zones_target" in value,
  );
}

export async function fetchFitBaselineWithLocalWrapper(
  activityIds: string[],
): Promise<unknown> {
  if (activityIds.length === 0) return undefined;
  const scriptPath = join(process.cwd(), "scripts", "garmin_fit_baseline.py");
  if (!existsSync(scriptPath)) return undefined;
  const command = process.env.GARMIN_FIT_BASELINE_COMMAND ?? "uv";
  const args = [
    "run",
    "--python",
    "3.12",
    "--with",
    "garminconnect==0.3.2",
    "--with",
    "fitparse>=1.2.0",
    "python",
    scriptPath,
    ...activityIds.slice(0, 6),
  ];
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const parsed = JSON.parse(stdout.trim()) as unknown;
    return hasZonesTarget(parsed) && parsed.zones_target ? parsed : undefined;
  } catch {
    return undefined;
  }
}
