import { getOptionalEnv, requireRuntimeEnv } from "../env";
import {
  activityDetailCoverage,
  dataCounts,
  finishSyncRun,
  getActivityDetailForAnalytics,
  getCheckpoint,
  getGarminAthleteBaseline,
  listActivityIdsNeedingDetail,
  listRecentActivities,
  recordActivityDetailAttempt,
  recordGarminAthleteBaselineFailure,
  recordSyncRun,
  saveCheckpoint,
  upsertActivities,
  upsertGarminRawPayload,
  upsertActivityDetail,
  upsertDailyHealth,
  writeGarminAthleteBaselineRefresh,
} from "../db/repository";
import { GarminMcpClient } from "./mcp-client";
import { fetchFitBaselineWithLocalWrapper } from "./fit-baseline";
import {
  hasUsableGarminAthleteBaseline,
  normalizeGarminAthleteBaseline,
} from "./athlete-normalize";
import {
  normalizeActivityDetail,
  normalizeUnsupportedActivityDetail,
} from "./detail-normalize";
import { normalizeActivity, normalizeDailyHealth } from "./normalize";
import type { GarminAthleteBaselineDto } from "./types";

type ActivityPage = {
  activities?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_page?: number;
};

export type GarminSyncResult = {
  status: "completed" | "failed";
  activitiesImported: number;
  healthDaysImported: number;
  detailsProcessed: number;
  coverageStart: string;
  coverageEnd: string;
  detailCoverage: ReturnType<typeof activityDetailCoverage>;
  athleteBaseline: GarminAthleteBaselineDto;
  detail: string;
};

export type GarminSyncProgress = {
  stage:
    | "starting"
    | "athlete"
    | "activities"
    | "health"
    | "detail"
    | "completed"
    | "failed";
  message: string;
  activitiesImported: number;
  healthDaysImported: number;
  detailsProcessed?: number;
  detailTotal?: number;
  page?: number;
  date?: string;
  totalHealthDays?: number;
  completedHealthDays?: number;
  athleteAvailability?: GarminAthleteBaselineDto["availability"];
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

function addUtcDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return isoDate(cursor);
}

function maxIsoDate(first: string, second: string): string {
  return first > second ? first : second;
}

function dateRange(startDate: string, endDate: string): string[] {
  return startDate <= endDate ? eachDate(startDate, endDate) : [];
}

export function dailyHealthImportPlan(input: {
  historyStartDate: string;
  resumeDate: string;
  endDate: string;
  recentWindowDays?: number;
}): { dates: string[]; checkpointDates: string[]; recentDates: string[] } {
  const recentWindowDays = Math.max(1, Math.trunc(input.recentWindowDays ?? 7));
  const historicalDates = dateRange(
    maxIsoDate(input.historyStartDate, input.resumeDate),
    input.endDate,
  );
  const recentDates = dateRange(
    maxIsoDate(
      input.historyStartDate,
      addUtcDays(input.endDate, 1 - recentWindowDays),
    ),
    input.endDate,
  );
  return {
    dates: Array.from(new Set([...historicalDates, ...recentDates])).sort(),
    checkpointDates: historicalDates,
    recentDates,
  };
}

function compactError(error: unknown): string {
  return (
    error instanceof Error
      ? error.message
      : "Garmin athlete baseline fetch failed"
  ).slice(0, 500);
}

async function fetchAndStoreAthleteBaseline(
  client: GarminMcpClient,
  fitPayload?: unknown,
): Promise<GarminAthleteBaselineDto> {
  const attemptedAt = new Date();
  const previous = getGarminAthleteBaseline();
  let profilePayload: unknown;
  let ftpPayload: unknown;
  const errors: string[] = [];
  try {
    profilePayload = parseToolJson(
      await client.callTool("get_user_profile", {}),
    );
    upsertGarminRawPayload({
      sourceTool: "get_user_profile",
      subjectType: "athlete_baseline",
      subjectId: "default:profile",
      payload: profilePayload,
    });
  } catch (error) {
    errors.push(`profile: ${compactError(error)}`);
  }
  try {
    ftpPayload = parseToolJson(await client.callTool("get_cycling_ftp", {}));
    upsertGarminRawPayload({
      sourceTool: "get_cycling_ftp",
      subjectType: "athlete_baseline",
      subjectId: "default:cycling_ftp",
      payload: ftpPayload,
    });
  } catch (error) {
    errors.push(`cycling FTP: ${compactError(error)}`);
  }
  if (!profilePayload && !ftpPayload) {
    const preservedPrevious = Boolean(previous.fetchedAt);
    recordGarminAthleteBaselineFailure({
      attemptedAt,
      errorMessage: errors.join("; ") || "Garmin athlete baseline fetch failed",
      preservedPrevious,
    });
    return getGarminAthleteBaseline();
  }
  const snapshot = normalizeGarminAthleteBaseline({
    profilePayload,
    ftpPayload,
    fitPayload,
    fetchedAt: new Date(),
  });
  const hasUsableSnapshot = hasUsableGarminAthleteBaseline(snapshot);
  writeGarminAthleteBaselineRefresh({
    snapshot: hasUsableSnapshot ? snapshot : null,
    status: snapshot.availability,
    attemptedAt,
    errorMessage: errors.length ? errors.join("; ") : null,
    preservedPrevious: false,
  });
  return getGarminAthleteBaseline();
}

async function fetchFitAthleteBaselinePayload(
  client: GarminMcpClient,
): Promise<unknown> {
  const recent = listRecentActivities(6);
  for (const activity of recent) {
    try {
      const parsed = parseToolJson(
        await client.callTool("get_activity_fit_data", {
          activity_id: activity.garminId,
          include_records: false,
        }),
      );
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        ("zones_target" in parsed || "zonesTarget" in parsed)
      ) {
        return parsed;
      }
    } catch {
      // FIT detail is best-effort for athlete-baseline recovery; normal detail
      // refresh records per-activity failures later without blocking sync.
    }
  }
  return fetchFitBaselineWithLocalWrapper(
    recent.map((activity) => activity.garminId),
  );
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
  let detailsProcessed = 0;
  let athleteBaseline = getGarminAthleteBaseline();

  try {
    onProgress({
      stage: "starting",
      message: "Starting pinned Garmin MCP stdio connector…",
      activitiesImported,
      healthDaysImported,
    });
    await client.start();
    onProgress({
      stage: "athlete",
      message:
        "Refreshing Garmin athlete baselines from approved read-only profile tools…",
      activitiesImported,
      healthDaysImported,
      athleteAvailability: athleteBaseline.availability,
    });
    athleteBaseline = await fetchAndStoreAthleteBaseline(client);
    onProgress({
      stage: "athlete",
      message: `Garmin athlete baseline refresh ${athleteBaseline.availability}; checking recent FIT zones target for configured max HR after activity import.`,
      activitiesImported,
      healthDaysImported,
      athleteAvailability: athleteBaseline.availability,
    });
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
      upsertGarminRawPayload({
        sourceTool: "get_activities_by_date",
        subjectType: "activity_page",
        subjectId: `${startDate}:${endDate}:page:${page}`,
        payload: parsed,
      });
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

    const fitBaselinePayload = await fetchFitAthleteBaselinePayload(client);
    if (fitBaselinePayload) {
      athleteBaseline = await fetchAndStoreAthleteBaseline(
        client,
        fitBaselinePayload,
      );
      onProgress({
        stage: "athlete",
        message: `Garmin athlete baseline refresh ${athleteBaseline.availability}; configured max HR ${athleteBaseline.values.configuredMaxHeartRateBpm ? "recovered from FIT zones target" : "unavailable"}; HR zones ${athleteBaseline.values.heartRateZones.status}.`,
        activitiesImported,
        healthDaysImported,
        athleteAvailability: athleteBaseline.availability,
      });
    }

    const resumeDate = getCheckpoint("health_next_date") ?? startDate;
    const healthPlan = dailyHealthImportPlan({
      historyStartDate: startDate,
      resumeDate,
      endDate,
    });
    const checkpointDates = new Set(healthPlan.checkpointDates);
    for (const [index, date] of healthPlan.dates.entries()) {
      onProgress({
        stage: "health",
        message: `Refreshing daily health ${index + 1}/${healthPlan.dates.length}: ${date}…`,
        activitiesImported,
        healthDaysImported,
        date,
        totalHealthDays: healthPlan.dates.length,
        completedHealthDays: index,
      });
      const statsText = await client.callTool("get_stats", { date });
      const sleepText = await client.callTool("get_sleep_summary", { date });
      const stats = parseToolJson(statsText);
      const sleep = parseToolJson(sleepText);
      upsertGarminRawPayload({
        sourceTool: "get_stats",
        subjectType: "daily_health",
        subjectId: `${date}:stats`,
        payload: stats,
      });
      upsertGarminRawPayload({
        sourceTool: "get_sleep_summary",
        subjectType: "daily_health",
        subjectId: `${date}:sleep`,
        payload: sleep,
      });
      healthDaysImported += upsertDailyHealth([
        normalizeDailyHealth(date, { stats, sleep }),
      ]);
      if (checkpointDates.has(date)) {
        const next = new Date(`${date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        saveCheckpoint("health_next_date", isoDate(next));
      }
      onProgress({
        stage: "health",
        message: `Imported daily health ${index + 1}/${healthPlan.dates.length}: ${date}.`,
        activitiesImported,
        healthDaysImported,
        date,
        totalHealthDays: healthPlan.dates.length,
        completedHealthDays: index + 1,
      });
    }

    const detailIds = listActivityIdsNeedingDetail();
    for (const [index, garminId] of detailIds.entries()) {
      onProgress({
        stage: "detail",
        message: `Refreshing missing activity detail ${index + 1}/${detailIds.length}: ${garminId}…`,
        activitiesImported,
        healthDaysImported,
        detailsProcessed,
        detailTotal: detailIds.length,
      });
      await fetchAndStoreActivityDetail(client, garminId, { force: false });
      detailsProcessed += 1;
      saveCheckpoint("activity_detail_last_id", garminId);
    }

    saveCheckpoint("activity_page", "0");
    finishSyncRun(syncRunId, "completed");
    const totals = dataCounts();
    const result = {
      status: "completed" as const,
      activitiesImported,
      healthDaysImported,
      detailsProcessed,
      coverageStart: startDate,
      coverageEnd: endDate,
      detailCoverage: totals.detailCoverage,
      athleteBaseline,
      detail: `Garmin sync completed through the pinned stdio MCP connector. Database now has ${totals.activities} activities, ${totals.healthDays} health days, detail coverage ${totals.detailCoverage.terminal}/${totals.detailCoverage.total} terminal (${totals.detailCoverage.retryableFailures} retryable failures, ${totals.detailCoverage.pending} pending), and athlete baseline status ${athleteBaseline.availability}. Redacted raw connector payloads were retained locally for generated analysis; configured max HR and complete HR-zone boundaries were not estimated.`,
    };
    onProgress({
      stage: "completed",
      message: result.detail,
      activitiesImported,
      healthDaysImported,
      detailsProcessed,
      detailTotal: detailIds.length,
      athleteAvailability: athleteBaseline.availability,
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
      detailsProcessed,
      coverageStart: startDate,
      coverageEnd: endDate,
      detailCoverage: activityDetailCoverage(),
      athleteBaseline,
      detail: message.slice(0, 1000),
    };
  } finally {
    client.close();
  }
}

export type DetailedBackfillResult = {
  status: "completed" | "failed";
  garminId: string;
  detailStatus: "available" | "partial" | "unsupported" | "failed";
  recordCount: number;
  lapCount: number;
  preservedPrevious: boolean;
  retryable: boolean;
  detail: string;
};

type DetailRefreshOptions = { force?: boolean };

function classifyDetailError(error: unknown): {
  errorClass: string;
  message: string;
  retryable: boolean;
} {
  const message =
    error instanceof Error ? error.message : "detail backfill failed";
  const normalized = message.toLowerCase();
  const stableUnsupported = /not found|unsupported|no fit|unavailable/.test(
    normalized,
  );
  const auth = /auth|token|login|credential/.test(normalized);
  const timeout = /timeout|timed out|rate|429/.test(normalized);
  return {
    errorClass: auth
      ? "auth"
      : timeout
        ? "timeout"
        : stableUnsupported
          ? "unsupported"
          : "connector",
    message: message.slice(0, 1000),
    retryable: !stableUnsupported,
  };
}

async function fetchAndStoreActivityDetail(
  client: GarminMcpClient,
  garminId: string,
  options: DetailRefreshOptions = {},
): Promise<DetailedBackfillResult> {
  const previous = getActivityDetailForAnalytics(garminId).availability;
  recordActivityDetailAttempt({
    garminId,
    force: options.force,
    status: "running",
    retryable: false,
  });
  try {
    const text = await client.callTool("get_activity_fit_data", {
      activity_id: garminId,
      include_records: true,
    });
    const parsed = parseToolJson(text);
    upsertGarminRawPayload({
      sourceTool: "get_activity_fit_data",
      subjectType: "activity_detail",
      subjectId: garminId,
      payload: parsed,
    });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const detail = normalizeActivityDetail(garminId, parsed);
      upsertActivityDetail(detail);
      const detailStatus =
        detail.status === "not_requested" ? "unsupported" : detail.status;
      recordActivityDetailAttempt({
        garminId,
        force: options.force,
        status: detailStatus === "unsupported" ? "unsupported" : "succeeded",
        detailStatus,
        retryable: false,
        preservedPrevious: false,
      });
      return {
        status: "completed",
        garminId,
        detailStatus,
        recordCount: detail.recordCount,
        lapCount: detail.lapCount,
        preservedPrevious: false,
        retryable: false,
        detail: `Detailed Garmin activity ${garminId} normalized locally from FIT parser. Records: ${detail.recordCount}; laps: ${detail.lapCount}. Redacted raw connector payload was retained locally for generated analysis.`,
      };
    }
    const unsupported = normalizeUnsupportedActivityDetail(
      garminId,
      typeof parsed === "string"
        ? parsed
        : "Connector returned an unparseable activity detail payload.",
    );
    upsertActivityDetail(unsupported);
    recordActivityDetailAttempt({
      garminId,
      force: options.force,
      status: "unsupported",
      detailStatus: "unsupported",
      retryable: false,
      preservedPrevious: false,
    });
    return {
      status: "completed",
      garminId,
      detailStatus: "unsupported",
      recordCount: 0,
      lapCount: 0,
      preservedPrevious: false,
      retryable: false,
      detail: unsupported.unavailableReason ?? "Activity detail unsupported.",
    };
  } catch (error) {
    const classified = classifyDetailError(error);
    const preservedPrevious = Boolean(
      previous && ["available", "partial"].includes(previous.status),
    );
    if (!classified.retryable && !preservedPrevious) {
      upsertActivityDetail(
        normalizeUnsupportedActivityDetail(garminId, classified.message),
      );
    }
    recordActivityDetailAttempt({
      garminId,
      force: options.force,
      status: "failed",
      detailStatus: "failed",
      retryable: classified.retryable,
      errorClass: classified.errorClass,
      errorMessage: classified.message,
      preservedPrevious,
    });
    return {
      status: "failed",
      garminId,
      detailStatus: "failed",
      recordCount: previous?.recordCount ?? 0,
      lapCount: previous?.lapCount ?? 0,
      preservedPrevious,
      retryable: classified.retryable,
      detail: preservedPrevious
        ? `${classified.message}. Previous usable normalized detail was preserved.`
        : classified.message,
    };
  }
}

export async function backfillActivityDetail(
  garminId: string,
  options: DetailRefreshOptions = {},
): Promise<DetailedBackfillResult> {
  const client = new GarminMcpClient();
  try {
    await client.start();
    return await fetchAndStoreActivityDetail(client, garminId, options);
  } finally {
    client.close();
  }
}

export function garminSyncPlan(): string {
  const env = getOptionalEnv();
  return `Pinned command: ${env.GARMIN_MCP_COMMAND} ${env.GARMIN_MCP_ARGS}; start date ${env.GARMIN_HISTORY_START_DATE ?? "missing"}`;
}
