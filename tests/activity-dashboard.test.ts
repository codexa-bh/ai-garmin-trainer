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
          heart_rate_bpm: 130 + index,
          altitude: 1000 + index * 3,
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
    });
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
    expect(serialized).toContain("lat");
    expect(serialized).toContain("lon");
    expect(serialized).not.toContain("payloadJson");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("DATABASE_PATH");
    expect(serialized).not.toContain("select ");
    expect(serialized).not.toContain("CARTO");
    expect(serialized).not.toContain("OpenStreetMap");
    expect(serialized).not.toContain("basemaps.cartocdn.com");
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
        heartRate: 130 + index,
        speedMps: null,
        altitudeMeters: 1000 + index,
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
    expect(dashboard?.charts).toMatchObject({
      domainStartSec: 0,
      domainEndSec: 3600,
      timeScaleStatus: "timestamp_derived",
    });
    expect(dashboard?.charts.timeScaleMessage).toMatch(/record timestamps/);
    expect(JSON.stringify(dashboard)).not.toContain("2026-08-01T07:15");
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
