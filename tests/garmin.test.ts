import { describe, expect, it } from "vitest";
import { assertReadOperation } from "../src/lib/garmin/client";
import { normalizeGarminAthleteBaseline } from "../src/lib/garmin/athlete-normalize";
import { normalizeActivityHrZoneTime } from "../src/lib/garmin/activity-hr-zone-time";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import {
  activityDetailNeedsAltitudeSupplement,
  mergeFitAltitudeRecords,
} from "../src/lib/garmin/fit-altitude";
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
    expect(() => assertReadOperation("download_activity_file")).toThrow(
      /Blocked/,
    );
    expect(() => assertReadOperation("set_user_profile")).toThrow(/Blocked/);
    expect(() => assertReadOperation("delete_activity")).toThrow(/Blocked/);
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
          speed_mps: 2.5,
          altitude_m: 1000,
          grade_pct: 6,
          lat_deg: 46.1,
          lon_deg: 13.8,
        },
        {
          timestamp: "2026-07-01T07:00:01Z",
          heart_rate_bpm: 131,
          altitude: 1001,
        },
        {
          timestamp: "2026-07-01T07:00:02Z",
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
    expect(detail.stream.map((point) => point.altitudeMeters)).toEqual([
      1000, 1001, 1002,
    ]);
    expect(JSON.stringify(detail)).not.toContain("garmin_tokens");
  });

  it("uses real FIT elapsed seconds before array-index fallback", () => {
    const detail = normalizeActivityDetail("46", {
      records: [
        { elapsed_time_s: 0, heart_rate_bpm: 130 },
        { elapsed_time_s: 60, heart_rate_bpm: 136 },
        { heart_rate_bpm: 140 },
        { elapsed_time_s: -5, heart_rate_bpm: 145 },
      ],
    });

    expect(detail.stream.map((point) => point.elapsedSec)).toEqual([
      0, 60, 2, 3,
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
