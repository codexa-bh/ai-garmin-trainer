import { describe, expect, it, vi } from "vitest";
import { createGarminImports } from "../src/lib/garmin/sync-import";
import {
  HISTORY_CHECKPOINT,
  historyState,
} from "../src/lib/garmin/history-policy";
import type {
  GarminImportPorts,
  GarminImportStore,
  GarminReader,
} from "../src/lib/garmin/import-ports";
import {
  normalizeActivity,
  normalizeDailyHealth,
} from "../src/lib/garmin/normalize";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import { normalizeGarminAthleteBaseline } from "../src/lib/garmin/athlete-normalize";
import { normalizeGarminBodyMetrics } from "../src/lib/garmin/body-metrics-normalize";
import type {
  GarminAthleteBaselineDto,
  GarminBodyMetricsDto,
} from "../src/lib/garmin/types";
import {
  classifyDetailError,
  dailyHealthImportPlan,
} from "../src/lib/garmin/import-policy";

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
    saveCheckpoint: vi.fn((key, value) => {
      journal.push(`checkpoint:${key}:${value}`);
      checkpoints.set(key, value);
    }),
    upsertActivities: vi.fn((rows) => {
      journal.push("write:activities");
      return rows.length;
    }),
    listActivityIdsNeedingEffortBackfill: vi.fn(() => []),
    listRecentActivities: vi.fn(() => []),
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
    vi.mocked(f.store.listActivityIdsNeedingDetail).mockReturnValue(["1"]);
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
    expect(f.store.saveCheckpoint).not.toHaveBeenCalledWith(
      "activity_page",
      expect.anything(),
    );
    expect(f.store.saveCheckpoint).not.toHaveBeenCalledWith(
      "health_next_date",
      expect.anything(),
    );
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
          detail: expect.stringContaining("connector or storage failure"),
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

  it("bounds and deduplicates health planning without advancing a completed historical cursor", () => {
    expect(
      dailyHealthImportPlan({
        historyStartDate: "2026-09-19",
        resumeDate: "2026-09-22",
        endDate: "2026-09-21",
        repairDates: ["2026-09-18", "2026-09-20", "2026-09-20"],
        trailingDates: ["2026-09-20", "2026-09-21", "2026-09-22"],
      }),
    ).toMatchObject({
      dates: ["2026-09-20", "2026-09-21"],
      checkpointDates: [],
    });
    expect(classifyDetailError(new Error("auth unavailable"))).toMatchObject({
      errorClass: "auth",
      retryable: false,
    });
    expect(
      classifyDetailError(new Error("x".repeat(2000))).message,
    ).toHaveLength(1000);
  });
});
