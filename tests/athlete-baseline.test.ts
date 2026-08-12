import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GarminAthleteBaselineSnapshot,
  GarminBodyMetricsSnapshot,
} from "../src/lib/garmin/types";

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

function bodySnapshot(
  overrides: Partial<GarminBodyMetricsSnapshot> = {},
): GarminBodyMetricsSnapshot {
  return {
    availability: "complete",
    source: "garmin_mcp",
    fetchedAt: new Date("2026-08-12T08:00:00Z"),
    values: { weightKg: 70.2, heightCm: 181 },
    history: {
      availability: "available",
      rangeStart: "2026-08-10",
      rangeEnd: "2026-08-11",
      count: 2,
    },
    historyRows: [
      {
        date: "2026-08-10",
        weightKg: 70.4,
        source: "garmin_mcp",
        fetchedAt: new Date("2026-08-12T08:00:00Z"),
      },
      {
        date: "2026-08-11",
        weightKg: 70.2,
        source: "garmin_mcp",
        fetchedAt: new Date("2026-08-12T08:00:00Z"),
      },
    ],
    ...overrides,
  };
}

function snapshot(overrides: Partial<GarminAthleteBaselineSnapshot> = {}) {
  return {
    availability: "partial",
    source: "garmin_mcp",
    fetchedAt: new Date("2026-07-20T08:00:00Z"),
    values: {
      configuredMaxHeartRateBpm: null,
      heartRateZones: {
        status: "unavailable",
        source: null,
        formula: null,
        boundaries: [],
      },
      cyclingFtpWatts: 250,
      cyclingFtpMeasuredOn: "2026-07-19",
      cyclingFtpSourceStale: false,
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
        configuredMaxHeartRateBpm: null,
        heartRateZones: {
          status: "unavailable",
          source: null,
          formula: null,
          boundaries: [],
        },
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

  it("persists Garmin body metrics separately and clears them only with Garmin data", async () => {
    const repo = await repository();

    repo.writeGarminBodyMetricsRefresh({
      snapshot: bodySnapshot(),
      status: "complete",
      attemptedAt: new Date("2026-08-12T08:00:00Z"),
    });

    expect(repo.getGarminBodyMetrics()).toMatchObject({
      availability: "complete",
      source: "garmin_mcp",
      values: { weightKg: 70.2, heightCm: 181 },
      history: { availability: "available", count: 2 },
    });
    expect(repo.importSummary().bodyMetrics.values.weightKg).toBe(70.2);
    expect(repo.clearChatAndProfile()).not.toContain("garmin_body_metrics");
    expect(repo.getGarminBodyMetrics().source).toBe("garmin_mcp");

    repo.recordGarminBodyMetricsFailure({
      attemptedAt: new Date("2026-08-13T08:00:00Z"),
      errorMessage: "connector timeout with private payload omitted",
      preservedPrevious: true,
    });
    expect(repo.getGarminBodyMetrics()).toMatchObject({
      availability: "failed",
      preservedPrevious: true,
      values: { weightKg: 70.2 },
    });

    const deleted = repo.clearGarminData();
    expect(deleted).toEqual(
      expect.arrayContaining([
        "garmin_body_metrics",
        "garmin_body_metric_attempt",
        "garmin_body_weight_history",
      ]),
    );
    expect(repo.getGarminBodyMetrics()).toMatchObject({
      availability: "unavailable",
      source: null,
      fetchedAt: null,
    });
  });
});
