import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";

const dbDir = join(tmpdir(), "ai-garmin-detail-sync-tests");

beforeEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  vi.resetModules();
});

async function repository() {
  return import("../src/lib/db/repository");
}

describe("detail sync state", () => {
  it("persists activity effort fields additively and preserves refreshed values across sparse sync rows", async () => {
    const repo = await repository();
    repo.upsertActivities([
      {
        garminId: "333333",
        name: "Effort detail",
        sport: "running",
        startedAt: new Date("2026-07-03T07:00:00Z"),
        durationSec: 1800,
        distanceMeters: 5000,
        calories: null,
        avgHeartRate: 145,
        maxHeartRate: 170,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: 3.1,
        anaerobicTrainingEffect: 1.1,
        trainingEffectLabel: "Tempo",
        trainingLoad: 74,
        moderateIntensityMinutes: 12,
        vigorousIntensityMinutes: 3,
        totalIntensityMinutes: 15,
      },
    ]);

    expect(repo.getActivityByGarminId("333333")).toMatchObject({
      trainingEffect: 3.1,
      anaerobicTrainingEffect: 1.1,
      trainingEffectLabel: "Tempo",
      trainingLoad: 74,
      moderateIntensityMinutes: 12,
      vigorousIntensityMinutes: 3,
      totalIntensityMinutes: 15,
    });
    expect(repo.activityEffortCoverage()).toMatchObject({
      total: 1,
      withAnyEffortField: 1,
      withIntensityMinutes: 1,
      needingBackfill: 0,
    });

    repo.upsertActivities([
      {
        garminId: "333333",
        name: "Sparse summary",
        sport: "running",
        startedAt: new Date("2026-07-03T07:00:00Z"),
        durationSec: 1800,
        distanceMeters: 5000,
        calories: null,
        avgHeartRate: 145,
        maxHeartRate: 170,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: null,
      },
    ]);

    expect(repo.getActivityByGarminId("333333")).toMatchObject({
      name: "Sparse summary",
      trainingEffect: 3.1,
      anaerobicTrainingEffect: 1.1,
      trainingEffectLabel: "Tempo",
      trainingLoad: 74,
      moderateIntensityMinutes: 12,
      vigorousIntensityMinutes: 3,
      totalIntensityMinutes: 15,
    });
  });

  it("accounts for pending, terminal, retryable, and preserved detail states", async () => {
    const repo = await repository();
    repo.upsertActivities([
      {
        garminId: "111111",
        name: "Summary only",
        sport: "running",
        startedAt: new Date("2026-07-01T07:00:00Z"),
        durationSec: 1800,
        distanceMeters: 5000,
        calories: null,
        avgHeartRate: 145,
        maxHeartRate: 170,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: null,
      },
      {
        garminId: "222222",
        name: "Detailed",
        sport: "running",
        startedAt: new Date("2026-07-02T07:00:00Z"),
        durationSec: 1200,
        distanceMeters: 3000,
        calories: null,
        avgHeartRate: 140,
        maxHeartRate: 165,
        steps: null,
        elevationGainMeters: null,
        elevationLossMeters: null,
        trainingEffect: null,
      },
    ]);
    repo.upsertActivityDetail(
      normalizeActivityDetail("222222", {
        session: { avg_heart_rate_bpm: 140 },
        records: [{ heart_rate_bpm: 141 }],
      }),
    );

    expect(repo.activityDetailCoverage()).toMatchObject({
      total: 2,
      pending: 1,
      available: 1,
      terminal: 1,
    });

    repo.recordActivityDetailAttempt({
      garminId: "111111",
      status: "failed",
      detailStatus: "failed",
      retryable: true,
      errorClass: "timeout",
      errorMessage: "connector timed out",
    });
    repo.recordActivityDetailAttempt({
      garminId: "222222",
      status: "failed",
      detailStatus: "failed",
      retryable: true,
      errorClass: "connector",
      errorMessage: "temporary connector error",
      preservedPrevious: true,
      force: true,
    });

    expect(repo.listActivityIdsNeedingDetail()).toContain("111111");
    expect(repo.listActivityIdsNeedingDetail()).not.toContain("222222");
    expect(repo.activityDetailCoverage()).toMatchObject({
      retryableFailures: 1,
      preservedFailures: 1,
      available: 1,
    });
  });
});
