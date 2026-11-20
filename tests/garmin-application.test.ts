type GarminImportStore =
  import("../src/lib/garmin/import-ports").GarminImportPorts["store"];
import { describe, expect, it, vi } from "vitest";
import { createGarminImports } from "../src/lib/garmin/sync-import";
import {
  FRESHNESS_CHECKPOINT,
  type LatestFreshness,
} from "../src/lib/garmin/latest-policy";
import { createGarminReader } from "./legacy-reader-double";
import {
  DISCOVERY_CHECKPOINT,
  DISCOVERY_LIMITS,
} from "../src/lib/garmin/discovery-policy";
import {
  HISTORY_CHECKPOINT,
  historyState,
} from "../src/lib/garmin/history-policy";
import type {
  GarminImportPorts,
  GarminReader,
} from "../src/lib/garmin/import-ports";
import { normalizeActivity } from "../src/lib/garmin/normalize";
import { normalizeDailyHealth } from "./legacy-normalize";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import { normalizeGarminAthleteBaseline } from "../src/lib/garmin/athlete-normalize";
import { normalizeGarminBodyMetrics } from "../src/lib/garmin/body-metrics-normalize";
import type {
  GarminAthleteBaselineDto,
  GarminBodyMetricsDto,
} from "../src/lib/garmin/types";

const now = new Date("2026-09-21T12:00:00Z");
function fixture() {
  const journal: string[] = [];
  const checkpoints = new Map<string, string>([
    ["health_next_date", "2026-09-22"],
  ]);
  const detail = normalizeActivityDetail("1", {
    records: [{ heart_rate_bpm: 140 }],
  });
  const athlete: GarminAthleteBaselineDto = {
    ...normalizeGarminAthleteBaseline({ fetchedAt: now }),
    fetchedAt: null,
    lastAttemptAt: null,
    preservedPrevious: false,
    unsupported: {
      configuredMaxHeartRate: true,
      completeHeartRateZoneBoundaries: true,
      reason: "not_exposed_by_pinned_connector",
    },
  };
  const body: GarminBodyMetricsDto = {
    ...normalizeGarminBodyMetrics({ fetchedAt: now }),
    fetchedAt: null,
    lastAttemptAt: null,
    preservedPrevious: false,
  };
  const store: GarminImportStore = {
    recordSyncRun: vi.fn(() => {
      journal.push("record:running");
      return "run";
    }),
    finishSyncRun: vi.fn((_id, status) => {
      journal.push(`finish:${status}`);
    }),
    getGarminAthleteBaseline: vi.fn(() => athlete),
    getGarminBodyMetrics: vi.fn(() => body),
    recordGarminAthleteBaselineFailure: vi.fn(),
    recordGarminBodyMetricsFailure: vi.fn(),
    writeGarminAthleteBaselineRefresh: vi.fn(() => {
      journal.push("write:athlete");
    }),
    writeGarminBodyMetricsRefresh: vi.fn(() => {
      journal.push("write:body");
    }),
    getCheckpoint: vi.fn((key) => checkpoints.get(key) ?? null),
    saveCheckpoints: vi.fn((entries) => {
      for (const [key, value] of entries) {
        journal.push(`checkpoint:${key}:${value}`);
        checkpoints.set(key, value);
      }
    }),
    upsertActivities: vi.fn((rows) => {
      journal.push("write:activities");
      return rows.length;
    }),
    listActivityIdsNeedingEffortBackfill: vi.fn(() => []),
    listRecentActivities: vi.fn(() => []),
    listStoredDailyHealthDates: vi.fn(() => []),
    listDailyHealthMissingGapDates: vi.fn(() => []),
    listDailyHealthRepairCandidateDates: vi.fn(() => []),
    listDailyHealthIntensityRepairCandidateDates: vi.fn(() => []),
    listDailyHealthTrailingCandidateDates: vi.fn(() => []),
    upsertDailyHealth: vi.fn((rows) => {
      journal.push(`write:health:${rows[0].date}`);
      return rows.length;
    }),
    listActivityIdsNeedingDetail: vi.fn(() => []),
    getDetailAvailability: vi.fn(() => null),
    recordActivityDetailAttempt: vi.fn((input) => {
      journal.push(`attempt:${input.status}`);
    }),
    upsertActivityDetail: vi.fn(() => {
      journal.push("write:detail");
    }),
    upsertActivityHrZoneTime: vi.fn(),
    dataCounts: vi.fn(() => ({
      activities: 99,
      healthCoverage: {
        totalRows: 50,
        completeDays: 40,
        partialDays: 8,
        missingDays: 2,
        metrics: {
          sleepDays: 40,
          restingHeartRateDays: 40,
          hrvDays: 40,
          stressDays: 40,
          stepsDays: 40,
          calorieDays: 40,
          intensityDays: 40,
          bodyBatteryDays: 40,
        },
      },
      detailCoverage: {
        total: 99,
        pending: 1,
        available: 98,
        partial: 0,
        unsupported: 0,
        retryableFailures: 0,
        preservedFailures: 0,
        inProgress: 0,
        terminal: 98,
      },
    })),
  };
  const reader: GarminReader = {
    start: vi.fn(async () => {
      journal.push("start");
    }),
    close: vi.fn(() => {
      journal.push("close");
    }),
    profile: vi.fn(async () => {
      journal.push("profile");
      return {};
    }),
    cyclingFtp: vi.fn(async () => {
      journal.push("ftp");
      return {};
    }),
    bodyComposition: vi.fn(async () => {
      journal.push("body");
      return {};
    }),
    weighIns: vi.fn(async () => {
      journal.push("weigh");
      return {};
    }),
    activityPage: vi.fn(async (_start, _end, page) => {
      journal.push(`page:${page}`);
      return { activities: [], hasMore: false };
    }),
    activityEffort: vi.fn(async () => null),
    fitBaseline: vi.fn(async () => {
      journal.push("fit:baseline");
      return null;
    }),
    dailyHealth: vi.fn(async (date) => {
      journal.push(`health:${date}`);
      return normalizeDailyHealth(date, {});
    }),
    activityDetail: vi.fn(async () => {
      journal.push("read:detail");
      return { recognized: true, detail };
    }),
    activityHrZoneTime: vi.fn(async () => {
      journal.push("read:zones");
      return null;
    }),
  };
  const ports: GarminImportPorts = {
    store,
    createReader: vi.fn(() => {
      journal.push("create");
      return reader;
    }),
    historyStartDate: vi.fn(() => {
      journal.push("config");
      return "2026-09-19";
    }),
    clock: vi.fn(() => {
      journal.push("clock");
      return now;
    }),
  };
  const app = createGarminImports(ports);
  return { app, store, reader, ports, journal, checkpoints, detail };
}

function operationFixture() {
  const f = fixture();
  let milliseconds = now.getTime();
  let cancelled = false;
  let nextFailure = "";
  const calls: Array<{
    name: string;
    args: Record<string, unknown>;
    at: number;
  }> = [];
  const dates = new Set<string>();
  f.ports.clock = () => new Date(milliseconds);
  f.ports.wait = async (delay) => {
    milliseconds += delay;
  };
  f.ports.historyStartDate = () => "2026-07-01";
  vi.mocked(f.store.listDailyHealthMissingGapDates).mockImplementation(
    ({ startDate, endDate }) =>
      startDate === endDate && !dates.has(startDate) ? [startDate] : [],
  );
  vi.mocked(f.store.upsertDailyHealth).mockImplementation((rows) => {
    for (const row of rows) dates.add(row.date);
    return rows.length;
  });
  f.ports.createReader = (control) =>
    createGarminReader({
      control,
      archive: () => {},
      connector: {
        start: async () => {},
        close: () => {},
        callTool: async (name, args) => {
          calls.push({ name, args, at: milliseconds });
          if (nextFailure) throw new Error(nextFailure);
          if (name === "get_weekly_steps")
            // Long history: one positive week per year keeps discovery open.
            return JSON.stringify({
              end_date: args.end_date,
              weeks_requested: args.weeks,
              weeks_returned: 1,
              weekly_data: [{ week_start: args.end_date, days_with_data: 1 }],
            });
          if (name === "get_activities_by_date")
            return '{"activities":[],"has_more":false}';
          if (name === "get_body_battery") return "[]";
          return "{}";
        },
      },
      fit: {
        baseline: async () => undefined,
        altitude: async () => undefined,
        distance: async () => undefined,
        speed: async () => undefined,
      },
    });
  const app = createGarminImports({
    ...f.ports,
    historyStartDate: () => f.ports.historyStartDate(),
    wait: (ms) => f.ports.wait!(ms),
  });
  return {
    ...f,
    app,
    calls,
    dates,
    cancelled: () => cancelled,
    cancel: () => {
      cancelled = true;
    },
    advance: (ms: number) => {
      milliseconds += ms;
    },
    fail: () => {
      nextFailure = "rate limit";
    },
  };
}

function latestFixture() {
  const f = fixture();
  const stored = new Set<string>(["2026-01-01", "2026-09-19"]);
  vi.mocked(f.store.listStoredDailyHealthDates).mockImplementation(() => [
    ...stored,
  ]);
  vi.mocked(f.store.upsertDailyHealth).mockImplementation((days) => {
    for (const day of days) stored.add(day.date);
    return days.length;
  });
  f.reader.primaryUpload = vi.fn(async () => ({
    kind: "known" as const,
    primaryId: "watch",
    uploadedAt: "2026-09-21T10:00:00.000Z",
  }));
  const read = () =>
    JSON.parse(f.checkpoints.get(FRESHNESS_CHECKPOINT)!) as LatestFreshness;
  const run = () =>
    createGarminImports(f.ports).runGarminSync(undefined, { intent: "latest" });
  return { ...f, stored, read, run };
}

describe("durable latest finality and supplements", () => {
  it("finalizes partial/empty ended days only after normalized writes and skips them across restart", async () => {
    const f = latestFixture();
    expect((await f.run()).healthDaysRefreshed).toBe(3);
    expect(f.read().days["2026-01-01"]).toEqual({
      final: true,
      source: "legacy",
    });
    expect(f.read().days["2026-09-19"]).toMatchObject({
      final: true,
      source: "download",
      primaryId: "watch",
    });
    expect(f.read().days["2026-09-21"].final).toBe(false);
    vi.mocked(f.reader.dailyHealth).mockClear();
    expect((await f.run()).healthDaysRefreshed).toBe(1);
    expect(f.reader.dailyHealth).toHaveBeenCalledExactlyOnceWith("2026-09-21");
    expect(
      f.store.listDailyHealthTrailingCandidateDates,
    ).not.toHaveBeenCalled();
    expect(f.reader.activityPage).toHaveBeenLastCalledWith(
      "2026-09-19",
      "2026-09-21",
      0,
    );
    expect(f.checkpoints.has(HISTORY_CHECKPOINT)).toBe(false);
  });
  it("retains all unknown/delayed days, then reads them after new primary evidence instead of finalizing an old download", async () => {
    const f = latestFixture();
    f.reader.primaryUpload = vi.fn(async () => ({
      kind: "unknown" as const,
      reason: "ambiguous-primary" as const,
    }));
    expect((await f.run()).detail).toContain("ambiguous-primary");
    expect((await f.run()).healthDaysRefreshed).toBe(3);
    expect(f.read().days["2026-09-19"].final).toBe(false);
    f.reader.primaryUpload = vi.fn(async () => ({
      kind: "known" as const,
      primaryId: "replacement",
      uploadedAt: "2026-09-20T10:00:00.000Z",
    }));
    expect((await f.run()).healthDaysRefreshed).toBe(3);
    expect(f.read().days["2026-09-19"]).toMatchObject({
      final: true,
      primaryId: "replacement",
    });
    expect(f.read().days["2026-09-20"].final).toBe(false);
    expect((await f.run()).healthDaysRefreshed).toBe(2);
  });
  it.each(["read", "write", "cancel"])(
    "never finalizes a failed %s",
    async (failure) => {
      const f = latestFixture();
      if (failure === "read")
        vi.mocked(f.reader.dailyHealth).mockRejectedValue(
          new Error("malformed health"),
        );
      if (failure === "write")
        vi.mocked(f.store.upsertDailyHealth).mockImplementation(() => {
          throw new Error("storage failed");
        });
      let cancelled = false;
      if (failure === "cancel")
        vi.mocked(f.reader.dailyHealth).mockImplementation(async (date) => {
          cancelled = true;
          return normalizeDailyHealth(date, {});
        });
      const result = await f.app.runGarminSync(undefined, {
        intent: "latest",
        cancelled: () => cancelled,
      });
      expect(result.status).not.toBe("completed");
      expect(f.read().days["2026-09-19"]).toBeUndefined();
      expect(f.read().days["2026-09-21"]).toBeUndefined();
    },
  );
  it("persists matched last-used interval evidence only after storage, reports a fixed source label and fails closed inside the possible upload second", async () => {
    const f = latestFixture();
    const interval = (second: string) => ({
      kind: "known" as const,
      primaryId: "watch",
      uploadedAt: new Date(Date.parse(second)).toISOString(),
      uploadedThrough: new Date(Date.parse(second) + 999).toISOString(),
      via: "last-used" as const,
    });
    f.reader.primaryUpload = vi.fn(async () =>
      interval("2026-09-21T11:59:59Z"),
    );
    // The download instant (fixture clock 12:00:00Z) lies after the interval.
    const messages: string[] = [];
    await f.app.runGarminSync((event) => messages.push(event.message), {
      intent: "latest",
    });
    expect(f.reader.primaryUpload).toHaveBeenCalledOnce();
    expect(f.read().days["2026-09-19"]).toMatchObject({
      final: true,
      uploadedAt: "2026-09-21T11:59:59.000Z",
      uploadedThrough: "2026-09-21T11:59:59.999Z",
    });
    expect(messages.join("\n")).toContain("matching last-used device record");
    expect(messages.join("\n")).not.toContain("watch");
    // A possible upload instant at/after download keeps every date mutable.
    const g = latestFixture();
    g.reader.primaryUpload = vi.fn(async () => ({
      ...interval("2026-09-21T11:59:59Z"),
      uploadedThrough: "2026-09-21T12:00:00.000Z",
    }));
    await g.run();
    expect(g.read().days["2026-09-19"].final).toBe(false);
  });
  it("replays durable data after a crash before freshness commits", async () => {
    const f = latestFixture();
    const save = f.store.saveCheckpoints;
    vi.mocked(f.store.saveCheckpoints).mockImplementation((entries) => {
      if (f.stored.has("2026-09-21"))
        throw new Error("interrupted metadata storage");
      for (const [key, value] of entries) f.checkpoints.set(key, value);
    });
    await expect(f.run()).rejects.toThrow("interrupted metadata storage");
    expect(f.stored.has("2026-09-21")).toBe(true);
    expect(f.read().days["2026-09-21"]).toBeUndefined();
    vi.mocked(save).mockImplementation((entries) => {
      for (const [key, value] of entries) f.checkpoints.set(key, value);
    });
    expect((await f.run()).healthDaysRefreshed).toBe(3);
  });
  it("shares profile/body reads, persists failed daily attempts, skips empty activity FIT and permits a new local day", async () => {
    const f = latestFixture();
    await f.run();
    await f.run();
    expect(f.reader.profile).toHaveBeenCalledTimes(1);
    expect(f.reader.cyclingFtp).toHaveBeenCalledTimes(1);
    expect(f.reader.fitBaseline).not.toHaveBeenCalled();
    expect(f.reader.bodyComposition).toHaveBeenCalledTimes(2);
    expect(f.reader.weighIns).toHaveBeenCalledTimes(2);
    f.ports.clock = () => new Date("2026-09-22T12:00:00Z");
    vi.mocked(f.reader.profile).mockRejectedValue(new Error("profile failed"));
    vi.mocked(f.reader.cyclingFtp).mockRejectedValue(new Error("ftp failed"));
    await f.run();
    await f.run();
    expect(f.reader.profile).toHaveBeenCalledTimes(2);
    expect(f.reader.cyclingFtp).toHaveBeenCalledTimes(2);
    expect(f.read()).toMatchObject({
      profileDay: "2026-09-22",
      ftpDay: "2026-09-22",
    });
    expect(f.store.recordGarminAthleteBaselineFailure).toHaveBeenCalled();
  });
  it("records only applicable successful FIT identity, retries failure and never re-reads same-day profile/FTP for new FIT", async () => {
    const f = latestFixture();
    let newest = "1";
    vi.mocked(f.store.listRecentActivities).mockImplementation(() => [
      { garminId: newest },
    ]);
    vi.mocked(f.reader.fitBaseline)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ zones_target: {} })
      .mockResolvedValue({ zones_target: { max_heart_rate: 190 } });
    await f.run();
    expect(f.read().fitActivity).toBeNull();
    await f.run();
    expect(f.read().fitActivity).toBeNull();
    await f.run();
    expect(f.read().fitActivity).toBe("1");
    await f.run();
    expect(f.reader.fitBaseline).toHaveBeenCalledTimes(3);
    newest = "2";
    await f.run();
    expect(f.read().fitActivity).toBe("2");
    expect(f.reader.profile).toHaveBeenCalledTimes(1);
    expect(f.reader.cyclingFtp).toHaveBeenCalledTimes(1);
    expect(f.store.writeGarminAthleteBaselineRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({ preserveAttempt: true }),
    );
  });
});

function pendingDetails(f: ReturnType<typeof fixture>, count: number) {
  const pending = new Set(
    Array.from({ length: count }, (_, index) => String(index + 1)),
  );
  vi.mocked(f.store.listActivityIdsNeedingDetail).mockImplementation(() => [
    ...pending,
  ]);
  vi.mocked(f.store.upsertActivityDetail).mockImplementation((detail) => {
    pending.delete(detail.garminId);
  });
  vi.mocked(f.reader.activityDetail).mockImplementation(async (id) => {
    f.journal.push("read:detail");
    return {
      recognized: true,
      detail: normalizeActivityDetail(id, {
        records: [{ heart_rate_bpm: 140 }],
      }),
    };
  });
  return pending;
}

describe("required detail exhaustion and truthful settlement", () => {
  it.each([0, 3, 501, 5001])(
    "drains %i known candidates without a selection quota or duplicate terminal fetch",
    async (count) => {
      const f = fixture();
      pendingDetails(f, count);
      const events: Array<
        Parameters<
          import("../src/lib/garmin/import-contracts").ProgressReporter
        >[0]
      > = [];
      const result = await f.app.runGarminSync((event) => events.push(event), {
        intent: "latest",
      });
      expect(result).toMatchObject({
        status: "completed",
        detailsAttempted: count,
        detailsProcessed: count,
        detailsFailed: 0,
        detailsRemaining: 0,
        stopReason: null,
      });
      expect(f.reader.activityDetail).toHaveBeenCalledTimes(count);
      expect(events.at(-1)?.stage).toBe("completed");
      expect(f.app.syncSummary().sync.operation).toMatchObject({
        outcome: "settled",
        detailsProcessed: count,
        detailsRemaining: 0,
      });
    },
  );

  it("continues latest across pre-dispatch internal batches without artificial pacing under one adapter/claim/clock", async () => {
    const f = operationFixture();
    pendingDetails(f, 55);
    const result = await f.app.runGarminSync(undefined, {
      intent: "latest",
      interactive: true,
    });
    expect(result).toMatchObject({
      status: "completed",
      detailsAttempted: 55,
      detailsProcessed: 55,
      detailsRemaining: 0,
    });
    expect(f.calls.length).toBeGreaterThan(96);
    expect(f.calls.length).toBeLessThanOrEqual(DISCOVERY_LIMITS.operations);
    expect(
      f.calls.slice(1).every((call, index) => call.at === f.calls[index].at),
    ).toBe(true);
  });

  it("keeps cumulative admission across detail batches and persists exact incomplete truth", async () => {
    const f = operationFixture();
    pendingDetails(f, 501);
    const stages: string[] = [];
    const result = await f.app.runGarminSync(
      (event) => stages.push(event.stage),
      { intent: "latest", interactive: true },
    );
    expect(result.status).toBe("budget-limited");
    expect(result.stopReason).toBe("attempt-limit");
    expect(result.detailsRemaining).toBeGreaterThan(0);
    expect(f.calls).toHaveLength(DISCOVERY_LIMITS.operations);
    expect(stages.at(-1)).toBe("budget-limited");
    expect(f.app.syncSummary().sync.operation).toMatchObject({
      outcome: "budget-limited",
      stopReason: result.stopReason,
      detailsProcessed: result.detailsProcessed,
      detailsRemaining: result.detailsRemaining,
    });
    expect(f.store.finishSyncRun).toHaveBeenLastCalledWith(
      "run",
      "budget-limited",
      expect.any(String),
    );
  });

  it("reports an overall deadline after committed detail without relabelling it completed", async () => {
    const f = operationFixture();
    const pending = pendingDetails(f, 3);
    vi.mocked(f.store.upsertActivityDetail).mockImplementation((detail) => {
      pending.delete(detail.garminId);
      f.advance(DISCOVERY_LIMITS.milliseconds);
    });
    const result = await f.app.runGarminSync(undefined, {
      intent: "latest",
      interactive: true,
    });
    expect(result).toMatchObject({
      status: "budget-limited",
      stopReason: "operation-deadline",
      detailsProcessed: 1,
      detailsRemaining: 2,
    });
  });

  it("admits details inserted by later historical pages in the same operation", async () => {
    const f = fixture();
    const pending = pendingDetails(f, 2);
    vi.mocked(f.reader.activityPage).mockImplementation(
      async (_start, _end) => {
        if (_end < "2026-09-08") pending.add("later");
        return { activities: [], hasMore: false };
      },
    );
    vi.mocked(f.ports.historyStartDate).mockReturnValue("2026-09-01");
    const result = await f.app.runGarminSync(undefined, { intent: "history" });
    expect(result.detailsProcessed).toBe(3);
    expect(result.detailsRemaining).toBe(0);
    expect(f.reader.activityDetail).toHaveBeenCalledWith("later");
  });

  it("stops on returned failure without counting it as completed or spinning", async () => {
    const f = fixture();
    pendingDetails(f, 3);
    vi.mocked(f.reader.activityDetail).mockRejectedValue(
      new Error(
        "Garmin connection or service is unavailable; authentication validity is inconclusive.",
      ),
    );
    const events: string[] = [];
    const result = await f.app.runGarminSync(
      (event) => events.push(event.stage),
      { intent: "latest" },
    );
    expect(result).toMatchObject({
      status: "failed",
      detailsAttempted: 1,
      detailsProcessed: 0,
      detailsFailed: 1,
      detailsRemaining: 3,
      stopReason: "detail-failure",
    });
    expect(f.store.upsertActivityDetail).not.toHaveBeenCalled();
    expect(f.reader.activityDetail).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toBe("failed");
    expect(f.app.syncSummary().sync.operation).toMatchObject({
      outcome: "failed",
      detailsRemaining: 3,
    });
  });

  it("retains committed detail on cancellation and never emits completed", async () => {
    const f = fixture();
    const pending = pendingDetails(f, 3);
    const events: string[] = [];
    const result = await f.app.runGarminSync(
      (event) => events.push(event.stage),
      { intent: "latest", cancelled: () => pending.size < 3 },
    );
    expect(result).toMatchObject({
      status: "cancelled",
      detailsProcessed: 1,
      detailsRemaining: 2,
      stopReason: "cancelled",
    });
    expect(events.at(-1)).toBe("cancelled");
    expect(f.store.finishSyncRun).toHaveBeenLastCalledWith(
      "run",
      "cancelled",
      expect.any(String),
    );
  });

  it("stops a non-removing store as no progress and preserves unsupported operation bytes", async () => {
    const f = fixture();
    vi.mocked(f.store.listActivityIdsNeedingDetail).mockReturnValue(["1"]);
    expect(
      await f.app.runGarminSync(undefined, { intent: "latest" }),
    ).toMatchObject({
      status: "failed",
      stopReason: "no-progress",
      detailsRemaining: 1,
    });
    f.checkpoints.set("garmin_sync_v1", '{"version":99}');
    expect(f.app.syncSummary().sync).toMatchObject({
      operation: null,
      operationInvalid: true,
    });
    await expect(
      f.app.runGarminSync(undefined, { intent: "latest" }),
    ).rejects.toThrow("Unsupported sync operation");
    expect(f.checkpoints.get("garmin_sync_v1")).toBe('{"version":99}');
  });
});

describe("interactive ownership, safety and comparative request cost", () => {
  it("amortizes common work compared with repeated bounded callers over the same sparse three-year-old checkpoint", async () => {
    const automatic = operationFixture();
    const manual = operationFixture();
    for (const f of [automatic, manual]) {
      f.ports.historyStartDate = () => "2023-07-01";
      const saved = historyState(null, "2023-07-01", "2023-09-21");
      f.checkpoints.set(HISTORY_CHECKPOINT, JSON.stringify(saved));
    }
    const one = await automatic.app.runGarminSync(undefined, {
      interactive: true,
    });
    let repeated = await manual.app.runGarminSync();
    let invocations = 1;
    while (repeated.continuationAvailable && invocations < 20) {
      repeated = await manual.app.runGarminSync();
      invocations += 1;
    }
    expect(one.status).toBe("completed");
    expect(repeated.continuationAvailable).toBe(false);
    expect(invocations).toBeGreaterThan(10);
    expect(automatic.dates).toEqual(manual.dates);
    expect(one.history.health.nextDate).toBe(repeated.history.health.nextDate);
    expect(automatic.calls.length).toBeLessThan(manual.calls.length);
    expect(
      automatic.calls.filter((call) => call.name === "get_user_profile"),
    ).toHaveLength(1);
    expect(
      manual.calls.filter((call) => call.name === "get_user_profile").length,
    ).toBeGreaterThan(10);
    for (let index = 1; index < automatic.calls.length; index += 1)
      expect(
        automatic.calls[index].at - automatic.calls[index - 1].at,
      ).toBeGreaterThanOrEqual(DISCOVERY_LIMITS.dispatchIntervalMs);
    expect(one.discovery?.operation?.batches).toBeGreaterThan(10);
  });
  it("keeps the original deadline across batches, startup and waits", async () => {
    const f = operationFixture();
    f.ports.historyStartDate = () => undefined;
    const result = await f.app.runGarminSync(
      (event) => {
        if (event.message.includes("continuing within the same operation"))
          f.advance(DISCOVERY_LIMITS.milliseconds);
      },
      { interactive: true },
    );
    expect(result.status).toBe("budget-limited");
    expect(result.discovery?.operation?.attempts).toBeLessThan(480);
    expect(
      Date.parse(result.discovery!.operation!.updatedAt) -
        Date.parse(result.discovery!.operation!.startedAt),
    ).toBeGreaterThanOrEqual(DISCOVERY_LIMITS.milliseconds);
  });
  it("retains exclusivity at inter-batch boundaries and cancellation settles before release", async () => {
    const f = operationFixture();
    let overlap: Promise<unknown> | undefined;
    const result = await f.app.runGarminSync(
      (event) => {
        if (event.message.includes("continuing within the same operation")) {
          expect(f.app.isSyncRunning()).toBe(true);
          overlap = f.app.runGarminSync().catch((error: unknown) => error);
          f.cancel();
        }
      },
      { interactive: true, cancelled: f.cancelled },
    );
    expect(result.status).toBe("cancelled");
    expect(await overlap).toBeInstanceOf(Error);
    expect(
      JSON.parse(f.checkpoints.get(DISCOVERY_CHECKPOINT)!).operation.outcome,
    ).toBe("cancelled");
    expect(f.app.isSyncRunning()).toBe(false);
  });
  it("does not bypass a swallowed baseline error or retry it within the operation", async () => {
    const f = operationFixture();
    const result = await f.app.runGarminSync(
      (event) => {
        if (event.stage === "body_metrics") f.fail();
      },
      { interactive: true },
    );
    expect(result.status).toBe("failed");
    expect(result.discovery?.operation?.batches).toBe(0);
    expect(
      f.calls.filter((call) => call.name === "get_user_profile"),
    ).toHaveLength(1);
    expect(
      f.calls.filter((call) => call.name === "get_body_composition"),
    ).toHaveLength(0);
  });
  it("rotates families when slow health consumes an internal batch instead of starving body/activity", async () => {
    const f = operationFixture();
    f.ports.historyStartDate = () => undefined;
    const result = await f.app.runGarminSync(
      (event) => {
        if (event.date && event.date < "2026-09-08") f.advance(110_000);
      },
      { interactive: true },
    );
    expect(result.status).toBe("budget-limited");
    expect(result.history.body.checks).toBeGreaterThan(1);
    expect(result.history.activities.checks).toBeGreaterThan(1);
    expect(result.history.health.checks).toBeGreaterThan(1);
  });
  it("stops a repeated unresolved candidate with no safe progress instead of spinning", async () => {
    const f = operationFixture();
    const saved = historyState(null, "2026-07-01", "2026-09-21");
    saved.health.nextDate =
      saved.activities.nextDate =
      saved.body.nextDate =
        null;
    saved.unresolvedHealth = ["2027-01-01"];
    f.checkpoints.set(HISTORY_CHECKPOINT, JSON.stringify(saved));
    const result = await f.app.runGarminSync(undefined, { interactive: true });
    expect(result.status).toBe("failed");
    expect(result.discovery?.operation?.batches).toBe(1);
    expect(result.discovery?.operation?.stopReason).toContain(
      "no forward progress",
    );
    expect(result.history.unresolvedHealth).toEqual(["2027-01-01"]);
  });
  it("does not mistake repair rotation for useful progress and persists recovery-only eligibility", async () => {
    const f = fixture();
    f.ports.historyStartDate = () => "2026-07-01";
    f.ports.wait = async () => {};
    const saved = historyState(null, "2026-07-01", "2026-09-21");
    saved.health.nextDate =
      saved.body.nextDate =
      saved.activities.nextDate =
        null;
    saved.outcome = "cancelled";
    f.checkpoints.set(HISTORY_CHECKPOINT, JSON.stringify(saved));
    vi.mocked(f.store.listDailyHealthRepairCandidateDates).mockReturnValue([
      "2026-07-02",
      "2026-07-03",
    ]);
    const app = createGarminImports(f.ports);
    const result = await app.runGarminSync(undefined, {
      interactive: true,
      intent: "history",
    });
    expect(result.status).toBe("failed");
    expect(result.history?.recoveryReason).toBe("no-progress");
    expect(result.discovery?.operation?.batches).toBe(1);
    expect(result.sync.historical).toMatchObject({
      state: "blocked",
      action: null,
    });
    expect(app.syncSummary().sync).toEqual(result.sync);
    const create = vi.mocked(f.ports.createReader).mock.calls.length;
    await expect(
      app.runGarminSync(undefined, { interactive: true, intent: "history" }),
    ).rejects.toThrow("not actionable");
    expect(vi.mocked(f.ports.createReader).mock.calls).toHaveLength(create);
  });
  it("refuses unsupported additive state without changing original bytes or constructing a reader", async () => {
    const f = operationFixture();
    const bytes = '{"version":99}';
    f.checkpoints.set(DISCOVERY_CHECKPOINT, bytes);
    await expect(
      f.app.runGarminSync(undefined, { interactive: true }),
    ).rejects.toThrow("preserve");
    expect(f.checkpoints.get(DISCOVERY_CHECKPOINT)).toBe(bytes);
    expect(f.calls).toEqual([]);
  });
});

describe("Garmin imports with supplied capabilities, no infrastructure mocks", () => {
  it("binds lazily and preserves sync config/clock, write, checkpoint, event and close order", async () => {
    const f = fixture();
    expect(f.journal).toEqual([]);
    const activity = normalizeActivity({
      activityId: "1",
      activityType: "running",
      startTimeLocal: "2026-09-20T12:00:00",
    });
    vi.mocked(f.reader.activityPage).mockImplementation(
      async (_start, _end, page) => {
        f.journal.push(`page:${page}`);
        return {
          activities: page === 0 ? [activity] : [],
          hasMore: page === 0,
        };
      },
    );
    pendingDetails(f, 1);
    f.checkpoints.set("health_next_date", "2026-09-21");
    vi.mocked(f.store.listDailyHealthMissingGapDates).mockReturnValue([
      "2026-09-19",
    ]);
    vi.mocked(f.store.listDailyHealthRepairCandidateDates).mockReturnValue([
      "2026-09-19",
    ]);
    vi.mocked(f.store.listDailyHealthTrailingCandidateDates).mockReturnValue([
      "2026-09-21",
    ]);
    const result = await f.app.runGarminSync((event) => {
      f.journal.push(`event:${event.stage}`);
    });
    expect(f.journal.indexOf("record:running")).toBeLessThan(
      f.journal.indexOf("create"),
    );
    expect(f.journal.indexOf("health:2026-09-21")).toBeLessThan(
      f.journal.indexOf("page:0"),
    );
    expect(f.journal.indexOf("write:body")).toBeLessThan(
      f.journal.indexOf("read:detail"),
    );
    expect(
      vi.mocked(f.reader.dailyHealth).mock.calls.map(([date]) => date),
    ).toEqual(["2026-09-21", "2026-09-20", "2026-09-19"]);
    expect(f.journal.at(-1)).toBe("event:completed");
    expect(f.reader.close).toHaveBeenCalledOnce();
    const savedKeys = vi
      .mocked(f.store.saveCheckpoints)
      .mock.calls.flatMap(([entries]) => entries.map(([key]) => key));
    expect(savedKeys).not.toContain("activity_page");
    expect(savedKeys).not.toContain("health_next_date");
    expect(result).toMatchObject({
      status: "completed",
      activitiesImported: 1,
      activitiesProcessed: 1,
      healthDaysImported: 3,
      healthDaysRefreshed: 3,
      detailsProcessed: 1,
      storedActivities: 99,
      storedHealthRows: 50,
    });
    expect(f.store.listActivityIdsNeedingEffortBackfill).toHaveBeenCalledWith(
      1,
    );
    expect(f.store.listRecentActivities).toHaveBeenCalledWith(1);
    expect(f.store.writeGarminAthleteBaselineRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ attemptedAt: now }),
    );
  });

  it("uses range-bound nonsequential pages, retains unresolved health and never adopts old global cursors", async () => {
    const f = fixture();
    vi.mocked(f.ports.historyStartDate).mockReturnValue(undefined);
    f.checkpoints.set("activity_page", "3");
    f.checkpoints.set("health_next_date", "2026-09-20");
    const saved = historyState(null, null, "2026-09-21");
    saved.activities.page = 0;
    f.checkpoints.set(HISTORY_CHECKPOINT, JSON.stringify(saved));
    vi.mocked(f.reader.activityPage)
      .mockResolvedValueOnce({ activities: [], hasMore: false })
      .mockResolvedValueOnce({ activities: [], hasMore: true, nextPage: 9 })
      .mockResolvedValueOnce({ activities: [], hasMore: false });
    vi.mocked(f.reader.dailyHealth).mockRejectedValueOnce(
      new Error("private source error"),
    );
    const result = await f.app.runGarminSync();
    expect(f.reader.activityPage).toHaveBeenNthCalledWith(
      2,
      "2026-08-09",
      "2026-09-07",
      0,
    );
    expect(f.reader.activityPage).toHaveBeenNthCalledWith(
      3,
      "2026-08-09",
      "2026-09-07",
      9,
    );
    expect(result.status).toBe("failed");
    expect(result.history.unresolvedHealth).toContain("2026-09-21");
    expect(result.detail).not.toContain("private source error");
    expect(f.checkpoints.get("activity_page")).toBe("3");
    expect(f.checkpoints.get("health_next_date")).toBe("2026-09-20");
    expect(result.history.activities.windowEnd).toBe("2026-08-08");
    expect(f.reader.close).toHaveBeenCalledOnce();
  });

  it("retains distinct startup failures for sync, effort and targeted detail", async () => {
    for (const operation of ["sync", "effort", "detail"]) {
      const f = fixture();
      vi.mocked(f.reader.start).mockRejectedValue(new Error("startup"));
      if (operation === "sync")
        expect(await f.app.runGarminSync()).toMatchObject({
          status: "failed",
          detail: expect.stringContaining("connection or storage failure"),
        });
      if (operation === "effort")
        expect(await f.app.backfillActivityEffortFields()).toMatchObject({
          status: "failed",
          detail: "startup",
          updated: 0,
        });
      if (operation === "detail")
        await expect(f.app.backfillActivityDetail("1")).rejects.toThrow(
          "startup",
        );
      expect(f.reader.close).toHaveBeenCalledExactlyOnceWith();
      expect(f.store.recordActivityDetailAttempt).not.toHaveBeenCalled();
    }
  });

  it("does not move initial storage reads inside try/finally", async () => {
    const f = fixture();
    vi.mocked(f.store.getGarminAthleteBaseline).mockImplementation(() => {
      throw new Error("initial store");
    });
    await expect(f.app.runGarminSync()).rejects.toThrow("initial store");
    expect(f.ports.createReader).toHaveBeenCalledOnce();
    expect(f.reader.start).not.toHaveBeenCalled();
    expect(f.reader.close).not.toHaveBeenCalled();
    expect(f.store.finishSyncRun).not.toHaveBeenCalled();
  });

  it("retains progress exception propagation, even after successful writes", async () => {
    const f = fixture();
    const events: string[] = [];
    await expect(
      f.app.runGarminSync((event) => {
        events.push(event.stage);
        if (event.stage === "completed" || event.stage === "failed")
          throw new Error(event.stage);
      }),
    ).rejects.toThrow("completed");
    expect(events.at(-1)).toBe("completed");
    expect(
      vi.mocked(f.store.finishSyncRun).mock.calls.map((args) => args[1]),
    ).toEqual(["completed"]);
    expect(f.reader.close).toHaveBeenCalledOnce();
  });

  it("counts only successful effort writes, defaults to 100 and reports remaining as a bounded existence count", async () => {
    const f = fixture();
    vi.mocked(f.store.listActivityIdsNeedingEffortBackfill)
      .mockReturnValueOnce(["1", "2", "3"])
      .mockReturnValueOnce(["2"]);
    vi.mocked(f.reader.activityEffort)
      .mockResolvedValueOnce(
        normalizeActivity({
          activityId: "1",
          activityType: "running",
          startTimeLocal: "2026-09-21T08:00:00",
        }),
      )
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(null);
    expect(await f.app.backfillActivityEffortFields()).toMatchObject({
      status: "completed",
      attempted: 3,
      updated: 1,
      remaining: 1,
    });
    expect(
      f.store.listActivityIdsNeedingEffortBackfill,
    ).toHaveBeenNthCalledWith(1, 100);
    expect(
      f.store.listActivityIdsNeedingEffortBackfill,
    ).toHaveBeenNthCalledWith(2, 1);
  });

  it.each(["available", "partial"] as const)(
    "preserves previous %s detail on stable unsupported failure",
    async (status) => {
      const f = fixture();
      vi.mocked(f.store.getDetailAvailability).mockReturnValue({
        ...f.detail,
        status,
      });
      vi.mocked(f.reader.activityDetail).mockRejectedValue(
        new Error("No FIT available"),
      );
      expect(
        await f.app.backfillActivityDetail("1", { force: true }),
      ).toMatchObject({
        status: "failed",
        preservedPrevious: true,
        retryable: false,
        recordCount: f.detail.recordCount,
      });
      expect(f.store.upsertActivityDetail).not.toHaveBeenCalled();
      expect(f.store.recordActivityDetailAttempt).toHaveBeenLastCalledWith(
        expect.objectContaining({
          force: true,
          status: "failed",
          errorClass: "unsupported",
          preservedPrevious: true,
        }),
      );
      expect(f.reader.close).toHaveBeenCalledOnce();
    },
  );

  it("records unsupported only without usable previous detail, and leaves retryable failures unwritten", async () => {
    for (const message of ["unsupported", "timeout"]) {
      const f = fixture();
      vi.mocked(f.reader.activityDetail).mockRejectedValue(new Error(message));
      const result = await f.app.backfillActivityDetail("1");
      expect(result.retryable).toBe(message === "timeout");
      expect(f.store.upsertActivityDetail).toHaveBeenCalledTimes(
        message === "unsupported" ? 1 : 0,
      );
    }
  });

  it("keeps HR-zone failure best effort and lets synchronous close errors propagate", async () => {
    const f = fixture();
    vi.mocked(f.reader.activityHrZoneTime).mockRejectedValue(
      new Error("endpoint unavailable"),
    );
    expect(await f.app.backfillActivityDetail("1")).toMatchObject({
      status: "completed",
      preservedPrevious: false,
    });
    expect(f.journal.indexOf("write:detail")).toBeLessThan(
      f.journal.indexOf("attempt:succeeded"),
    );
    vi.mocked(f.reader.close).mockImplementation(() => {
      throw new Error("close failed");
    });
    await expect(f.app.backfillActivityDetail("1")).rejects.toThrow(
      "close failed",
    );
  });

  it("retains unsupported-payload completion rather than attempting HR-zone reads", async () => {
    const f = fixture();
    vi.mocked(f.reader.activityDetail).mockResolvedValue({
      recognized: false,
      detail: { ...f.detail, status: "unsupported" },
    });
    expect(await f.app.backfillActivityDetail("1")).toMatchObject({
      status: "completed",
      detailStatus: "unsupported",
      recordCount: 0,
    });
    expect(f.reader.activityHrZoneTime).not.toHaveBeenCalled();
  });
});
