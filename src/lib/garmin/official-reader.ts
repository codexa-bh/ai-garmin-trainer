import type { NormalizedActivityHrZoneTime } from "./activity-hr-zone-time";
import type { DayCoverageEvidence } from "./coverage-policy";
import type { GarminReader } from "./import-ports";
import {
  SYNC_LIMITS,
  SyncPause,
  historyFailureClass,
  shiftDate,
  type GarminReadControl,
} from "./history-policy";
import { normalizeActivity } from "./normalize";
import {
  normalizeActivityDetail,
  normalizeUnsupportedActivityDetail,
} from "./detail-normalize";
import {
  createOfficialClient,
  type OfficialRequestStats,
} from "./official-client";
import { OfficialApiError, officialProtocol } from "./official-error";
import {
  decodeActivityFit,
  estimatedZoneTime,
  exactZoneTime,
  type DecodedActivityFit,
} from "./official-fit";
import { FitAdmissionError } from "./official-zip";
import {
  listHrZoneSeconds,
  officialActivityPayload,
  officialBodyHistory,
  officialDailyHealth,
  officialDiscoveryHint,
  officialProfile,
  officialWeighIns,
  parseBodyBatteryRange,
  parseDailySummaries,
  parseHrvRange,
  parseSleepRange,
  summaryCoverageEvidence,
} from "./official-normalize";
import type {
  GarminOfficialArchiveTool,
  NormalizedActivity,
  NormalizedDailyHealth,
} from "./types";

/** Documented, measured and conservative request bounds (handoff §4). */
export const OFFICIAL_RANGE_LIMITS = {
  activityPage: 100,
  sleepDays: 31,
  bodyBatteryDays: 31,
  summaryDays: 365,
  hrvDays: 365,
  bodyHistoryDays: 364,
  discoveryDays: 364,
} as const;

export type OfficialReaderDeps = {
  control?: GarminReadControl;
  /** Explicit key capability for this reader's lifetime. */
  apiKey: () => string | Promise<string>;
  fetch: typeof fetch;
  archive(input: {
    sourceTool: GarminOfficialArchiveTool;
    subjectType: "activity_page" | "daily_health" | "activity_detail";
    subjectId: string;
    payload: unknown;
  }): void;
  clock?: () => Date;
};

type Row = Record<string, unknown>;
type Maps = Map<string, Row>;
type DecodedOrganic = DecodedActivityFit | { missing: string };

function span(start: string, end: string): number {
  return (
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86_400_000 +
    1
  );
}

export function createOfficialReader(
  deps: OfficialReaderDeps,
): GarminReader & { requestStats(): OfficialRequestStats } {
  const { control } = deps;
  const clock = deps.clock ?? (() => new Date());
  const cancellation = new AbortController();
  const client = createOfficialClient({
    apiKey: deps.apiKey,
    fetch: deps.fetch,
    gate: {
      signal: cancellation.signal,
      async admit() {
        if (!control) return { timeoutMs: SYNC_LIMITS.operationMs };
        await control.admit();
        if (control.cancelled()) throw new SyncPause("cancelled");
        const remaining = control.remainingMs();
        if (remaining <= 0) throw new SyncPause("budget-limited");
        return { timeoutMs: Math.min(SYNC_LIMITS.operationMs, remaining) };
      },
    },
  });

  async function guarded<T>(action: () => Promise<T>): Promise<T> {
    const watcher = control
      ? setInterval(() => {
          if (control.cancelled()) cancellation.abort();
        }, 50)
      : undefined;
    try {
      return await action();
    } catch (raw) {
      let error: unknown = raw;
      if (control?.cancelled()) error = new SyncPause("cancelled");
      else if (
        raw instanceof OfficialApiError &&
        raw.kind === "timeout" &&
        control &&
        control.remainingMs() <= 0
      )
        error = new SyncPause("budget-limited");
      control?.failed?.(error);
      throw error;
    } finally {
      clearInterval(watcher);
    }
  }

  /** Auth, rate limiting and cancellation never degrade into an empty success. */
  function fatal(error: unknown): boolean {
    return (
      error instanceof SyncPause ||
      ["auth", "rate-limit"].includes(historyFailureClass(error))
    );
  }

  // ---- operation-local, per-reader caches (never shared across accounts) ----
  let planned: string[] = [];
  const ranges = new Map<string, Promise<Maps>>();
  const archived = new Set<string>();
  const listZones = new Map<string, number[]>();
  const decodes = new Map<string, Promise<DecodedOrganic>>();

  function range(key: string, load: () => Promise<Maps>): Promise<Maps> {
    let pending = ranges.get(key);
    if (!pending) {
      pending = load();
      ranges.set(key, pending);
      // A failed range is retried by the next caller, never cached as a result.
      pending.catch(() => ranges.delete(key));
    }
    return pending;
  }

  /**
   * The 31-day block of planned dates containing `date` (or `date` alone when it
   * was not planned). Blocks span only the hull of dates the application chose,
   * never a wider window, so ranges are fetched only inside the selected bounds.
   */
  function block(date: string): { start: string; end: string } {
    const dates = [...new Set([...planned, date])].sort();
    let start = dates[0];
    let end = dates[0];
    for (const candidate of dates) {
      if (span(start, candidate) > OFFICIAL_RANGE_LIMITS.sleepDays) {
        if (end >= date) break;
        start = candidate;
      }
      end = candidate;
    }
    return { start, end };
  }

  async function dailySources(date: string) {
    const { start, end } = block(date);
    const key = `${start}:${end}`;
    // Strictly serial: pacing, admission and cancellation see one request at a time.
    const summaries = await range(`summary:${key}`, async () =>
      parseDailySummaries(
        await client.json(
          "/usersummary-service/v2/dailysummaries",
          { startDate: start, endDate: end },
          "daily-summaries",
        ),
        start,
        end,
      ),
    );
    const sleep = await range(`sleep:${key}`, async () =>
      parseSleepRange(
        await client.json(
          "/sleep-service/sleep/dailySleepSummariesByDate",
          { startDate: start, endDate: end },
          "sleep",
        ),
        start,
        end,
      ),
    );
    const hrv = await range(`hrv:${key}`, async () =>
      parseHrvRange(
        await client.json(
          `/hrv-service/hrv/daily/${start}/${end}`,
          undefined,
          "hrv",
        ),
        start,
        end,
      ),
    );
    const bodyBattery = await range(`body-battery:${key}`, async () =>
      parseBodyBatteryRange(
        await client.json(
          "/wellness-service/wellness/bodyBattery/reports/daily",
          { startDate: start, endDate: end },
          "body-battery",
        ),
        start,
        end,
      ),
    );
    return { summaries, sleep, hrv, bodyBattery };
  }

  function archiveDay(
    date: string,
    sources: Awaited<ReturnType<typeof dailySources>>,
  ) {
    if (archived.has(date)) return;
    archived.add(date);
    const entries: Array<[GarminOfficialArchiveTool, string, Row | undefined]> =
      [
        [
          "official_daily_summary",
          `${date}:stats`,
          sources.summaries.get(date),
        ],
        ["official_sleep", `${date}:sleep`, sources.sleep.get(date)],
        [
          "official_body_battery",
          `${date}:body_battery`,
          sources.bodyBattery.get(date),
        ],
        ["official_hrv", `${date}:hrv`, sources.hrv.get(date)],
      ];
    for (const [sourceTool, subjectId, payload] of entries)
      deps.archive({
        sourceTool,
        subjectType: "daily_health",
        subjectId,
        payload: payload ?? null,
      });
  }

  function decoded(garminId: string): Promise<DecodedOrganic> {
    let pending = decodes.get(garminId);
    if (!pending) {
      pending = (async (): Promise<DecodedOrganic> => {
        let bytes: Uint8Array;
        try {
          bytes = await client.binary(
            `/download-service/files/activity/${encodeURIComponent(garminId)}`,
            "activity-file",
          );
        } catch (error) {
          if (error instanceof OfficialApiError && error.kind === "not-found")
            return { missing: "No original activity file is available." };
          throw error;
        }
        try {
          return await decodeActivityFit(bytes, cancellation.signal);
        } catch (error) {
          if (error instanceof FitAdmissionError)
            return { missing: error.message };
          throw error;
        }
      })();
      decodes.set(garminId, pending);
      // Transport failures retry on the next caller; deterministic refusals are cached.
      pending.catch(() => decodes.delete(garminId));
    }
    return pending;
  }

  /** Same `startTimeLocal` semantics as the MCP path, so a row read by either source is identical. */
  function normalizedList(list: Row): NormalizedActivity {
    return normalizeActivity(officialActivityPayload(list));
  }

  const reader: GarminReader & { requestStats(): OfficialRequestStats } = {
    source: "garmin_official",
    hintSource: "official_daily_summaries",
    requestStats: () => client.stats(),
    // No startup probe: the key is first used by the first admitted request.
    start: async () => undefined,
    close: () => cancellation.abort(),

    planDailyHealth(dates) {
      planned = [...new Set(dates)].sort();
    },

    async profile() {
      return guarded(async () => {
        const settings = await client.json(
          "/userprofile-service/userprofile/settings",
          undefined,
          "profile-settings",
        );
        let zones: unknown = null;
        try {
          zones = await client.json(
            "/biometric-service/heartRateZones/v2",
            undefined,
            "heart-rate-zones",
          );
        } catch (error) {
          if (fatal(error)) throw error;
          // Configured zones are optional; settings alone remain a usable profile.
        }
        return officialProfile(settings, zones);
      });
    },
    // The Personal API has no FTP endpoint; FTP arrives only from a cycling FIT.
    cyclingFtp: async () => ({}),

    bodyComposition: (startDate, endDate) =>
      guarded(async () => {
        if (span(startDate, endDate) > OFFICIAL_RANGE_LIMITS.bodyHistoryDays)
          throw officialProtocol(
            "Body history range exceeds its documented limit.",
          );
        return officialBodyHistory(
          await client.json(
            `/weight-service/weight/all/${startDate}/${endDate}`,
            undefined,
            "body-history",
          ),
        );
      }),
    weighIns: (startDate, endDate) =>
      guarded(async () =>
        officialWeighIns(
          await client.json(
            `/weight-service/weight/range/${startDate}/${endDate}`,
            { includeAll: true },
            "weigh-ins",
          ),
        ),
      ),

    activityPage: (startDate, endDate, page) =>
      guarded(async () => {
        const limit = OFFICIAL_RANGE_LIMITS.activityPage;
        const payload = await client.json(
          "/activitylist-service/activities/search/activities",
          { start: page * limit, limit, startDate, endDate },
          "activity-list",
        );
        if (payload !== null && !Array.isArray(payload))
          throw officialProtocol("Activity list was not an array.");
        const list = (payload ?? []).map((item: unknown) => {
          if (!item || typeof item !== "object" || Array.isArray(item))
            throw officialProtocol("Activity row was not an object.");
          return item as Row;
        });
        deps.archive({
          sourceTool: "official_activity_list",
          subjectType: "activity_page",
          subjectId: `${startDate}:${endDate}:page:${page}`,
          payload: list,
        });
        const seen = new Set<string>();
        const activities: NormalizedActivity[] = [];
        for (const item of list) {
          const activity = normalizedList(item);
          if (seen.has(activity.garminId)) continue;
          seen.add(activity.garminId);
          activities.push(activity);
          const zones = listHrZoneSeconds(item);
          if (zones) listZones.set(activity.garminId, zones);
        }
        // An exactly full final page just yields an empty next page.
        const hasMore = list.length >= limit;
        return {
          activities,
          hasMore,
          ...(hasMore ? { nextPage: page + 1 } : {}),
        };
      }),

    activityEffort: (garminId) =>
      guarded(async () => {
        const payload = await client.json(
          `/activity-service/activity/${encodeURIComponent(garminId)}`,
          undefined,
          "activity-summary",
        );
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          return null;
        const activity = normalizedList(payload as Row);
        return activity.garminId === garminId ? activity : null;
      }),

    fitBaseline: (garminIds) =>
      guarded(async () => {
        for (const garminId of garminIds) {
          try {
            const fit = await decoded(garminId);
            if (!("zonesTarget" in fit) || !fit.zonesTarget) continue;
            const cycling = fit.detail.session.sport === "cycling";
            return {
              zones_target: {
                max_heart_rate: fit.zonesTarget.max_heart_rate,
                threshold_heart_rate: fit.zonesTarget.threshold_heart_rate,
                // FTP is a per-sport threshold: only a cycling file may supply it.
                functional_threshold_power: cycling
                  ? fit.zonesTarget.functional_threshold_power
                  : null,
                source: "garmin_fit_zones_target",
              },
            };
          } catch (error) {
            if (fatal(error)) throw error;
            // Best-effort baseline recovery, distinct from detail attempt policy.
          }
        }
        return undefined;
      }),

    weeklySteps: (endDate, weeks, floor) =>
      guarded(async () => {
        const days = weeks * 7;
        if (
          !Number.isInteger(weeks) ||
          weeks < 1 ||
          days > OFFICIAL_RANGE_LIMITS.discoveryDays
        )
          throw officialProtocol(
            "Discovery range is invalid; no read admitted.",
          );
        // Never read below the selected limit; the cursor then continues from it.
        const bounded =
          floor && floor > shiftDate(endDate, -(days - 1))
            ? span(floor, endDate)
            : days;
        if (bounded < 1)
          throw officialProtocol("Discovery range is empty; no read admitted.");
        const startDate = shiftDate(endDate, -(bounded - 1));
        return officialDiscoveryHint(
          await client.json(
            "/usersummary-service/v2/dailysummaries",
            { startDate, endDate },
            "daily-summaries",
          ),
          endDate,
          bounded,
        );
      }),

    async dailyHealthEvidence(date) {
      return guarded(async () => {
        const sources = await dailySources(date);
        archiveDay(date, sources);
        const day: NormalizedDailyHealth = officialDailyHealth(date, sources);
        const coverage: DayCoverageEvidence = summaryCoverageEvidence(
          sources.summaries.get(date),
        );
        return { day, coverage };
      });
    },
    async dailyHealth(date) {
      return (await reader.dailyHealthEvidence!(date)).day;
    },

    activityDetail: (garminId) =>
      guarded(async () => {
        const fit = await decoded(garminId);
        if ("missing" in fit)
          return {
            recognized: false,
            detail: normalizeUnsupportedActivityDetail(garminId, fit.missing),
          };
        deps.archive({
          sourceTool: "official_activity_fit",
          subjectType: "activity_detail",
          subjectId: garminId,
          payload: fit.detail,
        });
        return {
          recognized: true,
          detail: normalizeActivityDetail(garminId, fit.detail),
        };
      }),

    activityHrZoneTime: (garminId) =>
      guarded(async (): Promise<NormalizedActivityHrZoneTime | null> => {
        const fetchedAt = clock();
        const fit = await decoded(garminId);
        if (!("missing" in fit)) {
          const exact = exactZoneTime(garminId, fit, fetchedAt);
          if (exact) return exact;
        }
        // Exact buckets the activity list already carried: stronger than sampling.
        const listed = listZones.get(garminId);
        if (listed)
          return {
            garminId,
            fetchedAt,
            source: "garmin_official_activity",
            status: "available",
            sourceTotalSeconds: listed.reduce(
              (sum, value) => sum + Math.round(value),
              0,
            ),
            buckets: listed.map((seconds, index) => ({
              zone: (index + 1) as 1 | 2 | 3 | 4 | 5,
              seconds: Math.round(seconds),
              sourceLowerBpm: null,
            })),
          };
        // Approximate only with boundaries stored in this file; otherwise unavailable.
        return "missing" in fit
          ? null
          : estimatedZoneTime(garminId, fit, fetchedAt);
      }),
  };
  return reader;
}
