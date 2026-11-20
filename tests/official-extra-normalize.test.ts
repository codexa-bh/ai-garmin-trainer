import { describe, expect, it } from "vitest";
import {
  officialActivityListExtras,
  officialDailyExtras,
  parseVo2Range,
} from "../src/lib/garmin/official-extra-normalize";
import { decodeActivityFit } from "../src/lib/garmin/official-fit";
import { buildFit, buildZip } from "./official-fit-fixture";

/** Authored Personal API shapes only; no recorded personal payloads. */
const SLEEP = {
  calendarDate: "2026-11-02",
  sleepStartTimestampGMT: Date.parse("2026-11-01T22:30:00Z"),
  sleepEndTimestampGMT: Date.parse("2026-11-02T06:15:00Z"),
  // Local = GMT + 60 minutes; the window crosses local midnight.
  sleepStartTimestampLocal: Date.parse("2026-11-01T23:30:00Z"),
  sleepEndTimestampLocal: Date.parse("2026-11-02T07:15:00Z"),
  awakeCount: 2,
  avgSleepStress: 14.5,
  avgHeartRate: 49,
  unmeasurableSleepSeconds: 0,
  sleepWindowConfirmationType: "enhanced_confirmed_final",
  sleepScoreFeedback: "NEGATIVE_POOR_STRUCTURE",
  sleepScoreInsight: "NONE",
  sleepScorePersonalizedInsight: "Free prose must be dropped",
  sleepScores: {
    overall: { value: 78, qualifierKey: "FAIR" },
    deepPercentage: {
      value: 22,
      qualifierKey: "GOOD",
      optimalStart: 16,
      optimalEnd: 33,
      idealStartInSeconds: 4464,
      idealEndInSeconds: 9207,
    },
    remPercentage: { value: 101, qualifierKey: "INVALID" },
    totalDuration: {
      qualifierKey: "GOOD",
      optimalStart: 28800,
      optimalEnd: 28800,
    },
    stress: { qualifierKey: "EXCELLENT", optimalStart: 0, optimalEnd: 15 },
    restlessness: { qualifierKey: "POOR", optimalStart: 0, optimalEnd: 5 },
  },
};

const SUMMARY = {
  calendarDate: "2026-11-02",
  bodyBattery: {
    minValue: 12,
    maxValue: 91,
    chargedValue: 62,
    drainedValue: 70,
    latestValue: 33,
    endOfDayValue: null,
    dynamicFeedbackEvent: {
      eventTimestampGmt: "2026-11-02T18:00:00.0",
      bodyBatteryLevel: "LOW",
      feedbackShortType: "DRAINING_FAST",
      feedbackLongType: "DAY_RECOVERING_AND_INACTIVE",
    },
    activityEvents: [
      {
        eventType: "SLEEP",
        eventStartTimeGmt: "2026-11-01T22:30:00.0",
        eventStartTimeLocal: "2026-11-01T23:30:00.0",
        bodyBatteryImpact: 55,
        durationInMillis: 27_900_000,
        feedbackType: "GOOD_SLEEP",
        shortFeedback: "SLEEP_RESTFUL",
        deviceId: 3_444_555,
      },
      {
        eventType: "ACTIVITY",
        eventStartTimeGmt: "2026-11-02T16:00:00.0",
        eventStartTimeLocal: "2026-11-02T17:00:00.0",
        bodyBatteryImpact: -18,
        durationInMillis: 3_600_000,
        feedbackType: "EXERCISE_TRAINING",
        shortFeedback: "HIGHLY_ACTIVE",
      },
      // Exact duplicate (same identity) collapses; no start instant is skipped.
      {
        eventType: "ACTIVITY",
        eventStartTimeGmt: "2026-11-02T16:00:00.0",
        bodyBatteryImpact: -18,
        durationInMillis: 3_600_000,
      },
      { eventType: "STRESS", bodyBatteryImpact: -4 },
    ],
  },
  stress: {
    avgLevel: 31,
    maxLevel: 96,
    qualifier: "BALANCED",
    totalDurationInMillis: 86_400_000,
    restDurationInMillis: 43_200_000,
    activityDurationInMillis: 8_640_000,
    uncategorizedDurationInMillis: 4_320_000,
    lowStressDurationInMillis: 17_280_000,
    mediumStressDurationInMillis: 8_640_000,
    highStressDurationInMillis: 4_320_000,
    restProportion: 50,
    activityProportion: 10,
    uncategorizedProportion: 5,
    lowStressProportion: 20,
    mediumStressProportion: 10,
    highStressProportion: 5,
  },
};

describe("daily extras translation", () => {
  it("maps sleep components/timing without inventing qualifier-only scores", () => {
    const extras = officialDailyExtras("2026-11-02", {
      summary: SUMMARY,
      sleep: SLEEP,
      hrv: undefined,
      vo2: [],
    });
    expect(extras.sleep?.detail).toMatchObject({
      startGmtMs: Date.parse("2026-11-01T22:30:00Z"),
      startLocal: "2026-11-01T23:30:00",
      endLocal: "2026-11-02T07:15:00",
      utcOffsetMinutes: 60,
      awakeCount: 2,
      overallScore: 78,
      overallQualifier: "FAIR",
      feedbackCode: "NEGATIVE_POOR_STRUCTURE",
      personalizedInsightCode: null,
    });
    const byName = Object.fromEntries(
      (extras.sleep?.components ?? []).map((c) => [c.component, c]),
    );
    expect(byName.deep).toMatchObject({ value: 22, idealEndSeconds: 9207 });
    // Out-of-range value is unknown, not clamped; its qualifier is retained.
    expect(byName.rem).toMatchObject({ value: null, qualifier: "INVALID" });
    for (const name of ["total_duration", "stress", "restlessness"])
      expect(byName[name].value).toBeNull();
    expect(byName.light).toBeUndefined();
    expect(extras.coverage.find((c) => c.group === "sleep")?.status).toBe(
      "populated",
    );
  });

  it("refuses inconsistent sleep timing instead of guessing a timezone", () => {
    const extras = officialDailyExtras("2026-11-02", {
      summary: undefined,
      sleep: {
        ...SLEEP,
        sleepEndTimestampGMT: Date.parse("2026-11-01T20:00:00Z"),
      },
      hrv: undefined,
      vo2: undefined,
    });
    expect(extras.sleep?.detail).toMatchObject({
      startGmtMs: null,
      startLocal: null,
      utcOffsetMinutes: null,
    });
  });

  it("keeps signed events, drops event duplicates and never fuzzy-links activities", () => {
    const extras = officialDailyExtras("2026-11-02", {
      summary: SUMMARY,
      sleep: undefined,
      hrv: undefined,
      vo2: undefined,
    });
    expect(extras.bodyBattery?.day).toMatchObject({
      minLevel: 12,
      charged: 62,
      drained: 70,
      latestLevel: 33,
      endOfDayLevel: null,
      // A non-numeric level is unknown, not invented.
      feedbackLevel: null,
      feedbackShortCode: "DRAINING_FAST",
    });
    const events = extras.bodyBattery?.events ?? [];
    expect(events.map((e) => [e.eventType, e.impact])).toEqual([
      ["SLEEP", 55],
      ["ACTIVITY", -18],
    ]);
    expect(events[1]).toMatchObject({
      durationSeconds: 3600,
      sourceActivityId: null,
    });
    // VO2 was not part of this read: no coverage claim either way.
    expect(extras.coverage.some((c) => c.group === "vo2_max")).toBe(false);
  });

  it("converts stress milliseconds to seconds and verifies the proportion scale", () => {
    const extras = officialDailyExtras("2026-11-02", {
      summary: SUMMARY,
      sleep: undefined,
      hrv: undefined,
      vo2: undefined,
    });
    expect(extras.stress).toMatchObject({
      avgLevel: 31,
      totalSeconds: 86_400,
      highSeconds: 4_320,
      activitySeconds: 8_640,
      highFraction: 0.05,
      restFraction: 0.5,
    });
    const inconsistent = officialDailyExtras("2026-11-02", {
      summary: {
        stress: { ...SUMMARY.stress, highStressProportion: 40, avgLevel: -1 },
      },
      sleep: undefined,
      hrv: undefined,
      vo2: undefined,
    });
    expect(inconsistent.stress).toMatchObject({
      avgLevel: null,
      highSeconds: 4_320,
      highFraction: null,
      lowFraction: null,
    });
  });

  it("separates source-empty, failed and populated coverage", () => {
    const empty = officialDailyExtras("2026-11-03", {
      summary: { calendarDate: "2026-11-03" },
      sleep: undefined,
      hrv: undefined,
      vo2: "failed",
    });
    expect(
      Object.fromEntries(empty.coverage.map((c) => [c.group, c.status])),
    ).toEqual({
      sleep: "empty",
      hrv: "empty",
      body_battery: "empty",
      stress: "empty",
      vo2_max: "failed",
    });
    expect(empty.vo2).toBeUndefined();
  });

  it("maps HRV weekly/baseline evidence and drops prose codes", () => {
    const extras = officialDailyExtras("2026-11-02", {
      summary: undefined,
      sleep: undefined,
      hrv: {
        calendarDate: "2026-11-02",
        weeklyAvg: 61,
        lastNightAvg: 58,
        lastNight5MinHigh: 92,
        status: "BALANCED",
        feedbackPhrase: "HRV_BALANCED_2",
        baseline: {
          lowUpper: 48,
          balancedLow: 53,
          balancedUpper: 71,
          markerValue: 0.44,
        },
      },
      vo2: undefined,
    });
    expect(extras.hrv).toEqual({
      weeklyAvgMs: 61,
      lastNight5MinHighMs: 92,
      baselineLowUpperMs: 48,
      baselineBalancedLowMs: 53,
      baselineBalancedUpperMs: 71,
      baselineMarkerValue: 0.44,
      feedbackCode: "HRV_BALANCED_2",
    });
  });
});

describe("VO2 range", () => {
  it("keeps sparse sport-aware branches without forward fill", () => {
    const readings = parseVo2Range(
      [
        {
          generic: {
            calendarDate: "2026-10-05",
            vo2MaxValue: 44,
            vo2MaxPreciseValue: 44.3,
            sport: "WALKING",
          },
          cycling: null,
        },
        {
          generic: {
            calendarDate: "2026-10-20",
            vo2MaxValue: 45,
            vo2MaxPreciseValue: 44.8,
          },
          cycling: {
            calendarDate: "2026-10-20",
            vo2MaxValue: 49,
            vo2MaxPreciseValue: 49.1,
            sport: "CYCLING",
            subSport: "ROAD",
          },
        },
        { generic: { calendarDate: "2026-10-21", vo2MaxValue: null } },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect([...readings.keys()].sort()).toEqual(["2026-10-05", "2026-10-20"]);
    expect(
      readings
        .get("2026-10-20")
        ?.map((r) => r.branch)
        .sort(),
    ).toEqual(["cycling", "generic"]);
    expect(readings.get("2026-10-05")?.[0]).toMatchObject({
      sport: "WALKING",
      vo2MaxPrecise: 44.3,
    });
  });

  it("refuses an out-of-range date as a protocol failure", () => {
    expect(() =>
      parseVo2Range(
        [{ generic: { calendarDate: "2026-12-01", vo2MaxValue: 40 } }],
        "2026-10-01",
        "2026-10-31",
      ),
    ).toThrow(/out-of-range/);
    expect(() =>
      parseVo2Range({ data: [] }, "2026-10-01", "2026-10-31"),
    ).toThrow(/list reply/);
    expect(parseVo2Range(null, "2026-10-01", "2026-10-31").size).toBe(0);
  });
});

describe("activity-list extras", () => {
  it("keeps signed delta, steps/min cadence, centimetre stride and nullable sensors", () => {
    const extras = officialActivityListExtras("7001", {
      activityId: 7001,
      differenceBodyBattery: -14,
      averageRunningCadenceInStepsPerMinute: 162.5,
      maxRunningCadenceInStepsPerMinute: 181,
      avgStrideLength: 104.2,
      maxDoubleCadence: 182,
      avgGroundContactTime: null,
    });
    expect(extras).toMatchObject({
      bodyBatteryDelta: -14,
      avgRunCadenceSpm: 162.5,
      avgStrideLengthCm: 104.2,
      maxDoubleCadenceSpm: 182,
      avgGroundContactTimeMs: null,
      avgVerticalOscillationCm: null,
      splits: null,
    });
    expect(
      Object.fromEntries(extras.coverage.map((c) => [c.group, c.status])),
    ).toEqual({
      activity_body_battery: "populated",
      running_dynamics: "populated",
      snowboard_splits: "empty",
    });
  });

  it("stores verified per-type snowboard summaries only", () => {
    const extras = officialActivityListExtras("7002", {
      differenceBodyBattery: 0,
      splitSummaries: [
        {
          splitType: "SKI_RUN_SPLIT",
          noOfSplits: 14,
          duration: 3600,
          distance: 21_000,
          averageSpeed: 5.8,
          maxSpeed: 17.1,
          elevationLoss: 3200,
          numFalls: 1,
        },
        {
          splitType: "SKI_LIFT_SPLIT",
          noOfSplits: 13,
          duration: 4200,
          totalAscent: 3150,
        },
        { splitType: "INTERVAL_ACTIVE", noOfSplits: 3 },
      ],
    });
    // True zero delta is kept, not dropped as missing.
    expect(extras.bodyBatteryDelta).toBe(0);
    expect(extras.splits?.map((s) => [s.splitType, s.count])).toEqual([
      ["SKI_RUN_SPLIT", 14],
      ["SKI_LIFT_SPLIT", 13],
    ]);
    expect(extras.splits?.[0]).toMatchObject({
      maxSpeedMps: 17.1,
      numFalls: 1,
    });
  });
});

describe("FIT lap zones and dynamics through the actual parser", () => {
  const laps = [
    {
      index: 0,
      startOffset: 0,
      cadence: 80,
      fractionalCadence128: 64,
      cycles: 500,
      stepLengthMm: 1050,
    },
    { index: 1, startOffset: 600, cadence: 82, cycles: 520 },
  ];

  it("associates lap zones by message_index with historical boundaries and below/above buckets", async () => {
    const decoded = await decodeActivityFit(
      buildZip(
        buildFit({
          laps,
          sessionCadence: { avg: 81, max: 92, fraction128: 32 },
          sessionZones: [0, 10, 20, 30, 40, 50],
          highBoundaries: [100, 115, 130, 145, 160, 175],
          // Out of file order: lap 1's message first.
          lapZoneMessages: [
            {
              reference: 1,
              seconds: [5, 1, 2, 3, 4, 5, 6],
              high: [110, 125, 140, 155, 170, 185],
              maxHr: 192,
              restingHr: 48,
              calcType: 1,
            },
            {
              reference: 0,
              seconds: [0, 7, 8, 9, 10, 11, 0],
              high: [100, 115, 130, 145, 160, 175],
            },
          ],
        }),
      ),
    );
    const { extras } = decoded;
    expect(extras.session).toMatchObject({
      avgCadenceCpm: 81.25,
      maxCadenceCpm: 92,
    });
    expect(extras.laps[0].dynamics).toMatchObject({
      avgCadenceCpm: 80.5,
      totalCycles: 500,
      avgStepLengthM: 1.05,
    });
    expect(extras.lapZoneStatus.status).toBe("populated");
    const second = extras.lapZones.find((z) => z.lapNumber === 2)!;
    expect(second).toMatchObject({
      calcMethod: "percent_max_hr",
      sourceMaxHeartRate: 192,
      sourceRestingHeartRate: 48,
    });
    expect(
      second.buckets.map((b) => [
        b.bucket,
        b.kind,
        b.zone,
        b.seconds,
        b.lowerBpm,
        b.upperBpm,
      ]),
    ).toEqual([
      [0, "below", null, 5, null, 110],
      [1, "zone", 1, 1, 110, 125],
      [2, "zone", 2, 2, 125, 140],
      [3, "zone", 3, 3, 140, 155],
      [4, "zone", 4, 4, 155, 170],
      [5, "zone", 5, 5, 170, 185],
      [6, "above", null, 6, 185, null],
    ]);
    // Session zones are unchanged and separate.
    expect(decoded.zoneSeconds).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it("makes duplicate or unknown references unavailable rather than shifting time", async () => {
    for (const lapZoneMessages of [
      [
        { reference: 0, seconds: [0, 1, 2, 3, 4, 5] },
        { reference: 0, seconds: [0, 1, 2, 3, 4, 5] },
      ],
      [{ reference: 7, seconds: [0, 1, 2, 3, 4, 5] }],
    ]) {
      const { extras } = await decodeActivityFit(
        buildZip(buildFit({ laps, lapZoneMessages })),
      );
      expect(extras.lapZones).toEqual([]);
      expect(extras.lapZoneStatus).toEqual({
        status: "unavailable",
        reason: "ambiguous-references",
      });
    }
    const none = await decodeActivityFit(buildZip(buildFit({ laps })));
    expect(none.extras.lapZoneStatus.status).toBe("empty");
  });
});
