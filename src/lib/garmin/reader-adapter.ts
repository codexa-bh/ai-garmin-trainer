import type { GarminReader } from "./import-ports";
import {
  SyncPause,
  UnrecognizedHealthReply,
  SYNC_LIMITS,
  type GarminReadControl,
  historyFailureClass,
} from "./history-policy";
import { safeConnectorFailure } from "./mcp-client";
import { discoveryDate, weeklyStepsHint } from "./discovery-policy";

type FitOptions = { signal: AbortSignal; timeout: number };
import type { GarminReadOperation } from "./types";
import { normalizeActivity, normalizeDailyHealth } from "./normalize";
import { normalizeActivityHrZoneTime } from "./activity-hr-zone-time";
import {
  normalizeActivityDetail,
  normalizeUnsupportedActivityDetail,
} from "./detail-normalize";
import {
  activityDetailNeedsAltitudeSupplement,
  mergeFitAltitudeRecords,
} from "./fit-altitude";
import {
  activityDetailNeedsDistanceSupplement,
  mergeFitDistanceRecords,
} from "./fit-distance";
import {
  activityDetailNeedsSpeedSupplement,
  mergeFitSpeedRecords,
} from "./fit-speed";

export type GarminReaderAdapters = {
  control?: GarminReadControl;
  connector: {
    start(): Promise<void>;
    close(): void;
    callTool(
      operation: GarminReadOperation,
      args: Record<string, unknown>,
    ): Promise<string>;
  };
  fit: {
    baseline(garminIds: string[], options?: FitOptions): Promise<unknown>;
    altitude(garminId: string, options?: FitOptions): Promise<unknown>;
    distance(garminId: string, options?: FitOptions): Promise<unknown>;
    speed(garminId: string, options?: FitOptions): Promise<unknown>;
  };
  archive(input: {
    sourceTool: GarminReadOperation;
    subjectType: "activity_page" | "daily_health" | "activity_detail";
    subjectId: string;
    payload: unknown;
  }): void;
};

function parseToolJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    if (
      /^No (?:stats|daily stats|sleep data|sleep summary|body battery data|body composition data|weigh.ins|weight measurements|activities|user profile|cycling FTP)(?: found| available)(?: for [^\n]+| between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2})?\.?$/i.test(
        trimmed,
      )
    )
      return {};
    throw new Error(safeConnectorFailure(trimmed));
  }
  return JSON.parse(trimmed);
}

export function createGarminReader({
  connector,
  fit,
  archive,
  control,
}: GarminReaderAdapters): GarminReader {
  const cancellation = new AbortController();
  const close = () => {
    cancellation.abort();
    connector.close();
  };
  async function bounded<T>(
    action: (options?: FitOptions) => Promise<T>,
    admit = true,
  ): Promise<T> {
    if (!control) return action();
    if (admit) await control.admit();
    if (control.cancelled()) throw new SyncPause("cancelled");
    const remaining = control.remainingMs();
    if (remaining <= 0) throw new SyncPause("budget-limited");
    const timeout = Math.min(SYNC_LIMITS.operationMs, remaining);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watcher: ReturnType<typeof setInterval> | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      const stop = (error: Error) => {
        close();
        reject(error);
      };
      timer = setTimeout(
        () =>
          stop(
            remaining <= SYNC_LIMITS.operationMs
              ? new SyncPause("budget-limited")
              : new Error(
                  "Garmin request timed out; no successful coverage recorded.",
                ),
          ),
        timeout,
      );
      watcher = setInterval(() => {
        if (control.cancelled()) stop(new SyncPause("cancelled"));
      }, 50);
    });
    try {
      return await Promise.race([
        action({ signal: cancellation.signal, timeout }),
        stopped,
      ]);
    } catch (error) {
      control.failed?.(error);
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(watcher);
    }
  }
  async function read(
    operation: GarminReadOperation,
    args: Record<string, unknown> = {},
  ) {
    try {
      const parsed = parseToolJson(
        await bounded(() => connector.callTool(operation, args)),
      );
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        ("error" in parsed || "message" in parsed)
      )
        throw new Error(
          "Garmin returned an unrecognized response; coverage was not advanced.",
        );
      return parsed;
    } catch (error) {
      control?.failed?.(error);
      throw error;
    }
  }

  return {
    start: () => bounded(() => connector.start(), false),
    close,
    profile: () => read("get_user_profile"),
    cyclingFtp: () => read("get_cycling_ftp"),
    async weeklySteps(endDate, weeks) {
      if (
        !discoveryDate(endDate) ||
        endDate < "0002-01-01" ||
        !Number.isInteger(weeks) ||
        weeks < 1 ||
        weeks > 52
      )
        throw new Error(
          "Garmin weekly steps request is invalid; no read admitted.",
        );
      // This reviewed operation has its own exact no-data and curated schema.
      // Do not broaden the generic parser or archive raw range/profile replies.
      const text = await bounded(() =>
        connector.callTool("get_weekly_steps", { end_date: endDate, weeks }),
      );
      const empty = `No weekly steps data found for ${weeks} weeks ending ${endDate}`;
      return weeklyStepsHint(
        text.trim() === empty
          ? {
              end_date: endDate,
              weeks_requested: weeks,
              weeks_returned: 0,
              weekly_data: [],
            }
          : parseToolJson(text),
        endDate,
        weeks,
      );
    },
    bodyComposition: (startDate, endDate) =>
      read("get_body_composition", {
        start_date: startDate,
        end_date: endDate,
      }),
    weighIns: (startDate, endDate) =>
      read("get_weigh_ins", { start_date: startDate, end_date: endDate }),
    async activityPage(startDate, endDate, page) {
      const parsed = (await read("get_activities_by_date", {
        start_date: startDate,
        end_date: endDate,
        page,
        page_size: 100,
      })) as {
        activities?: Array<Record<string, unknown>>;
        has_more?: boolean;
        next_page?: number;
      };
      if (
        !Array.isArray(parsed.activities) ||
        typeof parsed.has_more !== "boolean"
      )
        throw new Error(
          "Garmin activity paging protocol failed; coverage was not advanced.",
        );
      archive({
        sourceTool: "get_activities_by_date",
        subjectType: "activity_page",
        subjectId: `${startDate}:${endDate}:page:${page}`,
        payload: parsed,
      });
      return {
        activities: (parsed.activities ?? []).map((activity) =>
          normalizeActivity(activity),
        ),
        hasMore: Boolean(parsed.has_more),
        nextPage: parsed.next_page,
      };
    },
    async activityEffort(garminId) {
      const parsed = await read("get_activity", { activity_id: garminId });
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
      return normalizeActivity(parsed as Record<string, unknown>);
    },
    async fitBaseline(garminIds) {
      for (const garminId of garminIds) {
        try {
          const parsed = await read("get_activity_fit_data", {
            activity_id: garminId,
            include_records: false,
          });
          if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            ("zones_target" in parsed || "zonesTarget" in parsed)
          )
            return parsed;
        } catch (error) {
          if (
            error instanceof SyncPause ||
            ["auth", "rate-limit"].includes(historyFailureClass(error))
          )
            throw error;
          // Best-effort baseline recovery, distinct from detail attempt policy.
        }
      }
      return bounded((options) =>
        options ? fit.baseline(garminIds, options) : fit.baseline(garminIds),
      );
    },
    async dailyHealth(date) {
      // All reads precede all parsing, which precedes all archives. A malformed
      // earlier payload must not prevent the later read calls made historically.
      function rejectFatalReply(text: string): void {
        if (!/^Error\b/i.test(text.trim())) return;
        const error = new Error(safeConnectorFailure(text));
        if (["auth", "rate-limit"].includes(historyFailureClass(error)))
          throw error;
      }
      const statsText = await bounded(() =>
        connector.callTool("get_stats", { date }),
      );
      rejectFatalReply(statsText);
      const sleepText = await bounded(() =>
        connector.callTool("get_sleep_summary", { date }),
      );
      rejectFatalReply(sleepText);
      const batteryText = await bounded(() =>
        connector.callTool("get_body_battery", {
          start_date: date,
          end_date: date,
        }),
      );
      rejectFatalReply(batteryText);
      const stats = parseToolJson(statsText);
      const sleep = parseToolJson(sleepText);
      const bodyBattery = parseToolJson(batteryText);
      const knownKeys = [
        /^(?:total_steps|totalSteps|steps|resting_heart_rate_bpm|restingHeartRate|restingHR|avg_stress_level|averageStressLevel|active_calories|activeCalories|activeKilocalories|bmr_calories|bmrCalories|restingCalories|bmrKilocalories|total_calories|totalCalories|wellnessTotalKilocalories|moderate_intensity_minutes|moderateIntensityMinutes|vigorous_intensity_minutes|vigorousIntensityMinutes|body_battery_current|body_battery_highest|bodyBatteryCurrent|bodyBatteryHighest|bodyBatteryMostRecentValue|bodyBatteryHighestValue)$/,
        /^(?:sleep_seconds|sleep_time_seconds|sleepTimeSeconds|sleep_score|sleepScore|deep_sleep_seconds|deepSleepSeconds|light_sleep_seconds|lightSleepSeconds|rem_sleep_seconds|remSleepSeconds|awake_seconds|awakeSeconds|awakeSleepSeconds|nap_seconds|napSeconds|resting_heart_rate_bpm|restingHeartRate|avg_overnight_hrv|avgOvernightHrv)$/,
        /^(?:body_battery_level|bodyBatteryLevel|level|value)$/,
      ];
      function recognized(value: unknown, keys: RegExp, root = true): boolean {
        if (!value || typeof value !== "object") return false;
        if (Array.isArray(value))
          return (
            (root && value.length === 0) ||
            value.some((item) => recognized(item, keys, false))
          );
        const entries = Object.entries(value);
        return (
          (root && entries.length === 0) ||
          entries.some(
            ([key, item]) =>
              keys.test(key) ||
              (item &&
                typeof item === "object" &&
                recognized(item, keys, false)),
          )
        );
      }
      // Pinned curated stats/sleep also contain non-normalized metadata. A
      // reviewed, typed metadata-only reply is successful but contributes no
      // normalized metrics; it is not a protocol error or remote inception.
      const metadataNumbers = [
        /^(?:daily_step_goal|distance_meters|floors_ascended|floors_descended|highly_active_seconds|active_seconds|sedentary_seconds|sleeping_seconds|intensity_minutes_goal|min_heart_rate_bpm|max_heart_rate_bpm|last_7_days_avg_resting_hr|max_stress_level|body_battery_charged|body_battery_drained|body_battery_lowest|avg_spo2_percent|lowest_spo2_percent|avg_waking_respiration|highest_respiration|lowest_respiration)$/,
        /^(?:sleep_start|sleep_end|awake_count|restless_moments_count|avg_sleep_stress|avg_spo2_percent|lowest_spo2_percent|deep_sleep_percent|light_sleep_percent|rem_sleep_percent|sleep_hours)$/,
      ];
      function curatedMetadata(value: unknown, index: number): boolean {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          index > 1
        )
          return false;
        return Object.entries(value).every(([key, item]) => {
          if (index === 0 && key === "date") return item === date;
          if (metadataNumbers[index].test(key))
            return (
              item === null ||
              (typeof item === "number" && Number.isFinite(item))
            );
          if (
            (index === 0 && key === "stress_qualifier") ||
            (index === 1 && key === "sleep_score_qualifier")
          )
            return (
              item === null || (typeof item === "string" && item.length <= 120)
            );
          return false;
        });
      }
      // The pinned battery tool can return a valid charged/drained summary
      // without any level metric. That must not discard valid stats/sleep or
      // invent a battery value; malformed summaries still remain unresolved.
      const batterySummaryKeys = new Set([
        "date",
        "charged",
        "drained",
        "events",
        "current_feedback",
      ]);
      const batterySummary =
        Array.isArray(bodyBattery) &&
        bodyBattery.length > 0 &&
        bodyBattery.every((day: unknown) => {
          if (!day || typeof day !== "object" || Array.isArray(day))
            return false;
          const record = day as Record<string, unknown>;
          return (
            record.date === date &&
            Array.isArray(record.events) &&
            Object.keys(record).every((key) => batterySummaryKeys.has(key)) &&
            [record.charged, record.drained].every(
              (value) =>
                value === null ||
                (typeof value === "number" && Number.isFinite(value)),
            ) &&
            (record.current_feedback === undefined ||
              typeof record.current_feedback === "string" ||
              record.current_feedback === null)
          );
        });
      const sources = ["stats", "sleep", "bodyBattery"] as const;
      for (const [index, payload] of [stats, sleep, bodyBattery].entries()) {
        const key = sources[index];
        if (
          !payload ||
          typeof payload !== "object" ||
          (!Array.isArray(payload) &&
            ("error" in payload || "message" in payload)) ||
          (!recognized(payload, knownKeys[index]) &&
            !(key === "bodyBattery" && batterySummary) &&
            !curatedMetadata(payload, index) &&
            normalizeDailyHealth(date, { [key]: payload }).availability ===
              "missing")
        )
          throw new UnrecognizedHealthReply(key);
      }
      archive({
        sourceTool: "get_stats",
        subjectType: "daily_health",
        subjectId: `${date}:stats`,
        payload: stats,
      });
      archive({
        sourceTool: "get_sleep_summary",
        subjectType: "daily_health",
        subjectId: `${date}:sleep`,
        payload: sleep,
      });
      archive({
        sourceTool: "get_body_battery",
        subjectType: "daily_health",
        subjectId: `${date}:body_battery`,
        payload: bodyBattery,
      });
      return normalizeDailyHealth(date, { stats, sleep, bodyBattery });
    },
    async activityDetail(garminId) {
      let parsed = await read("get_activity_fit_data", {
        activity_id: garminId,
        include_records: true,
      });
      if (activityDetailNeedsAltitudeSupplement(parsed)) {
        parsed = mergeFitAltitudeRecords(
          parsed,
          await bounded((options) =>
            options ? fit.altitude(garminId, options) : fit.altitude(garminId),
          ),
        );
      }
      if (activityDetailNeedsDistanceSupplement(parsed)) {
        parsed = mergeFitDistanceRecords(
          parsed,
          await bounded((options) =>
            options ? fit.distance(garminId, options) : fit.distance(garminId),
          ),
        );
      }
      if (activityDetailNeedsSpeedSupplement(parsed)) {
        parsed = mergeFitSpeedRecords(
          parsed,
          await bounded((options) =>
            options ? fit.speed(garminId, options) : fit.speed(garminId),
          ),
        );
      }
      archive({
        sourceTool: "get_activity_fit_data",
        subjectType: "activity_detail",
        subjectId: garminId,
        payload: parsed,
      });
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          recognized: true,
          detail: normalizeActivityDetail(garminId, parsed),
        };
      }
      return {
        recognized: false,
        detail: normalizeUnsupportedActivityDetail(
          garminId,
          typeof parsed === "string"
            ? parsed
            : "Connector returned an unparseable activity detail payload.",
        ),
      };
    },
    async activityHrZoneTime(garminId) {
      return normalizeActivityHrZoneTime(
        garminId,
        await read("get_activity_hr_in_timezones", { activity_id: garminId }),
      );
    },
  };
}
