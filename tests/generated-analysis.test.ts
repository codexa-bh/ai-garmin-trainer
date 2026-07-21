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
});
