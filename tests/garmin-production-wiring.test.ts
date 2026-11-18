import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  token: true,
  starts: 0,
  closes: 0,
  constructions: 0,
  failStart: false,
  dependency: null as "launcher-unavailable" | "startup-unknown" | null,
  failDetail: false,
  newest: "123",
  upload: "2026-09-21T10:00:00Z" as string | null,
  failProfile: false,
  healthDates: [] as string[],
  calls: [] as string[],
  devices: null as unknown[] | null,
  lastUsed: "No last used device found.",
  profiles: [] as string[],
}));
vi.mock("../src/lib/garmin/client", () => ({
  verifyConnectorToken: async () => ({
    ok: state.token,
    detail: "token preflight",
  }),
}));
vi.mock("../src/lib/garmin/mcp-client", () => ({
  GarminMcpClient: class {
    constructor(private profile = "reads") {
      state.constructions += 1;
      state.profiles.push(profile);
    }
    async start() {
      state.starts += 1;
      if (state.dependency) {
        const { GarminDependencyError } =
          await import("../src/lib/garmin/dependency-error");
        throw new GarminDependencyError(state.dependency);
      }
      if (state.failStart) throw new Error("startup failed");
    }
    close() {
      state.closes += 1;
    }
    async callTool(operation: string, args: Record<string, unknown>) {
      state.calls.push(operation);
      // The dedicated UTC last-used process exposes only its single tool.
      if (
        (operation === "get_device_last_used") !==
        (this.profile === "last-used")
      )
        throw new Error("Unknown tool for this connector profile");
      if (operation === "get_device_last_used") return state.lastUsed;
      if (operation === "get_devices")
        return JSON.stringify(
          state.devices ?? [
            { device_id: 1, is_primary: true, last_sync_time: state.upload },
          ],
        );
      if (operation === "get_stats") {
        state.healthDates.push(String(args.date));
        return "{}";
      }
      if (operation === "get_user_profile") {
        if (state.failProfile) throw new Error("profile failed");
        return '{"userData":{"availableTrainingDays":["monday"],"weight":70,"height":180}}';
      }
      if (operation === "get_cycling_ftp")
        return '{"functional_threshold_power_watts":250,"sport":"cycling"}';
      if (operation === "get_activities_by_date")
        return JSON.stringify({
          activities: [
            {
              activityId: state.newest,
              activityType: "running",
              activityName: "Fixture",
              startTimeLocal:
                state.newest === "123"
                  ? "2026-09-21T08:00:00"
                  : "2026-09-21T09:00:00",
              trainingEffect: 2,
            },
          ],
          has_more: false,
          token: "fake-private-token",
        });
      if (operation === "get_activity_fit_data") {
        if (state.failDetail) throw new Error("detail timeout");
        return JSON.stringify({
          zones_target: { max_heart_rate: 190 },
          records: [
            {
              timestamp: "2026-09-21T08:00:00Z",
              heart_rate_bpm: 140,
              enhanced_altitude: 200,
              distance: 0,
              enhanced_speed: 3,
            },
          ],
          cookie: "fake-private-cookie",
        });
      }
      return "{}";
    }
  },
}));
vi.mock("../src/lib/garmin/fit-baseline", () => ({
  fetchFitBaselineWithLocalWrapper: async () => undefined,
}));
// Real supplement predicates/merge functions; only external process entrypoints are replaced.
vi.mock("../src/lib/garmin/fit-altitude", async (original) => ({
  ...(await original<typeof import("../src/lib/garmin/fit-altitude")>()),
  fetchFitAltitudeWithLocalWrapper: async () => undefined,
}));
vi.mock("../src/lib/garmin/fit-distance", async (original) => ({
  ...(await original<typeof import("../src/lib/garmin/fit-distance")>()),
  fetchFitDistanceWithLocalWrapper: async () => undefined,
}));
vi.mock("../src/lib/garmin/fit-speed", async (original) => ({
  ...(await original<typeof import("../src/lib/garmin/fit-speed")>()),
  fetchFitSpeedWithLocalWrapper: async () => undefined,
}));
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "garmin-wiring-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-21");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
  Object.assign(state, {
    token: true,
    starts: 0,
    closes: 0,
    constructions: 0,
    failStart: false,
    dependency: null,
    failDetail: false,
    newest: "123",
    upload: "2026-09-21T10:00:00Z",
    failProfile: false,
    healthDates: [],
    calls: [],
    devices: null,
    lastUsed: "No last used device found.",
    profiles: [],
  });
  vi.resetModules();
});
afterEach(async () => {
  const { getDatabase } = await import("../src/lib/db/connection");
  getDatabase().close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function detailRequest(body: unknown) {
  return new Request("http://localhost/api/activity-detail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("HTTP through real production composition, reader and SQLite", () => {
  it("keeps token preflight outside sync/connector construction and preserves 409 contracts", async () => {
    const route = await import("../src/app/api/sync/route");
    expect(state.constructions).toBe(0);
    state.token = false;
    const get = await route.GET();
    expect(get.status).toBe(409);
    expect(await get.json()).toEqual({ ok: false, detail: "token preflight" });
    const post = await route.POST();
    expect(post.status).toBe(409);
    expect(await post.json()).toEqual({
      status: "blocked",
      detail: "token preflight",
    });
    expect(state.constructions).toBe(0);
    state.token = true;
    expect((await route.GET()).status).toBe(200);
  });

  it.each(["launcher-unavailable", "startup-unknown"] as const)(
    "carries %s through real Sync and allows an explicit repaired retry with unchanged checkpoints",
    async (reason) => {
      vi.useFakeTimers();
      state.dependency = reason;
      const route = await import("../src/app/api/sync/route");
      const response = await route.POST();
      const text = await response.text();
      const events = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events.at(-1)).toMatchObject({
        type: "result",
        status: "failed",
        dependency: reason,
        storedActivities: 0,
      });
      expect(events.at(-1)?.detail).toContain("README Installation");
      expect(state.calls).toEqual([]);
      expect(state.closes).toBeGreaterThan(0);
      expect(text).not.toContain("fake-private");
      state.dependency = null;
      const repaired = await route.POST();
      const stream = repaired.text();
      await vi.advanceTimersByTimeAsync(30_000);
      const final = JSON.parse(
        (await stream).trim().split("\n").at(-1)!,
      ) as Record<string, unknown>;
      expect(final.status).toBe("completed");
      expect(final.dependency).toBeUndefined();
      expect(state.starts).toBe(2);
    },
  );

  it("streams progress/result, persists normalized data and redacts archives; repeated sync preserves coverage", async () => {
    vi.useFakeTimers();
    const sync = await import("../src/app/api/sync/route");
    const repo = await import("../src/lib/db/repository");
    for (let i = 0; i < 2; i += 1) {
      const response = await sync.POST();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/x-ndjson",
      );
      const stream = response.text();
      await vi.advanceTimersByTimeAsync(30_000);
      const events = (await stream)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events[0]).toMatchObject({ type: "progress", stage: "starting" });
      expect(events.at(-2)).toMatchObject({
        type: "progress",
        stage: "completed",
      });
      expect(events.at(-1)).toMatchObject({
        type: "result",
        status: "completed",
        storedActivities: 1,
        storedHealthRows: 1,
      });
      expect(repo.getCheckpoint("activity_page")).toBeNull();
      expect(repo.getCheckpoint("health_next_date")).toBeNull();
      expect(
        JSON.parse(repo.getCheckpoint("garmin_history_v1")!),
      ).toMatchObject({
        version: 1,
        limit: "2026-09-21",
        remoteLowerBound: null,
        outcome: "settled",
      });
    }
    expect(state.starts).toBe(2);
    expect(state.closes).toBe(2);
    const { getDatabase } = await import("../src/lib/db/connection");
    const archive = getDatabase()
      .prepare("select payload_json from garmin_raw_payload")
      .all();
    expect(archive.length).toBeGreaterThan(0);
    expect(JSON.stringify(archive)).not.toContain("fake-private-token");
    expect(JSON.stringify(archive)).not.toContain("fake-private-cookie");
    expect(
      repo.getActivityDetailForAnalytics("123").availability?.recordCount,
    ).toBe(1);
  });

  it("reconciles legacy data and durable cadence through actual HTTP/reader/SQLite without changing history or non-null facts", async () => {
    vi.stubEnv("TZ", "UTC");
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-01");
    const sync = await import("../src/app/api/sync/route");
    const repo = await import("../src/lib/db/repository");
    const { normalizeDailyHealth } =
      await import("../src/lib/garmin/normalize");
    const { getDatabase } = await import("../src/lib/db/connection");
    const { FRESHNESS_CHECKPOINT } =
      await import("../src/lib/garmin/latest-policy");
    repo.upsertDailyHealth([
      normalizeDailyHealth("2026-09-01", { stats: { total_steps: 1234 } }),
      normalizeDailyHealth("2026-09-20", { stats: { total_steps: 4321 } }),
    ]);
    repo.saveCheckpoints([
      ["garmin_history_v1", '{"retained":"unsupported-history"}'],
      ["garmin_discovery_v1", '{"retained":"unsupported-discovery"}'],
    ]);
    const before = [
      repo.getCheckpoint("garmin_history_v1"),
      repo.getCheckpoint("garmin_discovery_v1"),
    ];
    const run = async () => {
      const response = await sync.POST(
        new Request("http://localhost/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"intent":"latest"}',
        }),
      );
      expect(response.status).toBe(200);
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({
        type: "result",
        status: "completed",
      });
    };
    await run();
    const fresh = JSON.parse(repo.getCheckpoint(FRESHNESS_CHECKPOINT)!);
    expect(fresh.days["2026-09-01"]).toEqual({ final: true, source: "legacy" });
    expect(fresh.days["2026-09-20"].final).toBe(true);
    expect(state.healthDates).toHaveLength(14);
    expect(state.healthDates).not.toContain("2026-09-01");
    const athlete = repo.getGarminAthleteBaseline();
    expect(athlete.values).toMatchObject({
      configuredMaxHeartRateBpm: 190,
      cyclingFtpWatts: 250,
      availableTrainingDays: ["monday"],
    });
    expect(fresh.fitActivity).toBe("123");
    const beforeCalls = state.calls.length;
    state.healthDates = [];
    await run();
    expect(state.healthDates).toEqual(["2026-09-21"]);
    const repeated = state.calls.slice(beforeCalls);
    expect(
      repeated.filter((name) => name === "get_activities_by_date"),
    ).toHaveLength(1);
    expect(repeated).not.toContain("get_activity_fit_data");
    expect(repeated).not.toContain("get_user_profile");
    expect(repeated).not.toContain("get_cycling_ftp");
    expect(repo.getGarminAthleteBaseline()).toEqual(athlete);
    expect(
      getDatabase()
        .prepare("select steps from daily_health where date='2026-09-20'")
        .get(),
    ).toEqual({ steps: 4321 });
    state.newest = "456";
    await run();
    expect(
      JSON.parse(repo.getCheckpoint(FRESHNESS_CHECKPOINT)!).fitActivity,
    ).toBe("456");
    expect(
      state.calls.filter((name) => name === "get_user_profile"),
    ).toHaveLength(1);
    expect(
      state.calls.filter((name) => name === "get_cycling_ftp"),
    ).toHaveLength(1);
    expect(repo.getGarminAthleteBaseline().values).toEqual(athlete.values);
    expect([
      repo.getCheckpoint("garmin_history_v1"),
      repo.getCheckpoint("garmin_discovery_v1"),
    ]).toEqual(before);
    expect(getDatabase().pragma("integrity_check")).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(getDatabase().pragma("foreign_key_check")).toEqual([]);
  });

  it("catches up 15 initialized open days from matched last-used evidence when direct time is missing, then repeats only today after restart", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-01");
    const { FRESHNESS_CHECKPOINT } =
      await import("../src/lib/garmin/latest-policy");
    const { normalizeDailyHealth } =
      await import("../src/lib/garmin/normalize");
    let repo = await import("../src/lib/db/repository");
    const open = Array.from(
      { length: 15 },
      (_, index) => `2026-09-${String(6 + index).padStart(2, "0")}`,
    );
    repo.upsertDailyHealth([
      normalizeDailyHealth("2026-09-02", { stats: { total_steps: 1111 } }),
      ...open.map((date) =>
        normalizeDailyHealth(date, { stats: { total_steps: 4321 } }),
      ),
    ]);
    // Valid initialized freshness (not a first-run legacy fixture): 15 older
    // dates remain open from earlier downloads without usable evidence.
    const initialized = {
      version: 1,
      startDate: "2026-09-06",
      days: {
        "2026-09-02": { final: true, source: "legacy" },
        ...Object.fromEntries(
          open.map((date) => [
            date,
            {
              final: false,
              source: "download",
              downloadedAt: "2026-09-21T01:00:00.000Z",
              dayEndedAt: new Date(
                Date.parse(`${date}T07:00:00.000Z`) + 86400000,
              ).toISOString(),
              primaryId: null,
              uploadedAt: null,
            },
          ]),
        ),
      },
      profileDay: "2026-09-21",
      ftpDay: "2026-09-21",
      fitActivity: "123",
    };
    repo.saveCheckpoints([
      [FRESHNESS_CHECKPOINT, JSON.stringify(initialized)],
      ["garmin_history_v1", '{"retained":"unsupported-history"}'],
      ["garmin_discovery_v1", '{"retained":"unsupported-discovery"}'],
    ]);
    const history = [
      repo.getCheckpoint("garmin_history_v1"),
      repo.getCheckpoint("garmin_discovery_v1"),
    ];
    // Large lossless numeric ID; direct upload omitted as by the pinned curation.
    state.devices = [
      { device_id: 3456789012, is_primary: true, device_name: "private" },
      {
        device_id: 77,
        is_primary: false,
        last_sync_time: "2026-09-21T11:00:00Z",
      },
    ];
    state.lastUsed = JSON.stringify({
      user_device_id: 3456789012,
      device_name: "private watch",
      last_upload_time: "2026-09-21 10:00:00",
    });
    const run = async () => {
      const sync = await import("../src/app/api/sync/route");
      const response = await sync.POST(
        new Request("http://localhost/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"intent":"latest"}',
        }),
      );
      const text = await response.text();
      expect(text).not.toContain("private");
      expect(text).not.toContain("3456789012");
      const final = JSON.parse(text.trim().split("\n").at(-1)!);
      expect(final).toMatchObject({ type: "result", status: "completed" });
    };
    await run();
    expect(state.healthDates).toEqual(["2026-09-21", ...open]);
    expect(state.calls.filter((name) => name === "get_devices")).toHaveLength(
      1,
    );
    expect(
      state.calls.filter((name) => name === "get_device_last_used"),
    ).toHaveLength(1);
    const fresh = JSON.parse(repo.getCheckpoint(FRESHNESS_CHECKPOINT)!);
    for (const date of open)
      expect(fresh.days[date]).toMatchObject({
        final: true,
        primaryId: "3456789012",
        uploadedAt: "2026-09-21T10:00:00.000Z",
        uploadedThrough: "2026-09-21T10:00:00.999Z",
      });
    expect(fresh.days["2026-09-21"].final).toBe(false);
    expect(fresh.days["2026-09-02"]).toEqual({ final: true, source: "legacy" });
    // Recreate the application/reader over the same SQLite and checkpoint.
    const { getDatabase } = await import("../src/lib/db/connection");
    getDatabase().close();
    vi.resetModules();
    state.healthDates = [];
    state.calls = [];
    await run();
    expect(state.healthDates).toEqual(["2026-09-21"]);
    expect(state.calls.filter((name) => name === "get_stats")).toHaveLength(1);
    expect(
      state.calls.filter((name) => name === "get_sleep_summary"),
    ).toHaveLength(1);
    expect(
      state.calls.filter((name) => name === "get_body_battery"),
    ).toHaveLength(1);
    expect(
      state.calls.filter((name) => name === "get_device_last_used"),
    ).toHaveLength(1);
    repo = await import("../src/lib/db/repository");
    expect([
      repo.getCheckpoint("garmin_history_v1"),
      repo.getCheckpoint("garmin_discovery_v1"),
    ]).toEqual(history);
    const db = (await import("../src/lib/db/connection")).getDatabase();
    expect(
      db
        .prepare(
          "select count(*) as n, count(steps) as steps from daily_health",
        )
        .get(),
    ).toEqual({ n: 17, steps: 16 });
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("keeps ended days mutable when last-used names another device, retrying only on the next explicit latest", async () => {
    vi.stubEnv("TZ", "Europe/Prague");
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-19");
    const { FRESHNESS_CHECKPOINT } =
      await import("../src/lib/garmin/latest-policy");
    const repo = await import("../src/lib/db/repository");
    state.devices = [{ device_id: "watch-1", device_name: "private" }];
    state.lastUsed = JSON.stringify({
      user_device_id: "bike-2",
      last_upload_time: "2026-09-21 11:00:00",
    });
    const run = async () => {
      const sync = await import("../src/app/api/sync/route");
      const response = await sync.POST(
        new Request("http://localhost/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"intent":"latest"}',
        }),
      );
      const text = await response.text();
      expect(text).toContain("last-used-mismatch");
      expect(text).not.toMatch(/private|bike-2|watch-1/);
    };
    await run();
    await run();
    const fresh = JSON.parse(repo.getCheckpoint(FRESHNESS_CHECKPOINT)!);
    expect(fresh.days["2026-09-19"]).toMatchObject({
      final: false,
      primaryId: null,
    });
    expect(
      state.healthDates.filter((date) => date === "2026-09-19"),
    ).toHaveLength(2);
    expect(
      state.calls.filter((name) => name === "get_device_last_used"),
    ).toHaveLength(2);
    expect(
      state.profiles.filter((profile) => profile === "last-used"),
    ).toHaveLength(2);
  });

  it("rejects missing/unknown IDs before connector access and retains detail status/force/error contracts", async () => {
    const route = await import("../src/app/api/activity-detail/route");
    expect((await route.POST(detailRequest({}))).status).toBe(400);
    expect(
      (await route.POST(detailRequest({ garminId: "unknown" }))).status,
    ).toBe(404);
    expect(state.constructions).toBe(0);
    const repo = await import("../src/lib/db/repository");
    const { normalizeActivity } = await import("../src/lib/garmin/normalize");
    repo.upsertActivities([
      normalizeActivity({
        activityId: "123",
        activityType: "running",
        activityName: "Fixture",
        startTimeLocal: "2026-09-21T08:00:00",
      }),
    ]);
    const response = await route.POST(
      detailRequest({ garminId: " 123 ", force: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      garminId: "123",
      status: "completed",
      attempt: { force: true, status: "succeeded" },
      coverage: { available: 1 },
    });
    const status = await route.GET();
    expect(await status.json()).toMatchObject({
      recentActivities: [
        { garminId: "123", name: "Fixture", date: "2026-09-21" },
      ],
    });
    state.failDetail = true;
    const failed = await route.POST(
      detailRequest({ garminId: "123", force: true }),
    );
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      status: "failed",
      preservedPrevious: true,
      recordCount: 1,
      retryable: true,
    });
    state.failStart = true;
    expect((await route.POST(detailRequest({ garminId: "123" }))).status).toBe(
      500,
    );
    expect(state.closes).toBe(3);
    expect(
      (
        await route.POST(
          new Request("http://localhost/api/activity-detail", {
            method: "POST",
            body: "{",
          }),
        )
      ).status,
    ).toBe(500);
  });

  it("keeps sync startup failure as an NDJSON failed result and closes its client", async () => {
    state.failStart = true;
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST();
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      status: "failed",
      detail: expect.stringContaining("connector or storage failure"),
    });
    expect(state.closes).toBe(1);
  });
});

describe("KPI measurements through real composition (T0328)", () => {
  async function seed() {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { createWeeklyStore } =
      await import("../src/lib/db/weekly-repository");
    const { getDatabase } = await import("../src/lib/db/connection");
    const store = createWeeklyStore(getDatabase);
    const { authoredWeeklyKpis } = await import("../scripts/ci/kpi-fixture");
    const kpis = authoredWeeklyKpis(new Date("2026-09-21T12:00:00Z"));
    kpis.timeZone = timeZone;
    store.saveKpis("2026-09-21", kpis);
    store.saveKpis("2026-09-14", structuredClone(kpis));
    store.saveRecipe({
      conceptId: "authored-sessions",
      version: 1,
      sql: "select count(*) as count from activity where sport = 'running' and started_at >= :week_start_ms and started_at < :week_end_ms",
      tracks: [
        {
          key: "count",
          signature: JSON.stringify([
            "numeric",
            "sessions",
            "Selected session count",
          ]),
        },
      ],
      savedAt: "2026-09-21T00:00:00Z",
    });
    return { store, timeZone };
  }

  it("triggers the two-week default once after a completed sync and keeps the sync result when it fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const { kpiMeasurements } = await import("../src/lib/weekly/composition");
    const refresh = vi
      .spyOn(kpiMeasurements, "refresh")
      .mockRejectedValue(new Error("measurement_failed"));
    const sync = await import("../src/app/api/sync/route");
    const stream = (await sync.POST()).text();
    await vi.advanceTimersByTimeAsync(30_000);
    const events = (await stream).trim().split("\n");
    expect(JSON.parse(events.at(-1)!)).toMatchObject({
      type: "result",
      status: "completed",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]).toHaveLength(1);
  });

  it("recomputes stored actuals in a real bounded child via explicit POST only, never on GET or points", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
    const { store, timeZone } = await seed();
    const { upsertActivities } = await import("../src/lib/db/repository");
    upsertActivities([
      {
        garminId: "w1",
        name: "Authored run",
        sport: "running",
        startedAt: new Date("2026-09-21T12:00:00"),
        durationSec: 1800,
      } as Parameters<typeof upsertActivities>[0][number],
    ]);
    const before = JSON.stringify([
      store.readKpis("2026-09-21"),
      store.readKpis("2026-09-14"),
    ]);
    const weeklyRoute = await import("../src/app/api/weekly/route");
    const read = async () =>
      (
        (await weeklyRoute
          .GET(
            new Request(
              `http://localhost/api/weekly?view=progress&from=2026-09-21&through=2026-09-21&timeZone=${encodeURIComponent(timeZone)}`,
            ),
          )
          .json()) as { weeks: { kpis: { measured: unknown } }[] }
      ).weeks[0].kpis.measured;
    expect(await read()).toBeNull();
    const post = (body: unknown) =>
      weeklyRoute.POST(
        new Request("http://localhost/api/weekly", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    expect(
      await (await post({ action: "refresh-current-week", timeZone })).json(),
    ).toEqual({
      weekStart: "2026-09-21",
      status: "refreshed",
      previous: { weekStart: "2026-09-14", status: "refreshed" },
      failed: 0,
    });
    expect(
      store.readMeasurements("2026-09-14")?.concepts["authored-sessions"]
        .success?.values,
    ).toEqual({ count: 0 });
    // A late previous-week import is picked up by the same default POST.
    upsertActivities([
      {
        garminId: "late-previous",
        name: "Authored late run",
        sport: "running",
        startedAt: new Date("2026-09-20T12:00:00"),
        durationSec: 6480,
      } as Parameters<typeof upsertActivities>[0][number],
    ]);
    expect(
      (await post({ action: "refresh-current-week", timeZone })).status,
    ).toBe(200);
    expect(
      store.readMeasurements("2026-09-14")?.concepts["authored-sessions"]
        .success?.values,
    ).toEqual({ count: 1 });
    const measured = store.readMeasurements("2026-09-21");
    expect(measured?.concepts["authored-sessions"].success).toMatchObject({
      recipeVersion: 1,
      status: "measured",
      values: { count: 1 },
    });
    // Ordinary GET reads only the stored value; nothing is recalculated.
    expect(await read()).toEqual(measured);
    expect(store.readMeasurements("2026-09-21")?.revision).toBe(
      measured?.revision,
    );
    expect((await post({ action: "rescore", timeZone })).status).toBe(400);
    expect(
      (await post({ action: "refresh-current-week", timeZone: "invalid" }))
        .status,
    ).toBe(400);
    // Reviewed assessments, points and narrative state are never changed.
    expect(
      JSON.stringify([
        store.readKpis("2026-09-21"),
        store.readKpis("2026-09-14"),
      ]),
    ).toBe(before);
  }, 30000);
});
