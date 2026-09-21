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

  it("streams progress/result, persists normalized data and redacts archives; repeated sync preserves coverage", async () => {
    const sync = await import("../src/app/api/sync/route");
    const repo = await import("../src/lib/db/repository");
    for (let i = 0; i < 2; i += 1) {
      const response = await sync.POST();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/x-ndjson",
      );
      const events = (await response.text())
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
      expect(repo.getCheckpoint("activity_page")).toBe("0");
      expect(repo.getCheckpoint("health_next_date")).toBe("2026-09-22");
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
      detail: "startup failed",
    });
    expect(state.closes).toBe(1);
  });
});
