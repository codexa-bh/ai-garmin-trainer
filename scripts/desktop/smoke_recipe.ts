// Finite authored smoke input, not an application dataset or a migration path.
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  migrateDatabase,
  runIntegrityCheck,
} from "../../src/lib/db/migrations";
import {
  activity,
  conversation,
  dailyHealth,
  message,
  trainerProfile,
} from "../../src/lib/db/schema";

// Additive authored evidence keeps the version: other smoke owners pin it (Weekly KPI).
export const RECIPE_VERSION = 1;
const DAY = 86_400_000;

export function anchorTime(anchor: string): number {
  const value = Date.parse(anchor + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
    !Number.isFinite(value) ||
    new Date(value).toISOString().slice(0, 10) !== anchor
  )
    throw new Error("A real UTC YYYY-MM-DD anchor is required.");
  return value;
}

export function populate(db: Database.Database, anchor: string) {
  const time = anchorTime(anchor);
  migrateDatabase(db);
  // Migration metadata otherwise carries wall-clock time, breaking logical reproducibility.
  db.prepare(
    "update app_metadata set updated_at=? where key='schema_version'",
  ).run(time);
  const store = drizzle(db);
  store
    .insert(trainerProfile)
    .values({
      id: "default",
      goalsJson: JSON.stringify([
        "Fictional autumn walking consistency",
        "Keep recovery days comfortable",
      ]),
      sportsJson: JSON.stringify(["walking", "cycling"]),
      constraintsJson: JSON.stringify([
        "Synthetic example: two short weekday sessions",
      ]),
      preferencesJson: JSON.stringify({
        note: "Entirely authored smoke example; not athlete advice",
      }),
      updatedAt: new Date(time),
    })
    .run();
  for (let index = 0; index < 3; index++) {
    const id = index === 0 ? "default" : `synthetic-chat-${index}`;
    const stamp = time - index * DAY;
    store
      .insert(conversation)
      .values({
        id,
        title: [
          "Synthetic recovery planning",
          "Synthetic weekend walk",
          "Synthetic cycling questions",
        ][index],
        createdAt: sql`${stamp}`,
        updatedAt: sql`${stamp + 3000}`,
      })
      .run();
    for (let turn = 0; turn < 4; turn++) {
      store
        .insert(message)
        .values({
          id: `synthetic-turn-${index}-${turn}`,
          conversationId: id,
          role: turn % 2 ? "assistant" : "user",
          content:
            turn % 2
              ? "This fictional saved discussion compares a comfortable short session with a rest day. No provider was called, and these authored examples do not describe a real athlete."
              : "For this synthetic example, how could I fit a relaxed walk around a busy week while keeping time for recovery?",
          createdAt: sql`${stamp + turn * 1000}`,
        })
        .run();
    }
  }
  for (let index = 0; index < 8; index++) {
    store
      .insert(activity)
      .values({
        id: `synthetic-activity-${index}`,
        garminId: `synthetic-${index}`,
        name: `Fictional ${index % 2 ? "cycle" : "walk"} ${index + 1}`,
        sport: index % 2 ? "cycling" : "walking",
        startedAt: new Date(time - index * 2 * DAY),
        durationSec: 1800 + index * 120,
        distanceMeters: 2400 + index * 400,
        calories: 180 + index * 15,
        avgHeartRate: 102 + index,
        maxHeartRate: 130 + index,
        steps: index % 2 ? 0 : 3400 + index * 100,
      })
      .run();
  }
  for (let index = 0; index < 21; index++) {
    if (index === 10) continue; // Missing civil date, not an invented zero.
    const partial = index === 9;
    store
      .insert(dailyHealth)
      .values({
        date: new Date(time - index * DAY).toISOString().slice(0, 10),
        sleepMinutes: partial ? null : 420 + index,
        sleepScore: partial ? null : 72 + (index % 14),
        sleepDeepMinutes: partial ? null : 65,
        sleepLightMinutes: partial ? null : 255 + index,
        sleepRemMinutes: partial ? null : 85,
        sleepAwakeMinutes: partial ? null : 15,
        sleepNapMinutes: partial ? null : 0,
        restingHeartRate: 55 + (index % 4),
        hrvStatus: partial ? null : "BALANCED",
        hrvMs: partial ? null : 42 + (index % 9),
        stressAvg: partial ? null : 20 + (index % 10),
        steps: index === 8 ? 0 : 6000 + index * 110,
        // Fixed authored Calories evidence in the previous seven-date page.
        calories: index === 11 ? 1800 : partial || index === 12 ? null : 2100,
        activeCalories: index === 8 ? 0 : partial || index === 11 ? null : 400,
        restingCalories: index === 8 ? 0 : index === 11 ? null : 1700,
        totalCalories:
          index === 7
            ? 2150
            : index === 8
              ? 0
              : index === 11 || index === 12
                ? null
                : partial
                  ? 1900
                  : 2100,
        intensityMinutes: index === 8 ? 0 : 25,
        bodyBatteryAvg: partial ? null : 61,
        bodyBatteryMorning: partial ? null : 85,
        bodyBatteryEvening: partial ? null : 37,
        availability: partial ? "partial" : "complete",
      })
      .run();
  }
  populateSupplements(db, time);
}

/**
 * Authored additional-Garmin evidence for the existing Health/Activity views:
 * populated, measured-zero, partial and absent cases beside source-coverage
 * states. Every value is fictional; absence is left absent on purpose.
 */
function populateSupplements(db: Database.Database, time: number) {
  const date = (index: number) =>
    new Date(time - index * DAY).toISOString().slice(0, 10);
  const cover = db.prepare(
    "insert into garmin_data_coverage values (?, ?, ?, ?, ?, ?)",
  );
  const coverDate = (
    group: string,
    index: number,
    status: string,
    reason: string | null = null,
  ) => cover.run(group, "date", date(index), status, reason, time);
  const hrv = db.prepare(
    "insert into daily_hrv_detail (date, weekly_avg_ms, baseline_balanced_low_ms, baseline_balanced_upper_ms, feedback_code, fetched_at) values (?,?,?,?,?,?)",
  );
  // Latest page: baseline on some dates, one lower-only (no band), one absent.
  [
    [0, 46, 40, 55],
    [1, 45, 40, 55],
    [2, 44, 39, 54],
    [3, 43, 39, null],
    [5, 41, 38, 52],
    [8, 40, 37, 51],
  ].forEach(([index, weekly, low, high]) =>
    hrv.run(date(index!), weekly, low, high, "BALANCED", time),
  );
  coverDate("hrv", 0, "populated");
  coverDate("hrv", 4, "empty");
  coverDate("hrv", 6, "failed", "http_429");

  const sleep = db.prepare(
    "insert into daily_sleep_detail (date, overall_score, overall_qualifier, fetched_at) values (?,?,?,?)",
  );
  const part = db.prepare(
    "insert into daily_sleep_score_component (date, component, value, qualifier) values (?,?,?,?)",
  );
  sleep.run(date(0), 81, "GOOD", time);
  sleep.run(date(1), 64, "FAIR", time);
  [
    ["overall", 81, "GOOD"],
    ["deep", 0, "POOR"],
    ["light", 77, "GOOD"],
    ["rem", 88, "EXCELLENT"],
    ["total_duration", null, "GOOD"],
    ["stress", null, "FAIR"],
    ["awake_count", null, "EXCELLENT"],
    ["restlessness", null, null],
  ].forEach(([component, value, qualifier]) =>
    part.run(date(0), component, value, qualifier),
  );
  part.run(date(1), "overall", 64, "FAIR");
  part.run(date(1), "total_duration", null, "POOR");
  coverDate("sleep", 0, "populated");
  coverDate("sleep", 1, "populated");
  coverDate("sleep", 2, "empty");
  coverDate("sleep", 3, "unavailable");

  const stress = db.prepare(
    "insert into daily_stress (date, total_seconds, rest_seconds, low_seconds, medium_seconds, high_seconds, activity_seconds, uncategorized_seconds, fetched_at) values (?,?,?,?,?,?,?,?,?)",
  );
  // Complete day with a genuine zero bucket, and a partial day that must not stack.
  stress.run(date(0), 86400, 36000, 18000, 0, 3600, 7200, 21600, time);
  stress.run(date(1), 86400, 40000, 15000, null, null, 6000, 25400, time);
  coverDate("stress", 0, "populated");
  coverDate("stress", 1, "populated");
  coverDate("stress", 2, "failed", "timeout");

  const battery = db.prepare(
    "insert into daily_body_battery (date, charged, drained, latest_level, end_of_day_level, fetched_at) values (?,?,?,?,?,?)",
  );
  battery.run(date(0), 0, null, 74, 31, time);
  battery.run(date(1), 55, 61, 12, 14, time);
  battery.run(date(2), 48, null, 20, 22, time);
  coverDate("body_battery", 0, "populated");
  coverDate("body_battery", 1, "populated");
  coverDate("body_battery", 3, "unavailable");

  const vo2 = db.prepare(
    "insert into vo2_max_reading (date, branch, vo2_max, vo2_max_precise, sport, sub_sport, fetched_at) values (?,?,?,?,?,?,?)",
  );
  vo2.run(date(1), "generic", 51, 51.4, "RUNNING", null, time);
  vo2.run(date(1), "cycling", 58, null, "CYCLING", "ROAD", time);
  vo2.run(date(4), "generic", 50, null, "RUNNING", null, time);
  vo2.run(date(8), "rowing", 44, null, "ROWING", null, time);
  coverDate("vo2_max", 1, "populated");
  coverDate("vo2_max", 4, "populated");

  // Activities: one run with laps (zones on three of four), one snowboard day.
  const insertActivity = db.prepare(
    "insert into activity (id, garmin_id, name, sport, started_at, duration_sec, distance_meters, calories, avg_heart_rate, max_heart_rate, steps) values (?,?,?,?,?,?,?,?,?,?,?)",
  );
  insertActivity.run(
    "synthetic-activity-run",
    "synthetic-run",
    "Fictional lap run",
    "running",
    time - DAY / 2,
    2400,
    6400,
    410,
    148,
    171,
    6100,
  );
  insertActivity.run(
    "synthetic-activity-snow",
    "synthetic-snow",
    "Fictional snow day",
    "resort_snowboarding",
    time - DAY * 1.5,
    14400,
    38000,
    900,
    118,
    160,
    null,
  );
  for (const [index, variant] of [
    "unknown",
    "unsupported",
    "preserved",
    "unproven",
  ].entries())
    insertActivity.run(
      `synthetic-activity-snow-${variant}`,
      `synthetic-snow-${variant}`,
      `Fictional snow ${variant}`,
      variant === "unsupported" ? "backcountry_skiing" : "resort_skiing",
      time - DAY * (2.5 + index),
      3600,
      5000,
      300,
      null,
      null,
      null,
    );
  const lap = db.prepare(
    "insert into activity_lap (garmin_id, lap_number, start_time, duration_sec, distance_meters, avg_speed_mps, avg_heart_rate, max_heart_rate, elevation_gain_meters, elevation_loss_meters) values (?,?,?,?,?,?,?,?,?,?)",
  );
  for (let n = 1; n <= 4; n++)
    lap.run(
      "synthetic-run",
      n,
      new Date(time - DAY / 2 + (n - 1) * 600_000).toISOString(),
      600,
      1600,
      2.7,
      140 + n * 4,
      165,
      12,
      10,
    );
  db.prepare(
    "insert into activity_extra_metrics (garmin_id, body_battery_delta, avg_run_cadence_spm, max_run_cadence_spm, avg_stride_length_cm, fit_avg_cadence_cpm, fit_avg_step_length_m, fetched_at) values ('synthetic-run', -9, 162, 176, 98.5, 81.5, 0.99, ?)",
  ).run(time);
  const zone = db.prepare(
    "insert into activity_lap_hr_zone_time (garmin_id, lap_number, bucket, bucket_kind, zone, seconds, lower_bpm, upper_bpm, calc_method, source_max_heart_rate, source_resting_heart_rate, fetched_at) values (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const bounds = [
    [0, "below", null, null, 100],
    [1, "zone", 1, 101, 120],
    [2, "zone", 2, 121, 140],
    [3, "zone", 3, 141, 160],
    [4, "zone", 4, 161, 175],
    [5, "zone", 5, 176, 190],
    [6, "above", null, 191, null],
  ] as const;
  // Lap 3 has no recorded zones (unknown); lap 4 is recorded and entirely zero.
  const seconds: Record<number, number[]> = {
    1: [20, 40, 250, 220, 70, 0, 0],
    2: [0, 0, 60, 380, 160, 0, 0],
    4: [0, 0, 0, 0, 0, 0, 0],
  };
  for (const [lapNumber, values] of Object.entries(seconds))
    bounds.forEach(([bucket, kind, zoneNo, lower, upper]) =>
      zone.run(
        "synthetic-run",
        Number(lapNumber),
        bucket,
        kind,
        zoneNo,
        values[bucket],
        lower,
        upper,
        "PERCENT_MAX_HR",
        191,
        52,
        time,
      ),
    );
  const coverActivity = (
    id: string,
    group: string,
    status: string,
    reason: string | null = null,
  ) => cover.run(group, "activity", id, status, reason, time);
  coverActivity("synthetic-run", "activity_body_battery", "populated");
  coverActivity("synthetic-run", "running_dynamics", "populated");
  coverActivity("synthetic-run", "lap_hr_zones", "populated");

  const summary = db.prepare(
    "insert into activity_split_summary (garmin_id, split_type, split_count, duration_sec, distance_meters, max_distance_meters, max_speed_mps, fetched_at) values ('synthetic-snow',?,?,?,?,?,?,?)",
  );
  summary.run("SKI_RUN_SPLIT", 12, 3600, 31000, 4200, 19.5, time);
  summary.run("SKI_LIFT_SPLIT", 11, 3000, 8400, 1300, null, time);
  const run = db.prepare(
    "insert into activity_snow_split (garmin_id, split_key, message_index, source_order, split_type, start_time, timer_seconds, distance_meters, descent_meters, ascent_meters, max_speed_mps, fetched_at) values ('synthetic-snow',?,?,?,?,?,?,?,?,?,?,?)",
  );
  const startSec = (seconds: number) =>
    new Date(time - DAY * 1.5 + seconds * 1000).toISOString();
  const start = (minute: number) => startSec(minute * 60);
  run.run("index:1", 1, 1, "lift", start(0), 420, 1200, 0, 310, null, time);
  run.run("index:2", 2, 2, "run", start(8), 190, 2600, 340, 0, 17.8, time);
  run.run("index:3", 3, 3, "lift", start(14), 400, 1150, 0, 295, null, time);
  run.run("index:4", 4, 4, "run", start(22), null, null, 0, 0, null, time);
  run.run("index:5", 5, 5, "run", start(26), 205, 2900, 360, 0, 19.5, time);
  db.prepare(
    "update activity_snow_split set avg_speed_mps = 10, ascent_meters = 0.5, timer_seconds = 190.4 where garmin_id = 'synthetic-snow' and split_key = 'index:2'",
  ).run();
  // Measured windows for the two derivable runs (200 s and 215 s); run 4 keeps no
  // end time, so its derived HR is honestly unavailable and no end is invented.
  const windowEnd = db.prepare(
    "update activity_snow_split set end_time = ? where garmin_id = 'synthetic-snow' and split_key = ?",
  );
  windowEnd.run(startSec(8 * 60 + 200), "index:2");
  windowEnd.run(startSec(26 * 60 + 215), "index:5");
  // Actual legacy storage shape, with a genuine activity-start clock anchor,
  // then 10 s cadence inside the two measured windows:
  // run 1 supports 130/150/170 bpm for 40/50/70 s after the authored gap;
  // run 3 holds 120 for 100 s then
  // 165 for 115 s. Zone limits are the activity file's own, never today's baseline.
  const sample = db.prepare(
    "insert into activity_stream_point (garmin_id, elapsed_sec, timestamp, heart_rate) values ('synthetic-snow', ?, ?, ?)",
  );
  const storedTime = (value: string) =>
    value.replace("T", " ").replace(".000Z", "");
  sample.run(0, storedTime(startSec(0)), null); // clock proof, not HR support
  const sampleRun = (
    firstSecond: number,
    lengthSec: number,
    bpm: (offset: number) => number,
  ) => {
    for (let offset = 0; offset <= lengthSec; offset += 10)
      sample.run(
        firstSecond + offset,
        storedTime(startSec(firstSecond + offset)),
        bpm(offset),
      );
  };
  sampleRun(8 * 60, 200, (o) => (o < 60 ? 130 : o < 130 ? 150 : 170));
  // Reject the whole 40 s span 40..80: exact 80% coverage, no first-30 s hold.
  db.prepare(
    "delete from activity_stream_point where garmin_id='synthetic-snow' and elapsed_sec in (530,540,550)",
  ).run();
  sampleRun(26 * 60, 210, (o) => (o < 100 ? 120 : 165));
  const fileZone = db.prepare(
    "insert into activity_hr_zone_time (garmin_id, zone, fetched_at, source, status, seconds, source_lower_bpm, source_total_seconds) values ('synthetic-snow', ?, ?, 'garmin_mcp', 'available', 0, ?, 0)",
  );
  [100, 120, 140, 160, 180].forEach((lower, index) =>
    fileZone.run(index + 1, time, lower),
  );
  // Laps on every snow variant: redundant where individual runs are stored
  // (populated, preserved), retained where none are (unknown, unsupported).
  const snowLap = db.prepare(
    "insert into activity_lap (garmin_id, lap_number, start_time, duration_sec, distance_meters, avg_speed_mps, avg_heart_rate, max_heart_rate, elevation_gain_meters, elevation_loss_meters) values (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const [id, offset] of [
    ["synthetic-snow", 1.5],
    ["synthetic-snow-unknown", 2.5],
    ["synthetic-snow-unsupported", 3.5],
    ["synthetic-snow-preserved", 4.5],
    ["synthetic-snow-unproven", 5.5],
  ] as const)
    for (let n = 1; n <= 3; n++)
      snowLap.run(
        id,
        n,
        new Date(time - DAY * offset + (n - 1) * 1_200_000).toISOString(),
        1200,
        1700,
        3.1,
        112 + n,
        150,
        18,
        20,
      );
  // Complete lap-file floors establish historical zones despite MCP-only session rows.
  for (let lapNumber = 1; lapNumber <= 3; lapNumber++)
    [100, 120, 140, 160, 180].forEach((lower, index) =>
      zone.run(
        "synthetic-snow",
        lapNumber,
        index + 1,
        "zone",
        index + 1,
        999,
        lower,
        index === 4 ? null : lower + 19,
        "PERCENT_MAX_HR",
        200,
        50,
        time,
      ),
    );
  coverActivity("synthetic-snow", "lap_hr_zones", "populated");
  db.prepare(
    "update activity_snow_split set avg_speed_mps = 0 where garmin_id = 'synthetic-snow' and split_key = 'index:5'",
  ).run();
  db.prepare(
    `insert into activity_snow_split
    (garmin_id, split_key, message_index, source_order, split_type, timer_seconds,
     distance_meters, descent_meters, max_speed_mps, fetched_at)
    values ('synthetic-snow-preserved', 'index:8', 8, 0, 'run', 12.5, 0, 0, 0, ?)`,
  ).run(time);
  // Preserved rows retain the original invalid window and add two honest
  // failures: supported HR without file limits, and no samples in the window.
  const reasonSplit = db.prepare(`insert into activity_snow_split
    (garmin_id, split_key, message_index, source_order, split_type, start_time, end_time,
     timer_seconds, distance_meters, descent_meters, fetched_at)
    values (?, ?, ?, ?, 'run', ?, ?, 10, 0, 0, ?)`);
  const preservedAt = (second: number) =>
    new Date(time - DAY * 4.5 + second * 1000).toISOString();
  reasonSplit.run(
    "synthetic-snow-preserved",
    "index:9",
    9,
    1,
    preservedAt(0),
    preservedAt(200),
    time,
  );
  reasonSplit.run(
    "synthetic-snow-preserved",
    "index:10",
    10,
    2,
    preservedAt(250),
    preservedAt(260),
    time,
  );
  const reasonSample = db.prepare(
    "insert into activity_stream_point(garmin_id,elapsed_sec,timestamp,heart_rate) values(?,?,?,120)",
  );
  for (const second of [0, 20, 40, 80, 100, 120, 140, 160, 180, 200])
    reasonSample.run("synthetic-snow-preserved", second, preservedAt(second));
  const unprovenAt = (second: number) =>
    new Date(time - DAY * 5.5 + second * 1000).toISOString();
  reasonSplit.run(
    "synthetic-snow-unproven",
    "index:11",
    11,
    0,
    unprovenAt(0),
    unprovenAt(10),
    time,
  );
  // First stored timestamp mismatches activity start by 1 s. Never guess/shift.
  reasonSample.run("synthetic-snow-unproven", 0, storedTime(unprovenAt(1)));
  reasonSample.run("synthetic-snow-unproven", 10, storedTime(unprovenAt(10)));
  coverActivity("synthetic-snow-unproven", "snow_run_lift_splits", "populated");
  coverActivity(
    "synthetic-snow-unsupported",
    "snow_run_lift_splits",
    "unavailable",
    "unsupported-sport",
  );
  coverActivity(
    "synthetic-snow-preserved",
    "snow_run_lift_splits",
    "failed",
    "fit-download",
  );
  coverActivity("synthetic-snow", "snowboard_splits", "populated");
  coverActivity("synthetic-snow", "snow_run_lift_splits", "populated");
}

function inventory(db: Database.Database) {
  return db
    .prepare(
      "select type,name,tbl_name,sql from sqlite_master where name not like 'sqlite_%' order by type,name",
    )
    .all();
}

// Verify existing inputs read-only; never migrate a selected database.
export function verify(db: Database.Database, route: "synthetic" | "private") {
  const reference = new Database(":memory:");
  try {
    migrateDatabase(reference);
    if (
      currentSchemaVersion(db) !== LATEST_SCHEMA_VERSION ||
      runIntegrityCheck(db) !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length ||
      JSON.stringify(inventory(db)) !== JSON.stringify(inventory(reference))
    )
      throw new Error("Smoke schema/integrity/FK/inventory refused.");
  } finally {
    reference.close();
  }
  const allowed = new Set([
    "activity",
    "daily_health",
    // Authored additional-Garmin evidence for the existing Health/Activity views.
    "garmin_data_coverage",
    "daily_hrv_detail",
    "daily_sleep_detail",
    "daily_sleep_score_component",
    "daily_stress",
    "daily_body_battery",
    "vo2_max_reading",
    "activity_lap",
    "activity_extra_metrics",
    "activity_lap_hr_zone_time",
    "activity_stream_point",
    "activity_hr_zone_time",
    "activity_split_summary",
    "activity_snow_split",
    "trainer_profile",
    "app_metadata",
    "conversation_history_control",
    "summary_control",
    "summary_state",
    "summary_original_boundary",
    // Bounded deletion metadata only; debug revision text must stay empty.
    "summary_debug_event",
    ...(route === "synthetic" ? ["conversation", "message"] : []),
  ]);
  const tables = db
    .prepare(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%'",
    )
    .all() as { name: string }[];
  for (const { name } of tables) {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    const count = (
      db.prepare(`select count(*) as n from ${quoted}`).get() as { n: number }
    ).n;
    if (count > 256 || (!allowed.has(name) && count !== 0))
      throw new Error("Smoke populated data classes/count refused.");
    const columns = db.prepare(`pragma table_info(${quoted})`).all() as {
      name: string;
      type: string;
    }[];
    for (const row of db.prepare(`select * from ${quoted}`).all() as Record<
      string,
      unknown
    >[]) {
      for (const column of columns) {
        const value = row[column.name];
        if (value === null) continue;
        if (column.type === "INTEGER" || column.type === "REAL") {
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            (column.type === "INTEGER" &&
              // The importer preserves fractional duration/average-HR metrics;
              // SQLite INTEGER affinity does not make those domain values counters.
              !(
                name === "activity" &&
                ["duration_sec", "avg_heart_rate"].includes(column.name)
              ) &&
              !Number.isInteger(value))
          )
            throw new Error("Nonnumeric/nonfinite smoke value refused.");
        } else if (typeof value !== "string" || value.length > 12000)
          throw new Error("Unbounded/malformed smoke text refused.");
      }
    }
  }
  const controls = db
    .prepare(
      "select id,memory_generation as generation,deleting_conversation as deleting from conversation_history_control",
    )
    .all() as { id: number; generation: number; deleting: string | null }[];
  if (
    controls.length !== 1 ||
    controls[0]!.id !== 1 ||
    !Number.isSafeInteger(controls[0]!.generation) ||
    controls[0]!.generation < 0 ||
    controls[0]!.deleting !== null
  )
    throw new Error("Smoke conversation control refused.");
  if (
    JSON.stringify(
      db.prepare("select * from summary_original_boundary").all(),
    ) !== JSON.stringify([{ id: 1, floor: 0, clear_floor: 0 }])
  )
    throw new Error("Smoke original-message authority must be pristine.");
  const summary = db.prepare("select * from summary_state").all() as {
    id: number;
    format_version: number;
    revision: number;
    frontier: number;
    payload: string;
    checksum: string;
    privacy_generation: number;
    published_at: number | null;
  }[];
  const summaryControl = db
    .prepare("select * from summary_control")
    .all() as Record<string, unknown>[];
  if (
    summary.length !== 1 ||
    summary[0]!.id !== 1 ||
    summary[0]!.format_version !== 2 ||
    summary[0]!.revision !== controls[0]!.generation + 1 ||
    summary[0]!.frontier !== 0 ||
    summary[0]!.payload !== '{"version":2,"text":""}' ||
    (summary[0]!.checksum !== "" &&
      summary[0]!.checksum !==
        createHash("sha256")
          .update(
            JSON.stringify([
              summary[0]!.revision,
              0,
              controls[0]!.generation,
              summary[0]!.payload,
            ]),
          )
          .digest("hex")) ||
    summary[0]!.published_at !== null ||
    summary[0]!.privacy_generation !== controls[0]!.generation ||
    summaryControl.length !== 1 ||
    Object.entries(summaryControl[0]!).some(
      ([key, value]) =>
        value !==
        (
          {
            id: 1,
            enabled: 0,
            configured_enabled: 0,
            model: "",
            cap: 6000,
            generation: controls[0]!.generation + 1,
            manual_revision: 1,
            cutoff: 0,
            job_id: null,
            lease_until: 0,
            pending_since: null,
            last_started: 0,
            retry_at: 0,
            failures: 0,
            reason: controls[0]!.generation ? "summary_invalidated" : null,
            day: "",
            coverage_lost: 0,
          } as Record<string, unknown>
        )[key],
    )
  )
    throw new Error(
      "Smoke summary state must be empty, disabled and unselected.",
    );
  const profile = db.prepare("select * from trainer_profile").all() as Record<
    string,
    unknown
  >[];
  if (profile.length !== 1 || profile[0].id !== "default")
    throw new Error("Smoke Profile coverage refused.");
  for (const key of ["goals_json", "sports_json", "constraints_json"]) {
    const value: unknown = JSON.parse(String(profile[0][key]));
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === "string" && item.length < 1000)
    )
      throw new Error("Smoke Profile JSON refused.");
  }
  const preferences: unknown = JSON.parse(String(profile[0].preferences_json));
  if (
    !preferences ||
    Array.isArray(preferences) ||
    typeof preferences !== "object"
  )
    throw new Error("Smoke preferences refused.");
  if (
    (
      db
        .prepare(
          "select count(*) as n from app_metadata where key <> 'schema_version'",
        )
        .get() as { n: number }
    ).n
  )
    throw new Error("Unreviewed metadata refused.");
  const health = db
    .prepare("select * from daily_health order by date")
    .all() as Record<string, unknown>[];
  if (
    health.length < 14 ||
    health.some((row) => {
      try {
        anchorTime(String(row.date));
        return !["complete", "partial", "unavailable"].includes(
          String(row.availability),
        );
      } catch {
        return true;
      }
    }) ||
    anchorTime(String(health.at(-1)?.date)) -
      anchorTime(String(health[0]?.date)) <
      13 * DAY
  )
    throw new Error("Smoke Health history coverage refused.");
  const activities = (
    db.prepare("select count(*) as n from activity").get() as { n: number }
  ).n;
  if (!activities) throw new Error("Smoke activity coverage refused.");
  if (route === "synthetic") {
    const chats = db
      .prepare(
        "select id,created_at,updated_at from conversation order by updated_at desc",
      )
      .all() as { id: string; created_at: number; updated_at: number }[];
    if (
      chats.length < 3 ||
      chats.some(
        (chat) => chat.created_at < 1e12 || chat.updated_at < chat.created_at,
      )
    )
      throw new Error("Smoke conversation order refused.");
    for (const chat of chats) {
      const turns = db
        .prepare(
          "select role,content,created_at from message where conversation_id=? order by created_at",
        )
        .all(chat.id) as {
        role: string;
        content: string;
        created_at: number;
      }[];
      if (
        turns.length < 4 ||
        turns.some(
          (turn, index) =>
            !["user", "assistant"].includes(turn.role) ||
            turn.content.length < 60 ||
            turn.created_at !== chat.created_at + index * 1000,
        )
      )
        throw new Error("Smoke turn order/content refused.");
    }
    if (
      (
        db
          .prepare(
            "select count(*) as n from message where conversation_id not in (select id from conversation)",
          )
          .get() as { n: number }
      ).n
    )
      throw new Error("Orphan smoke message refused.");
    const gap = health.some(
      (row, index) =>
        index > 0 &&
        anchorTime(String(row.date)) -
          anchorTime(String(health[index - 1].date)) >
          DAY,
    );
    if (
      !gap ||
      !health.some((row) => row.sleep_minutes === null && row.steps !== null) ||
      !health.some((row) => row.steps === 0 && row.intensity_minutes === 0)
    )
      throw new Error("Smoke missing/partial/zero coverage refused.");
  }
  return {
    schema: LATEST_SCHEMA_VERSION,
    integrity: "ok",
    foreignKeys: "ok",
    inventory: "ok",
    coverage: "ok",
    activities,
    healthDays: health.length,
  };
}

export function recipe(
  scratch: string,
  name: string,
  anchor: string,
  emptyChat = false,
) {
  anchorTime(anchor);
  const info = lstatSync(scratch);
  if (
    !isAbsolute(scratch) ||
    realpathSync(scratch) !== scratch ||
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    !/^smoke-input-[0-9a-f-]{36}$/.test(name)
  )
    throw new Error(
      "Canonical private scratch and exclusive input name required.",
    );
  const root = join(scratch, name);
  mkdirSync(root, { mode: 0o700 });
  const db = new Database(":memory:");
  try {
    populate(db, anchor);
    const checks = verify(db, "synthetic");
    if (emptyChat) {
      // Author only this new in-memory fixture; never clear a published/selected input.
      db.exec("delete from message;delete from conversation");
      verify(db, "private"); // Existing empty-chat data-shape checks, not private authority.
    }
    const path = join(root, "synthetic.sqlite");
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, db.serialize());
    } finally {
      closeSync(fd);
    }
    return {
      path,
      recipeVersion: RECIPE_VERSION,
      anchor,
      ...checks,
      ...(emptyChat ? { syntheticVariant: "empty-chat" } : {}),
    };
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    process.argv.length === 6 &&
    ["create", "create-empty-chat"].includes(process.argv[2])
  )
    console.log(
      JSON.stringify(
        recipe(
          process.argv[3],
          process.argv[4],
          process.argv[5],
          process.argv[2] === "create-empty-chat",
        ),
      ),
    );
  else if (
    process.argv.length === 5 &&
    process.argv[2] === "verify" &&
    ["synthetic", "private"].includes(process.argv[4])
  ) {
    const db = new Database(process.argv[3], {
      readonly: true,
      fileMustExist: true,
      timeout: 3000,
    });
    try {
      console.log(
        JSON.stringify(verify(db, process.argv[4] as "synthetic" | "private")),
      );
    } finally {
      db.close();
    }
  } else
    throw new Error(
      "Usage: smoke_recipe.ts create|create-empty-chat <private-scratch> <smoke-input-UUID> <UTC-date> | verify <database> synthetic|private",
    );
}
