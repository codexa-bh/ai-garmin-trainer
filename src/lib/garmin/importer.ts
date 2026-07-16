import { getOptionalEnv, requireRuntimeEnv } from "../env";
import {
  finishSyncRun,
  getCheckpoint,
  recordSyncRun,
  saveCheckpoint,
  upsertActivities,
  upsertDailyHealth,
} from "../db/repository";
import { GarminMcpClient } from "./mcp-client";
import { normalizeActivity, normalizeDailyHealth } from "./normalize";

type ActivityPage = {
  activities?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_page?: number;
};

export type GarminSyncResult = {
  status: "completed" | "failed";
  activitiesImported: number;
  healthDaysImported: number;
  coverageStart: string;
  coverageEnd: string;
  detail: string;
};

export type GarminSyncProgress = {
  stage: "starting" | "activities" | "health" | "completed" | "failed";
  message: string;
  activitiesImported: number;
  healthDaysImported: number;
  page?: number;
  date?: string;
  totalHealthDays?: number;
  completedHealthDays?: number;
};

type ProgressReporter = (progress: GarminSyncProgress) => void;

function parseToolJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { message: trimmed };
  }
  return JSON.parse(trimmed);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDate(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function runGarminSync(
  onProgress: ProgressReporter = () => undefined,
): Promise<GarminSyncResult> {
  const env = requireRuntimeEnv();
  const endDate = isoDate(new Date());
  const startDate = env.GARMIN_HISTORY_START_DATE as string;
  const syncRunId = recordSyncRun("running");
  const client = new GarminMcpClient();
  let activitiesImported = 0;
  let healthDaysImported = 0;

  try {
    onProgress({
      stage: "starting",
      message: "Starting pinned Garmin MCP stdio connector…",
      activitiesImported,
      healthDaysImported,
    });
    await client.start();
    let page = Number(getCheckpoint("activity_page") ?? 0);
    while (true) {
      onProgress({
        stage: "activities",
        message: `Fetching Garmin activities page ${page}…`,
        activitiesImported,
        healthDaysImported,
        page,
      });
      const text = await client.callTool("get_activities_by_date", {
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: 100,
      });
      const parsed = parseToolJson(text) as ActivityPage;
      const normalized = (parsed.activities ?? []).map((activity) =>
        normalizeActivity(activity),
      );
      activitiesImported += upsertActivities(normalized);
      saveCheckpoint("activity_page", String(page));
      onProgress({
        stage: "activities",
        message: `Imported ${activitiesImported} activities through page ${page}.`,
        activitiesImported,
        healthDaysImported,
        page,
      });
      if (!parsed.has_more) break;
      page = parsed.next_page ?? page + 1;
    }

    const resumeDate = getCheckpoint("health_next_date") ?? startDate;
    const dates = eachDate(resumeDate, endDate);
    for (const [index, date] of dates.entries()) {
      onProgress({
        stage: "health",
        message: `Backfilling daily health ${index + 1}/${dates.length}: ${date}…`,
        activitiesImported,
        healthDaysImported,
        date,
        totalHealthDays: dates.length,
        completedHealthDays: index,
      });
      const statsText = await client.callTool("get_stats", { date });
      const sleepText = await client.callTool("get_sleep_summary", { date });
      const stats = parseToolJson(statsText);
      const sleep = parseToolJson(sleepText);
      healthDaysImported += upsertDailyHealth([
        normalizeDailyHealth(date, { stats, sleep }),
      ]);
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      saveCheckpoint("health_next_date", isoDate(next));
      onProgress({
        stage: "health",
        message: `Imported daily health ${index + 1}/${dates.length}: ${date}.`,
        activitiesImported,
        healthDaysImported,
        date,
        totalHealthDays: dates.length,
        completedHealthDays: index + 1,
      });
    }

    finishSyncRun(syncRunId, "completed");
    const result = {
      status: "completed" as const,
      activitiesImported,
      healthDaysImported,
      coverageStart: startDate,
      coverageEnd: endDate,
      detail:
        "Garmin sync completed through the pinned stdio MCP connector. Raw connector payloads were normalized in memory and not retained.",
    };
    onProgress({
      stage: "completed",
      message: result.detail,
      activitiesImported,
      healthDaysImported,
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Garmin sync failed";
    finishSyncRun(syncRunId, "failed", message.slice(0, 1000));
    onProgress({
      stage: "failed",
      message: message.slice(0, 1000),
      activitiesImported,
      healthDaysImported,
    });
    return {
      status: "failed",
      activitiesImported,
      healthDaysImported,
      coverageStart: startDate,
      coverageEnd: endDate,
      detail: message.slice(0, 1000),
    };
  } finally {
    client.close();
  }
}

export function garminSyncPlan(): string {
  const env = getOptionalEnv();
  return `Pinned command: ${env.GARMIN_MCP_COMMAND} ${env.GARMIN_MCP_ARGS}; start date ${env.GARMIN_HISTORY_START_DATE ?? "missing"}`;
}
