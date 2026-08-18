import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedDailyHealth } from "../src/lib/garmin/types";

const dbDir = join(tmpdir(), "ai-garmin-daily-health-sync-tests");
const mcpState = {
  failStart: false,
  activities: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ operation: string; args: Record<string, unknown> }>,
  statsByDate: new Map<string, Record<string, unknown>>(),
  sleepByDate: new Map<string, Record<string, unknown>>(),
  bodyBatteryByDate: new Map<string, unknown>(),
};

vi.mock("../src/lib/garmin/mcp-client", () => ({
  GarminMcpClient: class {
    async start() {
      if (mcpState.failStart) throw new Error("connector start failed");
      return undefined;
    }
    close() {
      return undefined;
    }
    async callTool(operation: string, args: Record<string, unknown> = {}) {
      mcpState.calls.push({ operation, args });
      if (operation === "get_user_profile") {
        return JSON.stringify({
          userData: { lactateThresholdHeartRate: null },
        });
      }
      if (operation === "get_cycling_ftp") {
        return JSON.stringify({ functional_threshold_power_watts: null });
      }
      if (operation === "get_activities_by_date") {
        return JSON.stringify({
          activities: mcpState.activities,
          has_more: false,
        });
      }
      if (operation === "get_stats") {
        return JSON.stringify(
          mcpState.statsByDate.get(String(args.date)) ?? {},
        );
      }
      if (operation === "get_sleep_summary") {
        return JSON.stringify(
          mcpState.sleepByDate.get(String(args.date)) ?? {},
        );
      }
      if (operation === "get_body_battery") {
        return JSON.stringify(
          mcpState.bodyBatteryByDate.get(String(args.start_date)) ?? [],
        );
      }
      if (operation === "get_activity_fit_data") {
        return JSON.stringify({ records: [] });
      }
      throw new Error(`Unexpected operation ${operation}`);
    }
  },
}));

function fetchedHealthDates(
  operation: "get_stats" | "get_sleep_summary" | "get_body_battery",
) {
  return mcpState.calls
    .filter((call) => call.operation === operation)
    .map((call) => String(call.args.date ?? call.args.start_date));
}

function dailyHealth(
  date: string,
  values: Partial<NormalizedDailyHealth>,
): NormalizedDailyHealth {
  return {
    date,
    sleepMinutes: values.sleepMinutes ?? null,
    sleepScore: values.sleepScore ?? null,
    sleepDeepMinutes: values.sleepDeepMinutes ?? null,
    sleepLightMinutes: values.sleepLightMinutes ?? null,
    sleepRemMinutes: values.sleepRemMinutes ?? null,
    sleepAwakeMinutes: values.sleepAwakeMinutes ?? null,
    sleepNapMinutes: values.sleepNapMinutes ?? null,
    restingHeartRate: values.restingHeartRate ?? null,
    hrvStatus: values.hrvStatus ?? null,
    hrvMs: values.hrvMs ?? null,
    stressAvg: values.stressAvg ?? null,
    steps: values.steps ?? null,
    calories: values.calories ?? null,
    activeCalories: values.activeCalories ?? null,
    restingCalories: values.restingCalories ?? null,
    totalCalories: values.totalCalories ?? null,
    intensityMinutes: values.intensityMinutes ?? null,
    bodyBatteryAvg: values.bodyBatteryAvg ?? null,
    bodyBatteryMorning: values.bodyBatteryMorning ?? null,
    bodyBatteryEvening: values.bodyBatteryEvening ?? null,
    availability: values.availability ?? "missing",
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  process.env.GARMIN_HISTORY_START_DATE = "2026-07-01";
  mcpState.failStart = false;
  mcpState.activities = [];
  mcpState.calls = [];
  mcpState.statsByDate = new Map();
  mcpState.sleepByDate = new Map();
  mcpState.bodyBatteryByDate = new Map();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Garmin daily health recent refresh", () => {
  it("plans repair candidates plus recent dates even when the checkpoint is past today", async () => {
    const { dailyHealthImportPlan } =
      await import("../src/lib/garmin/importer");

    expect(
      dailyHealthImportPlan({
        historyStartDate: "2026-07-01",
        resumeDate: "2026-07-24",
        endDate: "2026-07-23",
        repairDates: ["2026-06-30", "2026-07-03", "2026-07-21"],
      }),
    ).toMatchObject({
      dates: [
        "2026-07-03",
        "2026-07-17",
        "2026-07-18",
        "2026-07-19",
        "2026-07-20",
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
      ],
      checkpointDates: [],
    });
  });

  it("refreshes the recent window without moving a checkpoint that is already past today", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const { getCheckpoint, getDatabase, saveCheckpoint } =
      await import("../src/lib/db/repository");
    saveCheckpoint("health_next_date", "2026-07-24");

    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.healthDaysImported).toBe(7);
    expect(
      getDatabase()
        .prepare(
          "select status, coverage_start as coverageStart, coverage_end as coverageEnd from sync_run order by started_at desc limit 1",
        )
        .get(),
    ).toMatchObject({
      status: "completed",
      coverageStart: "2026-07-01",
      coverageEnd: "2026-07-23",
    });
    expect(fetchedHealthDates("get_stats")).toEqual([
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(fetchedHealthDates("get_sleep_summary")).toEqual(
      fetchedHealthDates("get_stats"),
    );
    expect(getCheckpoint("health_next_date")).toBe("2026-07-24");
  });

  it("records requested coverage before connector startup failures", async () => {
    mcpState.failStart = true;
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const { getDatabase } = await import("../src/lib/db/repository");

    const result = await runGarminSync();

    expect(result.status).toBe("failed");
    expect(result.coverageStart).toBe("2026-07-01");
    expect(result.coverageEnd).toBe("2026-07-23");
    expect(
      getDatabase()
        .prepare(
          "select status, coverage_start as coverageStart, coverage_end as coverageEnd, last_error as lastError from sync_run order by started_at desc limit 1",
        )
        .get(),
    ).toMatchObject({
      status: "failed",
      coverageStart: "2026-07-01",
      coverageEnd: "2026-07-23",
      lastError: "connector start failed",
    });
  });

  it("deduplicates historical backfill overlap with the recent refresh window", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const { getCheckpoint, saveCheckpoint } =
      await import("../src/lib/db/repository");
    saveCheckpoint("health_next_date", "2026-07-20");

    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.healthDaysImported).toBe(7);
    expect(fetchedHealthDates("get_stats")).toEqual([
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(new Set(fetchedHealthDates("get_stats")).size).toBe(7);
    expect(getCheckpoint("health_next_date")).toBe("2026-07-24");
  });

  it("repairs missing rows that have no raw daily-health payload evidence", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const {
      getDatabase,
      saveCheckpoint,
      upsertDailyHealth,
      upsertGarminRawPayload,
    } = await import("../src/lib/db/repository");
    saveCheckpoint("health_next_date", "2026-07-24");
    upsertDailyHealth([
      dailyHealth("2026-07-03", {}),
      dailyHealth("2026-07-04", {}),
    ]);
    upsertGarminRawPayload({
      sourceTool: "get_stats",
      subjectType: "daily_health",
      subjectId: "2026-07-04:stats",
      payload: {},
    });
    upsertGarminRawPayload({
      sourceTool: "get_sleep_summary",
      subjectType: "daily_health",
      subjectId: "2026-07-04:sleep",
      payload: {},
    });
    mcpState.statsByDate.set("2026-07-03", {
      total_steps: 8200,
      total_calories: 2300,
      avg_stress_level: 22,
      body_battery_current: 65,
    });

    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.healthDaysImported).toBe(8);
    expect(fetchedHealthDates("get_stats")).toContain("2026-07-03");
    expect(fetchedHealthDates("get_stats")).not.toContain("2026-07-04");
    expect(
      getDatabase()
        .prepare("select availability, steps from daily_health where date = ?")
        .get("2026-07-03"),
    ).toMatchObject({ availability: "partial", steps: 8200 });
    expect(
      getDatabase()
        .prepare("select availability from daily_health where date = ?")
        .get("2026-07-04"),
    ).toMatchObject({ availability: "missing" });
  });

  it("bounds repeat syncs to the recent window instead of replaying full history", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const { saveCheckpoint } = await import("../src/lib/db/repository");
    saveCheckpoint("health_next_date", "2026-07-24");

    await runGarminSync();
    const firstRunDates = fetchedHealthDates("get_stats");
    mcpState.calls = [];
    const second = await runGarminSync();

    expect(firstRunDates).toHaveLength(7);
    expect(second.healthDaysImported).toBe(7);
    expect(fetchedHealthDates("get_stats")).toHaveLength(7);
  });

  it("preserves stored non-null fields on partial refreshes and accepts new non-null arrivals", async () => {
    const { listRecentDailyHealth, upsertDailyHealth } =
      await import("../src/lib/db/repository");

    upsertDailyHealth([
      dailyHealth("2026-07-23", {
        sleepMinutes: 420,
        sleepScore: 85,
        sleepDeepMinutes: 72,
        sleepLightMinutes: 238,
        sleepRemMinutes: 88,
        sleepAwakeMinutes: 22,
        restingHeartRate: 48,
        steps: 8200,
        calories: 2300,
        availability: "partial",
      }),
    ]);
    upsertDailyHealth([
      dailyHealth("2026-07-23", {
        hrvMs: 62,
        stressAvg: 21,
        availability: "partial",
      }),
    ]);
    upsertDailyHealth([dailyHealth("2026-07-23", {})]);

    expect(listRecentDailyHealth(1)[0]).toMatchObject({
      date: "2026-07-23",
      sleepMinutes: 420,
      sleepScore: 85,
      sleepDeepMinutes: 72,
      sleepLightMinutes: 238,
      sleepRemMinutes: 88,
      sleepAwakeMinutes: 22,
      restingHeartRate: 48,
      hrvMs: 62,
      stressAvg: 21,
      steps: 8200,
      calories: 2300,
      availability: "complete",
    });
  });
});
