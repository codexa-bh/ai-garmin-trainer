import { deflateRawSync } from "node:zlib";
import { buildFit, buildZip } from "./official-fit-fixture";
import {
  binary,
  empty,
  fakeApi,
  json,
  syntheticBearer,
  text,
} from "./official-transport-fixture";

/** Authored Personal API account: deterministic days, activities, files. */
export const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) out.push(day);
  return out;
}
const wall = (ms: number) => new Date(ms).toISOString().slice(0, 19) + ".0";

export type AccountDay = {
  /** Hours of the day covered; 24 is a whole day, 0 is a source-empty day. */
  hours: number;
  steps?: number | null;
  /** Authored additional evidence merged into the summary/sleep/HRV rows. */
  extra?: {
    summary?: Record<string, unknown>;
    sleep?: Record<string, unknown>;
    hrv?: Record<string, unknown>;
  };
};
export type Account = {
  days: Map<string, AccountDay>;
  activities: Array<Record<string, unknown>>;
  files: Map<string, Uint8Array>;
  weighIns: Array<{ calendarDate: string; grams: number }>;
  failPaths: Map<string, number>;
  nullPaths: Set<string>;
  /** Authored sparse VO2 rows (`{generic?, cycling?}` objects with dates). */
  vo2: Array<Record<string, unknown>>;
};

export function newAccount(): Account {
  return {
    days: new Map(),
    activities: [],
    files: new Map(),
    weighIns: [],
    failPaths: new Map(),
    nullPaths: new Set(),
    vo2: [],
  };
}

export function summaryRow(date: string, day: AccountDay | undefined) {
  const start = Date.parse(`${date}T00:00:00Z`);
  const hours = day?.hours ?? 0;
  const covered = hours > 0;
  return {
    calendarDate: date,
    includesWellnessData: covered,
    includesActivityData: false,
    wellnessChronology: covered
      ? {
          startTimestampGmt: wall(start),
          startTimestampLocal: wall(start),
          endTimestampGmt: wall(start + hours * 3_600_000),
          endTimestampLocal: wall(start + hours * 3_600_000),
          totalDurationInMillis: hours * 3_600_000,
        }
      : null,
    movement: { steps: { value: covered ? (day?.steps ?? 9000) : null } },
    calories: covered
      ? { burnedResting: 1700, burnedActive: 500, burnedTotal: 2200 }
      : null,
    heartRate: covered ? { restingValue: 52 } : null,
    intensityMinutes: covered ? { moderate: 20, vigorous: 5 } : null,
    stress: covered
      ? { avgLevel: 31, ...(day?.extra?.summary?.stress ?? {}) }
      : null,
    bodyBattery: covered
      ? {
          latestValue: 40,
          maxValue: 90,
          ...(day?.extra?.summary?.bodyBattery ?? {}),
        }
      : null,
  };
}

export function sleepRow(date: string) {
  return {
    calendarDate: date,
    sleepTimeSeconds: 27_000,
    deepSleepSeconds: 5_400,
    lightSleepSeconds: 14_400,
    remSleepSeconds: 5_400,
    awakeSleepSeconds: 1_800,
    napTimeSeconds: 0,
    sleepScores: { overall: { value: 82 } },
  };
}

export function activityRow(id: number, local: string, extra = {}) {
  return {
    activityId: id,
    activityName: `Run ${id}`,
    activityType: { typeKey: "running" },
    startTimeLocal: local,
    startTimeGMT: local,
    duration: 1800,
    distance: 5000,
    averageHR: 140,
    maxHR: 170,
    aerobicTrainingEffect: 3.1,
    activityTrainingLoad: 80,
    ...extra,
  };
}

export function accountApi(account: Account) {
  const routes: Parameters<typeof fakeApi>[0] = {
    [`POST ${TOKEN_PATH}`]: () =>
      text(syntheticBearer(Date.now() + 86_400_000)),
    "GET /usersummary-service/v2/dailysummaries": (request) => {
      const failure = account.failPaths.get("summary");
      if (failure) return json({ error: "x" }, failure);
      if (account.nullPaths.has("summary")) return empty();
      const { startDate, endDate } = request.query;
      return json({
        data: eachDay(startDate, endDate).map((date) =>
          summaryRow(date, account.days.get(date)),
        ),
      });
    },
    "GET /sleep-service/sleep/dailySleepSummariesByDate": (request) => {
      const { startDate, endDate } = request.query;
      return json(
        eachDay(startDate, endDate)
          .filter((date) => (account.days.get(date)?.hours ?? 0) > 0)
          .map((date) => ({
            ...sleepRow(date),
            ...(account.days.get(date)?.extra?.sleep ?? {}),
          })),
      );
    },
    "GET /hrv-service/hrv/daily/*": (request) => {
      const [, , , , from, to] = request.path.split("/");
      return json({
        hrvSummaries: eachDay(from, to)
          .filter((date) => (account.days.get(date)?.hours ?? 0) > 0)
          .map((date) => ({
            calendarDate: date,
            lastNightAvg: 55,
            status: "BALANCED",
            ...(account.days.get(date)?.extra?.hrv ?? {}),
          })),
      });
    },
    "GET /wellness-service/wellness/bodyBattery/reports/daily": (request) => {
      const { startDate, endDate } = request.query;
      return json(
        eachDay(startDate, endDate)
          .filter((date) => (account.days.get(date)?.hours ?? 0) > 0)
          .map((date) => ({
            date,
            bodyBatteryValueDescriptorDTOList: [
              {
                bodyBatteryValueDescriptorIndex: 0,
                bodyBatteryValueDescriptorKey: "timestamp",
              },
              {
                bodyBatteryValueDescriptorIndex: 1,
                bodyBatteryValueDescriptorKey: "bodyBatteryLevel",
              },
            ],
            bodyBatteryValuesArray: [
              [Date.parse(`${date}T06:00:00Z`), 80],
              [Date.parse(`${date}T22:00:00Z`), 25],
            ],
          })),
      );
    },
    "GET /metrics-service/metrics/maxmet/daily/*": (request) => {
      const failure = account.failPaths.get("vo2");
      if (failure) return json({ error: "x" }, failure);
      const [, , , , , from, to] = request.path.split("/");
      return json(
        account.vo2.filter((entry) => {
          const day = String(
            (entry.generic as { calendarDate?: string } | undefined)
              ?.calendarDate ??
              (entry.cycling as { calendarDate?: string } | undefined)
                ?.calendarDate,
          );
          return day >= from && day <= to;
        }),
      );
    },
    "GET /activitylist-service/activities/search/activities": (request) => {
      const failure = account.failPaths.get("activities");
      if (failure) return json({}, failure);
      const start = Number(request.query.start);
      const limit = Number(request.query.limit);
      const inRange = account.activities.filter((row) => {
        const day = String(row.startTimeLocal).slice(0, 10);
        return day >= request.query.startDate && day <= request.query.endDate;
      });
      return json(inRange.slice(start, start + limit));
    },
    "GET /activity-service/activity/*": (request) => {
      const id = request.path.split("/").at(-1);
      const row = account.activities.find(
        (item) => String(item.activityId) === id,
      );
      return row ? json(row) : json({ error: "NOT_FOUND" }, 404);
    },
    "GET /download-service/files/activity/*": (request) => {
      const id = request.path.split("/").at(-1)!;
      const file = account.files.get(id);
      return file ? binary(file) : json({ error: "NOT_FOUND" }, 404);
    },
    "GET /weight-service/weight/range/*": () =>
      json({
        dailyWeightSummaries: account.weighIns.map((entry) => ({
          summaryDate: entry.calendarDate,
          allWeightMetrics: [
            {
              calendarDate: entry.calendarDate,
              weight: entry.grams,
              timestampGMT: 1,
            },
          ],
        })),
      }),
    "GET /weight-service/weight/all/*": () =>
      json(
        account.weighIns.map((entry) => ({
          calendarDate: entry.calendarDate,
          weight: entry.grams,
        })),
      ),
    "GET /userprofile-service/userprofile/settings": () =>
      json({
        availableTrainingDays: ["monday", "wednesday"],
        preferredLongTrainingDays: null,
      }),
    "GET /biometric-service/heartRateZones/v2": () =>
      json([
        {
          sport: "DEFAULT",
          trainingMethod: "PERCENT_MAX_HR",
          maxHeartRateUsed: 188,
          zone1Floor: 94,
          zone2Floor: 113,
          zone3Floor: 132,
          zone4Floor: 150,
          zone5Floor: 169,
        },
      ]),
  };
  return fakeApi(routes);
}

export function fitFor(options: Parameters<typeof buildFit>[0] = {}) {
  return buildZip(buildFit(options));
}
export { deflateRawSync };
