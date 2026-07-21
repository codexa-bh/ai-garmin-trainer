import { describe, expect, it } from "vitest";
import { assertReadOperation } from "../src/lib/garmin/client";
import { normalizeGarminAthleteBaseline } from "../src/lib/garmin/athlete-normalize";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
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
      ftpPayload: {
        functional_threshold_power_watts: 255,
        calendar_date: "2026-07-19",
        is_stale: true,
        sport: "cycling",
      },
      fetchedAt: new Date("2026-07-20T08:00:00Z"),
    });

    expect(normalized.availability).toBe("partial");
    expect(normalized.values).toMatchObject({
      runningLactateThresholdHeartRateBpm: 169,
      cyclingLactateThresholdHeartRateBpm: 172,
      rowingLactateThresholdHeartRateBpm: null,
      cyclingFtpWatts: 255,
      cyclingFtpMeasuredOn: "2026-07-19",
      cyclingFtpSourceStale: true,
      vo2MaxRunning: 51.2,
      vo2MaxCycling: null,
      availableTrainingDays: ["monday", "wednesday"],
      preferredLongTrainingDays: ["friday", "sunday"],
    });
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
      ],
      climbs: [{ elevation_gain_m: 80 }],
    });
    expect(detail.status).toBe("available");
    expect(detail.hasStreams).toBe(true);
    expect(detail.hasGps).toBe(true);
    expect(detail.hasElevation).toBe(true);
    expect(detail.hasHeartRate).toBe(true);
    expect(detail.recordCount).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("garmin_tokens");
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
