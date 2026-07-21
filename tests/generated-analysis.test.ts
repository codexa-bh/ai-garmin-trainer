import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-generated-analysis-")),
    "test.sqlite",
  );
});

describe("generated Garmin analysis", () => {
  it("retains redacted raw payloads and clears them with Garmin data", async () => {
    const repository = await import("../src/lib/db/repository");
    const stored = repository.upsertGarminRawPayload({
      sourceTool: "get_activities_by_date",
      subjectType: "activity_page",
      subjectId: "2026-07-01:page:0",
      payload: {
        activities: [{ activityId: 1 }],
        accessToken: "super-secret-token",
        nested: { cookie: "garmin_cookie=abc" },
      },
    });

    expect(stored.redactedFieldCount).toBeGreaterThanOrEqual(2);
    const listed = repository.listGarminRawPayloadsForAnalysis();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed[0].payload)).toContain("[REDACTED]");
    expect(JSON.stringify(listed[0].payload)).not.toContain(
      "super-secret-token",
    );

    expect(repository.clearGarminData()).toContain("garmin_raw_payload");
    expect(repository.listGarminRawPayloadsForAnalysis()).toHaveLength(0);
  });

  it("runs a top-10 generated ranking over the explicit bundle", async () => {
    const repository = await import("../src/lib/db/repository");
    const { runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");
    repository.upsertActivities(
      Array.from({ length: 12 }, (_, index) => ({
        garminId: `activity-${index + 1}`,
        name: `Activity ${index + 1}`,
        sport: index % 2 === 0 ? "running" : "cycling",
        startedAt: new Date(
          `2026-07-${String(index + 1).padStart(2, "0")}T07:00:00Z`,
        ),
        durationSec: 1800 + index * 60,
        distanceMeters: 5000 + index * 1000,
        calories: null,
        avgHeartRate: 130 + index,
        maxHeartRate: 160 + index,
        steps: null,
        elevationGainMeters: 100 + index * 20,
        elevationLossMeters: null,
        trainingEffect: 2 + index / 10,
      })),
    );

    const evidence = await runGeneratedGarminAnalysis({
      request: "top 10 most demanding activities",
      criterion: "demand_score",
      requestedCount: 10,
    });

    expect(evidence.status).toBe("succeeded");
    expect(evidence.result?.rows).toHaveLength(10);
    expect(evidence.result?.rows[0].garminId).toBe("activity-12");
    expect(evidence.scriptHash).toHaveLength(64);
    expect(JSON.stringify(evidence)).not.toContain("super-secret-token");
    expect(JSON.stringify(evidence)).not.toContain("garmin_cookie=abc");
  });

  it("uses sport-aware snowboarding demand instead of lift-assisted ascent", async () => {
    const repository = await import("../src/lib/db/repository");
    const { runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");
    repository.upsertActivities([
      {
        garminId: "snowboard-lift-ascent",
        name: "Resort snowboard with lift ascent",
        sport: "snowboarding",
        startedAt: new Date("2026-02-01T09:00:00Z"),
        durationSec: 3600,
        distanceMeters: 10000,
        calories: 300,
        avgHeartRate: 110,
        maxHeartRate: 145,
        steps: null,
        elevationGainMeters: 1400,
        elevationLossMeters: 900,
        trainingEffect: 1.4,
      },
      {
        garminId: "snowboard-effort",
        name: "Resort snowboard hard laps",
        sport: "snowboarding",
        startedAt: new Date("2026-02-02T09:00:00Z"),
        durationSec: 5400,
        distanceMeters: 18000,
        calories: 850,
        avgHeartRate: 136,
        maxHeartRate: 171,
        steps: null,
        elevationGainMeters: 120,
        elevationLossMeters: 1700,
        trainingEffect: 2.7,
      },
      {
        garminId: "hike-ascent",
        name: "Steep ascent hike",
        sport: "hiking",
        startedAt: new Date("2026-02-03T09:00:00Z"),
        durationSec: 7200,
        distanceMeters: 9000,
        calories: 700,
        avgHeartRate: 125,
        maxHeartRate: 160,
        steps: null,
        elevationGainMeters: 1800,
        elevationLossMeters: 100,
        trainingEffect: 2.1,
      },
    ]);

    const evidence = await runGeneratedGarminAnalysis({
      request:
        "Which resort snowboarding days were most demanding by calories, distance, and descent?",
      criterion: "sport_aware_demand_score",
      requestedCount: 2,
    });

    expect(evidence.status).toBe("succeeded");
    expect(evidence.result?.criterion).toBe("sport_aware_demand_score");
    expect(evidence.result?.rows.map((row) => row.garminId)).toEqual([
      "snowboard-effort",
      "snowboard-lift-ascent",
    ]);
    expect(evidence.result?.rows[0].notes).toContain("850 kcal");
    expect(evidence.result?.rows[0].notes).toContain("1,700 m descent");
    expect(evidence.result?.rows[0].notes).not.toContain("elevation gain");
    expect(
      evidence.result?.rows.some((row) => row.garminId === "hike-ascent"),
    ).toBe(false);
  });

  it("discloses missing snowboarding calories and descent without inventing them", async () => {
    const repository = await import("../src/lib/db/repository");
    const { runGeneratedGarminAnalysis } =
      await import("../src/lib/ai/generated-analysis");
    repository.upsertActivities([
      {
        garminId: "snowboard-missing",
        name: "Snowboard limited metrics",
        sport: "snowboarding",
        startedAt: new Date("2026-02-04T09:00:00Z"),
        durationSec: 4200,
        distanceMeters: 12000,
        calories: null,
        avgHeartRate: 128,
        maxHeartRate: 155,
        steps: null,
        elevationGainMeters: 800,
        elevationLossMeters: null,
        trainingEffect: 2.2,
      },
    ]);

    const evidence = await runGeneratedGarminAnalysis({
      request: "Analyze my resort snowboarding demand with missing fields",
      criterion: "sport_aware_demand_score",
      requestedCount: 1,
    });

    expect(evidence.status).toBe("succeeded");
    expect(evidence.result?.rows[0]).toMatchObject({
      garminId: "snowboard-missing",
      units: "sport-aware composite score",
    });
    expect(evidence.result?.rows[0].notes).toContain("calories unavailable");
    expect(evidence.result?.rows[0].notes).toContain("descent unavailable");
    expect(evidence.result?.limitations.join(" ")).toContain(
      "calories are missing",
    );
    expect(JSON.stringify(evidence.result)).not.toContain(
      "800 m elevation gain",
    );
  });
});
