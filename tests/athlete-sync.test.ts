import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbDir = join(tmpdir(), "ai-garmin-athlete-sync-tests");
const mcpState = {
  failAthlete: false,
  failBodyMetrics: false,
  nullAthlete: false,
  activities: [] as Array<Record<string, unknown>>,
};

vi.mock("../src/lib/garmin/mcp-client", () => ({
  GarminMcpClient: class {
    async start() {
      return undefined;
    }
    close() {
      return undefined;
    }
    async callTool(operation: string) {
      if (operation === "get_user_profile") {
        if (mcpState.failAthlete) throw new Error("profile endpoint timeout");
        return JSON.stringify({
          userData: mcpState.nullAthlete
            ? { lactateThresholdHeartRate: null }
            : {
                lactateThresholdHeartRate: 168,
                availableTrainingDays: ["monday", "wednesday"],
                weight: 70.2,
                height: 181,
              },
        });
      }
      if (operation === "get_cycling_ftp") {
        if (mcpState.failAthlete) throw new Error("ftp endpoint timeout");
        return JSON.stringify(
          mcpState.nullAthlete
            ? { functional_threshold_power_watts: null, sport: "cycling" }
            : {
                functional_threshold_power_watts: 250,
                calendar_date: "2026-07-19",
                is_stale: false,
                sport: "cycling",
              },
        );
      }
      if (operation === "get_body_composition") {
        if (mcpState.failBodyMetrics) throw new Error("body endpoint timeout");
        return JSON.stringify({
          dateWeightList: [{ date: "2026-07-21", weight: 70.4 }],
          totalAverage: { weight: 70.4, bodyFat: 20 },
        });
      }
      if (operation === "get_activities_by_date")
        return JSON.stringify({
          activities: mcpState.activities,
          has_more: false,
        });
      if (operation === "get_stats") return JSON.stringify({ steps: 1000 });
      if (operation === "get_sleep_summary") return JSON.stringify({});
      if (operation === "get_activity_fit_data") {
        return JSON.stringify({
          zones_target: { max_heart_rate: 190 },
          records: [
            {
              timestamp: "2026-07-21T07:00:00Z",
              heart_rate_bpm: 140,
            },
          ],
        });
      }
      throw new Error(`Unexpected operation ${operation}`);
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  process.env.GARMIN_HISTORY_START_DATE = "2026-07-21";
  mcpState.failAthlete = false;
  mcpState.failBodyMetrics = false;
  mcpState.nullAthlete = false;
  mcpState.activities = [];
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Garmin sync athlete baseline stage", () => {
  it("imports populated athlete facts without obscuring health sync", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const progress: string[] = [];

    const result = await runGarminSync((event) => progress.push(event.stage));

    expect(result.status).toBe("completed");
    expect(result.healthDaysImported).toBe(2);
    expect(result.athleteBaseline.availability).toBe("partial");
    expect(result.athleteBaseline.values).toMatchObject({
      cyclingFtpWatts: 250,
      availableTrainingDays: ["monday", "wednesday"],
    });
    expect(result.bodyMetrics).toMatchObject({
      availability: "complete",
      values: { weightKg: 70.2, heightCm: 181 },
      history: { availability: "available", count: 1 },
    });
    expect(progress).toContain("athlete");
    expect(progress).toContain("body_metrics");
  });

  it("uses refresh copy when importing missing activity detail", async () => {
    mcpState.activities = [
      {
        activityId: 123456,
        activityType: { typeKey: "running" },
        startTimeLocal: "2026-07-21T07:00:00",
        duration: 1800,
      },
    ];
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    const messages: string[] = [];

    const result = await runGarminSync((event) => messages.push(event.message));

    expect(result.status).toBe("completed");
    expect(messages).toContain(
      "Refreshing missing activity detail 1/1: 123456…",
    );
    expect(messages.join("\n")).not.toContain("Backfilling activity detail");
  });

  it("records unavailable athlete attempts for all-null profile facts", async () => {
    mcpState.nullAthlete = true;
    const { runGarminSync } = await import("../src/lib/garmin/importer");

    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.athleteBaseline).toMatchObject({
      availability: "unavailable",
      fetchedAt: null,
      source: null,
    });
  });

  it("preserves previous body metrics after failed refresh", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    await runGarminSync();

    mcpState.failAthlete = true;
    mcpState.failBodyMetrics = true;
    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.bodyMetrics).toMatchObject({
      availability: "failed",
      preservedPrevious: true,
      values: { weightKg: 70.2 },
    });
  });

  it("preserves previous athlete facts after failed refresh", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    await runGarminSync();

    mcpState.failAthlete = true;
    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.athleteBaseline).toMatchObject({
      availability: "failed",
      preservedPrevious: true,
      values: { cyclingFtpWatts: 250 },
    });
  });
});
