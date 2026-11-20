import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityRow,
  accountApi,
  addDays,
  fitFor,
  newAccount,
  TOKEN_PATH,
  type Account,
} from "./official-api-fixture";

/**
 * Real production composition → official reader → SQLite. Only global `fetch`
 * is authored (the finite Personal API fixture) and the key is installed
 * through the real process-owned startup capability, exactly as the desktop
 * launcher does. No MCP client, Python or FIT process exists to mock.
 */
const KEY = "synthetic-wiring-key-0001";
let directory: string;
let account: Account;
let api: ReturnType<typeof accountApi>;
const SLOT = "__trainerGarminConnectionV1";

type Slot = { installed?: unknown };
const slot = () =>
  (process as unknown as Record<string, Slot | undefined>)[SLOT];
function installKey(key: string | undefined) {
  if (slot()) delete slot()!.installed;
  return import("../src/lib/garmin/connection").then(
    ({ installGarminConnection }) => installGarminConnection({ key }),
  );
}
function populate() {
  for (let i = 0; i < 21; i += 1)
    account.days.set(addDays("2026-08-31", i), { hours: 24, steps: 5000 + i });
  account.days.set("2026-09-21", { hours: 12, steps: 3000 });
  account.activities.push(
    activityRow(123, "2026-09-21 07:00:00", {
      hrTimeInZone_1: 60,
      hrTimeInZone_2: 120,
      hrTimeInZone_3: 180,
      hrTimeInZone_4: 240,
      hrTimeInZone_5: 300,
    }),
  );
  account.files.set(
    "123",
    fitFor({
      sessionZones: [0, 10, 20, 30, 40, 50],
      highBoundaries: [100, 115, 130, 145, 160, 175],
      zonesTarget: { max: 190 },
    }),
  );
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "garmin-wiring-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-21");
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
  account = newAccount();
  populate();
  api = accountApi(account);
  vi.stubGlobal("fetch", api.fetch);
  vi.resetModules();
  await installKey(KEY);
});
afterEach(async () => {
  const { getDatabase } = await import("../src/lib/db/connection");
  getDatabase().close();
  if (slot()) delete slot()!.installed;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});
function detailRequest(body: unknown) {
  return new Request("http://localhost/api/activity-detail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function events(response: Response) {
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
const latest = () =>
  new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"intent":"latest"}',
  });

describe("HTTP through real production composition, official reader and SQLite", () => {
  it("makes no Garmin request on import, summary or a missing key, and blocks Sync with the closed reconnect message", async () => {
    await installKey(undefined);
    const route = await import("../src/app/api/sync/route");
    const summary = await import("../src/app/api/summary/route");
    await summary.GET();
    expect(api.requests).toEqual([]);
    const post = await route.POST();
    expect(post.status).toBe(409);
    expect(await post.json()).toEqual({
      status: "blocked",
      detail: expect.stringContaining("Personal API key in native Settings"),
    });
    const check = await route.GET();
    expect(check.status).toBe(409);
    expect(await check.json()).toMatchObject({ state: "not-configured" });
    expect(api.requests).toEqual([]);
  });

  it("explicit connection check uses only the official token and profile reads and never echoes the key", async () => {
    const route = await import("../src/app/api/sync/route");
    const ok = await route.GET();
    expect(ok.status).toBe(200);
    const body = JSON.stringify(await ok.json());
    expect(body).toContain("verified");
    expect(body).not.toContain(KEY);
    expect(api.requests.map((r) => r.path)).toEqual([
      TOKEN_PATH,
      "/userprofile-service/userprofile/settings",
      "/biometric-service/heartRateZones/v2",
    ]);
    expect(api.requests[0].authorization).toBe(`ApiKey ${KEY}`);
    expect(
      api.requests
        .slice(1)
        .every((r) => r.authorization?.startsWith("Bearer ")),
    ).toBe(true);
    account.failPaths.clear();
  });

  it.each([
    [401, "key-rejected"],
    [429, "rate-limited"],
    [503, "network"],
  ] as const)(
    "classifies a %s token exchange as %s without claiming key expiry for transient failures",
    async (status, state) => {
      vi.stubGlobal("fetch", (async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        return url.pathname === TOKEN_PATH
          ? new Response("x", { status })
          : new Response("{}", { status: 200 });
      }) as typeof fetch);
      const route = await import("../src/app/api/sync/route");
      const result = await (await route.GET()).json();
      expect(result).toMatchObject({ ok: false, state });
      expect(JSON.stringify(result)).not.toContain(KEY);
      if (state !== "key-rejected")
        expect(result.detail).not.toMatch(/expired|revoked/);
    },
  );

  it("streams progress/result, persists normalized data, HR zones and redacted archives; repeated sync preserves coverage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const sync = await import("../src/app/api/sync/route");
    const repo = await import("./storage-fixture");
    for (let i = 0; i < 2; i += 1) {
      const response = await sync.POST();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/x-ndjson",
      );
      const pending = events(response);
      await vi.advanceTimersByTimeAsync(60_000);
      const stream = await pending;
      expect(stream[0]).toMatchObject({ type: "progress", stage: "starting" });
      expect(stream.at(-1)).toMatchObject({
        type: "result",
        status: "completed",
        storedActivities: 1,
      });
      expect(String(stream.at(-1)?.detail)).toContain("HTTP requests");
      expect(
        JSON.parse(repo.getCheckpoint("garmin_history_v1")!),
      ).toMatchObject({
        version: 1,
        limit: "2026-09-21",
        remoteLowerBound: null,
        outcome: "settled",
      });
    }
    const { getDatabase } = await import("../src/lib/db/connection");
    const db = getDatabase();
    const archive = db
      .prepare("select payload_json from garmin_raw_payload")
      .all();
    expect(archive.length).toBeGreaterThan(0);
    const all =
      JSON.stringify(archive) + JSON.stringify(api.requests.map((r) => r.path));
    expect(all).not.toContain(KEY);
    expect(
      db
        .prepare(
          "select zone, seconds, source from activity_hr_zone_time where garmin_id='123' order by zone",
        )
        .all(),
    ).toEqual(
      [10, 20, 30, 40, 50].map((seconds, index) => ({
        zone: index + 1,
        seconds,
        source: "garmin_official_fit",
      })),
    );
    expect(
      repo.getActivityDetailForAnalytics("123").availability?.recordCount,
    ).toBeGreaterThan(0);
    // One token exchange per operation reader; no per-request key exposure.
    expect(api.count(TOKEN_PATH)).toBe(2);
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("first official run over legacy MCP state rechecks recent 14 days, keeps older finals and history checkpoints, and repeats only open days", async () => {
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-01");
    const sync = await import("../src/app/api/sync/route");
    const repo = await import("./storage-fixture");
    const { normalizeDailyHealth } = await import("./legacy-normalize");
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
      const final = (await events(await sync.POST(latest()))).at(-1);
      expect(final).toMatchObject({ type: "result", status: "completed" });
    };
    await run();
    const fresh = JSON.parse(repo.getCheckpoint(FRESHNESS_CHECKPOINT)!);
    expect(fresh.days["2026-09-01"]).toEqual({ final: true, source: "legacy" });
    expect(fresh.days["2026-09-20"]).toMatchObject({ final: true });
    expect(fresh.days["2026-09-21"]).toMatchObject({ final: false });
    // Official values replace the old mutable recent row; older history stays.
    expect(
      getDatabase()
        .prepare("select steps from daily_health where date='2026-09-20'")
        .get(),
    ).toEqual({ steps: 5020 });
    expect(
      getDatabase()
        .prepare("select steps from daily_health where date='2026-09-01'")
        .get(),
    ).toEqual({ steps: 1234 });
    const firstRequests = api.requests.length;
    await run();
    const repeat = api.requests.slice(firstRequests).map((r) => r.path);
    expect(repeat).not.toContain("/download-service/files/activity/123");
    expect([
      repo.getCheckpoint("garmin_history_v1"),
      repo.getCheckpoint("garmin_discovery_v1"),
    ]).toEqual(before);
    expect(getDatabase().pragma("integrity_check")).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(getDatabase().pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects missing/unknown IDs before any Garmin request and retains detail status/force/error contracts", async () => {
    const route = await import("../src/app/api/activity-detail/route");
    expect((await route.POST(detailRequest({}))).status).toBe(400);
    expect(
      (await route.POST(detailRequest({ garminId: "unknown" }))).status,
    ).toBe(404);
    expect(api.requests).toEqual([]);
    const repo = await import("./storage-fixture");
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
    vi.stubGlobal("fetch", (async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ) =>
      /\/(download-service|activity-service)\//.test(String(input))
        ? new Response("x", { status: 503 })
        : api.fetch(input, init)) as typeof fetch);
    const failed = await route.POST(
      detailRequest({ garminId: "123", force: true }),
    );
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      status: "failed",
      preservedPrevious: true,
      retryable: true,
    });
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

  it("reports a rejected key as a closed auth failure result without partial finality", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      (async () => new Response("x", { status: 401 })) as typeof fetch,
    );
    const route = await import("../src/app/api/sync/route");
    const pending = events(await route.POST());
    await vi.advanceTimersByTimeAsync(60_000);
    const final = (await pending).at(-1);
    expect(final).toMatchObject({ type: "result", status: "failed" });
    expect(String(final?.detail)).toContain(
      "Personal API key was rejected or has expired",
    );
    expect(JSON.stringify(final)).not.toContain(KEY);
  });
});

describe("KPI measurements through real composition (T0328)", () => {
  async function seed() {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { createWeeklyStore } =
      await import("../src/lib/db/weekly-repository");
    const { getDatabase } = await import("../src/lib/db/connection");
    const store = createWeeklyStore(getDatabase);
    const { authoredWeeklyKpis } = await import("./kpi-fixture");
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
    const { upsertActivities } = await import("./storage-fixture");
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
