import { describe, expect, it, vi } from "vitest";
import {
  buildActivityDashboardCharts,
  buildActivityDashboardRoute,
} from "../src/lib/analytics/activity-dashboard-calculations";
import {
  createLocalData,
  createLocalDataDeletion,
  type LocalDataReads,
} from "../src/lib/local-data/application";
import {
  boundedInteger,
  interpretActivityReference,
} from "../src/lib/local-data/activity-policy";
import {
  dailyHealthRefreshCutoff,
  dailyHealthTrailingCriteria,
  mergeDailyHealth,
  shiftIsoDate,
} from "../src/lib/local-data/health-policy";
import {
  storedHeartRateZoneTime,
  streamHeartRateZoneTime,
} from "../src/lib/local-data/heart-rate-policy";
import {
  interpretEffortCoverage,
  interpretHealthCoverage,
} from "../src/lib/local-data/coverage-policy";
import { buildDashboardDetail } from "../src/lib/local-data/dashboard-policy";
import {
  normalizeActivity,
  normalizeDailyHealth,
} from "../src/lib/garmin/normalize";
import type { GarminAthleteBaselineDto } from "../src/lib/garmin/types";
import type { LocalDataCounts } from "../src/lib/local-data/contracts";

const healthCoverage = interpretHealthCoverage({
  totalRows: 0,
  completeDays: 0,
  partialDays: 0,
  missingDays: 0,
  sleepDays: 0,
  restingHeartRateDays: 0,
  hrvDays: 0,
  stressDays: 0,
  stepsDays: 0,
  calorieDays: 0,
  intensityDays: 0,
  bodyBatteryDays: 0,
});
const counts: LocalDataCounts = {
  activities: 0,
  healthDays: 0,
  healthCoverage,
  detailedActivities: 0,
  detailCoverage: {
    total: 0,
    pending: 0,
    available: 0,
    partial: 0,
    unsupported: 0,
    inProgress: 0,
    retryableFailures: 0,
    preservedFailures: 0,
    terminal: 0,
  },
  activityEffortCoverage: interpretEffortCoverage({
    total: null,
    withAnyEffortField: null,
    withIntensityMinutes: 0,
    withTrainingLoad: null,
    withAnaerobicTrainingEffect: null,
    needingBackfill: null,
  }),
};
const zones: GarminAthleteBaselineDto["values"]["heartRateZones"] = {
  status: "garmin_configured",
  source: "garmin_mcp",
  formula: null,
  boundaries: [1, 2, 3, 4, 5].map((zone) => ({
    zone: zone as 1 | 2 | 3 | 4 | 5,
    label: `Zone ${zone}`,
    lowerBpm: zone * 20 + 60,
    upperBpm: zone === 5 ? null : zone * 20 + 79,
  })),
};
function fakeReads() {
  const activity = normalizeActivity({
    activityId: 1,
    activityName: "Morning",
    activityType: "walking",
    startTimeLocal: "2026-09-01T10:00:00Z",
  })!;
  const unsupported = () => {
    throw new Error("unexpected read");
  };
  const reads: LocalDataReads = {
    listActivitiesForDashboard: vi.fn(() => ({
      activities: [],
      limit: 100,
      offset: 0,
      totalApprox: 0,
      nextOffset: null,
    })),
    getActivityDashboardDetail: vi.fn(() => null),
    listRecentDailyHealth: vi.fn(() => []),
    listRecentActivities: vi.fn(() => [activity]),
    listActivitiesForComparison: vi.fn(() => [activity]),
    getActivityByGarminId: vi.fn(() => activity),
    getActivityDetailForAnalytics: vi.fn(() => ({
      activity,
      availability: null,
      session: null,
      derived: null,
      laps: [],
      stream: [],
    })),
    listActivityDetailAvailability: vi.fn(() => []),
    activityDetailCoverage: vi.fn(() => counts.detailCoverage),
    dataCounts: vi.fn(() => counts),
    importSummary: vi.fn(unsupported),
    getGarminAthleteBaseline: vi.fn(unsupported),
    getGarminBodyMetrics: vi.fn(unsupported),
  };
  return { reads, activity };
}

describe("local-data application capabilities", () => {
  it("binds without I/O and forwards bounded queries without normalizing adapter behavior", () => {
    const { reads, activity } = fakeReads();
    const app = createLocalData(reads);
    expect(reads.dataCounts).not.toHaveBeenCalled();
    const options = { query: "  %  ", limit: NaN, offset: -1 };
    app.listActivitiesForDashboard(options);
    expect(reads.listActivitiesForDashboard).toHaveBeenCalledWith(options);
    expect(app.healthDashboard()).toEqual({ days: [], latestDate: null });
    expect(reads.listRecentDailyHealth).toHaveBeenCalledWith(366);
    const days = [
      normalizeDailyHealth("2026-09-02", {}),
      normalizeDailyHealth("2026-09-01", {}),
    ];
    vi.mocked(reads.listRecentDailyHealth).mockReturnValue(days);
    expect(app.healthDashboard()).toEqual({ days, latestDate: "2026-09-02" });
    expect(
      app.verifyActivityReference({ garminId: activity.garminId }).outcome,
    ).toBe("found");
    expect(reads.listActivitiesForComparison).toHaveBeenCalledWith();
    expect(app.getActivityDashboardDetail("unknown")).toBeNull();
    expect(app.getActivityByGarminId("1")).toBe(activity);
    expect(app.getActivityDetailForAnalytics("1").stream).toEqual([]);
    expect(app.listRecentActivities(12)).toEqual([activity]);
    expect(app.listRecentDailyHealth(14)).toBe(days);
    expect(app.listActivityDetailAvailability(3)).toEqual([]);
    expect(app.activityDetailCoverage()).toBe(counts.detailCoverage);
    expect(app.dataCounts()).toBe(counts);
    expect(() => app.importSummary()).toThrow("unexpected read");
  });

  it.each(["chat-profile", "garmin-all"])(
    "dispatches %s atomically before counts, never retries or expands scope",
    (scope) => {
      const journal: string[] = [];
      const lifecycle = {
        clearChatAndProfile: () => {
          journal.push("chat");
          return ["messages", "conversations", "trainer_profile"];
        },
        clearGarminData: () => {
          journal.push("garmin");
          return ["activity"];
        },
        dataCounts: () => {
          journal.push("counts");
          return counts;
        },
      };
      const remove = createLocalDataDeletion(lifecycle);
      expect(remove("invalid")).toBeNull();
      expect(journal).toEqual([]);
      expect(remove(scope)?.counts).toBe(counts);
      expect(journal).toEqual([
        scope === "chat-profile" ? "chat" : "garmin",
        "counts",
      ]);
      journal.length = 0;
      const fail = () => {
        throw new Error("atomic failure");
      };
      const failing = createLocalDataDeletion({
        ...lifecycle,
        clearChatAndProfile: fail,
        clearGarminData: fail,
      });
      expect(() => failing(scope)).toThrow("atomic failure");
      expect(journal).toEqual([]);
    },
  );
});

describe("pure local-data interpretation", () => {
  it("merges frozen partial health with nullish precedence, retaining zero and recomputing availability", () => {
    const previous = Object.freeze({
      ...normalizeDailyHealth("2026-09-01", {}),
      steps: 42,
      calories: 22,
      sleepMinutes: 100,
    });
    const incoming = Object.freeze({
      ...normalizeDailyHealth("2026-09-01", {}),
      steps: 0,
      sleepMinutes: null,
    });
    expect(mergeDailyHealth(previous, incoming)).toMatchObject({
      steps: 0,
      calories: 22,
      sleepMinutes: 100,
      availability: "partial",
    });
    expect(previous.steps).toBe(42);
    expect(
      mergeDailyHealth(
        normalizeDailyHealth("x", {}),
        normalizeDailyHealth("x", {}),
      ).availability,
    ).toBe("missing");
  });
  it("preserves trailing date/cap behavior and explicit clock cutoff including invalid inputs", () => {
    expect(
      dailyHealthTrailingCriteria({
        startDate: "2026-01-01",
        endDate: "2026-09-21",
      }),
    ).toEqual({ startDate: "2026-09-08", safeLimit: 1000 });
    expect(
      dailyHealthTrailingCriteria({
        startDate: "2026-09-20",
        endDate: "2026-09-21",
        limit: 0,
        mutableTrailingDays: 100,
      }),
    ).toEqual({ startDate: "2026-09-20", safeLimit: 1 });
    expect(dailyHealthRefreshCutoff(86400001)).toBe(1);
    expect(shiftIsoDate("invalid", -1)).toBe("invalid");
    expect(boundedInteger(NaN, 100, 1, 100)).toBe(100);
    expect(boundedInteger(-1, 100, 1, 100)).toBe(1);
    expect(boundedInteger(4.9, 100, 1, 100)).toBe(4);
  });
  it("retains exact reference normalization, ambiguity before match cap and missing/name fallback", () => {
    const { activity } = fakeReads();
    const a = Object.freeze({
      ...activity,
      name: "  Ｍorning  walk ",
      garminId: "a",
    });
    const b = Object.freeze({
      ...activity,
      name: "Morning walk",
      garminId: "b",
    });
    const result = interpretActivityReference(
      [a, b],
      { suppliedName: "morning   walk" },
      1,
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.matches.map((x) => x.garminId)).toEqual(["a"]);
    expect(result.importedCoverage.activityCount).toBe(2);
    expect(
      interpretActivityReference([a], { date: "1900-01-01" }).outcome,
    ).toBe("not_found");
    expect(
      interpretActivityReference([], {}).importedCoverage.earliestDate,
    ).toBeNull();
    expect(
      interpretActivityReference([{ ...a, name: null }], {}).matches[0]
        .labelSource,
    ).toBe("fallback");
  });
  it("uses Garmin totals only for five rows, including zero, and preserves stream fallback edges", () => {
    const rows = zones.boundaries.map((z) => ({
      ...z,
      seconds: 0,
      sourceLowerBpm: null,
      sourceTotalSeconds: 0,
    }));
    expect(storedHeartRateZoneTime(rows.slice(0, 4), zones, 0)).toBeNull();
    expect(storedHeartRateZoneTime(rows, zones, 0)).toMatchObject({
      timeSource: "garmin_activity",
      classifiedSeconds: 0,
      sourceTotalSeconds: 0,
    });
    expect(
      streamHeartRateZoneTime([], { ...zones, status: "unavailable" }, null)
        .status,
    ).toBe("missing_zones");
    expect(streamHeartRateZoneTime([], zones, null).status).toBe(
      "missing_heart_rate",
    );
    expect(
      streamHeartRateZoneTime([{ elapsedSec: 0, heartRate: 100 }], zones, null)
        .status,
    ).toBe("insufficient_stream");
    expect(
      streamHeartRateZoneTime(
        [
          { elapsedSec: 0, heartRate: 100 },
          { elapsedSec: 0, heartRate: 120 },
        ],
        zones,
        null,
      ).status,
    ).toBe("insufficient_stream");
    const stream = [
      { elapsedSec: 0, heartRate: 100 },
      { elapsedSec: 10, heartRate: null },
      { elapsedSec: 20, heartRate: 0 },
      { elapsedSec: 30, heartRate: 140 },
    ];
    stream.forEach(Object.freeze);
    Object.freeze(stream);
    expect(streamHeartRateZoneTime(stream, zones, 30)).toMatchObject({
      classifiedSeconds: 10,
      noHeartRateSeconds: 10,
      unclassifiedSeconds: 10,
      sourceTotalSeconds: 30,
    });
  });
  it("builds dashboard availability from actual selected points/laps, not stale flags", () => {
    const { activity } = fakeReads();
    const detail = buildDashboardDetail(
      activity,
      undefined,
      buildActivityDashboardCharts([], null),
      buildActivityDashboardRoute([]),
      [],
      streamHeartRateZoneTime([], zones, null),
    );
    expect(detail.detail).toEqual({
      status: "not_requested",
      hasHeartRate: false,
      hasElevation: false,
      hasLaps: false,
      recordCount: 0,
      lapCount: 0,
      unavailableReason: null,
    });
  });
});
