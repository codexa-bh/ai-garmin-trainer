import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GarminAthleteBaselineSnapshot } from "../src/lib/garmin/types";

const dbDir = join(tmpdir(), "ai-garmin-athlete-baseline-tests");

beforeEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  vi.resetModules();
});

async function repository() {
  return import("../src/lib/db/repository");
}

function snapshot(overrides: Partial<GarminAthleteBaselineSnapshot> = {}) {
  return {
    availability: "partial",
    source: "garmin_mcp",
    fetchedAt: new Date("2026-07-20T08:00:00Z"),
    values: {
      runningLactateThresholdHeartRateBpm: 168,
      cyclingLactateThresholdHeartRateBpm: null,
      rowingLactateThresholdHeartRateBpm: null,
      cyclingFtpWatts: 250,
      cyclingFtpMeasuredOn: "2026-07-19",
      cyclingFtpSourceStale: false,
      vo2MaxRunning: 52.1,
      vo2MaxCycling: null,
      availableTrainingDays: ["monday", "wednesday"],
      preferredLongTrainingDays: ["sunday"],
    },
    ...overrides,
  } satisfies GarminAthleteBaselineSnapshot;
}

describe("Garmin athlete baseline repository", () => {
  it("persists a latest normalized snapshot and read-only DTO", async () => {
    const repo = await repository();

    repo.writeGarminAthleteBaselineRefresh({
      snapshot: snapshot(),
      status: "partial",
      attemptedAt: new Date("2026-07-20T08:00:00Z"),
    });

    expect(repo.getGarminAthleteBaseline()).toMatchObject({
      availability: "partial",
      source: "garmin_mcp",
      fetchedAt: "2026-07-20T08:00:00.000Z",
      values: {
        runningLactateThresholdHeartRateBpm: 168,
        cyclingFtpWatts: 250,
        availableTrainingDays: ["monday", "wednesday"],
      },
      unsupported: {
        configuredMaxHeartRate: true,
        completeHeartRateZoneBoundaries: true,
        reason: "not_exposed_by_pinned_connector",
      },
    });
  });

  it("preserves last known good athlete facts after failed refresh", async () => {
    const repo = await repository();
    repo.writeGarminAthleteBaselineRefresh({
      snapshot: snapshot(),
      status: "partial",
      attemptedAt: new Date("2026-07-20T08:00:00Z"),
    });

    repo.recordGarminAthleteBaselineFailure({
      attemptedAt: new Date("2026-07-21T08:00:00Z"),
      errorMessage: "connector timeout with private payload omitted",
      preservedPrevious: true,
    });

    expect(repo.getGarminAthleteBaseline()).toMatchObject({
      availability: "failed",
      fetchedAt: "2026-07-20T08:00:00.000Z",
      lastAttemptAt: "2026-07-21T08:00:00.000Z",
      preservedPrevious: true,
      values: { runningLactateThresholdHeartRateBpm: 168 },
    });
  });

  it("clears Garmin athlete baselines only with Garmin data deletion", async () => {
    const repo = await repository();
    repo.writeGarminAthleteBaselineRefresh({
      snapshot: snapshot(),
      status: "partial",
      attemptedAt: new Date("2026-07-20T08:00:00Z"),
    });

    expect(repo.clearChatAndProfile()).not.toContain("garmin_athlete_baseline");
    expect(repo.getGarminAthleteBaseline().source).toBe("garmin_mcp");

    const deleted = repo.clearGarminData();
    expect(deleted).toEqual(
      expect.arrayContaining([
        "garmin_athlete_baseline",
        "garmin_athlete_baseline_attempt",
      ]),
    );
    expect(repo.getGarminAthleteBaseline()).toMatchObject({
      availability: "unavailable",
      source: null,
      fetchedAt: null,
    });
  });
});
