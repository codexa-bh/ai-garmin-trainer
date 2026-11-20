import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase, runIntegrityCheck } from "../src/lib/db/migrations";
import { createExtraBackfillStore } from "../src/lib/db/extra-data-repository";
import {
  createBackfillControl,
  createExtraBackfill,
} from "../src/lib/garmin/extra-backfill";
import { createOfficialReader } from "../src/lib/garmin/official-reader";
import { removeGarminExtraFixtureSchema } from "./conversation-migration-fixture";
import {
  type Account,
  accountApi,
  activityRow,
  addDays,
  fitFor,
  newAccount,
} from "./official-api-fixture";

/**
 * Disposable populated rehearsal of the explicit extra-data backfill: legacy
 * schema 28 with MCP-era and official rows, explicit migration, first,
 * interrupted/resumed, crashed and repeated runs. Authored inputs only.
 */
let directory: string;
let db: Database.Database;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "extra-backfill-"));
  db = new Database(join(directory, "rehearsal.sqlite"));
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

const FIRST = "2026-06-01";
const DAYS = 75;
const LAST = addDays(FIRST, DAYS - 1);
const BOUNDARIES = [100, 115, 130, 145, 160, 175];
const LAP_START = ["2021-09-08T01:46:40.000Z", "2021-09-08T01:46:41.000Z"];

function seedLegacy() {
  migrateDatabase(db);
  removeGarminExtraFixtureSchema(db);
  const day = db.prepare(
    "insert into daily_health(date,steps,sleep_minutes,hrv_ms,stress_avg,body_battery_avg,availability) values (?,?,?,?,?,?,'complete')",
  );
  for (let i = 0; i < DAYS; i += 1)
    // MCP-era facts: stored values differ from what the source now reports
    // for sleep/HRV; the backfill must not touch them.
    day.run(addDays(FIRST, i), 5000 + i, 400, 51, 30, 44);
  const activity = db.prepare(
    "insert into activity(id,garmin_id,name,sport,started_at,duration_sec,steps) values (?,?,?,?,?,?,?)",
  );
  const lap = db.prepare(
    "insert into activity_lap(garmin_id,lap_number,start_time,avg_heart_rate) values (?,?,?,?)",
  );
  for (let i = 0; i < 6; i += 1) {
    const id = String(8000 + i);
    const local = `${addDays(FIRST, 5 + i * 12)} 07:00:00`;
    activity.run(
      `garmin-${id}`,
      id,
      `Legacy ${id}`,
      "running",
      Date.parse(`${local.replace(" ", "T")}Z`),
      1800,
      4000,
    );
    // Authored files start at the fixture FIT epoch. 8001 stores an earlier
    // reader's zone-less text; 8005 has a different lap set (mismatch).
    lap.run(id, 1, i === 1 ? "2021-09-08T01:46:40" : LAP_START[0], 140);
    if (i !== 5) lap.run(id, 2, LAP_START[1], 150);
  }
  db.prepare(
    "insert into sync_checkpoint(key,value,updated_at) values ('garmin_history','{\"preserved\":true}',1)",
  ).run();
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values ('kept','Authored chat',1,1)",
  ).run();
}

function account(): Account {
  const result = newAccount();
  for (let i = 0; i < DAYS; i += 1) {
    const date = addDays(FIRST, i);
    result.days.set(date, {
      hours: 24,
      steps: 5000 + i,
      extra: {
        hrv: {
          weeklyAvg: 50 + (i % 7),
          baseline: { balancedLow: 45, balancedUpper: 65 },
        },
        summary: {
          stress: {
            maxLevel: 80,
            totalDurationInMillis: 3_600_000,
            highStressDurationInMillis: 360_000,
          },
        },
      },
    });
  }
  result.vo2.push({
    generic: {
      calendarDate: addDays(FIRST, 20),
      vo2MaxValue: 44,
      vo2MaxPreciseValue: 44.2,
      sport: "WALKING",
    },
  });
  for (let i = 0; i < 6; i += 1) {
    const id = 8000 + i;
    const local = `${addDays(FIRST, 5 + i * 12)} 07:00:00`;
    result.activities.push(
      activityRow(id, local, {
        differenceBodyBattery: -5 - i,
        averageRunningCadenceInStepsPerMinute: 150 + i,
        ...(i === 2
          ? { splitSummaries: [{ splitType: "SKI_RUN_SPLIT", noOfSplits: 4 }] }
          : {}),
      }),
    );
    if (i !== 4)
      result.files.set(
        String(id),
        fitFor({
          laps: [
            { index: 0, startOffset: 0, cadence: 78 },
            { index: 1, startOffset: 1, cadence: 80 },
          ],
          lapZoneMessages: [
            { reference: 0, seconds: [0, 1, 2, 3, 4, 5, 0], high: BOUNDARIES },
            { reference: 1, seconds: [0, 5, 4, 3, 2, 1, 0], high: BOUNDARIES },
          ],
        }),
      );
  }
  return result;
}

function backfill(source: Account, maxRequests = 1000, cancelAfter?: number) {
  const api = accountApi(source);
  let admitted = 0;
  const control = createBackfillControl({
    maxRequests,
    maxMs: 600_000,
    intervalMs: 0,
    clock: () => Date.now(),
    wait: async () => undefined,
    cancelled: () => cancelAfter !== undefined && admitted >= cancelAfter,
  });
  const counted = {
    ...control,
    async admit() {
      await control.admit();
      admitted += 1;
    },
  };
  const reader = createOfficialReader({
    control: counted,
    apiKey: () => "synthetic-key",
    fetch: api.fetch,
    archive: () => undefined,
  });
  const run = createExtraBackfill({
    store: createExtraBackfillStore(db),
    reader,
  }).run({
    startDate: FIRST,
    endDate: LAST,
    target: "rehearsal-target",
    schemaVersion: 29,
    cancelled: () => cancelAfter !== undefined && admitted >= cancelAfter,
  });
  return { api, run, control };
}

const preservedState = () =>
  JSON.stringify([
    db.prepare("select * from daily_health order by date").all(),
    db.prepare("select * from activity order by garmin_id").all(),
    db
      .prepare(
        "select garmin_id, lap_number, start_time, avg_heart_rate from activity_lap order by 1, 2",
      )
      .all(),
    db
      .prepare(
        "select * from sync_checkpoint where key <> 'garmin_extra_backfill'",
      )
      .all(),
    db.prepare("select * from conversation").all(),
  ]);
const extraState = () =>
  JSON.stringify(
    [
      "daily_hrv_detail",
      "daily_stress",
      "vo2_max_reading",
      "activity_extra_metrics",
      "activity_split_summary",
      "activity_lap_hr_zone_time",
    ].map((table) =>
      db
        .prepare(`select * from ${table} order by 1, 2`)
        .all()
        .map((row) => ({ ...(row as object), fetched_at: undefined })),
    ),
  );
const coverage = () =>
  Object.fromEntries(
    (
      db
        .prepare(
          "select data_group || ':' || status as k, count(*) as n from garmin_data_coverage group by 1",
        )
        .all() as Array<{ k: string; n: number }>
    ).map((row) => [row.k, row.n]),
  );

describe("explicit extra-data backfill rehearsal", () => {
  it("migrates explicitly, then backfills, resumes and repeats without touching original facts", async () => {
    seedLegacy();
    const before = preservedState();
    expect(migrateDatabase(db)).toMatchObject({
      fromVersion: 28,
      toVersion: 30,
      applied: ["29:garmin_extra_data", "30:snow_run_lift_splits"],
    });
    expect(preservedState()).toBe(before);
    // Interrupted first pass: cancellation after a few admitted requests.
    const source = account();
    const interrupted = await backfill(source, 1000, 4).run;
    expect(interrupted).toMatchObject({
      status: "stopped",
      reason: "cancelled",
      pass: 1,
    });
    const partial = JSON.parse(
      (
        db
          .prepare(
            "select value from sync_checkpoint where key='garmin_extra_backfill'",
          )
          .get() as { value: string }
      ).value,
    );
    expect(partial).toMatchObject({ pass: 1, phase: "daily" });
    // Budget-limited continuation, then a completing resume of the same pass.
    const limited = await backfill(source, 5).run;
    expect(limited).toMatchObject({
      status: "stopped",
      reason: "budget-limited",
      pass: 1,
    });
    const resumed = backfill(source);
    const done = await resumed.run;
    expect(done).toMatchObject({ status: "completed", pass: 1, phase: "done" });
    expect(done.counts).toMatchObject({
      lapsMismatched: 1,
      localNotInSource: 0,
    });
    expect(runIntegrityCheck(db)).toBe("ok");
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(preservedState()).toBe(before);
    expect(coverage()).toMatchObject({
      "hrv:populated": DAYS,
      "stress:populated": DAYS,
      "sleep:populated": DAYS,
      "vo2_max:populated": 1,
      "vo2_max:empty": DAYS - 1,
      "activity_body_battery:populated": 6,
      "running_dynamics:populated": 6,
      "snowboard_splits:populated": 1,
      "snowboard_splits:empty": 5,
      "lap_hr_zones:populated": 4,
      "lap_hr_zones:unavailable": 2,
    });
    expect(
      db.prepare("select count(*) as n from activity_lap_hr_zone_time").get(),
    ).toEqual({ n: 4 * 2 * 7 });
    // Lap dynamics attach to matching stored laps without altering them.
    expect(
      db
        .prepare(
          "select lap_number, avg_heart_rate, fit_avg_cadence_cpm from activity_lap where garmin_id='8000' order by lap_number",
        )
        .all(),
    ).toEqual([
      { lap_number: 1, avg_heart_rate: 140, fit_avg_cadence_cpm: 78 },
      { lap_number: 2, avg_heart_rate: 150, fit_avg_cadence_cpm: 80 },
    ]);
    // Repeat: a new pass skips settled subjects (no reads) and changes nothing.
    const after = extraState();
    const repeat = backfill(source);
    expect(await repeat.run).toMatchObject({ status: "completed", pass: 2 });
    expect(extraState()).toBe(after);
    expect(repeat.api.requests).toHaveLength(0);
    expect(preservedState()).toBe(before);
  });

  it("records failed groups truthfully, keeps checkpoint-after-data ordering and retries only failures", async () => {
    seedLegacy();
    migrateDatabase(db);
    const source = account();
    source.failPaths.set("vo2", 503);
    const first = await backfill(source).run;
    expect(first.status).toBe("completed");
    expect(coverage()).toMatchObject({
      "vo2_max:failed": DAYS,
      "hrv:populated": DAYS,
    });
    expect(
      db.prepare("select count(*) as n from vo2_max_reading").get(),
    ).toEqual({ n: 0 });
    source.failPaths.delete("vo2");
    const retry = backfill(source);
    expect(await retry.run).toMatchObject({ status: "completed", pass: 2 });
    expect(coverage()).toMatchObject({
      "vo2_max:populated": 1,
      "vo2_max:empty": DAYS - 1,
    });
    expect(coverage()["vo2_max:failed"]).toBeUndefined();
    // Only daily blocks with a failed group were reread; no activity work.
    expect(
      retry.api.requests.some((r) => r.path.includes("download-service")),
    ).toBe(false);
  });

  it("replays idempotently after a crash between data write and checkpoint", async () => {
    seedLegacy();
    migrateDatabase(db);
    const source = account();
    const store = createExtraBackfillStore(db);
    let commits = 0;
    const crashing = {
      ...store,
      commit(work: () => void, checkpoint: string) {
        commits += 1;
        // The data/checkpoint transaction is atomic: a crash leaves neither.
        if (commits === 4) {
          db.transaction(() => {
            work();
            throw new Error("simulated crash");
          })();
        }
        store.commit(work, checkpoint);
      },
    };
    const api = accountApi(source);
    const reader = createOfficialReader({
      apiKey: () => "k",
      fetch: api.fetch,
      archive: () => undefined,
    });
    await expect(
      createExtraBackfill({ store: crashing, reader }).run({
        startDate: FIRST,
        endDate: LAST,
        target: "rehearsal-target",
        schemaVersion: 29,
      }),
    ).resolves.toMatchObject({ status: "stopped" });
    const resumed = await backfill(source).run;
    expect(resumed).toMatchObject({ status: "completed", pass: 1 });
    expect(
      db.prepare("select count(*) as n from daily_hrv_detail").get(),
    ).toEqual({ n: DAYS });
    expect(
      db
        .prepare(
          "select count(distinct garmin_id || ':' || lap_number || ':' || bucket) as n, count(*) as total from activity_lap_hr_zone_time",
        )
        .get(),
    ).toEqual({ n: 56, total: 56 });
  });

  it("refuses wrong targets, incompatible checkpoints and an unrecognisable account without writing", async () => {
    seedLegacy();
    migrateDatabase(db);
    const source = account();
    await backfill(source, 1000, 3).run;
    const checkpoint = () =>
      db
        .prepare(
          "select value from sync_checkpoint where key='garmin_extra_backfill'",
        )
        .get();
    const saved = checkpoint();
    const store = createExtraBackfillStore(db);
    const reader = () =>
      createOfficialReader({
        apiKey: () => "k",
        fetch: accountApi(source).fetch,
        archive: () => undefined,
      });
    for (const input of [
      {
        target: "other-target",
        schemaVersion: 29,
        startDate: FIRST,
        endDate: LAST,
      },
      {
        target: "rehearsal-target",
        schemaVersion: 29,
        startDate: FIRST,
        endDate: addDays(LAST, 1),
      },
      {
        target: "rehearsal-target",
        schemaVersion: 30,
        startDate: FIRST,
        endDate: LAST,
      },
    ])
      expect(
        await createExtraBackfill({ store, reader: reader() }).run(input),
      ).toMatchObject({
        status: "refused",
        reason: "checkpoint-mismatch",
      });
    expect(checkpoint()).toEqual(saved);
    db.prepare(
      "update sync_checkpoint set value='{' where key='garmin_extra_backfill'",
    ).run();
    expect(
      await createExtraBackfill({ store, reader: reader() }).run({
        target: "rehearsal-target",
        schemaVersion: 29,
        startDate: FIRST,
        endDate: LAST,
      }),
    ).toMatchObject({ status: "refused", reason: "checkpoint-corrupt" });
    expect(checkpoint()).toEqual({ value: "{" });
  });

  it("refuses a different account before writing any extras", async () => {
    seedLegacy();
    migrateDatabase(db);
    const other = newAccount();
    for (let i = 0; i < DAYS; i += 1)
      other.days.set(addDays(FIRST, i), { hours: 24, steps: 12_000 + i });
    other.activities.push(activityRow(99_999, `${addDays(FIRST, 7)} 08:00:00`));
    const result = await backfill(other).run;
    expect(result).toMatchObject({
      status: "refused",
      reason: "account-or-target-mismatch",
    });
    expect(
      db.prepare("select count(*) as n from daily_hrv_detail").get(),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("select count(*) as n from garmin_data_coverage").get(),
    ).toEqual({ n: 0 });
  });

  it("stops on authentication or rate limiting without marking anything empty", async () => {
    seedLegacy();
    migrateDatabase(db);
    const source = account();
    source.failPaths.set("summary", 429);
    const result = await backfill(source).run;
    expect(result).toMatchObject({ status: "stopped", reason: "rate-limit" });
    expect(
      db.prepare("select count(*) as n from garmin_data_coverage").get(),
    ).toEqual({ n: 0 });
  });
});
