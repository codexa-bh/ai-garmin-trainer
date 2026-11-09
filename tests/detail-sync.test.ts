import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeActivityDetail } from "../src/lib/garmin/detail-normalize";
import { normalizeActivity } from "../src/lib/garmin/normalize";

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
  it("enumerates beyond both former selection ceilings and counts retryable candidates only once", async () => {
    const repo = await repository();
    repo.upsertActivities(
      Array.from({ length: 5003 }, (_, index) =>
        normalizeActivity({
          activityId: String(index),
          startTimeLocal: "2026-07-01T12:00:00Z",
          activityType: "running",
        }),
      ),
    );
    repo.recordActivityDetailAttempt({
      garminId: "0",
      status: "failed",
      retryable: true,
    });
    repo.upsertActivityDetail(
      normalizeActivityDetail("1", { records: [{ heart_rate_bpm: 140 }] }),
    );
    repo.upsertActivityDetail({
      ...normalizeActivityDetail("2", {}),
      status: "unsupported",
    });
    expect(repo.listActivityIdsNeedingDetail()).toHaveLength(5001);
    expect(new Set(repo.listActivityIdsNeedingDetail()).size).toBe(5001);
    expect(repo.listActivityIdsNeedingDetail(500)).toHaveLength(500);
    expect(repo.listActivityIdsNeedingDetail(9999)).toHaveLength(5000);
    expect(repo.listActivityIdsNeedingDetail()).not.toContain("1");
    expect(repo.listActivityIdsNeedingDetail()).not.toContain("2");
  });
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
