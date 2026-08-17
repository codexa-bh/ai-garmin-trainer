import { getOptionalEnv, requireRuntimeEnv } from "../env";
import {
  activityDetailCoverage,
  dataCounts,
  finishSyncRun,
  getActivityDetailForAnalytics,
  getCheckpoint,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  listActivityIdsNeedingDetail,
  listDailyHealthRepairCandidateDates,
  listActivityIdsNeedingEffortBackfill,
  listRecentActivities,
  recordActivityDetailAttempt,
  recordGarminAthleteBaselineFailure,
  recordGarminBodyMetricsFailure,
  recordSyncRun,
  saveCheckpoint,
  upsertActivities,
  upsertGarminRawPayload,
  upsertActivityDetail,
  upsertActivityHrZoneTime,
  upsertDailyHealth,
  writeGarminAthleteBaselineRefresh,
  writeGarminBodyMetricsRefresh,
} from "../db/repository";
import { GarminMcpClient } from "./mcp-client";
import { fetchFitBaselineWithLocalWrapper } from "./fit-baseline";
import {
  activityDetailNeedsAltitudeSupplement,
  fetchFitAltitudeWithLocalWrapper,
  mergeFitAltitudeRecords,
} from "./fit-altitude";
import {
  activityDetailNeedsDistanceSupplement,
  fetchFitDistanceWithLocalWrapper,
  mergeFitDistanceRecords,
} from "./fit-distance";
import {
  activityDetailNeedsSpeedSupplement,
  fetchFitSpeedWithLocalWrapper,
  mergeFitSpeedRecords,
} from "./fit-speed";
import {
  hasUsableGarminAthleteBaseline,
  normalizeGarminAthleteBaseline,
} from "./athlete-normalize";
import {
  hasUsableGarminBodyMetrics,
  normalizeGarminBodyMetrics,
} from "./body-metrics-normalize";
import { normalizeActivityHrZoneTime } from "./activity-hr-zone-time";
import {
  normalizeActivityDetail,
  normalizeUnsupportedActivityDetail,
} from "./detail-normalize";
import { normalizeActivity, normalizeDailyHealth } from "./normalize";
import type { GarminAthleteBaselineDto, GarminBodyMetricsDto } from "./types";

type ActivityPage = {
  activities?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_page?: number;
};

export type GarminSyncResult = {
  status: "completed" | "failed";
  activitiesImported: number;
  healthDaysImported: number;
  activitiesProcessed: number;
  healthDaysRefreshed: number;
  detailsProcessed: number;
  effortDetailsProcessed: number;
  storedActivities: number;
  storedHealthRows: number;
  coverageStart: string;
  coverageEnd: string;
  healthCoverage: ReturnType<typeof dataCounts>["healthCoverage"];
  detailCoverage: ReturnType<typeof activityDetailCoverage>;
  athleteBaseline: GarminAthleteBaselineDto;
  bodyMetrics: GarminBodyMetricsDto;
  detail: string;
};

export type GarminSyncProgress = {
  stage:
    | "starting"
    | "athlete"
    | "body_metrics"
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
  bodyMetricsAvailability?: GarminBodyMetricsDto["availability"];
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
  repairDates?: string[];
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
  const repairDates = (input.repairDates ?? []).filter(
    (date) => date >= input.historyStartDate && date <= input.endDate,
  );
  return {
    dates: Array.from(
      new Set([...historicalDates, ...recentDates, ...repairDates]),
    ).sort(),
    checkpointDates: historicalDates,
    recentDates,
  };
}

function compactError(error: unknown): string {
  return (
    error instanceof Error ? error.message : "Garmin connector fetch failed"
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
  } catch (error) {
    errors.push(`profile: ${compactError(error)}`);
  }
  try {
    ftpPayload = parseToolJson(await client.callTool("get_cycling_ftp", {}));
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

async function fetchAndStoreBodyMetrics(
  client: GarminMcpClient,
  startDate: string,
  endDate: string,
): Promise<GarminBodyMetricsDto> {
  const attemptedAt = new Date();
  const previous = getGarminBodyMetrics();
  let profilePayload: unknown;
  let historyPayload: unknown;
  let historyFailed = false;
  const errors: string[] = [];
  try {
    profilePayload = parseToolJson(
      await client.callTool("get_user_profile", {}),
    );
  } catch (error) {
    errors.push(`profile: ${compactError(error)}`);
  }
  try {
    historyPayload = parseToolJson(
      await client.callTool("get_body_composition", {
        start_date: startDate,
        end_date: endDate,
      }),
    );
  } catch (error) {
    historyFailed = true;
    errors.push(`body composition history: ${compactError(error)}`);
  }
  if (!profilePayload && !historyPayload) {
    const preservedPrevious = Boolean(previous.fetchedAt);
    recordGarminBodyMetricsFailure({
      attemptedAt,
      errorMessage: errors.join("; ") || "Garmin body metrics fetch failed",
      preservedPrevious,
    });
    return getGarminBodyMetrics();
  }
  const snapshot = normalizeGarminBodyMetrics({
    profilePayload,
    historyPayload,
    historyFailed,
    fetchedAt: new Date(),
  });
  const hasUsableSnapshot = hasUsableGarminBodyMetrics(snapshot);
  writeGarminBodyMetricsRefresh({
    snapshot: hasUsableSnapshot ? snapshot : null,
    status: snapshot.availability,
    attemptedAt,
    errorMessage: errors.length ? errors.join("; ") : null,
    preservedPrevious: false,
  });
  return getGarminBodyMetrics();
}

async function fetchAndStoreActivityEffort(
  client: GarminMcpClient,
  garminId: string,
): Promise<boolean> {
  try {
    const text = await client.callTool("get_activity", {
      activity_id: garminId,
    });
    const parsed = parseToolJson(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    upsertActivities([normalizeActivity(parsed as Record<string, unknown>)]);
    return true;
  } catch {
    return false;
  }
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
  const syncRunId = recordSyncRun("running", {
    coverageStart: startDate,
    coverageEnd: endDate,
  });
  const client = new GarminMcpClient();
  let activitiesImported = 0;
  let healthDaysImported = 0;
  let detailsProcessed = 0;
  let effortDetailsProcessed = 0;
  let athleteBaseline = getGarminAthleteBaseline();
  let bodyMetrics = getGarminBodyMetrics();

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
    onProgress({
      stage: "body_metrics",
      message:
        "Refreshing Garmin body metrics from approved read-only profile/body-composition tools…",
      activitiesImported,
      healthDaysImported,
      bodyMetricsAvailability: bodyMetrics.availability,
    });
    bodyMetrics = await fetchAndStoreBodyMetrics(client, startDate, endDate);
    onProgress({
      stage: "body_metrics",
      message: `Garmin body metrics refresh ${bodyMetrics.availability}; current weight ${bodyMetrics.values.weightKg !== null ? "available" : "unavailable"}; height ${bodyMetrics.values.heightCm !== null ? "available" : "unavailable"}; weight history ${bodyMetrics.history.availability}.`,
      activitiesImported,
      healthDaysImported,
      bodyMetricsAvailability: bodyMetrics.availability,
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

    const effortBackfillIds = listActivityIdsNeedingEffortBackfill(50);
    for (const [index, garminId] of effortBackfillIds.entries()) {
      onProgress({
        stage: "activities",
        message: `Refreshing Garmin activity effort fields ${index + 1}/${effortBackfillIds.length} from read-only activity detail…`,
        activitiesImported,
        healthDaysImported,
        page,
      });
      if (await fetchAndStoreActivityEffort(client, garminId)) {
        effortDetailsProcessed += 1;
      }
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
    const repairDates = listDailyHealthRepairCandidateDates({
      startDate,
      endDate,
    });
    const healthPlan = dailyHealthImportPlan({
      historyStartDate: startDate,
      resumeDate,
      endDate,
      repairDates,
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
      const bodyBatteryText = await client.callTool("get_body_battery", {
        start_date: date,
        end_date: date,
      });
      const stats = parseToolJson(statsText);
      const sleep = parseToolJson(sleepText);
      const bodyBattery = parseToolJson(bodyBatteryText);
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
      upsertGarminRawPayload({
        sourceTool: "get_body_battery",
        subjectType: "daily_health",
        subjectId: `${date}:body_battery`,
        payload: bodyBattery,
      });
      healthDaysImported += upsertDailyHealth([
        normalizeDailyHealth(date, { stats, sleep, bodyBattery }),
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
      activitiesProcessed: activitiesImported,
      healthDaysRefreshed: healthDaysImported,
      detailsProcessed,
      effortDetailsProcessed,
      storedActivities: totals.activities,
      storedHealthRows: totals.healthCoverage.totalRows,
      coverageStart: startDate,
      coverageEnd: endDate,
      healthCoverage: totals.healthCoverage,
      detailCoverage: totals.detailCoverage,
      athleteBaseline,
      bodyMetrics,
      detail: `Sync complete via pinned read-only Garmin MCP stdio. Processed ${activitiesImported} activity records; refreshed ${healthDaysImported} health dates including ${repairDates.length} missing-row repair candidates; refreshed ${detailsProcessed} activity detail records. Stored totals: ${totals.activities} activities; health ${totals.healthCoverage.completeDays} complete, ${totals.healthCoverage.partialDays} partial, ${totals.healthCoverage.missingDays} missing of ${totals.healthCoverage.totalRows}; detail ${totals.detailCoverage.available} available, ${totals.detailCoverage.partial} partial, ${totals.detailCoverage.unsupported} unsupported, ${totals.detailCoverage.pending} pending. Athlete baseline ${athleteBaseline.availability}; body metrics ${bodyMetrics.availability}.`,
    };
    onProgress({
      stage: "completed",
      message: result.detail,
      activitiesImported,
      healthDaysImported,
      detailsProcessed,
      detailTotal: detailIds.length,
      athleteAvailability: athleteBaseline.availability,
      bodyMetricsAvailability: bodyMetrics.availability,
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Garmin sync failed";
    finishSyncRun(syncRunId, "failed", message.slice(0, 1000));
    const totals = dataCounts();
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
      activitiesProcessed: activitiesImported,
      healthDaysRefreshed: healthDaysImported,
      detailsProcessed,
      effortDetailsProcessed,
      storedActivities: totals.activities,
      storedHealthRows: totals.healthCoverage.totalRows,
      coverageStart: startDate,
      coverageEnd: endDate,
      healthCoverage: totals.healthCoverage,
      detailCoverage: totals.detailCoverage,
      athleteBaseline,
      bodyMetrics,
      detail: message.slice(0, 1000),
    };
  } finally {
    client.close();
  }
}

export type ActivityEffortBackfillResult = {
  status: "completed" | "failed";
  attempted: number;
  updated: number;
  remaining: number;
  detail: string;
};

export async function backfillActivityEffortFields(
  options: { limit?: number } = {},
): Promise<ActivityEffortBackfillResult> {
  const ids = listActivityIdsNeedingEffortBackfill(options.limit ?? 100);
  const client = new GarminMcpClient();
  let updated = 0;
  try {
    await client.start();
    for (const garminId of ids) {
      if (await fetchAndStoreActivityEffort(client, garminId)) updated += 1;
    }
    const remaining = listActivityIdsNeedingEffortBackfill(1).length;
    return {
      status: "completed",
      attempted: ids.length,
      updated,
      remaining,
      detail:
        remaining === 0
          ? `Activity effort back-sync completed for ${updated}/${ids.length} attempted activities; no activities remain without any normalized effort fields.`
          : `Activity effort back-sync completed for ${updated}/${ids.length} attempted activities; at least one activity still has no normalized effort fields.`,
    };
  } catch (error) {
    const remaining = listActivityIdsNeedingEffortBackfill(1).length;
    return {
      status: "failed",
      attempted: ids.length,
      updated,
      remaining,
      detail: (error instanceof Error
        ? error.message
        : "activity effort back-sync failed"
      ).slice(0, 500),
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

async function fetchAndStoreActivityHrZoneTime(
  client: GarminMcpClient,
  garminId: string,
): Promise<boolean> {
  try {
    const text = await client.callTool("get_activity_hr_in_timezones", {
      activity_id: garminId,
    });
    const parsed = parseToolJson(text);
    const normalized = normalizeActivityHrZoneTime(garminId, parsed);
    if (!normalized) return false;
    upsertActivityHrZoneTime(normalized);
    return true;
  } catch {
    // Garmin activity HR-zone totals are an additive dashboard source. Preserve
    // existing FIT detail behavior and any previous usable HR-zone rows when the
    // connector endpoint is unavailable or returns an unrecognized shape.
    return false;
  }
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
    let parsed = parseToolJson(text);
    if (activityDetailNeedsAltitudeSupplement(parsed)) {
      const altitudePayload = await fetchFitAltitudeWithLocalWrapper(garminId);
      parsed = mergeFitAltitudeRecords(parsed, altitudePayload);
    }
    if (activityDetailNeedsDistanceSupplement(parsed)) {
      const distancePayload = await fetchFitDistanceWithLocalWrapper(garminId);
      parsed = mergeFitDistanceRecords(parsed, distancePayload);
    }
    if (activityDetailNeedsSpeedSupplement(parsed)) {
      const speedPayload = await fetchFitSpeedWithLocalWrapper(garminId);
      parsed = mergeFitSpeedRecords(parsed, speedPayload);
    }
    upsertGarminRawPayload({
      sourceTool: "get_activity_fit_data",
      subjectType: "activity_detail",
      subjectId: garminId,
      payload: parsed,
    });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const detail = normalizeActivityDetail(garminId, parsed);
      upsertActivityDetail(detail);
      const storedHrZoneTime = await fetchAndStoreActivityHrZoneTime(
        client,
        garminId,
      );
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
        detail: `Detailed Garmin activity ${garminId} normalized locally from FIT parser. Records: ${detail.recordCount}; laps: ${detail.lapCount}; Garmin activity HR-zone totals ${storedHrZoneTime ? "stored" : "unavailable or preserved"}. Redacted raw connector payload was retained locally for generated analysis.`,
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
