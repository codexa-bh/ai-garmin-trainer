import type { GarminReader } from "./import-ports";
import {
  SyncPause,
  SYNC_LIMITS,
  type GarminReadControl,
  historyFailureClass,
} from "./history-policy";
import { safeConnectorFailure } from "./mcp-client";

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
      /^No (?:stats|daily stats|sleep data|sleep summary|body battery data|body composition data|weigh.ins|activities|user profile|cycling FTP)(?: found| available)(?: for [^\n]+)?\.?$/i.test(
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
    if (admit) control.admit();
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
    } finally {
      clearTimeout(timer);
      clearInterval(watcher);
    }
  }
  async function read(
    operation: GarminReadOperation,
    args: Record<string, unknown> = {},
  ) {
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
  }

  return {
    start: () => bounded(() => connector.start(), false),
    close,
    profile: () => read("get_user_profile"),
    cyclingFtp: () => read("get_cycling_ftp"),
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
      for (const [index, payload] of [stats, sleep, bodyBattery].entries()) {
        const key = ["stats", "sleep", "bodyBattery"][index];
        if (
          !recognized(payload, knownKeys[index]) &&
          normalizeDailyHealth(date, { [key]: payload }).availability ===
            "missing"
        )
          throw new Error(
            "Garmin daily health response was unrecognized; date remains unresolved.",
          );
      }
      for (const payload of [stats, sleep, bodyBattery]) {
        if (
          !payload ||
          typeof payload !== "object" ||
          (!Array.isArray(payload) &&
            ("error" in payload || "message" in payload))
        )
          throw new Error(
            "Garmin daily health response was unrecognized; date remains unresolved.",
          );
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
