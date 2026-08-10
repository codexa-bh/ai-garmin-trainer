import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";

const dbDir = join(tmpdir(), "ai-garmin-activity-dashboard-tests");

beforeEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  vi.resetModules();
});

async function seedActivities() {
  const repo = await import("../src/lib/db/repository");
  repo.upsertActivities([
    {
      garminId: "111111",
      name: "Morning Trail Run",
      sport: "running",
      startedAt: new Date("2026-08-01T07:00:00Z"),
      durationSec: 3600,
      distanceMeters: 10000,
      calories: 640,
      avgHeartRate: 145,
      maxHeartRate: 174,
      steps: 9200,
      elevationGainMeters: 260,
      elevationLossMeters: 250,
      trainingEffect: 3.2,
    },
    {
      garminId: "222222",
      name: "Evening Ride",
      sport: "cycling",
      startedAt: new Date("2026-08-02T17:00:00Z"),
      durationSec: 5400,
      distanceMeters: 32000,
      calories: 820,
      avgHeartRate: 132,
      maxHeartRate: 166,
      steps: null,
      elevationGainMeters: 420,
      elevationLossMeters: 410,
      trainingEffect: 2.8,
    },
  ]);
  return repo;
}

describe("activity dashboard repository and routes", () => {
  it("searches all synced activities with bounded results", async () => {
    const repo = await seedActivities();

    const page = repo.listActivitiesForDashboard({ query: "ride", limit: 200 });

    expect(page.limit).toBe(50);
    expect(page.totalApprox).toBe(1);
    expect(page.activities).toHaveLength(1);
    expect(page.activities[0]).toMatchObject({
      garminId: "222222",
      sport: "cycling",
    });
  });

  it("returns selected dashboard payload without raw coordinates or payload fields", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        session: { avg_heart_rate_bpm: 145 },
        laps: [
          {
            lap_number: 1,
            total_elapsed_time_s: 1800,
            total_distance_m: 5000,
            avg_heart_rate_bpm: 143,
            max_heart_rate_bpm: 168,
          },
        ],
        records: Array.from({ length: 12 }, (_, index) => ({
          timestamp: `2026-08-01T07:${index.toString().padStart(2, "0")}:00Z`,
          elapsed_time_s: index * 60,
          heart_rate_bpm: 130 + index,
          altitude_m: 1000 + index * 3,
          lat_deg: 46.1 + index / 1000,
          lon_deg: 13.8 + index / 1000,
        })),
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111", 5);

    expect(dashboard?.charts.downsampled).toBe(true);
    expect(dashboard?.charts.points.length).toBeLessThanOrEqual(5);
    expect(dashboard?.detail).toMatchObject({
      status: "available",
      hasHeartRate: true,
      hasElevation: true,
      hasLaps: true,
    });
    expect(dashboard?.laps).toHaveLength(1);
    const serialized = JSON.stringify(dashboard);
    expect(serialized).not.toContain("lat");
    expect(serialized).not.toContain("lon");
    expect(serialized).not.toContain("payloadJson");
    expect(serialized).not.toContain("token");
  });

  it("serves bounded list and selected dashboard API responses", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, heart_rate_bpm: 130, altitude_m: 1000 },
          { elapsed_time_s: 60, heart_rate_bpm: 136, altitude_m: 1012 },
        ],
      }),
    );
    const listRoute = await import("../src/app/api/activities/route");
    const detailRoute =
      await import("../src/app/api/activities/[garminId]/dashboard/route");

    const listResponse = await listRoute.GET(
      new Request("http://local.test/api/activities?q=trail&limit=1"),
    );
    const listPayload = await listResponse.json();
    expect(listPayload.activities).toHaveLength(1);
    expect(listPayload.activities[0]).toMatchObject({
      garminId: "111111",
      label: "Morning Trail Run",
    });

    const detailResponse = await detailRoute.GET(
      new Request("http://local.test/api/activities/111111/dashboard"),
      { params: { garminId: "111111" } },
    );
    const detailPayload = await detailResponse.json();
    expect(detailPayload.activity).toMatchObject({
      garminId: "111111",
      calories: 640,
    });
    expect(detailPayload.charts.points[0]).toEqual({
      elapsedSec: 0,
      heartRate: 130,
      altitudeMeters: 1000,
    });
    expect(JSON.stringify(detailPayload)).not.toContain("lat");
    expect(JSON.stringify(detailPayload)).not.toContain("lon");
  });
});
