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
      if (name === "get_weekly_steps")
        return JSON.stringify({
          end_date: args.end_date,
          weeks_requested: args.weeks,
          weeks_returned: 0,
          weekly_data: [],
        });
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
    expect(resumed.status).toBe("completed");
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
    expect(result.status).toBe("completed");
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
      status: "completed",
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
    expect(resumed.status).toBe("completed");
    const count = repo.dataCounts().healthDays;
    await app.runGarminSync();
    expect(repo.dataCounts().healthDays).toBe(count + 6);
    expect(repo.importSummary().history?.outcome).toBe("settled");
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

  it("preserves global legacy checkpoints and normalized rows across clearing/changing a limit", async () => {
    const repo = await import("../src/lib/db/repository");
    repo.saveCheckpoint("activity_page", "99");
    repo.saveCheckpoint("health_next_date", "2030-01-01");
    const app = await import("../src/lib/garmin/composition");
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "2026-09-20");
    await app.runGarminSync();
    expect(healthDates()).toEqual(["2026-09-21", "2026-09-20"]);
    vi.stubEnv("GARMIN_HISTORY_START_DATE", "");
    remote.calls = [];
    const automatic = await app.runGarminSync();
    expect(automatic.history.limit).toBeNull();
    expect(automatic.history.health.nextDate).toBe("2026-09-01");
    expect(repo.getCheckpoint("activity_page")).toBe("99");
    expect(repo.getCheckpoint("health_next_date")).toBe("2030-01-01");
    expect(repo.dataCounts().healthDays).toBe(20);
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
