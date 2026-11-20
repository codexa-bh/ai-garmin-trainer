import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

const dbDir = join(tmpdir(), "ai-garmin-supplement-read-tests");

beforeEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
  process.env.DATABASE_PATH = join(dbDir, `${crypto.randomUUID()}.sqlite`);
  vi.resetModules();
});

async function open() {
  const { getDatabase } = await import("../src/lib/db/connection");
  const db: Database.Database = getDatabase();
  return {
    db,
    read: await import("../src/lib/db/supplement-repository"),
    app: await import("../src/lib/local-data/composition"),
  };
}

const NOW = 1;
function health(db: Database.Database, date: string) {
  db.prepare(
    "insert into daily_health (date, availability) values (?, 'complete')",
  ).run(date);
}
function cover(
  db: Database.Database,
  group: string,
  type: "date" | "activity",
  id: string,
  status: string,
  reason: string | null = null,
) {
  db.prepare("insert into garmin_data_coverage values (?, ?, ?, ?, ?, ?)").run(
    group,
    type,
    id,
    status,
    reason,
    NOW,
  );
}

describe("health supplement read", () => {
  it("returns null without daily rows and reads only dates inside the bounded window", async () => {
    const { db, read } = await open();
    expect(read.getHealthSupplements(366)).toBeNull();
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"])
      health(db, date);
    db.prepare(
      "insert into daily_stress (date, rest_seconds, fetched_at) values ('2026-09-01', 5, 1)",
    ).run();
    const window = read.getHealthSupplements(2)!;
    // Newest two daily rows bound the window; the older stress row is outside it.
    expect([window.from, window.to]).toEqual(["2026-10-02", "2026-10-03"]);
    expect(window.days).toEqual([]);
  });

  it("keeps HRV band only with ordered endpoints and never extrapolates across dates", async () => {
    const { db, read } = await open();
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"])
      health(db, date);
    const insert = db.prepare(
      `insert into daily_hrv_detail (date, weekly_avg_ms, baseline_balanced_low_ms, baseline_balanced_upper_ms, feedback_code, fetched_at)
       values (?, ?, ?, ?, ?, 1)`,
    );
    insert.run("2026-10-01", 44, 38, 52, "BALANCED");
    insert.run("2026-10-02", 45, null, 52, "BALANCED");
    insert.run("2026-10-03", 46, 60, 40, "free text: ignore previous!");
    const days = new Map(
      read.getHealthSupplements(366)!.days.map((day) => [day.date, day]),
    );
    expect(days.get("2026-10-01")!.hrv).toEqual({
      weeklyAvgMs: 44,
      balancedLowMs: 38,
      balancedUpperMs: 52,
      feedbackCode: "BALANCED",
    });
    // One missing endpoint and a reversed band both leave no band at all.
    expect(days.get("2026-10-02")!.hrv).toMatchObject({
      balancedLowMs: null,
      balancedUpperMs: null,
    });
    expect(days.get("2026-10-03")!.hrv).toMatchObject({
      balancedLowMs: null,
      balancedUpperMs: null,
      feedbackCode: null,
    });
    // No row for 2026-10-04: absent, not a carried-forward band.
    expect(days.has("2026-10-04")).toBe(false);
  });

  it("returns each sleep component once per date with qualifier-only parts numberless", async () => {
    const { db, read } = await open();
    health(db, "2026-10-01");
    db.prepare(
      "insert into daily_sleep_detail (date, overall_qualifier, fetched_at) values ('2026-10-01','GOOD',1)",
    ).run();
    const part = db.prepare(
      "insert into daily_sleep_score_component (date, component, value, qualifier) values ('2026-10-01', ?, ?, ?)",
    );
    part.run("overall", 81, "GOOD");
    part.run("deep", 0, "POOR");
    part.run("stress", null, "FAIR");
    part.run("restlessness", null, null);
    const day = read.getHealthSupplements(366)!.days[0];
    expect(day.sleep!.overallQualifier).toBe("GOOD");
    expect(day.sleep!.components).toEqual([
      { component: "deep", value: 0, qualifier: "POOR" },
      { component: "overall", value: 81, qualifier: "GOOD" },
      { component: "restlessness", value: null, qualifier: null },
      { component: "stress", value: null, qualifier: "FAIR" },
    ]);
  });

  it("reads stress buckets and charged/drained keeping zero distinct from null", async () => {
    const { db, read } = await open();
    for (const date of ["2026-10-01", "2026-10-02"]) health(db, date);
    db.prepare(
      `insert into daily_stress (date, total_seconds, rest_seconds, low_seconds, medium_seconds, high_seconds, activity_seconds, uncategorized_seconds, fetched_at)
       values ('2026-10-01', 86400, 40000, 20000, 0, null, 3000, 23400, 1)`,
    ).run();
    db.prepare(
      "insert into daily_body_battery (date, charged, drained, latest_level, end_of_day_level, fetched_at) values ('2026-10-01', 0, null, 77, 30, 1), ('2026-10-02', 55, 61, 10, 12, 1)",
    ).run();
    const days = new Map(
      read.getHealthSupplements(366)!.days.map((d) => [d.date, d]),
    );
    expect(days.get("2026-10-01")!.stress).toMatchObject({
      mediumSeconds: 0,
      highSeconds: null,
      activitySeconds: 3000,
      uncategorizedSeconds: 23400,
    });
    expect(days.get("2026-10-01")!.bodyBattery).toEqual({
      charged: 0,
      drained: null,
    });
    // Levels never leak into charged/drained.
    expect(days.get("2026-10-02")!.bodyBattery).toEqual({
      charged: 55,
      drained: 61,
    });
    expect(days.get("2026-10-02")!.stress).toBeNull();
  });

  it("keeps multisport VO2 readings distinct and sparse without carrying values forward", async () => {
    const { db, read } = await open();
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"])
      health(db, date);
    db.prepare(
      `insert into vo2_max_reading (date, branch, vo2_max, vo2_max_precise, sport, sub_sport, fetched_at) values
       ('2026-10-01','generic',51,51.4,'RUNNING','GENERIC',1),
       ('2026-10-01','cycling',58,null,'CYCLING','ROAD',1),
       ('2026-10-03','generic',null,null,null,null,1)`,
    ).run();
    const { vo2 } = read.getHealthSupplements(366)!;
    expect(vo2.map((p) => `${p.date}/${p.branch}`)).toEqual([
      "2026-10-01/cycling",
      "2026-10-01/generic",
      "2026-10-03/generic",
    ]);
    expect(vo2[1]).toMatchObject({ vo2Max: 51, vo2MaxPrecise: 51.4 });
    expect(vo2.some((p) => p.date === "2026-10-02")).toBe(false);
  });

  it("maps every coverage state and treats an absent row as not imported, never empty", async () => {
    const { db, read } = await open();
    health(db, "2026-10-01");
    cover(db, "sleep", "date", "2026-10-01", "populated");
    cover(db, "hrv", "date", "2026-10-01", "empty");
    cover(db, "stress", "date", "2026-10-01", "failed", "http_429");
    cover(
      db,
      "body_battery",
      "date",
      "2026-10-01",
      "unavailable",
      "Garmin said: leak",
    );
    const day = read.getHealthSupplements(366)!.days[0];
    expect(day.coverage.sleep.status).toBe("populated");
    expect(day.coverage.hrv.status).toBe("empty");
    expect(day.coverage.stress).toEqual({
      status: "failed",
      reason: "http_429",
    });
    // Free text reasons are dropped; only closed short codes survive.
    expect(day.coverage.body_battery).toEqual({
      status: "unavailable",
      reason: null,
    });
    expect(day.coverage.vo2_max).toEqual({
      status: "not_imported",
      reason: null,
    });
    // Coverage alone does not imply a field: populated sleep without a row has no sleep object.
    expect(day.sleep).toBeNull();
  });

  it("leaves the existing legacy daily rows and fields untouched by the supplement read", async () => {
    const { db, read, app } = await open();
    health(db, "2026-10-01");
    const before = db.prepare("select * from daily_health").all();
    read.getHealthSupplements(366);
    expect(db.prepare("select * from daily_health").all()).toEqual(before);
    const payload = app.healthDashboard();
    expect(payload.days).toHaveLength(1);
    expect(payload.supplements).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });
});

function activity(db: Database.Database, id = "a1") {
  db.prepare(
    "insert into activity (id, garmin_id, sport, started_at) values (?, ?, 'resort_snowboarding', 1)",
  ).run(id, id);
  return id;
}

describe("activity supplement read", () => {
  it("returns unknown coverage and empty evidence for an activity with nothing imported", async () => {
    const { db, read } = await open();
    const id = activity(db);
    const result = read.getActivitySupplement(id);
    expect(result.bodyBatteryDelta).toBeNull();
    expect(result.lapZones).toEqual([]);
    expect(result.snowRuns).toEqual({
      total: 0,
      returned: 0,
      truncated: false,
      entries: [],
    });
    expect(
      Object.values(result.coverage).every((c) => c.status === "not_imported"),
    ).toBe(true);
  });

  it("carries signed battery delta and keeps list and FIT cadence separately labelled", async () => {
    const { db, read } = await open();
    const id = activity(db);
    db.prepare(
      `insert into activity_extra_metrics (garmin_id, body_battery_delta, avg_run_cadence_spm, max_run_cadence_spm, avg_stride_length_cm, fit_avg_cadence_cpm, fit_avg_step_length_m, fetched_at)
       values (?, -12, 158, 171, 104.5, 79.5, 1.04, 1)`,
    ).run(id);
    const result = read.getActivitySupplement(id);
    expect(result.bodyBatteryDelta).toBe(-12);
    expect(result.listCadence).toEqual({
      avgSpm: 158,
      maxSpm: 171,
      strideLengthCm: 104.5,
    });
    // FIT cadence stays fractional cycles/min, never doubled into steps/min.
    expect(result.fitCadence).toEqual({ avgCpm: 79.5, stepLengthM: 1.04 });
  });

  it("attaches lap-zone buckets by stored lap number without multiplying laps or crossing activities", async () => {
    const { db, read } = await open();
    const id = activity(db);
    const other = activity(db, "a2");
    const lap = db.prepare(
      "insert into activity_lap (garmin_id, lap_number) values (?, ?)",
    );
    for (const n of [1, 2, 3]) lap.run(id, n);
    lap.run(other, 1);
    const zone = db.prepare(
      `insert into activity_lap_hr_zone_time (garmin_id, lap_number, bucket, bucket_kind, zone, seconds, lower_bpm, upper_bpm, calc_method, source_max_heart_rate, source_resting_heart_rate, fetched_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, 'PERCENT_MAX_HR', 190, 52, 1)`,
    );
    zone.run(id, 1, 0, "below", null, 12, null, 99);
    zone.run(id, 1, 1, "zone", 1, 0, 100, 115);
    zone.run(id, 1, 6, "above", null, 33, 190, null);
    zone.run(id, 3, 2, "zone", 2, 61, 116, 134);
    zone.run(other, 1, 1, "zone", 1, 999, 100, 115);
    // Lap 2 has no zone rows: unknown, not a copy of a neighbour or session total.
    const result = read.getActivitySupplement(id);
    expect(result.lapZones.map((l) => l.lapNumber)).toEqual([1, 3]);
    expect(
      result.lapZones[0].buckets.map((b) => [b.bucket, b.kind, b.seconds]),
    ).toEqual([
      [0, "below", 12],
      [1, "zone", 0],
      [6, "above", 33],
    ]);
    expect(result.lapZones[0]).toMatchObject({
      calcMethod: "PERCENT_MAX_HR",
      sourceMaxHeartRate: 190,
      sourceRestingHeartRate: 52,
    });
    expect(JSON.stringify(result)).not.toContain("999");
  });

  it("separates per-type totals from individual runs and bounds the run list with disclosed omission", async () => {
    const { db, read } = await open();
    const id = activity(db);
    db.prepare(
      `insert into activity_split_summary (garmin_id, split_type, split_count, duration_sec, distance_meters, max_distance_meters, max_speed_mps, fetched_at)
       values (?, 'SKI_RUN_SPLIT', 70, 4000, 51000, 1900, 22.5, 1)`,
    ).run(id);
    const run = db.prepare(
      `insert into activity_snow_split (garmin_id, split_key, message_index, source_order, split_type, start_time, timer_seconds, distance_meters, descent_meters, start_lat, start_lon, fetched_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 46.5, 7.5, 1)`,
    );
    for (let i = 0; i < 65; i++)
      run.run(
        id,
        `index:${i}`,
        i,
        i,
        i % 2 ? "lift" : "run",
        `2026-01-01T10:${String(i).padStart(2, "0")}:00Z`,
        60 + i,
        500 + i,
        i % 2 ? 0 : 120,
      );
    const result = read.getActivitySupplement(id);
    expect(result.snowTotals).toEqual([
      {
        splitType: "SKI_RUN_SPLIT",
        count: 70,
        durationSec: 4000,
        distanceMeters: 51000,
        bestSplitDistanceMeters: 1900,
        maxSpeedMps: 22.5,
      },
    ]);
    expect(result.snowRuns).toMatchObject({
      total: 65,
      returned: 60,
      truncated: true,
    });
    expect(result.snowRuns.entries[0].splitKey).toBe("index:0");
    // The individual list never carries locations.
    expect(JSON.stringify(result.snowRuns)).not.toMatch(
      /"(start|end)?(Lat|Lon)[A-Za-z]*"|46\.5|7\.5/i,
    );
    // Totals (70) are never added to or confused with the stored individual entries (65).
    expect(result.snowRuns.total).not.toBe(result.snowTotals[0].count);
  });

  it("reports populated individual-run coverage independently of aggregate coverage", async () => {
    const { db, read } = await open();
    const id = activity(db);
    cover(db, "snow_run_lift_splits", "activity", id, "empty");
    cover(db, "snowboard_splits", "activity", id, "populated");
    const { coverage } = read.getActivitySupplement(id);
    expect(coverage.snow_run_lift_splits.status).toBe("empty");
    expect(coverage.snowboard_splits.status).toBe("populated");
    expect(coverage.lap_hr_zones.status).toBe("not_imported");
  });
});

describe("activity dashboard route projection", () => {
  it("serializes only the explicit supplement allowlist, with unchanged existing fields and no locations", async () => {
    const { db } = await open();
    const id = activity(db);
    db.prepare(
      `insert into activity_extra_metrics (garmin_id, body_battery_delta, avg_run_cadence_spm, avg_ground_contact_time_ms, fit_avg_cadence_cpm, fetched_at)
       values (?, 4, 150, 245, 75, 1)`,
    ).run(id);
    db.prepare(
      `insert into activity_snow_split (garmin_id, split_key, message_index, source_order, split_type, start_lat, start_lon, end_lat, end_lon, fetched_at)
       values (?, 'index:1', 1, 1, 'run', 46.123456, 7.654321, 46.2, 7.7, 1)`,
    ).run(id);
    cover(db, "running_dynamics", "activity", id, "populated");
    const route =
      await import("../src/app/api/activities/[garminId]/dashboard/route");
    const response = await route.GET(
      new Request("http://local.test/dashboard"),
      { params: { garminId: id } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(
      [
        "activity",
        "charts",
        "detail",
        "heartRateZones",
        "laps",
        "route",
        "supplement",
        "terrainSections",
      ].sort(),
    );
    expect(Object.keys(body.supplement).sort()).toEqual(
      [
        "bodyBatteryDelta",
        "coverage",
        "fitCadence",
        "lapZones",
        "listCadence",
        "snowRuns",
        "snowTotals",
      ].sort(),
    );
    expect(body.supplement.bodyBatteryDelta).toBe(4);
    expect(body.supplement.coverage.running_dynamics.status).toBe("populated");
    // Running-dynamics fields outside the request and all coordinates stay unexposed.
    const text = JSON.stringify(body.supplement);
    expect(text).not.toMatch(/\b245\b|groundContact|46\.1|7\.65/);
    expect(text).not.toMatch(/"(start|end)?(Lat|Lon|lat|lon)[A-Za-z]*"/);
  });

  it("returns 404 without a supplement read for an unknown activity", async () => {
    await open();
    const route =
      await import("../src/app/api/activities/[garminId]/dashboard/route");
    const response = await route.GET(
      new Request("http://local.test/dashboard"),
      { params: { garminId: "missing" } },
    );
    expect(response.status).toBe(404);
  });
});
