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
      anaerobicTrainingEffect: 1.8,
      trainingEffectLabel: "Endurance",
      trainingLoad: 126,
      moderateIntensityMinutes: 40,
      vigorousIntensityMinutes: 18,
      totalIntensityMinutes: 58,
    },
    {
      garminId: "jan-run-1",
      name: "January run",
      sport: "running",
      startedAt: new Date("2026-01-15T07:00:00Z"),
      durationSec: 1800,
      distanceMeters: 5000,
      calories: 300,
      avgHeartRate: 132,
      maxHeartRate: 160,
      steps: 6200,
      elevationGainMeters: 80,
      elevationLossMeters: 80,
      trainingEffect: 2.3,
    },
    {
      garminId: "aug-ride-1",
      name: "August ride",
      sport: "cycling",
      startedAt: new Date("2026-08-05T07:00:00Z"),
      durationSec: 5400,
      distanceMeters: 42000,
      calories: 900,
      avgHeartRate: 138,
      maxHeartRate: 168,
      steps: null,
      elevationGainMeters: 520,
      elevationLossMeters: 520,
      trainingEffect: 3.6,
    },
  ]);
  repository.upsertDailyHealth([
    {
      date: "2026-07-01",
      sleepMinutes: 430,
      sleepScore: 82,
      sleepDeepMinutes: 74,
      sleepLightMinutes: 268,
      sleepRemMinutes: 70,
      sleepAwakeMinutes: 18,
      sleepNapMinutes: 20,
      restingHeartRate: 48,
      hrvStatus: "balanced",
      hrvMs: 58,
      stressAvg: 24,
      steps: 11000,
      calories: 2500,
      activeCalories: 900,
      restingCalories: 1600,
      totalCalories: 2500,
      intensityMinutes: 45,
      bodyBatteryAvg: 70,
      bodyBatteryMorning: 86,
      bodyBatteryEvening: 44,
      availability: "complete",
    },
    {
      date: "2026-08-05",
      sleepMinutes: 410,
      sleepScore: 78,
      sleepDeepMinutes: 68,
      sleepLightMinutes: 250,
      sleepRemMinutes: 72,
      sleepAwakeMinutes: 20,
      sleepNapMinutes: null,
      restingHeartRate: 50,
      hrvStatus: "balanced",
      hrvMs: 55,
      stressAvg: 28,
      steps: 9000,
      calories: 2300,
      activeCalories: 700,
      restingCalories: 1600,
      totalCalories: 2300,
      intensityMinutes: 35,
      bodyBatteryAvg: 66,
      bodyBatteryMorning: 80,
      bodyBatteryEvening: 42,
      availability: "complete",
    },
  ]);
  for (const detail of [
    {
      garminId: "run-1",
      fetchedAt: new Date("2026-07-01T08:00:00Z"),
      source: "garmin_mcp" as const,
      status: "available" as const,
      sourceTotalSeconds: 3600,
      buckets: [
        { zone: 1 as const, seconds: 600, sourceLowerBpm: 95 },
        { zone: 2 as const, seconds: 1200, sourceLowerBpm: 114 },
        { zone: 3 as const, seconds: 900, sourceLowerBpm: 133 },
        { zone: 4 as const, seconds: 600, sourceLowerBpm: 152 },
        { zone: 5 as const, seconds: 300, sourceLowerBpm: 171 },
      ],
    },
    {
      garminId: "ride-1",
      fetchedAt: new Date("2026-07-02T09:00:00Z"),
      source: "garmin_mcp" as const,
      status: "available" as const,
      sourceTotalSeconds: 7200,
      buckets: [
        { zone: 1 as const, seconds: 1800, sourceLowerBpm: 95 },
        { zone: 2 as const, seconds: 2400, sourceLowerBpm: 114 },
        { zone: 3 as const, seconds: 1800, sourceLowerBpm: 133 },
        { zone: 4 as const, seconds: 900, sourceLowerBpm: 152 },
        { zone: 5 as const, seconds: 300, sourceLowerBpm: 171 },
      ],
    },
    {
      garminId: "aug-ride-1",
      fetchedAt: new Date("2026-08-05T09:00:00Z"),
      source: "garmin_mcp" as const,
      status: "available" as const,
      sourceTotalSeconds: 5400,
      buckets: [
        { zone: 1 as const, seconds: 900, sourceLowerBpm: 95 },
        { zone: 2 as const, seconds: 1500, sourceLowerBpm: 114 },
        { zone: 3 as const, seconds: 1600, sourceLowerBpm: 133 },
        { zone: 4 as const, seconds: 1000, sourceLowerBpm: 152 },
        { zone: 5 as const, seconds: 400, sourceLowerBpm: 171 },
      ],
    },
  ]) {
    repository.upsertActivityHrZoneTime(detail);
  }
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
    expect(description.tables.map((table) => table.name)).toContain(
      "garmin_body_metrics",
    );
    expect(description.tables.map((table) => table.name)).toContain(
      "garmin_body_weight_history",
    );
    expect(description.tables.map((table) => table.name)).toContain(
      "activity_hr_zone_time",
    );
    expect(description.tables.map((table) => table.name)).not.toEqual(
      expect.arrayContaining([
        "user",
        "session",
        "account",
        "conversation",
        "message",
        "trainer_memory",
        "semantic_memory",
        "garmin_raw_payload",
        "sync_run",
        "sync_checkpoint",
        "activity_detail_attempt",
      ]),
    );
    const dailyHealth = description.tables.find(
      (table) => table.name === "daily_health",
    );
    expect(dailyHealth?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sleep_score", unit: "score" }),
        expect.objectContaining({
          name: "sleep_deep_minutes",
          unit: "minutes",
        }),
        expect.objectContaining({
          name: "sleep_light_minutes",
          unit: "minutes",
        }),
        expect.objectContaining({ name: "sleep_rem_minutes", unit: "minutes" }),
        expect.objectContaining({
          name: "sleep_awake_minutes",
          unit: "minutes",
        }),
        expect.objectContaining({ name: "sleep_nap_minutes", unit: "minutes" }),
      ]),
    );
    expect(JSON.stringify(description)).toContain(
      "Garmin/source-provided sleep score",
    );
    expect(JSON.stringify(description)).toContain("duration_sec");
    expect(JSON.stringify(description)).toContain("source_updated_at");
    expect(JSON.stringify(description)).toContain("moderate_intensity_minutes");
    expect(JSON.stringify(description)).toContain("anaerobic_training_effect");
    expect(JSON.stringify(description)).toContain("training_load");
    expect(JSON.stringify(description)).toContain("distance_meters");
    expect(JSON.stringify(description)).toContain("temperature_c");
    expect(JSON.stringify(description)).toContain("lat");
    expect(JSON.stringify(description)).toContain("lon");
    expect(JSON.stringify(description)).toContain(
      "bounded normalized GPS route coordinates",
    );
    expect(JSON.stringify(description)).toContain("activity_hr_zone_time");
    expect(JSON.stringify(description)).toContain("hr_zone_seconds");
    expect(JSON.stringify(description)).toContain("source_total_seconds");
    expect(JSON.stringify(description)).toContain("heart_rate_zones_json");
    expect(JSON.stringify(description)).toContain("session_json");
    expect(description.examples.join(" ")).toContain(
      "unixepoch('now', '-365 days') * 1000",
    );
    expect(description.examples.join(" ")).toContain("activity_calories_kcal");
    expect(description.examples.join(" ")).toContain("active_calories_kcal");
    expect(description.examples.join(" ")).toContain("activity_hr_zone_time");
    expect(description.examples.join(" ")).toContain("strftime('%Y-%m'");
    expect(description.examples.join(" ")).toContain("model-selected formula");
    expect(description.examples.join(" ")).not.toContain(
      "sportNormalizedDemand",
    );
    expect(JSON.stringify(description)).toContain("weight_kg");
    expect(JSON.stringify(description)).toContain("history_source");
    expect(JSON.stringify(description)).toContain("current_weight_source");
    expect(JSON.stringify(description)).toContain("weigh_in_availability");
    expect(JSON.stringify(description)).toContain("weigh-in");
    expect(JSON.stringify(description)).not.toContain("bodyFat");
    expect(JSON.stringify(description)).not.toContain("access_token");
    expect(JSON.stringify(description)).not.toContain("session token");
    expect(description.forbiddenDataClasses.join(" ")).toContain(
      "auth/session/account/verification",
    );
    expect(description.forbiddenDataClasses.join(" ")).toContain(
      "conversation/message/memory/profile",
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
    expect(result.returnedRows).toBe(4);
    expect(result.privacy).toContain("Read-only local SQLite");
  });

  it("runs bounded SELECT over source-provided sleep detail columns", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      resultName: "sleep_details",
      maxRows: 7,
      sql: `
        select date,
               sleep_minutes,
               sleep_score,
               sleep_deep_minutes,
               sleep_light_minutes,
               sleep_rem_minutes,
               sleep_awake_minutes,
               sleep_nap_minutes
        from daily_health
        where sleep_minutes is not null
        order by date desc
        limit 7
      `,
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows).toEqual([
      {
        date: "2026-08-05",
        sleep_minutes: 410,
        sleep_score: 78,
        sleep_deep_minutes: 68,
        sleep_light_minutes: 250,
        sleep_rem_minutes: 72,
        sleep_awake_minutes: 20,
        sleep_nap_minutes: null,
      },
      {
        date: "2026-07-01",
        sleep_minutes: 430,
        sleep_score: 82,
        sleep_deep_minutes: 74,
        sleep_light_minutes: 268,
        sleep_rem_minutes: 70,
        sleep_awake_minutes: 18,
        sleep_nap_minutes: 20,
      },
    ]);
  });

  it("runs a last-365-days demand candidate extraction query over exact exposed columns", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      resultName: "demand_candidates",
      maxRows: 200,
      sql: `
        select garmin_id,
               coalesce(name, sport || ' on ' || date(started_at / 1000, 'unixepoch')) as label,
               sport,
               date(started_at / 1000, 'unixepoch') as date,
               duration_sec,
               distance_meters,
               calories,
               avg_heart_rate,
               max_heart_rate,
               elevation_gain_meters,
               elevation_loss_meters,
               training_effect,
               anaerobic_training_effect,
               training_load,
               moderate_intensity_minutes,
               vigorous_intensity_minutes,
               total_intensity_minutes
        from activity
        where started_at >= unixepoch('2026-07-22', '-365 days') * 1000
        order by started_at desc
        limit 200
      `,
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          garmin_id: "ride-1",
          label: "Long ride",
          sport: "cycling",
        }),
      ]),
    );
    expect(result.columns.map((column) => column.name)).toContain(
      "elevation_loss_meters",
    );
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          garmin_id: "ride-1",
          training_load: 126,
          total_intensity_minutes: 58,
        }),
      ]),
    );
  });

  it("runs monthly activity-calorie aggregation over activity.started_at and activity.calories", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      resultName: "monthly_activity_calories",
      maxRows: 20,
      sql: `
        select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month,
               count(*) as activities,
               coalesce(sum(calories), 0) as activity_calories_kcal
        from activity
        where strftime('%Y', started_at / 1000, 'unixepoch') = '2026'
          and calories is not null
        group by month
        order by month
      `,
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows).toEqual([
      { month: "2026-01", activities: 1, activity_calories_kcal: 300 },
      { month: "2026-07", activities: 2, activity_calories_kcal: 1800 },
      { month: "2026-08", activities: 1, activity_calories_kcal: 900 },
    ]);
  });

  it("runs monthly multi-metric aggregates including HR-zone totals", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      resultName: "monthly_garmin_totals",
      maxRows: 20,
      sql: `
        with months(month) as (
          values ('2026-07'), ('2026-08')
        ),
        daily as (
          select substr(date, 1, 7) as month,
                 sum(steps) as steps,
                 sum(active_calories) as active_calories_kcal,
                 sum(resting_calories) as resting_calories_kcal,
                 sum(total_calories) as total_calories_kcal
          from daily_health
          where substr(date, 1, 7) in ('2026-07', '2026-08')
          group by month
        ),
        activity_totals as (
          select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month,
                 count(*) as activities,
                 round(sum(distance_meters) / 1000.0, 1) as activity_km,
                 sum(elevation_gain_meters) as ascent_meters,
                 sum(calories) as activity_calories_kcal
          from activity
          where strftime('%Y-%m', started_at / 1000, 'unixepoch') in ('2026-07', '2026-08')
          group by month
        ),
        zone_totals as (
          select strftime('%Y-%m', a.started_at / 1000, 'unixepoch') as month,
                 z.zone,
                 sum(z.seconds) as seconds
          from activity a
          join activity_hr_zone_time z on z.garmin_id = a.garmin_id
          where z.status = 'available'
            and strftime('%Y-%m', a.started_at / 1000, 'unixepoch') in ('2026-07', '2026-08')
          group by month, z.zone
        )
        select m.month,
               d.steps,
               d.active_calories_kcal,
               d.resting_calories_kcal,
               d.total_calories_kcal,
               a.activities,
               a.activity_km,
               a.ascent_meters,
               a.activity_calories_kcal,
               z.zone,
               z.seconds as hr_zone_seconds
        from months m
        left join daily d on d.month = m.month
        left join activity_totals a on a.month = m.month
        left join zone_totals z on z.month = m.month
        order by m.month, z.zone
      `,
    });

    expect(result.status).toBe("succeeded");
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          month: "2026-07",
          steps: 11000,
          active_calories_kcal: 900,
          resting_calories_kcal: 1600,
          activities: 2,
          activity_km: 84,
          ascent_meters: 1350,
          zone: 2,
          hr_zone_seconds: 3600,
        }),
        expect.objectContaining({
          month: "2026-08",
          steps: 9000,
          active_calories_kcal: 700,
          resting_calories_kcal: 1600,
          activities: 1,
          activity_km: 42,
          ascent_meters: 520,
          zone: 5,
          hr_zone_seconds: 400,
        }),
      ]),
    );
  });

  it("allows CTE and month-series aliases while still requiring allowlisted activity data", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const cteResult = runReadOnlySql({
      resultName: "monthly_activity_calories",
      sql: `
        with monthly as (
          select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month,
                 sum(calories) as calories
          from activity
          where calories is not null
          group by month
        )
        select month, calories from monthly order by month
      `,
    });

    expect(cteResult.status).toBe("succeeded");
    expect(cteResult.rows).toEqual([
      { month: "2026-01", calories: 300 },
      { month: "2026-07", calories: 1800 },
      { month: "2026-08", calories: 900 },
    ]);

    const monthSeriesResult = runReadOnlySql({
      resultName: "month_series_activity_calories",
      sql: `
        with recursive months(month) as (
          select '2026-01'
          union all
          select strftime('%Y-%m', date(month || '-01', '+1 month'))
          from months
          where month < '2026-08'
        ),
        monthly as (
          select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month,
                 sum(calories) as calories
          from activity
          where strftime('%Y', started_at / 1000, 'unixepoch') = '2026'
          group by month
        )
        select months.month, coalesce(monthly.calories, 0) as activity_calories_kcal
        from months
        left join monthly on monthly.month = months.month
        order by months.month
      `,
      maxRows: 20,
    });

    expect(monthSeriesResult.status).toBe("succeeded");
    expect(monthSeriesResult.rows).toEqual(
      expect.arrayContaining([
        { month: "2026-01", activity_calories_kcal: 300 },
        { month: "2026-02", activity_calories_kcal: 0 },
        { month: "2026-08", activity_calories_kcal: 900 },
      ]),
    );
  });

  it("rejects CTEs that hide private tables and corrects only benign wrong analytical names", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const hiddenPrivate = runReadOnlySql({
      sql: "with hidden as (select * from session) select * from hidden",
    });

    expect(hiddenPrivate.status).toBe("rejected");
    expect(hiddenPrivate.reason).toBe("disallowed_table");
    expect(hiddenPrivate.correctionAllowed).toBeUndefined();

    const wrongPlural = runReadOnlySql({
      sql: "select started_at, calories from activities order by started_at",
    });

    expect(wrongPlural.status).toBe("rejected");
    expect(wrongPlural.reason).toBe("disallowed_table");
    expect(wrongPlural.correctionAllowed).toBe(true);
    expect(wrongPlural.message).toContain("Allowed analytical tables");
    expect(wrongPlural.message).toContain("Allowed activity columns");
    expect(wrongPlural.correctionHint).toContain("activity.started_at");
    expect(JSON.stringify(wrongPlural)).not.toContain(
      process.env.DATABASE_PATH,
    );
  });

  it("returns sanitized correctable SQL schema errors without paths or secrets", async () => {
    await seedActivities();
    const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");

    const result = runReadOnlySql({
      sql: "select activity_id, start_time from activity order by start_time desc",
      resultName: "bad_activity_query",
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("unknown_column");
    expect(result.correctionAllowed).toBe(true);
    expect(result.message).toContain("activity_id");
    expect(result.message).toContain("Allowed activity columns");
    expect(result.message).toContain("started_at");
    expect(JSON.stringify(result)).not.toContain(process.env.DATABASE_PATH);
    expect(JSON.stringify(result)).not.toContain("OPENAI_API_KEY");
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
      "select content from message",
      "select value from trainer_memory",
      "select * from sync_run",
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
    expect(result.rowCount).toBe(4);
    expect(result.truncated).toBe(true);
  });
});
