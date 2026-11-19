import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Mixed MCP-era and official provenance through the real repository and SQLite. */
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "official-mixed-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
  vi.resetModules();
});
afterEach(async () => {
  const { getDatabase } = await import("../src/lib/db/connection");
  getDatabase().close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function repo() {
  const storage = await import("./storage-fixture");
  const { normalizeDailyHealth } = await import("../src/lib/garmin/normalize");
  return { ...storage, normalizeDailyHealth };
}
const archive = (
  r: Awaited<ReturnType<typeof repo>>,
  sourceTool: string,
  date: string,
  kind: string,
) =>
  r.upsertGarminRawPayload({
    sourceTool,
    subjectType: "daily_health",
    subjectId: `${date}:${kind}`,
    payload: { date },
  });

describe("archive repair across old and official labels", () => {
  it("treats old-only, new-only and mixed evidence as the same logical kinds", async () => {
    const r = await repo();
    const missing = (date: string) => r.normalizeDailyHealth(date, {});
    r.upsertDailyHealth(
      ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map(missing),
    );
    // 09-01: MCP stats+sleep. 09-02: official stats+sleep. 09-03: mixed. 09-04: stats only.
    archive(r, "get_stats", "2026-09-01", "stats");
    archive(r, "get_sleep_summary", "2026-09-01", "sleep");
    archive(r, "official_daily_summary", "2026-09-02", "stats");
    archive(r, "official_sleep", "2026-09-02", "sleep");
    archive(r, "get_stats", "2026-09-03", "stats");
    archive(r, "official_sleep", "2026-09-03", "sleep");
    archive(r, "official_daily_summary", "2026-09-04", "stats");
    const range = { startDate: "2026-09-01", endDate: "2026-09-04" };
    expect(r.listDailyHealthRepairCandidateDates(range)).toEqual([
      "2026-09-04",
    ]);
  });

  it("selects the intensity repair only when no stats archive of either source exists", async () => {
    const r = await repo();
    r.upsertDailyHealth([
      r.normalizeDailyHealth("2026-09-01", { stats: { total_steps: 10 } }),
      r.normalizeDailyHealth("2026-09-02", { stats: { total_steps: 10 } }),
      r.normalizeDailyHealth("2026-09-03", { stats: { total_steps: 10 } }),
    ]);
    archive(r, "get_stats", "2026-09-01", "stats");
    archive(r, "official_daily_summary", "2026-09-02", "stats");
    expect(
      r.listDailyHealthIntensityRepairCandidateDates({
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).toEqual(["2026-09-03"]);
  });

  it("counts three logical kinds per date for the trailing refresh regardless of source", async () => {
    const r = await repo();
    const full = (date: string) =>
      r.normalizeDailyHealth(date, {
        stats: {
          total_steps: 1,
          resting_heart_rate_bpm: 50,
          avg_stress_level: 3,
          active_calories: 4,
          total_calories: 5,
          moderate_intensity_minutes: 6,
        },
        sleep: { sleep_seconds: 100, sleep_score: 70 },
      });
    r.upsertDailyHealth([
      full("2026-08-01"),
      full("2026-08-02"),
      full("2026-08-03"),
    ]);
    for (const [stats, sleep, battery, date] of [
      ["get_stats", "get_sleep_summary", "get_body_battery", "2026-08-01"],
      [
        "official_daily_summary",
        "official_sleep",
        "official_body_battery",
        "2026-08-02",
      ],
      ["get_stats", "official_sleep", "official_body_battery", "2026-08-03"],
    ]) {
      archive(r, stats, date, "stats");
      archive(r, sleep, date, "sleep");
      archive(r, battery, date, "body_battery");
    }
    const trailing = r.listDailyHealthTrailingCandidateDates({
      startDate: "2026-08-01",
      // Today and yesterday always refresh, so keep the archived dates older than both.
      endDate: "2026-08-05",
      mutableTrailingDays: 0,
    });
    // All three kinds exist for each date in any label mix: none is re-selected for archive reasons.
    expect(trailing).not.toContain("2026-08-01");
    expect(trailing).not.toContain("2026-08-02");
    expect(trailing).not.toContain("2026-08-03");
  });
});

describe("official provenance is truthful and old rows stay readable", () => {
  it("stores official baseline, body and zone sources without renaming MCP rows", async () => {
    const r = await repo();
    const { normalizeGarminBodyMetrics } =
      await import("../src/lib/garmin/body-metrics-normalize");
    const { normalizeGarminAthleteBaseline } =
      await import("../src/lib/garmin/athlete-normalize");
    const at = new Date("2026-09-21T12:00:00Z");
    const mcp = normalizeGarminBodyMetrics({
      historyPayload: { dateWeightList: [{ date: "2026-08-01", weight: 71 }] },
      fetchedAt: at,
    });
    r.writeGarminBodyMetricsRefresh({
      snapshot: mcp,
      status: mcp.availability,
      attemptedAt: at,
    });
    const official = normalizeGarminBodyMetrics({
      weighInPayload: {
        measurements: [{ date: "2026-09-10", weight_kg: 70.2 }],
      },
      fetchedAt: at,
      source: "garmin_official",
    });
    r.writeGarminBodyMetricsRefresh({
      snapshot: official,
      status: official.availability,
      attemptedAt: at,
    });
    const { getDatabase } = await import("../src/lib/db/connection");
    expect(
      getDatabase()
        .prepare(
          "select date, source from garmin_body_weight_history order by date",
        )
        .all(),
    ).toEqual([
      { date: "2026-08-01", source: "garmin_mcp" },
      { date: "2026-09-10", source: "garmin_official" },
    ]);
    expect(r.getGarminBodyMetrics().source).toBe("garmin_official");
    const baseline = normalizeGarminAthleteBaseline({
      fitPayload: { zones_target: { max_heart_rate: 190 } },
      fetchedAt: at,
      source: "garmin_official",
    });
    r.writeGarminAthleteBaselineRefresh({
      snapshot: baseline,
      status: baseline.availability,
      attemptedAt: at,
    });
    expect(r.getGarminAthleteBaseline().source).toBe("garmin_official");
  });

  it("keeps old MCP zone rows and replaces them only by an explicit newer refresh", async () => {
    const r = await repo();
    const { getDatabase } = await import("../src/lib/db/connection");
    const at = new Date("2026-09-21T12:00:00Z");
    const buckets = (seconds: number) =>
      ([1, 2, 3, 4, 5] as const).map((zone) => ({
        zone,
        seconds,
        sourceLowerBpm: null,
      }));
    r.upsertActivityHrZoneTime({
      garminId: "1",
      fetchedAt: at,
      source: "garmin_mcp",
      status: "available",
      sourceTotalSeconds: 50,
      buckets: buckets(10),
    });
    r.upsertActivityHrZoneTime({
      garminId: "2",
      fetchedAt: at,
      source: "garmin_mcp",
      status: "available",
      sourceTotalSeconds: 50,
      buckets: buckets(10),
    });
    r.upsertActivityHrZoneTime({
      garminId: "2",
      fetchedAt: at,
      source: "garmin_official_estimate",
      status: "available",
      sourceTotalSeconds: 100,
      buckets: buckets(20),
    });
    expect(
      getDatabase()
        .prepare(
          "select garmin_id as id, source, seconds from activity_hr_zone_time where zone = 1 order by garmin_id",
        )
        .all(),
    ).toEqual([
      { id: "1", source: "garmin_mcp", seconds: 10 },
      { id: "2", source: "garmin_official_estimate", seconds: 20 },
    ]);
  });
});
