import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import type { NormalizedActivityDetail } from "../src/lib/garmin/detail-types";
import type {
  GarminAthleteBaselineSnapshot,
  HeartRateZoneSetDto,
} from "../src/lib/garmin/types";

const dbDir = join(tmpdir(), "ai-garmin-activity-dashboard-tests");

beforeEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  vi.resetModules();
});

function baselineSnapshot(
  heartRateZones: HeartRateZoneSetDto = {
    status: "garmin_configured" as const,
    source: "garmin_mcp" as const,
    formula: null,
    boundaries: [
      { zone: 1 as const, label: "Zone 1", lowerBpm: 90, upperBpm: 119 },
      { zone: 2 as const, label: "Zone 2", lowerBpm: 120, upperBpm: 139 },
      { zone: 3 as const, label: "Zone 3", lowerBpm: 140, upperBpm: 159 },
      { zone: 4 as const, label: "Zone 4", lowerBpm: 160, upperBpm: 179 },
      { zone: 5 as const, label: "Zone 5", lowerBpm: 180, upperBpm: null },
    ],
  },
) {
  return {
    availability: "complete" as const,
    source: "garmin_mcp" as const,
    fetchedAt: new Date("2026-08-01T00:00:00Z"),
    values: {
      configuredMaxHeartRateBpm: 190,
      heartRateZones,
      cyclingFtpWatts: null,
      cyclingFtpMeasuredOn: null,
      cyclingFtpSourceStale: null,
      availableTrainingDays: [],
      preferredLongTrainingDays: [],
    },
  } satisfies GarminAthleteBaselineSnapshot;
}

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
      anaerobicTrainingEffect: 1.4,
      trainingEffectLabel: "Tempo",
      trainingLoad: 91,
      moderateIntensityMinutes: 18,
      vigorousIntensityMinutes: 6,
      totalIntensityMinutes: 24,
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
  it("searches all synced activities with dashboard-bounded results", async () => {
    const repo = await seedActivities();

    const page = repo.listActivitiesForDashboard({ query: "ride", limit: 200 });

    expect(page.limit).toBe(100);
    expect(page.totalApprox).toBe(1);
    expect(page.activities).toHaveLength(1);
    expect(page.activities[0]).toMatchObject({
      garminId: "222222",
      sport: "cycling",
    });
  });

  it("returns 100-item dashboard pages with nextOffset until the final page", async () => {
    const repo = await import("../src/lib/db/repository");
    repo.upsertActivities(
      Array.from({ length: 125 }, (_, index) => ({
        garminId: `page-${index.toString().padStart(3, "0")}`,
        name: `Paged Activity ${index}`,
        sport: "running",
        startedAt: new Date(Date.UTC(2026, 7, 1, 7, 0, index)),
        durationSec: 1800 + index,
        distanceMeters: 5000 + index,
        calories: null,
        avgHeartRate: null,
        maxHeartRate: null,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: null,
      })),
    );

    const firstPage = repo.listActivitiesForDashboard({ limit: 100 });
    const secondPage = repo.listActivitiesForDashboard({
      limit: 100,
      offset: 100,
    });

    expect(firstPage.limit).toBe(100);
    expect(firstPage.offset).toBe(0);
    expect(firstPage.totalApprox).toBe(125);
    expect(firstPage.activities).toHaveLength(100);
    expect(firstPage.nextOffset).toBe(100);
    expect(secondPage.activities).toHaveLength(25);
    expect(secondPage.nextOffset).toBeNull();
  });

  it("returns selected dashboard payload with bounded route coordinates and without raw payload fields", async () => {
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
          distance: index * 100,
          heart_rate_bpm: 130 + index,
          speed_mps: index === 0 ? 0 : 2 + index / 10,
          altitude: 1000 + index * 3,
          grade_pct: index === 0 ? 0 : index % 2 === 0 ? -3.5 : 4.25,
          lat_deg: 46.1 + index / 1000,
          lon_deg: 13.8 + index / 1000,
        })),
      }),
    );

    repo.writeGarminAthleteBaselineRefresh({
      snapshot: baselineSnapshot(),
      status: "complete",
      attemptedAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-01T00:00:01Z"),
    });

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.activity).toMatchObject({
      trainingEffect: 3.2,
      anaerobicTrainingEffect: 1.4,
      trainingEffectLabel: "Tempo",
      trainingLoad: 91,
      moderateIntensityMinutes: 18,
      vigorousIntensityMinutes: 6,
      totalIntensityMinutes: 24,
    });
    expect(dashboard?.charts.downsampled).toBe(false);
    expect(dashboard?.charts.sourcePointCount).toBe(12);
    expect(dashboard?.charts.pointCount).toBe(12);
    expect(dashboard?.charts.maxPoints).toBe(12);
    expect(dashboard?.charts.points).toHaveLength(12);
    expect(dashboard?.charts).toMatchObject({
      domainStartSec: 0,
      domainEndSec: 3600,
      timeScaleStatus: "elapsed",
      timeScaleMessage: null,
      speed: {
        status: "available",
        sourcePointCount: 12,
        pointCount: 11,
      },
    });
    expect(dashboard?.charts.points[0].speedKmh).toBeNull();
    expect(dashboard?.charts.points[1].speedKmh).toBeCloseTo(6, 6);
    expect(
      dashboard?.charts.points.slice(0, 3).map((point) => point.gradePct),
    ).toEqual([3, 3, 3]);
    expect(dashboard?.route).toMatchObject({
      status: "available",
      sourcePointCount: 12,
      pointCount: 12,
      maxPoints: 400,
      simplified: false,
      bounds: {
        minLat: 46.1,
        maxLat: expect.closeTo(46.111, 6),
        minLon: 13.8,
        maxLon: 13.811,
        minAltitudeMeters: 1000,
        maxAltitudeMeters: 1033,
      },
    });
    expect(dashboard?.route.points[0]).toMatchObject({
      elapsedSec: 0,
      lat: 46.1,
      lon: 13.8,
      altitudeMeters: 1000,
    });
    expect(dashboard?.detail).toMatchObject({
      status: "available",
      hasHeartRate: true,
      hasElevation: true,
      hasLaps: true,
    });
    expect(dashboard?.laps).toHaveLength(1);
    expect(dashboard?.heartRateZones).toMatchObject({
      status: "available",
      zoneStatus: "garmin_configured",
      timeSource: "local_stream",
      classifiedSeconds: 660,
      sourceTotalSeconds: 660,
      buckets: expect.arrayContaining([
        expect.objectContaining({ zone: 2, seconds: 600 }),
        expect.objectContaining({ zone: 3, seconds: 60 }),
      ]),
    });
    const serialized = JSON.stringify(dashboard);
    const serializedChartPoints = JSON.stringify(dashboard?.charts.points);
    expect(serialized).toContain("lat");
    expect(serialized).toContain("lon");
    expect(serializedChartPoints).not.toContain("lat");
    expect(serializedChartPoints).not.toContain("lon");
    expect(serialized).not.toContain("payloadJson");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("DATABASE_PATH");
    expect(serialized).not.toContain("select ");
    expect(serialized).not.toContain("CARTO");
    expect(serialized).not.toContain("OpenTopoMap");
    expect(serialized).not.toContain("OpenStreetMap");
    expect(serialized).not.toContain("basemaps.cartocdn.com");
    expect(serialized).not.toContain("tile.opentopomap.org");
    expect(serialized).not.toContain("opentopomap.org");
    expect(serialized).not.toContain("tile.openstreetmap.org");
  });

  it("repairs selected chart elapsed timing from persisted timestamps", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail({
      garminId: "111111",
      fetchedAt: new Date("2026-08-01T07:00:00Z"),
      source: "garmin-fit",
      status: "available",
      hasSession: false,
      hasLaps: false,
      hasStreams: true,
      hasGps: false,
      hasElevation: true,
      hasHeartRate: true,
      hasGrade: false,
      hasPower: false,
      hasRecovery: false,
      recordCount: 4,
      lapCount: 0,
      unavailableReason: null,
      session: null,
      derived: null,
      laps: [],
      stream: Array.from({ length: 4 }, (_, index) => ({
        timestamp: new Date(
          Date.UTC(2026, 7, 1, 7, index * 15, 0),
        ).toISOString(),
        elapsedSec: index,
        distanceMeters: index * 900,
        heartRate: 130 + index,
        speedMps: null,
        altitudeMeters: 1000 + index * 9,
        gradePct: null,
        lat: null,
        lon: null,
        cadence: null,
        powerWatts: null,
        temperatureC: null,
      })),
    } satisfies NormalizedActivityDetail);

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.points.map((point) => point.elapsedSec)).toEqual([
      0, 900, 1800, 2700,
    ]);
    expect(dashboard?.charts.points.map((point) => point.gradePct)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(dashboard?.charts).toMatchObject({
      domainStartSec: 0,
      domainEndSec: 3600,
      timeScaleStatus: "timestamp_derived",
    });
    expect(dashboard?.charts.timeScaleMessage).toMatch(/record timestamps/);
    expect(JSON.stringify(dashboard)).not.toContain("2026-08-01T07:15");
  });

  it("uses the named 180-second distance-altitude window for selected chart grade readouts", async () => {
    const repo = await seedActivities();
    expect(repo.ACTIVITY_DASHBOARD_GRADE_READOUT_WINDOW_SEC).toBe(180);
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: Array.from({ length: 7 }, (_, index) => ({
          elapsed_time_s: index * 60,
          distance: index * 100,
          altitude_m: 1000 + index * 3,
          grade_pct: index % 2 === 0 ? -25 : 40,
        })),
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.points.map((point) => point.gradePct)).toEqual([
      3, 3, 3, 3, 3, 3, 3,
    ]);
  });

  it("reports positive negative and zero smoothed grade while rejecting unsafe evidence", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, altitude_m: 1000 },
          { elapsed_time_s: 60, distance: 100, altitude_m: 1006 },
          { elapsed_time_s: 120, distance: 200, altitude_m: 1012 },
          { elapsed_time_s: 180, distance: 300, altitude_m: 1018 },
          { elapsed_time_s: 240, distance: 400, altitude_m: 1012 },
          { elapsed_time_s: 300, distance: 500, altitude_m: 1006 },
          { elapsed_time_s: 360, distance: 600, altitude_m: 1000 },
        ],
      }),
    );

    expect(
      repo
        .getActivityDashboardDetail("111111")
        ?.charts.points.map((point) => point.gradePct),
    ).toEqual([6, 6, 3, 0, -3, -6, -6]);

    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, altitude_m: 1000 },
          { elapsed_time_s: 60, distance: 100, altitude_m: 1006 },
          { elapsed_time_s: 120, distance: null, altitude_m: 1012 },
          { elapsed_time_s: 180, distance: 300, altitude_m: 1018 },
        ],
      }),
    );
    expect(
      repo
        .getActivityDashboardDetail("111111")
        ?.charts.points.map((point) => point.gradePct),
    ).toEqual([null, null, null, null]);

    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, altitude_m: 1000 },
          { elapsed_time_s: 60, distance: 100, altitude_m: 1006 },
          { elapsed_time_s: 120, distance: 90, altitude_m: 1012 },
          { elapsed_time_s: 180, distance: 300, altitude_m: 1018 },
        ],
      }),
    );
    expect(
      repo
        .getActivityDashboardDetail("111111")
        ?.charts.points.map((point) => point.gradePct),
    ).toEqual([null, null, null, null]);

    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, altitude_m: 1000 },
          { elapsed_time_s: 120, distance: 240, altitude_m: 1012 },
        ],
      }),
    );
    expect(
      repo
        .getActivityDashboardDetail("111111")
        ?.charts.points.map((point) => point.gradePct),
    ).toEqual([null, null]);
  });

  it("labels sample-index-only chart timing instead of stretching it to activity duration", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: Array.from({ length: 4 }, (_, index) => ({
          heart_rate_bpm: 130 + index,
          altitude_m: 1000 + index,
        })),
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.points.map((point) => point.elapsedSec)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(dashboard?.charts).toMatchObject({
      domainStartSec: 0,
      domainEndSec: 3,
      timeScaleStatus: "sample_index_limited",
    });
    expect(dashboard?.charts.timeScaleMessage).toMatch(/sample-index/);
  });

  it("simplifies large selected-dashboard routes and reports missing GPS truthfully", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: Array.from({ length: 450 }, (_, index) => ({
          elapsed_time_s: index * 10,
          lat_deg: 46 + index / 10000,
          lon_deg: 13 + index / 10000,
          altitude_m: 900 + index,
          grade_pct: index % 3 === 0 ? 5 : -2,
        })),
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.route).toMatchObject({
      status: "available",
      sourcePointCount: 450,
      pointCount: 400,
      maxPoints: 400,
      simplified: true,
      bounds: {
        minLat: 46,
        maxLat: expect.closeTo(46.0449, 6),
        minLon: 13,
        maxLon: expect.closeTo(13.0449, 6),
        minAltitudeMeters: 900,
        maxAltitudeMeters: 1349,
      },
    });
    expect(dashboard?.route.points[0]).toMatchObject({ lat: 46, lon: 13 });
    expect(dashboard?.route.points.at(-1)).toMatchObject({
      lat: 46.0449,
      lon: 13.0449,
    });

    expect(repo.getActivityDashboardDetail("222222")?.route).toMatchObject({
      status: "missing_gps",
      sourcePointCount: 0,
      pointCount: 0,
      bounds: null,
      points: [],
    });
  });

  it("builds speed from normalized distance over elapsed windows instead of measured stream speed", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          {
            elapsed_time_s: 0,
            distance: 0,
            speed_mps: 50,
            heart_rate_bpm: 130,
          },
          {
            elapsed_time_s: 10,
            distance: 20,
            speed_mps: 0,
            heart_rate_bpm: 132,
          },
          {
            elapsed_time_s: 20,
            distance: 50,
            speed_mps: null,
            heart_rate_bpm: 134,
          },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "available",
      sourcePointCount: 3,
      pointCount: 2,
    });
    expect(JSON.stringify(dashboard?.charts.points)).not.toContain("speedMps");
    expect(JSON.stringify(dashboard?.charts.points)).not.toContain(
      "distanceMeters",
    );
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      7.2,
      9,
    ]);
  });

  it("preserves true stops as zero average speed when elapsed distance evidence is reliable", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 100, heart_rate_bpm: 130 },
          { elapsed_time_s: 15, distance: 100, heart_rate_bpm: 131 },
          { elapsed_time_s: 30, distance: 100, heart_rate_bpm: 132 },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "available",
      sourcePointCount: 3,
      pointCount: 2,
    });
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      0,
      0,
    ]);
  });

  it("uses the named 60-second distance-average window and reports honest metadata", async () => {
    const repo = await seedActivities();
    expect(repo.ACTIVITY_DASHBOARD_SPEED_AVERAGE_WINDOW_SEC).toBe(60);
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, heart_rate_bpm: 130 },
          { elapsed_time_s: 30, distance: 90, heart_rate_bpm: 132 },
          { elapsed_time_s: 70, distance: 210, heart_rate_bpm: 134 },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "available",
      sourcePointCount: 3,
      pointCount: 2,
    });
    expect(dashboard?.charts.speed.message).toBe(
      "Speed uses a 60-second moving average derived from normalized cumulative distance and elapsed time.",
    );
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      10.8,
      10.8,
    ]);
  });

  it("does not build selected-dashboard speed from measured speed, GPS, summary, lap, or average speed when stream distance is missing", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        session: { total_distance_m: 1000, avg_speed_mps: 2.5 },
        laps: [
          {
            lap_number: 1,
            total_elapsed_time_s: 600,
            distance: 1000,
            avg_speed_mps: 2.5,
            averageSpeed: 2.5,
          },
        ],
        records: [
          {
            elapsed_time_s: 0,
            lat_deg: 46,
            lon_deg: 13,
            heart_rate_bpm: 130,
            averageSpeed: 2.5,
          },
          {
            elapsed_time_s: 10,
            lat_deg: 46.001,
            lon_deg: 13.001,
            heart_rate_bpm: 132,
            avg_speed_mps: 2.5,
          },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "missing_speed",
      sourcePointCount: 0,
      pointCount: 0,
    });
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      null,
    ]);
  });

  it("keeps impossible measured-speed samples irrelevant when distance evidence proves movement", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        session: { avg_speed_mps: 9, total_distance_m: 18 },
        laps: [{ lap_number: 1, avg_speed_mps: 9, distance: 18 }],
        records: [
          { elapsed_time_s: 0, distance: 0, speed_mps: 2, heart_rate_bpm: 130 },
          {
            elapsed_time_s: 10,
            distance: 6,
            speed_mps: 0,
            heart_rate_bpm: 131,
          },
          {
            elapsed_time_s: 20,
            distance: 12,
            speed_mps: 0.02,
            heart_rate_bpm: 132,
          },
          {
            elapsed_time_s: 30,
            distance: 18,
            speed_mps: 2,
            heart_rate_bpm: 133,
          },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "available",
      sourcePointCount: 4,
      pointCount: 3,
    });
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      2.16,
      2.16,
      2.16,
    ]);
    expect(JSON.stringify(dashboard?.charts.points)).not.toContain(
      "distanceMeters",
    );
  });

  it("reports insufficient speed when distance windows are too sparse", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, heart_rate_bpm: 130 },
          { elapsed_time_s: 120, distance: 240, heart_rate_bpm: 132 },
        ],
      }),
    );

    expect(
      repo.getActivityDashboardDetail("111111")?.charts.speed,
    ).toMatchObject({
      status: "insufficient_speed",
      sourcePointCount: 2,
      pointCount: 0,
    });
  });

  it("gaps speed when cumulative distance is non-monotonic", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, distance: 0, heart_rate_bpm: 130 },
          { elapsed_time_s: 10, distance: 20, heart_rate_bpm: 131 },
          { elapsed_time_s: 20, distance: 15, heart_rate_bpm: 132 },
          { elapsed_time_s: 30, distance: 40, heart_rate_bpm: 134 },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "insufficient_speed",
      sourcePointCount: 4,
      pointCount: 1,
    });
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      7.2,
      null,
      null,
    ]);
  });

  it("gaps speed when timestamp-derived elapsed evidence is duplicated", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail({
      garminId: "111111",
      fetchedAt: new Date("2026-08-01T07:00:00Z"),
      source: "garmin-fit",
      status: "available",
      hasSession: false,
      hasLaps: false,
      hasStreams: true,
      hasGps: false,
      hasElevation: false,
      hasHeartRate: true,
      hasGrade: false,
      hasPower: false,
      hasRecovery: false,
      recordCount: 4,
      lapCount: 0,
      unavailableReason: null,
      session: null,
      derived: null,
      laps: [],
      stream: [
        {
          timestamp: "2026-08-01T07:00:00Z",
          elapsedSec: 0,
          distanceMeters: 0,
          heartRate: 130,
          speedMps: null,
          altitudeMeters: null,
          gradePct: null,
          lat: null,
          lon: null,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
        {
          timestamp: "2026-08-01T07:02:00Z",
          elapsedSec: 1,
          distanceMeters: 20,
          heartRate: 131,
          speedMps: null,
          altitudeMeters: null,
          gradePct: null,
          lat: null,
          lon: null,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
        {
          timestamp: "2026-08-01T07:02:00Z",
          elapsedSec: 2,
          distanceMeters: 30,
          heartRate: 132,
          speedMps: null,
          altitudeMeters: null,
          gradePct: null,
          lat: null,
          lon: null,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
        {
          timestamp: "2026-08-01T07:03:00Z",
          elapsedSec: 3,
          distanceMeters: 40,
          heartRate: 133,
          speedMps: null,
          altitudeMeters: null,
          gradePct: null,
          lat: null,
          lon: null,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
      ],
    } satisfies NormalizedActivityDetail);

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.timeScaleStatus).toBe("timestamp_derived");
    expect(dashboard?.charts.speed).toMatchObject({
      status: "insufficient_speed",
      sourcePointCount: 4,
      pointCount: 0,
    });
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("does not use raw payload, pace, or activity averages as dashboard speed fallbacks", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        session: { avg_speed_mps: 12, averagePace: 300 },
        records: [
          { elapsed_time_s: 0, pace: 300, heart_rate_bpm: 130 },
          { elapsed_time_s: 10, pace: 200, heart_rate_bpm: 132 },
        ],
      }),
    );

    const dashboard = repo.getActivityDashboardDetail("111111");

    expect(dashboard?.charts.speed).toMatchObject({
      status: "missing_speed",
      sourcePointCount: 0,
      pointCount: 0,
    });
    expect(dashboard?.charts.points.map((point) => point.speedKmh)).toEqual([
      null,
      null,
    ]);
    expect(JSON.stringify(dashboard)).not.toContain("raw");
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
    repo.writeGarminAthleteBaselineRefresh({
      snapshot: baselineSnapshot({
        status: "derived_from_garmin_max_hr" as const,
        source: "derived" as const,
        formula: "test formula",
        boundaries: [
          { zone: 1 as const, label: "Zone 1", lowerBpm: 90, upperBpm: 119 },
          { zone: 2 as const, label: "Zone 2", lowerBpm: 120, upperBpm: 139 },
          { zone: 3 as const, label: "Zone 3", lowerBpm: 140, upperBpm: 159 },
          { zone: 4 as const, label: "Zone 4", lowerBpm: 160, upperBpm: 179 },
          { zone: 5 as const, label: "Zone 5", lowerBpm: 180, upperBpm: null },
        ],
      }),
      status: "complete",
      attemptedAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-01T00:00:01Z"),
    });
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
      new Request(
        "http://local.test/api/activities/111111/dashboard?maxPoints=1",
      ),
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
      speedKmh: null,
      gradePct: null,
    });
    expect(detailPayload.route).toMatchObject({
      status: "missing_gps",
      sourcePointCount: 0,
      pointCount: 0,
      maxPoints: 400,
      points: [],
    });
    expect(detailPayload.heartRateZones).toMatchObject({
      status: "available",
      zoneStatus: "derived_from_garmin_max_hr",
      zoneSource: "derived",
      timeSource: "local_stream",
      classifiedSeconds: 60,
    });
    expect(JSON.stringify(detailPayload)).not.toContain("payloadJson");
    expect(JSON.stringify(detailPayload)).not.toContain("token");
  });

  it("serves lap average speed from source speed or distance-duration fallback", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail({
      garminId: "111111",
      fetchedAt: new Date("2026-08-01T07:00:00Z"),
      source: "garmin-fit",
      status: "available",
      hasSession: false,
      hasLaps: true,
      hasStreams: false,
      hasGps: false,
      hasElevation: false,
      hasHeartRate: false,
      hasGrade: false,
      hasPower: false,
      hasRecovery: false,
      recordCount: 0,
      lapCount: 5,
      unavailableReason: null,
      session: null,
      derived: null,
      laps: [
        {
          lapNumber: 1,
          startTime: null,
          durationSec: 1800,
          distanceMeters: 5000,
          avgSpeedMps: 3.2,
          avgHeartRate: null,
          maxHeartRate: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          avgPowerWatts: null,
          normalizedPowerWatts: null,
        },
        {
          lapNumber: 2,
          startTime: null,
          durationSec: 2000,
          distanceMeters: 5000,
          avgSpeedMps: null,
          avgHeartRate: null,
          maxHeartRate: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          avgPowerWatts: null,
          normalizedPowerWatts: null,
        },
        {
          lapNumber: 3,
          startTime: null,
          durationSec: 600,
          distanceMeters: 0,
          avgSpeedMps: null,
          avgHeartRate: null,
          maxHeartRate: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          avgPowerWatts: null,
          normalizedPowerWatts: null,
        },
        {
          lapNumber: 4,
          startTime: null,
          durationSec: 0,
          distanceMeters: 1000,
          avgSpeedMps: null,
          avgHeartRate: null,
          maxHeartRate: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          avgPowerWatts: null,
          normalizedPowerWatts: null,
        },
        {
          lapNumber: 5,
          startTime: null,
          durationSec: 600,
          distanceMeters: -100,
          avgSpeedMps: null,
          avgHeartRate: null,
          maxHeartRate: null,
          elevationGainMeters: null,
          elevationLossMeters: null,
          avgPowerWatts: null,
          normalizedPowerWatts: null,
        },
      ],
      stream: [],
    } satisfies NormalizedActivityDetail);
    const detailRoute =
      await import("../src/app/api/activities/[garminId]/dashboard/route");

    const detailResponse = await detailRoute.GET(
      new Request("http://local.test/api/activities/111111/dashboard"),
      { params: { garminId: "111111" } },
    );
    const detailPayload = await detailResponse.json();

    expect(detailPayload.laps).toHaveLength(5);
    expect(detailPayload.laps[0].avgSpeedMps).toBe(3.2);
    expect(detailPayload.laps[1].avgSpeedMps).toBe(2.5);
    expect(detailPayload.laps[2].avgSpeedMps).toBe(0);
    expect(detailPayload.laps[3].avgSpeedMps).toBeNull();
    expect(detailPayload.laps[4].avgSpeedMps).toBeNull();
    expect(JSON.stringify(detailPayload)).not.toContain("payloadJson");
    expect(JSON.stringify(detailPayload)).not.toContain("token");
    expect(JSON.stringify(detailPayload)).not.toContain("DATABASE_PATH");
    expect(JSON.stringify(detailPayload)).not.toContain("select ");
  });

  it("prefers Garmin activity HR-zone totals over local stream-derived fallback", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, heart_rate_bpm: 130 },
          { elapsed_time_s: 60, heart_rate_bpm: 136 },
        ],
      }),
    );
    repo.writeGarminAthleteBaselineRefresh({
      snapshot: baselineSnapshot(),
      status: "complete",
      attemptedAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-01T00:00:01Z"),
    });
    repo.upsertActivityHrZoneTime({
      garminId: "111111",
      fetchedAt: new Date("2026-08-01T00:00:02Z"),
      source: "garmin_mcp",
      status: "available",
      sourceTotalSeconds: 3600,
      buckets: [
        { zone: 1, seconds: 300, sourceLowerBpm: 90 },
        { zone: 2, seconds: 900, sourceLowerBpm: 120 },
        { zone: 3, seconds: 1200, sourceLowerBpm: 140 },
        { zone: 4, seconds: 800, sourceLowerBpm: 160 },
        { zone: 5, seconds: 400, sourceLowerBpm: 180 },
      ],
    });

    expect(
      repo.getActivityDashboardDetail("111111")?.heartRateZones,
    ).toMatchObject({
      status: "available",
      timeSource: "garmin_activity",
      classifiedSeconds: 3600,
      sourceTotalSeconds: 3600,
      activityDurationSec: 3600,
      buckets: expect.arrayContaining([
        expect.objectContaining({ zone: 5, seconds: 400, percent: 11.1 }),
      ]),
    });
  });

  it("keeps selected dashboard elevation unchartable when only summary and lap totals exist", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        session: { total_ascent_m: 260, total_descent_m: 250 },
        laps: [
          {
            lap_number: 1,
            total_elapsed_time_s: 1800,
            total_distance_m: 5000,
            total_ascent_m: 120,
            total_descent_m: 115,
          },
        ],
        records: [
          {
            elapsed_time_s: 0,
            heart_rate_bpm: 130,
            grade_pct: 6,
            lat_deg: 46.1,
            lon_deg: 13.8,
            has_elevation: true,
          },
        ],
      }),
    );
    const detailRoute =
      await import("../src/app/api/activities/[garminId]/dashboard/route");

    const dashboard = repo.getActivityDashboardDetail("111111");
    expect(dashboard?.detail.hasElevation).toBe(false);
    expect(dashboard?.charts.points[0]).toMatchObject({
      elapsedSec: 0,
      heartRate: 130,
      altitudeMeters: null,
    });
    expect(dashboard?.laps[0]).toMatchObject({
      elevationGainMeters: 120,
      elevationLossMeters: 115,
    });

    const detailResponse = await detailRoute.GET(
      new Request("http://local.test/api/activities/111111/dashboard"),
      { params: { garminId: "111111" } },
    );
    const detailPayload = await detailResponse.json();
    const serialized = JSON.stringify(detailPayload);
    expect(detailPayload.detail.hasElevation).toBe(false);
    expect(detailPayload.route).toMatchObject({
      status: "insufficient_points",
      sourcePointCount: 1,
      pointCount: 1,
    });
    expect(detailPayload.route.points[0]).toMatchObject({
      lat: 46.1,
      lon: 13.8,
    });
    expect(serialized).not.toContain("payloadJson");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("DATABASE_PATH");
    expect(serialized).not.toContain("select ");
  });

  it("reports truthful HR-zone unavailable states without fabricating buckets", async () => {
    const repo = await seedActivities();
    repo.upsertActivityDetail(
      normalizeActivityDetail("111111", {
        records: [
          { elapsed_time_s: 0, heart_rate_bpm: 130 },
          { elapsed_time_s: 60, heart_rate_bpm: 136 },
        ],
      }),
    );

    expect(
      repo.getActivityDashboardDetail("111111")?.heartRateZones,
    ).toMatchObject({
      status: "missing_zones",
      buckets: [],
    });

    repo.writeGarminAthleteBaselineRefresh({
      snapshot: baselineSnapshot(),
      status: "complete",
      attemptedAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-01T00:00:01Z"),
    });
    repo.upsertActivityDetail(
      normalizeActivityDetail("222222", {
        records: [
          { elapsed_time_s: 0, altitude_m: 1000 },
          { elapsed_time_s: 60, altitude_m: 1006 },
        ],
      }),
    );

    expect(
      repo.getActivityDashboardDetail("222222")?.heartRateZones,
    ).toMatchObject({
      status: "missing_heart_rate",
      zoneStatus: "garmin_configured",
    });
  });
});
