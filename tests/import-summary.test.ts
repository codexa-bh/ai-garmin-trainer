import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedDailyHealth } from "../src/lib/garmin/types";

const dbDir = join(tmpdir(), "ai-garmin-import-summary-tests");

beforeEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  vi.resetModules();
});

async function repository() {
  return import("../src/lib/db/repository");
}

function dailyHealth(
  date: string,
  values: Partial<NormalizedDailyHealth>,
): NormalizedDailyHealth {
  return {
    date,
    sleepMinutes: values.sleepMinutes ?? null,
    restingHeartRate: values.restingHeartRate ?? null,
    hrvStatus: values.hrvStatus ?? null,
    hrvMs: values.hrvMs ?? null,
    stressAvg: values.stressAvg ?? null,
    steps: values.steps ?? null,
    calories: values.calories ?? null,
    bodyBatteryAvg: values.bodyBatteryAvg ?? null,
    availability: values.availability ?? "missing",
  };
}

describe("import summary health coverage", () => {
  it("returns zero health coverage and null boundaries for an empty database", async () => {
    const repo = await repository();

    expect(repo.importSummary()).toMatchObject({
      healthDays: 0,
      healthCoverage: {
        totalRows: 0,
        completeDays: 0,
        partialDays: 0,
        missingDays: 0,
        metrics: {
          sleepDays: 0,
          restingHeartRateDays: 0,
          hrvDays: 0,
          stressDays: 0,
          stepsDays: 0,
          calorieDays: 0,
          bodyBatteryDays: 0,
        },
      },
      healthStartDate: null,
      healthEndDate: null,
    });
  });

  it("separates complete, partial, missing, total-row, and non-null metric counts", async () => {
    const repo = await repository();

    repo.upsertDailyHealth([
      dailyHealth("2026-07-20", {
        sleepMinutes: 0,
        restingHeartRate: 0,
        hrvMs: 0,
        stressAvg: 0,
        steps: 0,
        calories: 0,
        bodyBatteryAvg: 0,
        availability: "complete",
      }),
      dailyHealth("2026-07-21", {
        sleepMinutes: 420,
        steps: 6500,
        availability: "partial",
      }),
      dailyHealth("2026-07-22", {
        availability: "missing",
      }),
    ]);

    expect(repo.healthCoverage()).toEqual({
      totalRows: 3,
      completeDays: 1,
      partialDays: 1,
      missingDays: 1,
      metrics: {
        sleepDays: 2,
        restingHeartRateDays: 1,
        hrvDays: 1,
        stressDays: 1,
        stepsDays: 2,
        calorieDays: 1,
        bodyBatteryDays: 1,
      },
    });
    expect(repo.importSummary()).toMatchObject({
      healthDays: 3,
      healthCoverage: repo.healthCoverage(),
      healthStartDate: "2026-07-20",
      healthEndDate: "2026-07-22",
    });
  });
});
