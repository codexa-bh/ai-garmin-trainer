import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-analytics-")),
    "test.sqlite",
  );
});

describe("activity analytics", () => {
  it("computes bounded summaries from detailed streams", async () => {
    const repository = await import("../src/lib/db/repository");
    const { analyzeStoredActivity } =
      await import("../src/lib/analytics/activity");
    repository.upsertActivities([
      {
        garminId: "a1",
        name: "Hill test",
        sport: "hiking",
        startedAt: new Date("2026-07-01T07:00:00Z"),
        durationSec: 120,
        distanceMeters: 300,
        calories: null,
        avgHeartRate: 130,
        maxHeartRate: 160,
        steps: null,
        elevationGainMeters: 45,
        elevationLossMeters: null,
        trainingEffect: null,
      },
      {
        garminId: "a2",
        name: "Similar hill",
        sport: "hiking",
        startedAt: new Date("2026-06-20T07:00:00Z"),
        durationSec: 130,
        distanceMeters: 320,
        calories: null,
        avgHeartRate: 128,
        maxHeartRate: 155,
        steps: null,
        elevationGainMeters: 40,
        elevationLossMeters: null,
        trainingEffect: null,
      },
    ]);
    repository.upsertActivityDetail({
      garminId: "a1",
      fetchedAt: new Date("2026-07-01T08:00:00Z"),
      source: "garmin-fit",
      status: "available",
      hasSession: true,
      hasLaps: true,
      hasStreams: true,
      hasGps: true,
      hasElevation: true,
      hasHeartRate: true,
      hasGrade: true,
      hasPower: false,
      hasRecovery: false,
      recordCount: 3,
      lapCount: 1,
      unavailableReason: null,
      session: { avg_heart_rate_bpm: 130 },
      derived: null,
      laps: [
        {
          lapNumber: 1,
          startTime: "2026-07-01T07:00:00Z",
          durationSec: 120,
          distanceMeters: 300,
          avgSpeedMps: 2.5,
          avgHeartRate: 130,
          maxHeartRate: 150,
          elevationGainMeters: 45,
          elevationLossMeters: null,
          avgPowerWatts: null,
          normalizedPowerWatts: null,
        },
      ],
      stream: [
        {
          timestamp: "2026-07-01T07:00:00Z",
          elapsedSec: 0,
          heartRate: 120,
          speedMps: 2.5,
          altitudeMeters: 1000,
          gradePct: 5,
          lat: 46,
          lon: 14,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
        {
          timestamp: "2026-07-01T07:01:00Z",
          elapsedSec: 60,
          heartRate: 135,
          speedMps: 2.5,
          altitudeMeters: 1022,
          gradePct: 7,
          lat: 46,
          lon: 14,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
        {
          timestamp: "2026-07-01T07:02:00Z",
          elapsedSec: 120,
          heartRate: 150,
          speedMps: 2.5,
          altitudeMeters: 1045,
          gradePct: 8,
          lat: 46,
          lon: 14,
          cadence: null,
          powerWatts: null,
          temperatureC: null,
        },
      ],
    });

    const analysis = analyzeStoredActivity("a1");
    expect(analysis.streamSummary.records).toBe(3);
    expect(analysis.streamSummary.maxAltitudeMeters).toBe(1045);
    expect(analysis.heartRateZones.length).toBe(5);
    expect(analysis.similarEfforts[0]?.garminId).toBe("a2");
    expect(JSON.stringify(analysis)).toMatch(/raw FIT.*not sent/);
  });

  it("reports missing stream limitations without throwing", async () => {
    const repository = await import("../src/lib/db/repository");
    const { analyzeStoredActivity } =
      await import("../src/lib/analytics/activity");
    repository.upsertActivities([
      {
        garminId: "missing",
        name: "Summary only",
        sport: "running",
        startedAt: new Date("2026-07-02T07:00:00Z"),
        durationSec: 1800,
        distanceMeters: 5000,
        calories: null,
        avgHeartRate: 140,
        maxHeartRate: 170,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: null,
      },
    ]);
    const analysis = analyzeStoredActivity("missing");
    expect(analysis.streamSummary.records).toBe(0);
    expect(analysis.limitations).toContain(
      "No detailed FIT/stream backfill has been run for this activity yet.",
    );
  });

  it("builds deterministic activity ranking evidence with grounded labels", async () => {
    const repository = await import("../src/lib/db/repository");
    const { summarizeActivityRankings } =
      await import("../src/lib/analytics/activity");
    repository.upsertActivities([
      {
        garminId: "rank-1",
        name: "Source climb — Špik",
        sport: "hiking",
        startedAt: new Date("2026-07-03T07:00:00Z"),
        durationSec: 7200,
        distanceMeters: 14000,
        calories: null,
        avgHeartRate: 150,
        maxHeartRate: 170,
        steps: null,
        elevationGainMeters: 1200,
        elevationLossMeters: 1100,
        trainingEffect: null,
      },
      {
        garminId: "rank-2",
        name: null,
        sport: "running",
        startedAt: new Date("2026-07-02T07:00:00Z"),
        durationSec: 3600,
        distanceMeters: 21000,
        calories: null,
        avgHeartRate: 165,
        maxHeartRate: 181,
        steps: null,
        elevationGainMeters: 40,
        elevationLossMeters: 40,
        trainingEffect: null,
      },
    ]);

    const evidence = summarizeActivityRankings(
      "Which are my most demanding activities by elevation, distance, duration, and HR?",
    );

    expect(evidence?.tool).toBe("activityRanking");
    expect(evidence?.rankings.elevationGainMeters[0]?.label).toBe(
      "Source climb — Špik",
    );
    expect(evidence?.rankings.distanceMeters[0]?.label).toBe(
      "Imported running on 2026-07-02 (Garmin ID rank-2)",
    );
    expect(evidence?.rankings.distanceMeters[0]?.labelSource).toBe("fallback");
    expect(JSON.stringify(evidence)).not.toContain("Golovec trails");
  });
});
