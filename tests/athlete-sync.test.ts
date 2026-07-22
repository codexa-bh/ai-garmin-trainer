import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbDir = join(tmpdir(), "ai-garmin-athlete-sync-tests");
const mcpState = {
  failAthlete: false,
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
      if (operation === "get_activities_by_date")
        return JSON.stringify({
          activities: mcpState.activities,
          has_more: false,
        });
      if (operation === "get_stats") return JSON.stringify({ steps: 1000 });
      if (operation === "get_sleep_summary") return JSON.stringify({});
      if (operation === "get_activity_fit_data") {
        return JSON.stringify({
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
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  process.env.GARMIN_HISTORY_START_DATE = "2026-07-21";
  mcpState.failAthlete = false;
  mcpState.nullAthlete = false;
  mcpState.activities = [];
  vi.resetModules();
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
      runningLactateThresholdHeartRateBpm: 168,
      cyclingFtpWatts: 250,
      availableTrainingDays: ["monday", "wednesday"],
    });
    expect(progress).toContain("athlete");
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

  it("preserves previous athlete facts after failed refresh", async () => {
    const { runGarminSync } = await import("../src/lib/garmin/importer");
    await runGarminSync();

    mcpState.failAthlete = true;
    const result = await runGarminSync();

    expect(result.status).toBe("completed");
    expect(result.athleteBaseline).toMatchObject({
      availability: "failed",
      preservedPrevious: true,
      values: { runningLactateThresholdHeartRateBpm: 168 },
    });
  });
});
