import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-sql-analysis-")),
    "test.sqlite",
  );
});

async function seedActivities() {
  const repository = await import("../src/lib/db/repository");
  repository.upsertActivities([
    {
      garminId: "run-1",
      name: "Hill run",
      sport: "running",
      startedAt: new Date("2026-07-01T07:00:00Z"),
      durationSec: 3600,
      distanceMeters: 9000,
      calories: 600,
      avgHeartRate: 142,
      maxHeartRate: 170,
      steps: 9500,
      elevationGainMeters: 450,
      elevationLossMeters: 450,
      trainingEffect: 3.4,
    },
    {
      garminId: "ride-1",
      name: "Long ride",
      sport: "cycling",
      startedAt: new Date("2026-07-02T07:00:00Z"),
      durationSec: 7200,
      distanceMeters: 75000,
      calories: 1200,
      avgHeartRate: 136,
      maxHeartRate: 166,
      steps: null,
      elevationGainMeters: 900,
      elevationLossMeters: 900,
      trainingEffect: 4.1,
    },
  ]);
  repository.upsertDailyHealth([
    {
      date: "2026-07-01",
      sleepMinutes: 430,
      restingHeartRate: 48,
      hrvStatus: "balanced",
      hrvMs: 58,
      stressAvg: 24,
      steps: 11000,
      calories: 2500,
      bodyBatteryAvg: 70,
      availability: "complete",
    },
  ]);
}

describe("read-only Garmin SQL analysis", () => {
  it("describes allowed analytical schema and excludes private auth surfaces", async () => {
    await seedActivities();
    const { describeGarminDatabase } =
      await import("../src/lib/ai/sql-analysis");

    const description = describeGarminDatabase();

    expect(description.status).toBe("succeeded");
    expect(description.tables.map((table) => table.name)).toContain("activity");
    expect(description.tables.map((table) => table.name)).toContain(
      "daily_health",
    );
    expect(JSON.stringify(description)).toContain("duration_sec");
    expect(JSON.stringify(description)).not.toContain("access_token");
    expect(JSON.stringify(description)).not.toContain("session token");
    expect(description.forbiddenDataClasses.join(" ")).toContain(
      "auth/session/account/verification",
    );
  });

  it("runs bounded SELECT and safe joins over allowed analytical tables", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      resultName: "top_efforts",
      maxRows: 10,
      sql: `
        select a.garmin_id, a.name, a.duration_sec, h.sleep_minutes
        from activity a
        left join daily_health h on h.date = date(a.started_at / 1000, 'unixepoch')
        order by a.duration_sec desc
      `,
    });

    expect(result.status).toBe("succeeded");
    expect(result.resultName).toBe("top_efforts");
    expect(result.rows[0]).toMatchObject({
      garmin_id: "ride-1",
      duration_sec: 7200,
    });
    expect(result.returnedRows).toBe(2);
    expect(result.privacy).toContain("Read-only local SQLite");
  });

  it("rejects writes, pragmas, comments, multi-statements, and disallowed tables", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    for (const sql of [
      "update activity set name = 'bad'",
      "pragma table_info(activity)",
      "select * from activity; select * from daily_health",
      "select * from activity -- hidden",
      "select token from session",
      "select * from garmin_raw_payload",
    ]) {
      const result = runReadOnlySql({ sql });
      expect(result.status).not.toBe("succeeded");
      expect(JSON.stringify(result)).not.toContain(process.env.DATABASE_PATH);
    }
  });

  it("caps rows and reports truncation", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      sql: "select garmin_id, duration_sec from activity order by duration_sec desc",
      maxRows: 1,
    });

    expect(result.status).toBe("succeeded");
    expect(result.returnedRows).toBe(1);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
  });
});
