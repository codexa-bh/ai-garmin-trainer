import { describe, expect, it } from "vitest";
import { assertReadOperation } from "../src/lib/garmin/client";
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
    expect(() => assertReadOperation("delete_activity")).toThrow(/Blocked/);
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
