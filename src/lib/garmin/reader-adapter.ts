import type { GarminReader } from "./import-ports";
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
  connector: {
    start(): Promise<void>;
    close(): void;
    callTool(
      operation: GarminReadOperation,
      args: Record<string, unknown>,
    ): Promise<string>;
  };
  fit: {
    baseline(garminIds: string[]): Promise<unknown>;
    altitude(garminId: string): Promise<unknown>;
    distance(garminId: string): Promise<unknown>;
    speed(garminId: string): Promise<unknown>;
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
    return { message: trimmed };
  }
  return JSON.parse(trimmed);
}

export function createGarminReader({
  connector,
  fit,
  archive,
}: GarminReaderAdapters): GarminReader {
  async function read(
    operation: GarminReadOperation,
    args: Record<string, unknown> = {},
  ) {
    return parseToolJson(await connector.callTool(operation, args));
  }

  return {
    start: () => connector.start(),
    close: () => connector.close(),
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
        } catch {
          // Best-effort baseline recovery, distinct from detail attempt policy.
        }
      }
      return fit.baseline(garminIds);
    },
    async dailyHealth(date) {
      // All reads precede all parsing, which precedes all archives. A malformed
      // earlier payload must not prevent the later read calls made historically.
      const statsText = await connector.callTool("get_stats", { date });
      const sleepText = await connector.callTool("get_sleep_summary", { date });
      const batteryText = await connector.callTool("get_body_battery", {
        start_date: date,
        end_date: date,
      });
      const stats = parseToolJson(statsText);
      const sleep = parseToolJson(sleepText);
      const bodyBattery = parseToolJson(batteryText);
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
        parsed = mergeFitAltitudeRecords(parsed, await fit.altitude(garminId));
      }
      if (activityDetailNeedsDistanceSupplement(parsed)) {
        parsed = mergeFitDistanceRecords(parsed, await fit.distance(garminId));
      }
      if (activityDetailNeedsSpeedSupplement(parsed)) {
        parsed = mergeFitSpeedRecords(parsed, await fit.speed(garminId));
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
