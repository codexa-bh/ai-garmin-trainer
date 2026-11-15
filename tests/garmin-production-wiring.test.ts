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
  calls: [] as string[],
}));
vi.mock("../src/lib/garmin/client", () => ({
  verifyConnectorToken: async () => ({
    ok: state.token,
    detail: "token preflight",
  }),
}));
vi.mock("../src/lib/garmin/mcp-client", () => ({
  GarminMcpClient: class {
    constructor() {
      state.constructions += 1;
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
    async callTool(operation: string) {
      state.calls.push(operation);
      if (operation === "get_activities_by_date")
        return JSON.stringify({
          activities: [
            {
              activityId: "123",
              activityType: "running",
              activityName: "Fixture",
              startTimeLocal: "2026-09-21T08:00:00",
              trainingEffect: 2,
            },
          ],
          has_more: false,
          token: "fake-private-token",
        });
      if (operation === "get_activity_fit_data") {
        if (state.failDetail) throw new Error("detail timeout");
        return JSON.stringify({
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
    calls: [],
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

  it("triggers one current-week refresh after a completed sync and keeps the sync result when it fails", async () => {
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
    const before = JSON.stringify(store.readKpis("2026-09-21"));
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
    ).toEqual({ weekStart: "2026-09-21", status: "refreshed", failed: 0 });
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
    // Reviewed assessments, points and narrative state are never changed.
    expect(JSON.stringify(store.readKpis("2026-09-21"))).toBe(before);
  }, 30000);
});
