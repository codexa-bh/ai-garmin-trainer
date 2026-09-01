import { describe, expect, it } from "vitest";
import { assertReadOperation } from "../src/lib/garmin/client";
import { normalizeGarminAthleteBaseline } from "../src/lib/garmin/athlete-normalize";
import { normalizeGarminBodyMetrics } from "../src/lib/garmin/body-metrics-normalize";
import { normalizeActivityHrZoneTime } from "../src/lib/garmin/activity-hr-zone-time";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import {
  activityDetailNeedsAltitudeSupplement,
  mergeFitAltitudeRecords,
} from "../src/lib/garmin/fit-altitude";
import {
  activityDetailNeedsDistanceSupplement,
  mergeFitDistanceRecords,
} from "../src/lib/garmin/fit-distance";
import {
  activityDetailNeedsSpeedSupplement,
  mergeFitSpeedRecords,
} from "../src/lib/garmin/fit-speed";
import {
  normalizeActivity,
  normalizeDailyHealth,
} from "../src/lib/garmin/normalize";
import {
  syncActivitiesToExhaustion,
  syncDailyHealthRange,
  type FitnessStore,
} from "../src/lib/garmin/sync";

class MemoryStore implements FitnessStore {
  checkpoints = new Map<string, string>();
  activities = new Set<string>();
  days = new Set<string>();
  async upsertActivities(items: { garminId: string }[]) {
    items.forEach((item) => this.activities.add(item.garminId));
    return items.length;
  }
  async upsertDailyHealth(items: { date: string }[]) {
    items.forEach((item) => this.days.add(item.date));
    return items.length;
  }
  async saveCheckpoint(key: string, value: string) {
    this.checkpoints.set(key, value);
  }
  async getCheckpoint(key: string) {
    return this.checkpoints.get(key) ?? null;
  }
}

describe("Garmin boundary", () => {
  it("allows only reviewed read operations", () => {
    expect(() => assertReadOperation("list_activities")).not.toThrow();
    expect(() => assertReadOperation("get_activity_fit_data")).not.toThrow();
    expect(() => assertReadOperation("get_user_profile")).not.toThrow();
    expect(() => assertReadOperation("get_cycling_ftp")).not.toThrow();
    expect(() => assertReadOperation("get_body_composition")).not.toThrow();
    expect(() => assertReadOperation("get_weigh_ins")).not.toThrow();
    expect(() => assertReadOperation("download_activity_file")).toThrow(
      /Blocked/,
    );
    expect(() => assertReadOperation("set_user_profile")).toThrow(/Blocked/);
    expect(() => assertReadOperation("delete_activity")).toThrow(/Blocked/);
    expect(() => assertReadOperation("add_weigh_in")).toThrow(/Blocked/);
    expect(() => assertReadOperation("delete_weigh_ins")).toThrow(/Blocked/);
  });

  it("normalizes athlete baseline facts and excludes unsupported profile fields", () => {
    const normalized = normalizeGarminAthleteBaseline({
      profilePayload: {
        userData: {
          lactateThresholdHeartRate: 169,
          lactateThresholdHeartRateCycling: "172",
          lactateThresholdHeartRateRowing: -1,
          vo2MaxRunning: 51.23,
          vo2MaxCycling: Number.NaN,
          availableTrainingDays: ["MONDAY", "wed", "Bogus", "monday"],
          preferredLongTrainingDays: ["Sunday", "fri"],
          birthDate: "1980-01-01",
          gender: "private",
          weight: 70,
        },
      },
      fitPayload: { zones_target: { max_heart_rate: 190 } },
      ftpPayload: {
        functional_threshold_power_watts: 255,
        calendar_date: "2026-07-19",
        is_stale: true,
        sport: "cycling",
      },
      fetchedAt: new Date("2026-07-20T08:00:00Z"),
    });

    expect(normalized.availability).toBe("complete");
    expect(normalized.values).toMatchObject({
      configuredMaxHeartRateBpm: 190,
      heartRateZones: {
        status: "derived_from_garmin_max_hr",
        boundaries: [
          { zone: 1, label: "Zone 1", lowerBpm: 95, upperBpm: 113 },
          { zone: 2, label: "Zone 2", lowerBpm: 114, upperBpm: 132 },
          { zone: 3, label: "Zone 3", lowerBpm: 133, upperBpm: 151 },
          { zone: 4, label: "Zone 4", lowerBpm: 152, upperBpm: 170 },
          { zone: 5, label: "Zone 5", lowerBpm: 171, upperBpm: null },
        ],
      },
      cyclingFtpWatts: 255,
      cyclingFtpMeasuredOn: "2026-07-19",
      cyclingFtpSourceStale: true,
      availableTrainingDays: ["monday", "wednesday"],
      preferredLongTrainingDays: ["friday", "sunday"],
    });
    expect(JSON.stringify(normalized)).not.toContain(
      "lactateThresholdHeartRate",
    );
    expect(JSON.stringify(normalized)).not.toContain("vo2MaxRunning");
    expect(JSON.stringify(normalized)).not.toContain("birthDate");
    expect(JSON.stringify(normalized)).not.toContain("gender");
    expect(JSON.stringify(normalized)).not.toContain("weight");
  });

  it("normalizes accepted Garmin body metrics while excluding forbidden profile fields", () => {
    const normalized = normalizeGarminBodyMetrics({
      profilePayload: {
        userData: {
          weight: 70.25,
          height: 181,
          birthDate: "1980-01-01",
          gender: "private",
          weatherLocation: "private",
          email: "private@example.invalid",
        },
      },
      historyPayload: {
        dateWeightList: [
          { date: "2026-08-10", weight: 70.4, bodyFat: 20 },
          { calendarDate: "2026-08-11", weight: "70.2" },
          { date: "2026-08-12", weight: 0 },
        ],
        totalAverage: { weight: 70.3, bodyFat: 20, bmi: 22 },
      },
      fetchedAt: new Date("2026-08-12T08:00:00Z"),
    });

    expect(normalized).toMatchObject({
      availability: "complete",
      values: { weightKg: 70.25, heightCm: 181 },
      history: {
        availability: "available",
        rangeStart: "2026-08-10",
        rangeEnd: "2026-08-11",
        count: 2,
      },
    });
    expect(normalized.historyRows).toHaveLength(2);
    expect(JSON.stringify(normalized)).not.toContain("birthDate");
    expect(JSON.stringify(normalized)).not.toContain("gender");
    expect(JSON.stringify(normalized)).not.toContain("weatherLocation");
    expect(JSON.stringify(normalized)).not.toContain("bodyFat");
    expect(JSON.stringify(normalized)).not.toContain("bmi");
  });

  it("normalizes Garmin weigh-ins into history with the latest weigh-in as current weight", () => {
    const normalized = normalizeGarminBodyMetrics({
      profilePayload: { userData: { height: 181 } },
      weighInPayload: {
        date_range: { start: "2026-08-01", end: "2026-08-17" },
        measurement_count: 2,
        measurements: [
          { date: "2026-08-10", weight_kg: 70.4, source_type: "SCALE" },
          {
            date: "2026-08-15",
            weight_kg: 70.2,
            weight_grams: 70200,
            source_type: "MANUAL",
            timestamp_gmt: 1755273600,
          },
        ],
      },
      fetchedAt: new Date("2026-08-17T08:00:00Z"),
    });

    expect(normalized).toMatchObject({
      availability: "complete",
      values: { weightKg: 70.2, heightCm: 181 },
      currentWeightSource: "weigh_in",
      weighInAvailability: "available",
      history: {
        availability: "available",
        source: "weigh_in",
        rangeStart: "2026-08-10",
        rangeEnd: "2026-08-15",
        count: 2,
      },
    });
    expect(normalized.historyRows.map((row) => row.date)).toEqual([
      "2026-08-10",
      "2026-08-15",
    ]);
    expect(JSON.stringify(normalized)).not.toContain("source_type");
    expect(JSON.stringify(normalized)).not.toContain("weight_grams");
    expect(JSON.stringify(normalized)).not.toContain("timestamp_gmt");
    expect(JSON.stringify(normalized)).not.toContain("measurement_count");
  });

  it("rejects implausible/malformed/non-finite weigh-in values and rows without dates", () => {
    const normalized = normalizeGarminBodyMetrics({
      profilePayload: { userData: { height: 181 } },
      weighInPayload: {
        measurements: [
          { date: "2026-08-10", weight_kg: 70.4 },
          { date: "2026-08-11", weight_kg: 0 },
          { date: "2026-08-12", weight_kg: -70 },
          { date: "2026-08-13", weight_kg: 450 },
          { date: "2026-08-14", weight_kg: Number.NaN },
          { date: "not-a-date", weight_kg: 70 },
          { weight_kg: 71 },
          { date: "2026-08-16", weight_grams: 70100 },
        ],
      },
      fetchedAt: new Date("2026-08-17T08:00:00Z"),
    });

    expect(normalized.historyRows).toHaveLength(2);
    expect(normalized.historyRows.map((row) => row.date)).toEqual([
      "2026-08-10",
      "2026-08-16",
    ]);
    expect(normalized.historyRows[1]?.weightKg).toBe(70.1);
  });

  it("gives weigh-in rows deterministic priority over body-composition rows on date overlap", () => {
    const normalized = normalizeGarminBodyMetrics({
      profilePayload: { userData: { height: 181 } },
      historyPayload: {
        dateWeightList: [
          { date: "2026-08-10", weight: 70.4 },
          { date: "2026-08-12", weight: 71.0 },
        ],
      },
      weighInPayload: {
        measurements: [
          { date: "2026-08-10", weight_kg: 69.9 },
          { date: "2026-08-11", weight_kg: 70.0 },
        ],
      },
      fetchedAt: new Date("2026-08-17T08:00:00Z"),
    });

    expect(
      normalized.historyRows.map((row) => [row.date, row.weightKg]),
    ).toEqual([
      ["2026-08-10", 69.9],
      ["2026-08-11", 70.0],
      ["2026-08-12", 71.0],
    ]);
    expect(normalized.history).toMatchObject({
      availability: "available",
      source: "mixed",
      count: 3,
    });
    // Latest row is body-composition here; weigh-in-wins only applies to
    // current weight when weigh-in rows exist.
    expect(normalized.values.weightKg).toBe(70.0);
    expect(normalized.currentWeightSource).toBe("weigh_in");
  });

  it("falls back to profile weight only when no weigh-in rows exist", () => {
    const profileOnly = normalizeGarminBodyMetrics({
      profilePayload: { userData: { weight: 70.25, height: 181 } },
      historyPayload: {
        dateWeightList: [{ date: "2026-08-10", weight: 70.4 }],
      },
      fetchedAt: new Date("2026-08-17T08:00:00Z"),
    });
    expect(profileOnly).toMatchObject({
      values: { weightKg: 70.25, heightCm: 181 },
      currentWeightSource: "profile",
      weighInAvailability: "unavailable",
      history: {
        availability: "available",
        source: "body_composition",
        count: 1,
      },
    });

    const noWeightAtAll = normalizeGarminBodyMetrics({
      profilePayload: { userData: { height: 181 } },
      weighInPayload: { measurements: [] },
      fetchedAt: new Date("2026-08-17T08:00:00Z"),
    });
    expect(noWeightAtAll).toMatchObject({
      values: { weightKg: null, heightCm: 181 },
      currentWeightSource: null,
      weighInAvailability: "unavailable",
      history: { availability: "unavailable", source: null, count: 0 },
    });
  });

  it("marks history failed when weigh-in refresh fails and no rows exist", () => {
    const normalized = normalizeGarminBodyMetrics({
      profilePayload: { userData: { height: 181 } },
      historyPayload: { dateWeightList: [] },
      weighInFailed: true,
      fetchedAt: new Date("2026-08-17T08:00:00Z"),
    });
    expect(normalized).toMatchObject({
      availability: "partial",
      weighInAvailability: "failed",
      history: { availability: "failed", source: null, count: 0 },
      values: { weightKg: null, heightCm: 181 },
    });
  });

  it("treats all-null athlete baseline payloads as unavailable without estimating max HR", () => {
    const normalized = normalizeGarminAthleteBaseline({
      profilePayload: { userData: { lactateThresholdHeartRate: null } },
      ftpPayload: { functional_threshold_power_watts: 0, sport: "cycling" },
    });

    expect(normalized.availability).toBe("unavailable");
    expect(normalized.values.cyclingFtpWatts).toBeNull();
    expect(JSON.stringify(normalized)).not.toContain("maxHeartRate");
  });

  it("normalizes activity and explicit missing health data", () => {
    expect(
      normalizeActivity({
        activityId: 123,
        activityType: { typeKey: "running" },
        startTimeLocal: "2026-07-01T07:00:00",
        duration: 1800,
      }).sport,
    ).toBe("running");
    expect(normalizeDailyHealth("2026-07-01", {}).availability).toBe("missing");
  });

  it("normalizes source-proven Garmin sleep score and stage durations fail-closed", () => {
    expect(
      normalizeDailyHealth("2026-07-01", {
        sleep: {
          sleep_seconds: 28800,
          sleep_score: 87.4,
          deep_sleep_seconds: 5400,
          light_sleep_seconds: 16200,
          rem_sleep_seconds: 6000,
          awake_seconds: 1200,
          nap_seconds: 0,
        },
      }),
    ).toMatchObject({
      sleepMinutes: 480,
      sleepScore: 87,
      sleepDeepMinutes: 90,
      sleepLightMinutes: 270,
      sleepRemMinutes: 100,
      sleepAwakeMinutes: 20,
      sleepNapMinutes: 0,
      availability: "partial",
    });

    expect(
      normalizeDailyHealth("2026-07-01", {
        sleep: {
          sleep_seconds: -1,
          sleep_score: 120,
          deep_sleep_seconds: Number.NaN,
          light_sleep_seconds: -30,
          rem_sleep_seconds: "3600",
          awake_seconds: Infinity,
          nap_seconds: null,
        },
      }),
    ).toMatchObject({
      sleepMinutes: null,
      sleepScore: null,
      sleepDeepMinutes: null,
      sleepLightMinutes: null,
      sleepRemMinutes: null,
      sleepAwakeMinutes: null,
      sleepNapMinutes: null,
      availability: "missing",
    });
  });

  it("normalizes Garmin Connect daily sleep, stats, and body-battery payload aliases", () => {
    expect(
      normalizeDailyHealth("2026-08-24", {
        stats: {
          totalSteps: 8400,
          wellnessTotalKilocalories: 2350,
          activeKilocalories: 720,
          bmrKilocalories: 1630,
          moderateIntensityMinutes: 24,
          vigorousIntensityMinutes: 8,
          restingHeartRate: 47,
          averageStressLevel: 21,
        },
        sleep: {
          dailySleepDTO: {
            sleepTimeSeconds: 26820,
            deepSleepSeconds: 5400,
            lightSleepSeconds: 14400,
            remSleepSeconds: 6000,
            awakeSleepSeconds: 1020,
            avgOvernightHrv: 63,
          },
        },
        bodyBattery: {
          bodyBatteryValuesArray: [
            ["2026-08-24T06:30:00.000", 79],
            ["2026-08-24T21:30:00.000", 42],
          ],
        },
      }),
    ).toMatchObject({
      availability: "complete",
      sleepMinutes: 447,
      sleepDeepMinutes: 90,
      sleepLightMinutes: 240,
      sleepRemMinutes: 100,
      sleepAwakeMinutes: 17,
      restingHeartRate: 47,
      hrvMs: 63,
      stressAvg: 21,
      steps: 8400,
      totalCalories: 2350,
      activeCalories: 720,
      restingCalories: 1630,
      intensityMinutes: 32,
      bodyBatteryMorning: 79,
      bodyBatteryEvening: 42,
    });
  });

  it("normalizes proven Garmin activity effort fields fail-closed", () => {
    const base = {
      activityId: 123,
      activityType: { typeKey: "running" },
      startTimeLocal: "2026-07-01T07:00:00",
    };

    expect(
      normalizeActivity({
        id: 123,
        type: "running",
        start_time_local: "2026-07-01T07:00:00",
        training_effect: 3.4,
        anaerobic_training_effect: 1.2,
        training_effect_label: "  Tempo benefit  ",
        training_load: 88,
        moderate_intensity_minutes: 12,
        vigorous_intensity_minutes: 4,
      }),
    ).toMatchObject({
      trainingEffect: 3.4,
      anaerobicTrainingEffect: 1.2,
      trainingEffectLabel: "Tempo benefit",
      trainingLoad: 88,
      moderateIntensityMinutes: 12,
      vigorousIntensityMinutes: 4,
      totalIntensityMinutes: 16,
    });

    expect(
      normalizeActivity({
        ...base,
        training_effect: -1,
        anaerobic_training_effect: Number.NaN,
        training_effect_label: " ",
        training_load: Number.POSITIVE_INFINITY,
        moderate_intensity_minutes: -2,
        vigorous_intensity_minutes: "4" as unknown as number,
      }),
    ).toMatchObject({
      trainingEffect: null,
      anaerobicTrainingEffect: null,
      trainingEffectLabel: null,
      trainingLoad: null,
      moderateIntensityMinutes: null,
      vigorousIntensityMinutes: null,
      totalIntensityMinutes: null,
    });
  });

  it("normalizes source activity names safely", () => {
    const base = {
      activityId: 123,
      activityType: { typeKey: "running" },
      startTimeLocal: "2026-07-01T07:00:00",
    };

    expect(
      normalizeActivity({
        ...base,
        activityName: "  Jutranji tek — Rožnik  ",
        name: "Fallback name",
      }).name,
    ).toBe("Jutranji tek — Rožnik");
    expect(
      normalizeActivity({ ...base, activityName: " ", name: "Bike" }).name,
    ).toBe("Bike");
    expect(normalizeActivity({ ...base, activityName: "\t\n" }).name).toBe(
      null,
    );
    expect(
      normalizeActivity({ ...base, name: "  Élan / Šmarna gora  " }).name,
    ).toBe("Élan / Šmarna gora");
  });

  it("normalizes detailed FIT parser payloads without retaining raw data", () => {
    const detail = normalizeActivityDetail("42", {
      session: { avg_heart_rate_bpm: 140, total_ascent_m: 220 },
      laps: [{ lap_number: 1, total_elapsed_time_s: 600 }],
      records: [
        {
          timestamp: "2026-07-01T07:00:00Z",
          heart_rate_bpm: 130,
          distance: 12.5,
          speed_mps: 2.5,
          altitude_m: 1000,
          grade_pct: 6,
          lat_deg: 46.1,
          lon_deg: 13.8,
        },
        {
          timestamp: "2026-07-01T07:00:01Z",
          distance_meters: 13.5,
          heart_rate_bpm: 131,
          altitude: 1001,
        },
        {
          timestamp: "2026-07-01T07:00:02Z",
          distance_meters: -1,
          heart_rate_bpm: 132,
          enhanced_altitude: 1002,
        },
      ],
      climbs: [{ elevation_gain_m: 80 }],
    });
    expect(detail.status).toBe("available");
    expect(detail.hasStreams).toBe(true);
    expect(detail.hasGps).toBe(true);
    expect(detail.hasElevation).toBe(true);
    expect(detail.hasHeartRate).toBe(true);
    expect(detail.recordCount).toBe(3);
    expect(detail.stream.map((point) => point.elapsedSec)).toEqual([0, 1, 2]);
    expect(detail.stream.map((point) => point.distanceMeters)).toEqual([
      12.5,
      13.5,
      null,
    ]);
    expect(detail.stream.map((point) => point.altitudeMeters)).toEqual([
      1000, 1001, 1002,
    ]);
    expect(JSON.stringify(detail)).not.toContain("garmin_tokens");
  });

  it("normalizes true stream speed fields without accepting fallback speed sources", () => {
    const detail = normalizeActivityDetail("51", {
      session: { avg_speed_mps: 9.9 },
      laps: [{ lap_number: 1, avg_speed_mps: 8.8, averageSpeed: 7.7 }],
      records: [
        { elapsed_time_s: 0, speed_mps: 0 },
        { elapsed_time_s: 1, enhanced_speed: 2.5 },
        { elapsed_time_s: 2, speed: 3.25 },
        { elapsed_time_s: 3, speed_mps: -1, enhanced_speed: Number.NaN },
        { elapsed_time_s: 4, averageSpeed: 4.5, avg_speed_mps: 4.5 },
      ],
    });

    expect(detail.stream.map((point) => point.speedMps)).toEqual([
      0,
      2.5,
      3.25,
      null,
      null,
    ]);
  });

  it("preserves zero and near-zero measured stream speeds during movement", () => {
    const detail = normalizeActivityDetail("54", {
      records: [
        { elapsed_time_s: 0, distance: 0, speed_mps: 1.5 },
        { elapsed_time_s: 10, distance: 6, speed_mps: 0 },
        { elapsed_time_s: 20, distance: 12, enhanced_speed: 0.03 },
        { elapsed_time_s: 30, distance: 18, speed: 1.5 },
      ],
    });

    expect(detail.stream.map((point) => point.distanceMeters)).toEqual([
      0, 6, 12, 18,
    ]);
    expect(detail.stream.map((point) => point.speedMps)).toEqual([
      1.5, 0, 0.03, 1.5,
    ]);
  });

  it("preserves zero stream speeds for true pauses and ambiguous stop boundaries", () => {
    const detail = normalizeActivityDetail("55", {
      records: [
        { elapsed_time_s: 0, distance: 0, speed_mps: 2 },
        { elapsed_time_s: 10, distance: 5, speed_mps: 0 },
        { elapsed_time_s: 20, distance: 5, speed_mps: 0 },
        { elapsed_time_s: 30, distance: 5, speed_mps: 0 },
      ],
    });

    expect(detail.stream.map((point) => point.speedMps)).toEqual([2, 0, 0, 0]);
  });

  it("uses real FIT elapsed seconds before timestamp and array-index fallback", () => {
    const detail = normalizeActivityDetail("46", {
      records: [
        {
          elapsed_time_s: 0,
          timestamp: "2026-08-01T07:00:00Z",
          heart_rate_bpm: 130,
        },
        {
          elapsed_time_s: 60,
          timestamp: "2026-08-01T07:05:00Z",
          heart_rate_bpm: 136,
        },
        { timestamp: "2026-08-01T07:10:00Z", heart_rate_bpm: 140 },
        { elapsed_time_s: -5, heart_rate_bpm: 145 },
      ],
    });

    expect(detail.stream.map((point) => point.elapsedSec)).toEqual([
      0, 60, 600, 3,
    ]);
  });

  it("derives stream elapsed seconds from timestamps when explicit elapsed is absent", () => {
    const detail = normalizeActivityDetail("47", {
      records: [
        { timestamp: "2026-08-01T07:00:00Z", heart_rate_bpm: 130 },
        { timestamp: "2026-08-01T07:15:00Z", heart_rate_bpm: 136 },
        { timestamp: "2026-08-01T07:30:00Z", heart_rate_bpm: 140 },
      ],
    });

    expect(detail.stream.map((point) => point.elapsedSec)).toEqual([
      0, 900, 1800,
    ]);
  });

  it("normalizes Garmin activity HR-zone time payload shape fail-closed", () => {
    expect(
      normalizeActivityHrZoneTime("42", [
        { zoneNumber: 1, secsInZone: 120, zoneLowBoundary: 95 },
        { zoneNumber: 2, secsInZone: 240, zoneLowBoundary: 114 },
        { zoneNumber: 3, secsInZone: 360, zoneLowBoundary: 133 },
        { zoneNumber: 4, secsInZone: 480, zoneLowBoundary: 152 },
        { zoneNumber: 5, secsInZone: 60, zoneLowBoundary: 171 },
      ]),
    ).toMatchObject({
      source: "garmin_mcp",
      status: "available",
      sourceTotalSeconds: 1260,
      buckets: expect.arrayContaining([
        { zone: 5, seconds: 60, sourceLowerBpm: 171 },
      ]),
    });
    expect(
      normalizeActivityHrZoneTime("42", [
        { zoneNumber: 1, secsInZone: 120, zoneLowBoundary: 95 },
        { zoneNumber: 1, secsInZone: 240, zoneLowBoundary: 114 },
      ]),
    ).toBeNull();
    expect(
      normalizeActivityHrZoneTime("42", [
        { zoneNumber: 1, secsInZone: -1, zoneLowBoundary: 95 },
      ]),
    ).toBeNull();
  });

  it("merges true FIT enhanced altitude records by timestamp before normalization", () => {
    const connectorPayload = {
      records: [
        { timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 130 },
        { timestamp: "2026-07-01T07:00:01Z", heart_rate_bpm: 131 },
      ],
    };

    expect(activityDetailNeedsAltitudeSupplement(connectorPayload)).toBe(true);
    const merged = mergeFitAltitudeRecords(connectorPayload, {
      source: "garmin-fit-altitude-stream",
      records: [
        { timestamp: "2026-07-01T07:00:00Z", enhanced_altitude: 1000.5 },
        { timestamp: "2026-07-01T07:00:01Z", enhanced_altitude: 1001.25 },
      ],
    });

    const detail = normalizeActivityDetail("44", merged);
    expect(detail.hasElevation).toBe(true);
    expect(detail.stream.map((point) => point.altitudeMeters)).toEqual([
      1000.5, 1001.25,
    ]);
  });

  it("does not merge FIT altitude when timestamps do not match connector records", () => {
    const connectorPayload = {
      records: [{ timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 130 }],
    };

    const merged = mergeFitAltitudeRecords(connectorPayload, {
      records: [
        { timestamp: "2026-07-01T07:00:01Z", enhanced_altitude: 1001.25 },
      ],
    });

    const detail = normalizeActivityDetail("45", merged);
    expect(detail.stream[0].altitudeMeters).toBeNull();
  });

  it("merges true FIT cumulative distance records by unique timestamp before normalization", () => {
    const connectorPayload = {
      records: [
        {
          timestamp: "2026-07-01T07:00:00Z",
          heart_rate_bpm: 130,
          lat_deg: 46.1,
          lon_deg: 13.8,
        },
        {
          timestamp: "2026-07-01T07:00:01Z",
          heart_rate_bpm: 131,
          speed_mps: 2.5,
        },
      ],
    };

    expect(activityDetailNeedsDistanceSupplement(connectorPayload)).toBe(true);
    const merged = mergeFitDistanceRecords(connectorPayload, {
      source: "garmin-fit-distance-stream",
      records: [
        { timestamp: "2026-07-01T07:00:00Z", distance_meters: 0 },
        { timestamp: "2026-07-01T07:00:01Z", distance_meters: 2.5 },
      ],
    });

    const detail = normalizeActivityDetail("48", merged);
    expect(detail.stream.map((point) => point.distanceMeters)).toEqual([
      0, 2.5,
    ]);
  });

  it("does not merge FIT distance when timestamp identity is ambiguous or absent", () => {
    const connectorPayload = {
      records: [
        { timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 130 },
        { timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 131 },
        { timestamp: "2026-07-01T07:00:02Z", heart_rate_bpm: 132 },
      ],
    };

    const merged = mergeFitDistanceRecords(connectorPayload, {
      records: [
        { timestamp: "2026-07-01T07:00:00Z", distance_meters: 0 },
        { timestamp: "2026-07-01T07:00:02Z", distance_meters: -1 },
        { timestamp: "2026-07-01T07:00:03Z", distance_meters: 3 },
      ],
    });

    const detail = normalizeActivityDetail("49", merged);
    expect(detail.stream.map((point) => point.distanceMeters)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("merges true FIT speed records by unique timestamp without overwriting connector speed", () => {
    const connectorPayload = {
      records: [
        { timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 130 },
        {
          timestamp: "2026-07-01T07:00:01Z",
          heart_rate_bpm: 131,
          speed_mps: 2.5,
        },
        {
          timestamp: "2026-07-01T07:00:02Z",
          heart_rate_bpm: 132,
          enhanced_speed: 3,
        },
      ],
    };

    expect(activityDetailNeedsSpeedSupplement(connectorPayload)).toBe(true);
    const merged = mergeFitSpeedRecords(connectorPayload, {
      source: "garmin-fit-speed-stream",
      records: [
        { timestamp: "2026-07-01T07:00:00Z", speed_mps: 0 },
        { timestamp: "2026-07-01T07:00:01Z", speed_mps: 9 },
        { timestamp: "2026-07-01T07:00:02Z", speed_mps: 10 },
      ],
    });

    const detail = normalizeActivityDetail("52", merged);
    expect(detail.stream.map((point) => point.speedMps)).toEqual([0, 2.5, 3]);
  });

  it("does not merge FIT speed when timestamp identity is ambiguous or speed is invalid", () => {
    const connectorPayload = {
      records: [
        { timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 130 },
        { timestamp: "2026-07-01T07:00:00Z", heart_rate_bpm: 131 },
        { timestamp: "2026-07-01T07:00:02Z", heart_rate_bpm: 132 },
        { heart_rate_bpm: 133 },
      ],
    };

    const merged = mergeFitSpeedRecords(connectorPayload, {
      records: [
        { timestamp: "2026-07-01T07:00:00Z", speed_mps: 0 },
        { timestamp: "2026-07-01T07:00:02Z", speed_mps: -1 },
        { timestamp: "2026-07-01T07:00:03Z", speed_mps: 3 },
      ],
    });

    const detail = normalizeActivityDetail("53", merged);
    expect(detail.stream.map((point) => point.speedMps)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("does not synthesize stream distance from summary, lap, GPS, speed, grade, or availability fields", () => {
    const detail = normalizeActivityDetail("50", {
      session: { total_distance_m: 1000, avg_speed_mps: 2.5 },
      laps: [
        {
          lap_number: 1,
          total_elapsed_time_s: 600,
          total_distance_m: 1000,
        },
      ],
      records: [
        {
          timestamp: "2026-07-01T07:00:00Z",
          heart_rate_bpm: 130,
          speed_mps: 2.5,
          grade_pct: 6,
          lat_deg: 46.1,
          lon_deg: 13.8,
          has_distance: true,
        },
      ],
    });

    expect(detail.stream).toHaveLength(1);
    expect(detail.stream[0].distanceMeters).toBeNull();
  });

  it("does not synthesize stream altitude from summary, lap, GPS, grade, or availability fields", () => {
    const detail = normalizeActivityDetail("43", {
      session: { total_ascent_m: 220, total_descent_m: 210 },
      laps: [
        {
          lap_number: 1,
          total_elapsed_time_s: 600,
          total_ascent_m: 80,
          total_descent_m: 70,
        },
      ],
      records: [
        {
          timestamp: "2026-07-01T07:00:00Z",
          heart_rate_bpm: 130,
          grade_pct: 6,
          lat_deg: 46.1,
          lon_deg: 13.8,
          has_elevation: true,
        },
      ],
      climbs: [{ elevation_gain_m: 80 }],
    });

    expect(detail.hasElevation).toBe(true);
    expect(detail.stream).toHaveLength(1);
    expect(detail.stream[0].altitudeMeters).toBeNull();
  });

  it("paginates, checkpoints, and resumes idempotent sync", async () => {
    const store = new MemoryStore();
    const total = await syncActivitiesToExhaustion(store, async (offset) =>
      offset >= 2
        ? []
        : [
            normalizeActivity({
              activityId: offset + 1,
              activityType: "cycling",
              startTimeLocal: "2026-07-01T07:00:00",
            }),
          ],
    );
    expect(total).toBe(2);
    expect(store.checkpoints.get("activity_offset")).toBe("2");
    const days = await syncDailyHealthRange(
      store,
      "2026-07-01",
      "2026-07-03",
      async (date) => normalizeDailyHealth(date, { steps: 1000 }),
    );
    expect(days).toBe(3);
    expect(store.days.has("2026-07-03")).toBe(true);
  });
});
