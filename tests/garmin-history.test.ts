import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_CHECKPOINT,
  historyState,
  shiftDate,
  SYNC_LIMITS,
} from "../src/lib/garmin/history-policy";
import { createGarminReader } from "../src/lib/garmin/reader-adapter";

import {
  DISCOVERY_CHECKPOINT,
  DISCOVERY_LIMITS,
} from "../src/lib/garmin/discovery-policy";

const remote = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  stats: new Map<string, unknown>(),
  sleep: new Map<string, unknown>(),
  pages: new Map<
    number,
    {
      activities: Record<string, unknown>[];
      has_more: boolean;
      next_page?: number;
    }
  >(),
  cancelled: false,
  cancelAt: 0,
  advanceAt: 0,
  failure: "",
  bodyFailed: false,
  hang: false,
  stepsStart: "",
}));
vi.mock("../src/lib/garmin/client", () => ({
  verifyConnectorToken: async () => ({ ok: true, detail: "fixture metadata" }),
}));
vi.mock("../src/lib/garmin/mcp-client", async (original) => ({
  ...(await original<typeof import("../src/lib/garmin/mcp-client")>()),
  GarminMcpClient: class {
    async start() {}
    close() {}
    async callTool(name: string, args: Record<string, unknown>) {
      remote.calls.push({ name, args });
      if (
        remote.bodyFailed &&
        ["get_user_profile", "get_body_composition", "get_weigh_ins"].includes(
          name,
        )
      )
        throw new Error("body fixture read failed");
      if (remote.cancelAt === remote.calls.length) remote.cancelled = true;
      if (remote.advanceAt === remote.calls.length)
        vi.setSystemTime(Date.now() + SYNC_LIMITS.milliseconds + 1);
      if (name === "get_stats") {
        if (remote.hang) return new Promise<string>(() => {});
        if (remote.failure) return remote.failure;
        return JSON.stringify(remote.stats.get(String(args.date)) ?? {});
      }
      if (name === "get_sleep_summary")
        return JSON.stringify(remote.sleep.get(String(args.date)) ?? {});
      if (name === "get_body_battery") return "[]";
      if (name === "get_activities_by_date")
        return JSON.stringify(
          String(args.end_date) < "2026-09-08"
            ? (remote.pages.get(Number(args.page)) ?? {
                activities: [],
                has_more: false,
              })
            : { activities: [], has_more: false },
        );
      if (name === "get_weekly_steps") {
        // Default: long history (one positive week per read). Tests that set
        // remote.stepsStart model an account whose data begins there.
        const data: { week_start: string; days_with_data: number }[] = [];
        if (!remote.stepsStart)
          data.push({ week_start: String(args.end_date), days_with_data: 1 });
        else
          for (
            let week = String(args.end_date);
            week >= remote.stepsStart && data.length < Number(args.weeks);
            week = shiftDate(week, -7)
          )
            data.push({ week_start: week, days_with_data: 7 });
        return JSON.stringify({
          end_date: args.end_date,
          weeks_requested: args.weeks,
          weeks_returned: data.length,
          weekly_data: data,
        });
      }
      if (name === "get_user_profile")
        return '{"userData":{"weight":70,"height":180}}';
      if (name === "get_body_composition")
        return JSON.stringify({
          dateWeightList: [
            { date: "2020-01-01", weight: 90 },
            { date: "2026-09-21", weight: 70 },
          ].filter(
            (row) =>
              row.date >= String(args.start_date) &&
              row.date <= String(args.end_date),
          ),
        });
      return "{}";
    }
  },
}));
vi.mock("../src/lib/garmin/fit-baseline", () => ({
  fetchFitBaselineWithLocalWrapper: async () => undefined,
}));
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "garmin-history-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "copy.sqlite"));
  vi.stubEnv("GARMIN_HISTORY_START_DATE", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
  Object.assign(remote, {
    calls: [],
    stats: new Map(),
    sleep: new Map(),
    pages: new Map(),
    cancelled: false,
    cancelAt: 0,
    advanceAt: 0,
    failure: "",
    bodyFailed: false,
    hang: false,
    stepsStart: "",
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
const healthDates = () =>
  remote.calls
    .filter((call) => call.name === "get_stats")
    .map((call) => String(call.args.date));

describe("bounded discovery through the real HTTP/composition/reader/SQLite seams", () => {
  it("retains only a fixed health source diagnostic for unrecognized replies", async () => {
    remote.stats.set("2026-09-21", {
      unexpected: "synthetic-private-payload-not-errors",
    });
    const app = await import("../src/lib/garmin/composition");
    const result = await app.runGarminSync();
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("protocol, stats");
    expect(result.detail).not.toContain("synthetic-private-payload");
    expect(result.history?.unresolvedHealth).toContain("2026-09-21");
  });
  it("refreshes a frozen window head for new arrivals while resuming its range-bound page", async () => {
    const activity = (id: string, day: string) => ({
      activityId: id,
      activityType: "running",
      startTimeLocal: `${day}T12:00:00`,
      trainingEffect: 2,
    });
    remote.pages.set(0, {
      activities: [activity("a", "2026-09-06")],
      has_more: true,
    });
    remote.pages.set(1, {
      activities: [activity("b", "2026-09-05")],
      has_more: true,
    });
    const app = await import("../src/lib/garmin/composition");
    const first = await app.runGarminSync();
    expect(first.history.activities.page).toBe(2);
    remote.pages.set(0, {
      activities: [activity("new", "2026-09-07"), activity("a", "2026-09-06")],
      has_more: true,
    });
    remote.pages.set(2, {
      activities: [activity("c", "2026-09-04")],
      has_more: false,
    });
    remote.calls = [];
    const next = await app.runGarminSync();
    const calls = remote.calls.filter(
      (call) =>
        call.name === "get_activities_by_date" &&
        call.args.end_date === "2026-09-07",
    );
    expect(calls.map((call) => call.args.page)).toEqual([0, 2]);
    expect(next.storedActivities).toBe(4);
    expect(next.history.activities.windowEnd).toBe("2026-08-08");
    expect(next.history.activities.oldestImported).toBe("2026-09-04");
  });

  it("never advances body discovery when all baseline/body reads fail", async () => {
    remote.bodyFailed = true;
    const app = await import("../src/lib/garmin/composition");
    const result = await app.runGarminSync();
    expect(result.status).toBe("failed");
    expect(result.history.body).toMatchObject({
      nextDate: "2026-09-07",
      checks: 0,
    });
    expect(result.history.health.checks).toBe(6);
    expect(result.bodyMetrics.availability).toBe("failed");
  });

  it("replays safely after normalized commit but failed cursor persistence", async () => {
    const repo = await import("../src/lib/db/repository");
    const { getDatabase } = await import("../src/lib/db/connection");
    const db = getDatabase();
    db.exec(`create trigger checkpoint_write_fault before update on sync_checkpoint
      when new.key='garmin_history_v1' and json_extract(new.value, '$.operations') > 0
      begin select raise(abort, 'checkpoint_write_fault'); end`);
    const app = await import("../src/lib/garmin/composition");
    await expect(app.runGarminSync()).rejects.toThrow("checkpoint_write_fault");
    expect(repo.dataCounts().healthDays).toBe(1);
    expect(JSON.parse(repo.getCheckpoint(HISTORY_CHECKPOINT)!)).toMatchObject({
      outcome: "running",
      health: { nextDate: "2026-09-07" },
    });
    db.exec("drop trigger checkpoint_write_fault");
    const resumed = await app.runGarminSync();
    expect(resumed).toMatchObject({
      status: "budget-limited",
      stopReason: "required-work-remaining",
    });
    expect(repo.dataCounts().healthDays).toBe(20);
    expect(
      db
        .prepare(
          "select count(*) as n from daily_health where date='2026-09-21'",
        )
        .get(),
    ).toEqual({ n: 1 });
  });

  it("moves the repair SQL window beyond a capped prefix rather than starving later candidates", async () => {
    const repo = await import("../src/lib/db/repository");
    const { getDatabase } = await import("../src/lib/db/connection");
    const db = getDatabase();
    const insert = db.prepare(
      "insert into daily_health(date, availability) values (?, 'missing')",
    );
    db.transaction(() => {
      for (let i = 0; i < 1005; i += 1) insert.run(shiftDate("2000-01-01", i));
    })();
    const saved = historyState(null, null, "2026-09-21");
    saved.health.nextDate = null;
    saved.body.nextDate = null;
    saved.activities.nextDate = null;
    saved.repairAfter = shiftDate("2000-01-01", 499);
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(saved));
    const app = await import("../src/lib/garmin/composition");
    const result = await app.runGarminSync();
    expect(result).toMatchObject({
      status: "budget-limited",
      stopReason: "required-work-remaining",
    });
    expect(healthDates().slice(-2)).toEqual([
      shiftDate("2000-01-01", 500),
      shiftDate("2000-01-01", 501),
    ]);
    expect(result.history.repairAfter).toBe(shiftDate("2000-01-01", 501));
    expect(healthDates()).toHaveLength(16);
  });

  it("refuses corrupt/unknown checkpoints without resetting or constructing a connector", async () => {
    const repo = await import("../src/lib/db/repository");
    const app = await import("../src/lib/garmin/composition");
    const saved = {
      ...historyState(null, null, "2026-09-21"),
      health: { nextDate: "bad" },
    };
    const bytes = JSON.stringify(saved);
    repo.saveCheckpoint(HISTORY_CHECKPOINT, bytes);
    await expect(app.runGarminSync()).rejects.toThrow(
      "preserve it for recovery",
    );
    expect(repo.getCheckpoint(HISTORY_CHECKPOINT)).toBe(bytes);
    expect(remote.calls).toEqual([]);
  });
  it("keeps the legacy caller bounded while continuing past old empty dates without claiming remote exhaustion", async () => {
    const app = await import("../src/lib/garmin/composition");
    const repo = await import("../src/lib/db/repository");
    const first = await app.runGarminSync();
    expect(first).toMatchObject({
      status: "budget-limited",
      stopReason: "required-work-remaining",
      continuationAvailable: true,
      history: {
        remoteLowerBound: null,
        health: {
          unit: "date",
          checks: 6,
          checksWithMetrics: 0,
          oldestImported: null,
          nextDate: "2026-09-01",
        },
      },
    });
    expect(healthDates().slice(0, 2)).toEqual(["2026-09-21", "2026-09-20"]);
    expect(remote.calls[0].name).toBe("get_stats");
    expect(remote.calls[1].name).toBe("get_sleep_summary");
    expect(remote.calls[2].name).toBe("get_body_battery");
    expect(first.history.operations).toBeGreaterThanOrEqual(
      remote.calls.length,
    );
    expect(first.history.operations).toBeLessThanOrEqual(
      SYNC_LIMITS.operations,
    );
    expect(healthDates()).toHaveLength(20);
    const oldDates = healthDates().filter((date) => date < "2026-09-08");
    remote.calls = [];
    const next = await app.runGarminSync();
    expect(next.history.health.nextDate).toBe("2026-08-26");
    for (const date of oldDates) expect(healthDates()).not.toContain(date);
    const summary = repo.importSummary();
    expect(summary.history?.health.checks).toBe(12);
    expect(summary.history?.remoteLowerBound).toBeNull();
    expect(summary.healthCoverage.metrics.stepsDays).toBe(0);
  });

  it("retains sparse, metric-specific islands and older weight records while preserving current body facts", async () => {
    const repo = await import("../src/lib/db/repository");
    const app = await import("../src/lib/garmin/composition");
    const saved = historyState(null, null, "2026-09-21");
    saved.health.nextDate = "2020-01-10";
    saved.body.nextDate = "2020-01-10";
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(saved));
    remote.stats.set("2020-01-10", { total_steps: 0 });
    remote.sleep.set("2020-01-01", { sleep_seconds: 3600 });
    const first = await app.runGarminSync();
    expect(first.history.health).toMatchObject({
      checksWithMetrics: 1,
      oldestImported: "2020-01-10",
    });
    expect(first.bodyMetrics.values.weightKg).toBe(70);
    expect(first.bodyMetrics.history.count).toBe(2);
    const second = await app.runGarminSync();
    expect(second.history.health).toMatchObject({
      checksWithMetrics: 2,
      oldestImported: "2020-01-01",
    });
    expect(second.healthCoverage.metrics.stepsDays).toBe(1);
    expect(second.healthCoverage.metrics.sleepDays).toBe(1);
    expect(second.history.remoteLowerBound).toBeNull();
    expect(second.bodyMetrics.values.weightKg).toBe(70);
    expect(second.bodyMetrics.history.count).toBe(2);
    const { getDatabase } = await import("../src/lib/db/connection");
    expect(
      getDatabase()
        .prepare(
          "select date, weight_kg from garmin_body_weight_history order by date",
        )
        .all(),
    ).toEqual([
      { date: "2020-01-01", weight_kg: 90 },
      { date: "2026-09-21", weight_kg: 70 },
    ]);
  });

  it.each([
    ["Error retrieving stats: private path secret", "connector"],
    ['{"unknown_payload":{"opaque":true}}', "protocol"],
    ["Error retrieving stats: 429 rate limit private secret", "rate-limit"],
    ["Error retrieving stats: 401 unauthorized private secret", "auth"],
    ["Error retrieving stats: network connection private secret", "network"],
  ])(
    "never records %s as source-empty evidence",
    async (failure, failureClass) => {
      remote.failure = failure;
      const app = await import("../src/lib/garmin/composition");
      const result = await app.runGarminSync();
      expect(result.status).toBe("failed");
      expect(result.history.failureClass).toBe(failureClass);
      expect(result.history.health.checks).toBe(0);
      expect(result.history.unresolvedHealth).toContain("2026-09-21");
      expect(result.detail).not.toContain("private");
      const repo = await import("../src/lib/db/repository");
      expect(repo.dataCounts().healthDays).toBe(0);
      if (["rate-limit", "auth"].includes(failureClass))
        expect(remote.calls).toHaveLength(1);
    },
  );

  it("cancels between nested date reads without committing a partial date, then resumes idempotently", async () => {
    const app = await import("../src/lib/garmin/composition");
    const repo = await import("../src/lib/db/repository");
    remote.cancelAt = 2;
    const stopped = await app.runGarminSync(undefined, {
      cancelled: () => remote.cancelled,
    });
    expect(stopped.status).toBe("cancelled");
    expect(stopped.history.health.nextDate).toBe("2026-09-07");
    expect(remote.calls).toHaveLength(2);
    expect(repo.dataCounts().healthDays).toBe(0);
    remote.cancelAt = 0;
    remote.cancelled = false;
    const resumed = await app.runGarminSync();
    expect(resumed).toMatchObject({
      status: "budget-limited",
      stopReason: "required-work-remaining",
    });
    const count = repo.dataCounts().healthDays;
    await app.runGarminSync();
    expect(repo.dataCounts().healthDays).toBe(count + 6);
    expect(repo.importSummary().history?.outcome).toBe("budget-limited");
  });

  it("enforces elapsed-time admission before the next nested read", async () => {
    remote.advanceAt = 1;
    const app = await import("../src/lib/garmin/composition");
    const result = await app.runGarminSync();
    expect(result.status).toBe("budget-limited");
    expect(remote.calls).toHaveLength(1);
    expect(result.history.health.nextDate).toBe("2026-09-07");
  });

  it("keeps active writer exclusion through disconnect and settles durable cancellation", async () => {
    remote.hang = true;
    const route = await import("../src/app/api/sync/route");
    const first = await route.POST();
    expect((await route.POST()).status).toBe(409);
    await first.body!.cancel();
    const app = await import("../src/lib/garmin/composition");
    await vi.waitFor(() => expect(app.isGarminSyncRunning()).toBe(false));
    const repo = await import("../src/lib/db/repository");
    expect(repo.importSummary().history?.outcome).toBe("cancelled");
    expect(repo.dataCounts().healthDays).toBe(0);
  });

  it("preserves global legacy checkpoints and normalized rows; a changed limit never resets via legacy callers", async () => {
    const repo = await import("../src/lib/db/repository");
    repo.saveCheckpoint("activity_page", "99");
    repo.saveCheckpoint("health_next_date", "2030-01-01");
    const app = await import("../src/lib/garmin/composition");
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-20");
    await app.runGarminSync();
    expect(healthDates()).toEqual(["2026-09-21", "2026-09-20"]);
    const bytes = [
      repo.getCheckpoint(HISTORY_CHECKPOINT),
      repo.getCheckpoint(DISCOVERY_CHECKPOINT),
    ];
    const rows = repo.dataCounts().healthDays;
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "");
    remote.calls = [];
    // Only the explicit discover action may continue limited progress.
    await expect(app.runGarminSync()).rejects.toThrow("not actionable");
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-10");
    await expect(app.runGarminSync()).rejects.toThrow("not actionable");
    expect(remote.calls).toEqual([]);
    expect([
      repo.getCheckpoint(HISTORY_CHECKPOINT),
      repo.getCheckpoint(DISCOVERY_CHECKPOINT),
    ]).toEqual(bytes);
    expect(repo.getCheckpoint("activity_page")).toBe("99");
    expect(repo.getCheckpoint("health_next_date")).toBe("2030-01-01");
    expect(repo.dataCounts().healthDays).toBe(rows);
  });
});

describe("interactive operation through actual HTTP/NDJSON/SQLite", () => {
  it("automatically commits multiple batches, refreshes common work once and resumes preserved v1 state", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-08-22");
    const repo = await import("../src/lib/db/repository");
    const initial = historyState(null, "2026-08-22", "2026-09-21");
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(initial));
    repo.saveCheckpoint("health_next_date", "retained-legacy");
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST();
    expect((await route.POST()).status).toBe(409);
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(250_000);
    const events = (await stream)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const result = events.at(-1);
    expect(result.status).toBe("completed");
    expect(result.discovery.operation.batches).toBeGreaterThan(2);
    expect(result.history.health.checks).toBe(17);
    expect(result.history.remoteLowerBound).toBeNull();
    expect(result.history.health.nextDate).toBe("2026-08-21");
    expect(
      remote.calls.filter((call) => call.name === "get_user_profile"),
    ).toHaveLength(1);
    expect(
      remote.calls.filter((call) => call.name === "get_cycling_ftp"),
    ).toHaveLength(1);
    expect(
      remote.calls.filter((call) => call.name === "get_weekly_steps"),
    ).toHaveLength(1);
    expect(healthDates().filter((date) => date === "2026-09-21")).toHaveLength(
      1,
    );
    expect(
      events.some((event) =>
        event.message?.includes("continuing within the same operation"),
      ),
    ).toBe(true);
    expect(repo.getCheckpoint("health_next_date")).toBe("retained-legacy");
    expect(
      JSON.parse(repo.getCheckpoint(DISCOVERY_CHECKPOINT)!).operation.outcome,
    ).toBe("settled");
    expect(
      (await import("../src/lib/garmin/composition")).isGarminSyncRunning(),
    ).toBe(false);
  });

  it("strictly lowers native/API evidence to150 cumulative attempts without resetting across batches", async () => {
    vi.useFakeTimers();
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        headers: { "x-trainer-sync-budget": "finite-live-smoke" },
      }),
    );
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(200_000);
    const result = JSON.parse((await stream).trim().split("\n").at(-1)!);
    expect(result.status).toBe("budget-limited");
    expect(result.discovery.operation.attempts).toBe(150);
    expect(result.discovery.operation.batches).toBeGreaterThan(1);
    expect(remote.calls.length).toBeLessThanOrEqual(150);
    expect(
      Date.parse(result.discovery.operation.updatedAt) -
        Date.parse(result.discovery.operation.startedAt),
    ).toBeLessThanOrEqual(180_000);
  });
  it("refuses arbitrary budget values before any connector operation", async () => {
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        headers: { "x-trainer-sync-budget": "unlimited" },
      }),
    );
    expect(response.status).toBe(400);
    expect(remote.calls).toEqual([]);
  });
  it("enforces the fixed live180-second deadline even when cumulative attempts remain", async () => {
    remote.advanceAt = 1;
    const app = await import("../src/lib/garmin/composition");
    const result = await app.runGarminSync(undefined, {
      interactive: true,
      finiteLiveSmoke: true,
    });
    expect(result.status).toBe("budget-limited");
    expect(remote.calls).toHaveLength(1);
    expect(result.discovery?.operation?.attempts).toBe(1);
  });
  it("caps cumulative attempts without resetting across batches and exposes resumable unknown history", async () => {
    vi.useFakeTimers();
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST();
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(600_000);
    const result = JSON.parse((await stream).trim().split("\n").at(-1)!);
    expect(result.status).toBe("budget-limited");
    expect(result.discovery.operation.attempts).toBe(
      DISCOVERY_LIMITS.operations,
    );
    expect(result.discovery.operation.batches).toBeGreaterThan(5);
    expect(result.history.remoteLowerBound).toBeNull();
    expect(result.continuationAvailable).toBe(true);
    expect(result.history.health.checks).toBeGreaterThan(60);
    expect(remote.calls.length).toBeLessThanOrEqual(
      DISCOVERY_LIMITS.operations,
    );
  });

  it("stops on a protocol failure instead of automatically advancing or retrying", async () => {
    vi.useFakeTimers();
    remote.failure = '{"unexpected":"private"}';
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST();
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(10_000);
    const result = JSON.parse((await stream).trim().split("\n").at(-1)!);
    expect(result.status).toBe("failed");
    expect(remote.calls).toHaveLength(3);
    expect(result.discovery.operation.batches).toBe(0);
    expect(result.history.unresolvedHealth).toContain("2026-09-21");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

describe("explicit Sync intents and durable eligibility", () => {
  async function explicit(intent: string) {
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        body: JSON.stringify({ intent }),
      }),
    );
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(600_000);
    return {
      status: response.status,
      events: (await stream)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    };
  }
  it("keeps latest separate, preserves completed scope byte-for-byte and agrees after reload/repeat", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-07");
    const repo = await import("../src/lib/db/repository");
    const route = await import("../src/app/api/summary/route");
    const { getDatabase } = await import("../src/lib/db/connection");
    const db = getDatabase();
    db.prepare(
      "insert into daily_health(date,availability,steps) values ('2000-01-01','partial',1234)",
    ).run();
    db.prepare(
      "insert into garmin_body_weight_history(date,weight_kg,source,fetched_at) values ('2000-01-01',72,'authored-transition',1)",
    ).run();
    const originals = () => [
      db
        .prepare(
          "select date,availability,steps from daily_health where date='2000-01-01'",
        )
        .get(),
      db
        .prepare(
          "select * from garmin_body_weight_history where date='2000-01-01'",
        )
        .get(),
    ];
    const preserved = originals();
    const initial = await (await route.GET()).json();
    expect(initial.sync.historical).toMatchObject({
      state: "available",
      action: "start",
    });
    expect(remote.calls).toEqual([]);
    const history = await explicit("history");
    const result = history.events.at(-1);
    expect(result.status).toBe("completed");
    expect(result.sync.historical.state).toBe("complete");
    const bytes = [
      repo.getCheckpoint(HISTORY_CHECKPOINT),
      repo.getCheckpoint(DISCOVERY_CHECKPOINT),
    ];
    for (let index = 0; index < 2; index += 1) {
      remote.calls = [];
      const latest = (await explicit("latest")).events.at(-1);
      expect(latest.intent).toBe("latest");
      expect(latest.sync.historical.state).toBe("complete");
      expect(latest.detail).not.toContain("Detail backlog");
      expect(healthDates().every((date) => date >= "2026-09-08")).toBe(true);
      expect(
        remote.calls.some((call) => call.name === "get_weekly_steps"),
      ).toBe(false);
      expect([
        repo.getCheckpoint(HISTORY_CHECKPOINT),
        repo.getCheckpoint(DISCOVERY_CHECKPOINT),
      ]).toEqual(bytes);
      const reload = await (await route.GET()).json();
      expect(reload.sync).toEqual(latest.sync);
      expect(originals()).toEqual(preserved);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("foreign_key_check")).toEqual([]);
    }
    remote.calls = [];
    expect((await explicit("history")).status).toBe(409);
    expect(remote.calls).toEqual([]);
  });
  it("latest on a fresh database never creates history and retains the meaningful older-data entry", async () => {
    vi.useFakeTimers();
    const latest = (await explicit("latest")).events.at(-1);
    const repo = await import("../src/lib/db/repository");
    expect(repo.getCheckpoint(HISTORY_CHECKPOINT)).toBeNull();
    expect(repo.getCheckpoint(DISCOVERY_CHECKPOINT)).toBeNull();
    expect(latest.sync.historical).toMatchObject({
      state: "available",
      action: "start",
    });
    expect(remote.calls.some((call) => call.name === "get_weekly_steps")).toBe(
      false,
    );
  });
  it("retains corrupt checkpoints, permits latest only, and rejects unknown or extra action input", async () => {
    vi.useFakeTimers();
    const repo = await import("../src/lib/db/repository");
    repo.saveCheckpoint(HISTORY_CHECKPOINT, "{broken");
    const route = await import("../src/app/api/summary/route");
    expect((await (await route.GET()).json()).sync.historical.state).toBe(
      "blocked",
    );
    expect((await explicit("history")).status).toBe(409);
    expect((await explicit("unknown")).status).toBe(400);
    expect(remote.calls).toEqual([]);
    const syncRoute = await import("../src/app/api/sync/route");
    expect(
      (
        await syncRoute.POST(
          new Request("http://localhost/api/sync", {
            method: "POST",
            body: '{"intent":"latest","reset":true}',
          }),
        )
      ).status,
    ).toBe(400);
    expect((await explicit("latest")).events.at(-1).status).toBe("completed");
    expect(repo.getCheckpoint(HISTORY_CHECKPOINT)).toBe("{broken");
  });
  it("preserves actionable backlog during latest and advances it only on explicit history", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-06");
    const repo = await import("../src/lib/db/repository");
    const saved = historyState(null, "2026-09-06", "2026-09-21");
    saved.outcome = "cancelled";
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(saved));
    const bytes = repo.getCheckpoint(HISTORY_CHECKPOINT);
    const latest = (await explicit("latest")).events.at(-1);
    expect(latest.sync.historical).toMatchObject({
      state: "available",
      action: "continue",
    });
    expect(repo.getCheckpoint(HISTORY_CHECKPOINT)).toBe(bytes);
    const next = (await explicit("history")).events.at(-1);
    expect(next.history.health.nextDate).toBe("2026-09-05");
    expect(next.sync.historical.state).toBe("complete");
  });
});

describe("explicit finite limit -> automatic discovery through HTTP/NDJSON/SQLite", () => {
  async function post(intent: string) {
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        body: JSON.stringify({ intent }),
      }),
    );
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(2_000_000);
    const text = await stream;
    return {
      status: response.status,
      events: text.trim()
        ? text
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
    };
  }
  // Authored populated copy: settled pair limited to 2026-09-07, automatic now.
  async function seedSettledPair() {
    const repo = await import("../src/lib/db/repository");
    const { getDatabase } = await import("../src/lib/db/connection");
    const db = getDatabase();
    for (const [date, steps] of [
      ["2026-09-10", 5000],
      ["2026-09-08", 4000],
    ] as const)
      db.prepare(
        "insert into daily_health(date,availability,steps) values (?, 'partial', ?)",
      ).run(date, steps);
    db.prepare(
      "insert into garmin_body_weight_history(date,weight_kg,source,fetched_at) values ('2026-09-08',71,'authored-transition',1)",
    ).run();
    const history = historyState(null, "2026-09-07", "2026-09-21");
    history.outcome = "settled";
    for (const family of ["health", "body", "activities"] as const)
      history[family].nextDate = "2026-09-06";
    history.activities.windowEnd = "2026-09-06";
    history.health.checks = 14;
    history.health.checksWithMetrics = 2;
    history.health.oldestChecked = "2026-09-07";
    const discovery = {
      version: 1,
      limit: "2026-09-07",
      nextHintEnd: "2025-09-08",
      positiveDates: [],
      hint: null,
      operation: {
        phase: "settled",
        startedAt: "2026-09-20T09:00:00.000Z",
        updatedAt: "2026-09-20T09:10:00.000Z",
        attempts: 20,
        batches: 3,
        outcome: "settled",
        stopReason:
          "Chosen exploration range checked; remote boundary unknown.",
      },
    };
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(history));
    repo.saveCheckpoint(DISCOVERY_CHECKPOINT, JSON.stringify(discovery));
    repo.saveCheckpoint(
      "garmin_latest_v1",
      JSON.stringify({
        version: 1,
        outcome: "settled",
        updatedAt: "2026-09-21T08:00:00.000Z",
        activitiesProcessed: 10,
        healthDaysRefreshed: 14,
      }),
    );
    const facts = () => [
      db
        .prepare(
          "select date,availability,steps from daily_health where date in ('2026-09-10','2026-09-08') order by date",
        )
        .all(),
      db
        .prepare(
          "select date,weight_kg,source from garmin_body_weight_history order by date",
        )
        .all(),
    ];
    const pair = () => [
      repo.getCheckpoint(HISTORY_CHECKPOINT),
      repo.getCheckpoint(DISCOVERY_CHECKPOINT),
    ];
    return { repo, db, facts, pair, before: { facts: facts(), pair: pair() } };
  }
  it("summary, latest and legacy callers never transition; one explicit action continues older", async () => {
    vi.useFakeTimers();
    const { repo, db, facts, pair, before } = await seedSettledPair();
    const summary = await import("../src/app/api/summary/route");
    const initial = await (await summary.GET()).json();
    expect(initial.sync.historical).toMatchObject({
      state: "available",
      action: "discover",
      savedLimit: "2026-09-07",
      limit: null,
      remoteLowerBound: null,
    });
    expect(initial.sync.latest.healthDaysRefreshed).toBe(14);
    expect((await post("history")).status).toBe(409);
    const composition = await import("../src/lib/garmin/composition");
    await expect(
      composition.runGarminSync(undefined, { intent: "discover" }),
    ).rejects.toThrow("interactive");
    const legacy = await import("../src/app/api/sync/route");
    expect((await legacy.POST()).status).toBe(409);
    expect(remote.calls).toEqual([]);
    const latest = (await post("latest")).events.at(-1);
    expect(latest.status).toBe("completed");
    expect(latest.sync.historical.action).toBe("discover");
    expect(remote.calls.some((call) => call.name === "get_weekly_steps")).toBe(
      false,
    );
    expect(pair()).toEqual(before.pair);
    remote.calls = [];
    const discover = await post("discover");
    expect(discover.status).toBe(200);
    const result = discover.events.at(-1);
    expect(result.type).toBe("result");
    expect(["completed", "budget-limited"]).toContain(result.status);
    // Older-than-limit progress, without a recent-first history reset.
    const older = healthDates().filter((date) => date < "2026-09-07");
    expect(older[0]).toBe("2026-09-06");
    expect(
      healthDates().filter(
        (date) => date > "2026-09-07" && date < "2026-09-08",
      ),
    ).toEqual([]);
    expect(
      remote.calls.find((call) => call.name === "get_weekly_steps")?.args
        .end_date,
    ).toBe("2026-09-06");
    const saved = JSON.parse(repo.getCheckpoint(HISTORY_CHECKPOINT)!);
    expect(saved).toMatchObject({
      limit: null,
      expandedFrom: "2026-09-07",
      remoteLowerBound: null,
    });
    expect(saved.health.checks).toBeGreaterThan(14);
    expect(saved.health.nextDate < "2026-09-06").toBe(true);
    expect(
      JSON.parse(repo.getCheckpoint(DISCOVERY_CHECKPOINT)!).limit,
    ).toBeNull();
    expect(JSON.parse(repo.getCheckpoint("garmin_sync_v1")!).intent).toBe(
      "history",
    );
    expect(
      JSON.parse(repo.getCheckpoint("garmin_latest_v1")!).healthDaysRefreshed,
    ).toBe(latest.healthDaysRefreshed);
    expect(facts()[1]).toEqual(
      expect.arrayContaining(before.facts[1] as unknown[]),
    );
    expect(facts()[0]).toHaveLength(2);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const reload = await (await summary.GET()).json();
    expect(reload.sync).toEqual(result.sync);
    expect(reload.sync.historical.action).not.toBe("discover");
    // Idempotent: the transition happened once; discover is no longer admitted.
    const transitioned = pair();
    remote.calls = [];
    expect((await post("discover")).status).toBe(409);
    expect(remote.calls).toEqual([]);
    expect(pair()).toEqual(transitioned);
  });
  it("keeps a clamped activity window's query identity while paging, then widens", async () => {
    vi.useFakeTimers();
    const { repo } = await seedSettledPair();
    const history = JSON.parse(repo.getCheckpoint(HISTORY_CHECKPOINT)!);
    history.activities.nextDate = "2026-09-07";
    history.activities.windowEnd = "2026-09-07";
    history.activities.page = 1;
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(history));
    remote.pages.set(0, { activities: [], has_more: true });
    remote.pages.set(1, { activities: [], has_more: false });
    const result = (await post("discover")).events.at(-1);
    expect(["completed", "budget-limited"]).toContain(result.status);
    const windows = remote.calls
      .filter((call) => call.name === "get_activities_by_date")
      .map((call) => [
        call.args.start_date,
        call.args.end_date,
        call.args.page,
      ]);
    // Same (start, end, page) identity as the original limited query.
    expect(windows).toContainEqual(["2026-09-07", "2026-09-07", 0]);
    expect(windows).toContainEqual(["2026-09-07", "2026-09-07", 1]);
    expect(
      windows.some(
        ([start, end]) => end === "2026-09-07" && start !== "2026-09-07",
      ),
    ).toBe(false);
    // After that window completes, older windows are opened without the limit.
    expect(windows).toContainEqual(["2026-08-08", "2026-09-06", 0]);
    const saved = JSON.parse(repo.getCheckpoint(HISTORY_CHECKPOINT)!);
    expect(saved.version).toBe(1);
    expect(saved.activities.windowStart).toBeUndefined();
  });
  it("stops at the oldest data instead of crawling an empty year, and says so", async () => {
    vi.useFakeTimers();
    const { repo } = await seedSettledPair();
    // Account data starts in late July 2026; nothing before.
    remote.stepsStart = "2026-07-20";
    const result = (await post("discover")).events.at(-1);
    expect(result.status).toBe("completed");
    const steps = remote.calls.filter(
      (call) => call.name === "get_weekly_steps",
    );
    expect(steps.map((call) => call.args.end_date)).toEqual([
      "2026-09-06",
      "2025-09-07",
    ]);
    const discovery = JSON.parse(repo.getCheckpoint(DISCOVERY_CHECKPOINT)!);
    // Oldest positive week found by the first read, not a day-by-day walk.
    expect(discovery.noDataBefore).toBe(discovery.oldestPositive);
    expect(discovery.nextHintEnd).toBeNull();
    // No health/activity/body reads before the discovered start.
    expect(healthDates().every((date) => date >= discovery.noDataBefore)).toBe(
      true,
    );
    expect(
      remote.calls
        .filter((call) => call.name === "get_activities_by_date")
        .every(
          (call) => String(call.args.start_date) >= discovery.noDataBefore,
        ),
    ).toBe(true);
    const summary = await import("../src/app/api/summary/route");
    const historical = (await (await summary.GET()).json()).sync.historical;
    expect(historical).toMatchObject({
      state: "complete",
      action: null,
      noDataBefore: discovery.noDataBefore,
    });
    expect(historical.reason).toContain("No older Garmin data found before");
    remote.calls = [];
    expect((await post("history")).status).toBe(409);
    expect(remote.calls).toEqual([]);
  });
  it("stops at the oldest imported data even when the saved empty-year stop is far older", async () => {
    vi.useFakeTimers();
    const { repo } = await seedSettledPair();
    // Shape of a real stuck run: discovery recorded an empty-year stop decades
    // back while history is already automatic and crawling empty days.
    const history = JSON.parse(repo.getCheckpoint(HISTORY_CHECKPOINT)!);
    Object.assign(history, {
      limit: null,
      expandedFrom: "2026-09-07",
      outcome: "cancelled",
    });
    history.health.oldestImported = "2026-09-08";
    history.activities.oldestImported = "2026-09-08";
    repo.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(history));
    const discovery = JSON.parse(repo.getCheckpoint(DISCOVERY_CHECKPOINT)!);
    Object.assign(discovery, {
      limit: null,
      nextHintEnd: null,
      noDataBefore: "1983-07-23",
    });
    repo.saveCheckpoint(DISCOVERY_CHECKPOINT, JSON.stringify(discovery));
    const summary = await import("../src/app/api/summary/route");
    const historical = (await (await summary.GET()).json()).sync.historical;
    expect(historical).toMatchObject({
      state: "complete",
      action: null,
      noDataBefore: "2026-09-08",
    });
    expect(historical.reason).toBe(
      "No older Garmin data found before 2026-09-08.",
    );
    remote.calls = [];
    expect((await post("history")).status).toBe(409);
    expect(remote.calls).toEqual([]);
  });
  it("Cancel stops the server operation even when the response stream stays open", async () => {
    vi.useFakeTimers();
    await seedSettledPair();
    remote.stepsStart = "2000-01-01";
    const route = await import("../src/app/api/sync/route");
    const response = await route.POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        body: JSON.stringify({ intent: "discover" }),
      }),
    );
    const stream = response.text();
    await vi.advanceTimersByTimeAsync(3_000);
    const composition = await import("../src/lib/garmin/composition");
    expect(composition.isGarminSyncRunning()).toBe(true);
    expect(await (await route.DELETE()).json()).toEqual({ cancelled: true });
    await vi.advanceTimersByTimeAsync(5_000);
    const events = (await stream)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "result",
      status: "cancelled",
    });
    expect(composition.isGarminSyncRunning()).toBe(false);
    expect(await (await route.DELETE()).json()).toEqual({ cancelled: false });
  });
  it("never exposes a half-written pair when the transition commit fails", async () => {
    vi.useFakeTimers();
    const { db, pair, before } = await seedSettledPair();
    db.exec(
      "create trigger inject_t0335 before update on sync_checkpoint when new.key = 'garmin_discovery_v1' begin select raise(abort, 'injected storage failure'); end",
    );
    const failed = await post("discover");
    expect(failed.events.at(-1)).toMatchObject({
      type: "result",
      status: "failed",
    });
    expect(pair()).toEqual(before.pair);
    const summary = await import("../src/app/api/summary/route");
    expect((await (await summary.GET()).json()).sync.historical.action).toBe(
      "discover",
    );
    db.exec("drop trigger inject_t0335");
    const composition = await import("../src/lib/garmin/composition");
    expect(composition.isGarminSyncRunning()).toBe(false);
    const retry = (await post("discover")).events.at(-1);
    expect(["completed", "budget-limited"]).toContain(retry.status);
    expect(JSON.parse(pair()[0]!).limit).toBeNull();
  });
  it("cancellation after commitment settles durably and continues explicitly under automatic scope", async () => {
    vi.useFakeTimers();
    const { pair, before } = await seedSettledPair();
    const app = await import("../src/lib/garmin/composition");
    remote.cancelAt = 4;
    const run = app.runGarminSync(undefined, {
      intent: "discover",
      interactive: true,
      cancelled: () => remote.cancelled,
    });
    await vi.advanceTimersByTimeAsync(2_000_000);
    const cancelled = await run;
    expect(cancelled.status).toBe("cancelled");
    const saved = JSON.parse(pair()[0]!);
    expect(saved).toMatchObject({
      limit: null,
      expandedFrom: "2026-09-07",
      outcome: "cancelled",
    });
    expect(saved.health.checks).toBeGreaterThanOrEqual(14);
    expect(JSON.parse(pair()[1]!).limit).toBeNull();
    expect(pair()).not.toEqual(before.pair);
    // Relaunch equivalent: fresh modules read the committed automatic pair.
    vi.resetModules();
    const summary = await import("../src/app/api/summary/route");
    const after = (await (await summary.GET()).json()).sync.historical;
    expect(after).toMatchObject({
      state: "available",
      action: "continue",
      savedLimit: null,
      recovery: null,
    });
    remote.cancelAt = 0;
    remote.cancelled = false;
    remote.calls = [];
    const resumed = (await post("history")).events.at(-1);
    expect(["completed", "budget-limited"]).toContain(resumed.status);
    const continued = JSON.parse(pair()[0]!);
    // Never a reset to the recent-first fresh cursor (today - 14).
    expect(continued.health.nextDate < saved.health.nextDate).toBe(true);
    expect(continued.health.checks).toBeGreaterThan(saved.health.checks);
    expect(continued.expandedFrom).toBe("2026-09-07");
  });
});

describe("nested reader admission and in-flight termination", () => {
  it("admits every nested FIT supplement, not only the application operation", async () => {
    let attempts = 0;
    const connector = {
      start: vi.fn(async () => {}),
      close: vi.fn(),
      callTool: vi.fn(
        async () => '{"records":[{"timestamp":"2026-09-21T12:00:00Z"}]}',
      ),
    };
    const fit = {
      baseline: vi.fn(async () => undefined),
      altitude: vi.fn(async () => undefined),
      distance: vi.fn(async () => undefined),
      speed: vi.fn(async () => undefined),
    };
    const reader = createGarminReader({
      connector,
      fit,
      archive: vi.fn(),
      control: {
        admit() {
          if (attempts >= 2) throw new Error("admission limit");
          attempts += 1;
        },
        remainingMs: () => 1000,
        cancelled: () => false,
      },
    });
    await expect(reader.activityDetail("1")).rejects.toThrow("admission limit");
    expect(attempts).toBe(2);
    expect(fit.altitude).toHaveBeenCalledOnce();
    expect(fit.distance).not.toHaveBeenCalled();
    expect(fit.speed).not.toHaveBeenCalled();
    reader.close();
  });

  it("closes owned work at the in-flight deadline", async () => {
    const connector = {
      start: vi.fn(async () => {}),
      close: vi.fn(),
      callTool: vi.fn(() => new Promise<string>(() => {})),
    };
    const noop = async () => undefined;
    const reader = createGarminReader({
      connector,
      fit: { baseline: noop, altitude: noop, distance: noop, speed: noop },
      archive: vi.fn(),
      control: { admit() {}, remainingMs: () => 10, cancelled: () => false },
    });
    await expect(reader.profile()).rejects.toThrow("Sync budget reached");
    expect(connector.close).toHaveBeenCalledOnce();
  });
});
