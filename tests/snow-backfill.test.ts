import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "../src/lib/db/migrations";
import { createExtraBackfillStore } from "../src/lib/db/extra-data-repository";
import { runSnowBackfill } from "../src/lib/garmin/snow-backfill";
import { createOfficialReader } from "../src/lib/garmin/official-reader";
import {
  newAccount,
  activityRow,
  accountApi,
  fitFor,
} from "./official-api-fixture";

function setup() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const account = newAccount();
  for (const [id, date, sport] of [
    [1, "2020-01-01 09:00:00", "resort_snowboarding"],
    [2, "2026-01-01 09:00:00", "resort_skiing"],
    [3, "2026-02-01 09:00:00", "hiking"],
  ] as const) {
    db.prepare(
      "insert into activity(id,garmin_id,sport,started_at) values(?,?,?,?)",
    ).run(
      String(id),
      String(id),
      sport,
      Date.parse(date.replace(" ", "T") + "Z"),
    );
    db.prepare(
      "insert into garmin_data_coverage values('lap_hr_zones','activity',?,'populated',null,1)",
    ).run(String(id));
    account.activities.push(
      activityRow(id, date, { activityType: { typeKey: sport } }),
    );
    account.files.set(
      String(id),
      fitFor({
        sport: id === 1 ? 14 : 13,
        snowSplits: [
          { index: 1, type: 29, start: 0, end: 5, distanceCm: 12345 },
          { index: 2, type: 28, start: 6, end: 10 },
        ],
      }),
    );
  }
  db.exec(
    "insert into sync_checkpoint values('garmin_extra_backfill','completed-T0352',1); insert into sync_checkpoint values('garmin_history_v1','unchanged',1)",
  );
  const store = createExtraBackfillStore(db, "garmin_snow_split_backfill");
  const run = (
    options: { target?: string; cancelled?: () => boolean } = {},
  ) => {
    const api = accountApi(account);
    const reader = createOfficialReader({
      apiKey: () => "synthetic-key",
      fetch: api.fetch,
      archive: () => undefined,
    });
    return {
      api,
      result: runSnowBackfill({
        store,
        reader,
        startDate: "2000-01-01",
        endDate: "2026-12-31",
        schemaVersion: 30,
        target: "authored-target",
        ...options,
      }),
    };
  };
  return { db, account, store, run };
}
const rows = (db: Database.Database, table: string) =>
  db.prepare(`select * from ${table}`).all();

describe("independent snow-only historical operation", () => {
  it("covers full authored history despite completed T0352; interrupted/resumed/repeated is idempotent", async () => {
    const { db, run } = setup();
    const original = rows(db, "activity");
    const coverage = rows(db, "garmin_data_coverage");
    const first = run({
      cancelled: () => rows(db, "activity_snow_split").length >= 2,
    });
    expect(await first.result).toMatchObject({
      status: "stopped",
      reason: "cancelled",
      counts: { selected: 2, processed: 1, fitReads: 1 },
    });
    const resume = run();
    expect(await resume.result).toMatchObject({
      status: "completed",
      counts: { selected: 2, skipped: 1, processed: 1, fitReads: 1 },
    });
    expect(rows(db, "activity_snow_split")).toHaveLength(4);
    const before = JSON.stringify(rows(db, "activity_snow_split"));
    const repeat = run();
    expect(await repeat.result).toMatchObject({
      status: "completed",
      counts: { skipped: 2, fitReads: 0, listReads: 0 },
    });
    expect(repeat.api.requests).toHaveLength(0);
    expect(JSON.stringify(rows(db, "activity_snow_split"))).toBe(before);
    expect(rows(db, "activity")).toEqual(original);
    expect(
      db
        .prepare(
          "select * from garmin_data_coverage where data_group='lap_hr_zones'",
        )
        .all(),
    ).toEqual(coverage);
    expect(
      db
        .prepare(
          "select value from sync_checkpoint where key='garmin_extra_backfill'",
        )
        .get(),
    ).toEqual({ value: "completed-T0352" });
    expect(
      db
        .prepare(
          "select value from sync_checkpoint where key='garmin_history_v1'",
        )
        .get(),
    ).toEqual({ value: "unchanged" });
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
  it("refuses foreign/corrupt/changed-selection bindings without new file reads", async () => {
    const { db, run } = setup();
    await run().result;
    const foreign = run({ target: "other" });
    expect(await foreign.result).toMatchObject({
      status: "refused",
      reason: "checkpoint-mismatch",
    });
    expect(foreign.api.requests).toHaveLength(0);
    db.exec("update activity set started_at=started_at+1 where garmin_id='1'");
    expect(await run().result).toMatchObject({
      status: "refused",
      reason: "checkpoint-mismatch",
    });
    db.exec(
      "update sync_checkpoint set value='invalid' where key='garmin_snow_split_backfill'",
    );
    expect(await run().result).toMatchObject({
      status: "refused",
      reason: "checkpoint-corrupt",
    });
    db.close();
  });
  it("refuses account mismatch before FIT access and changes no core data", async () => {
    const { db, run, account } = setup();
    account.activities = [];
    const r = run();
    expect(await r.result).toMatchObject({
      status: "refused",
      reason: "account-or-target-mismatch",
      counts: { fitReads: 0 },
    });
    expect(rows(db, "activity_snow_split")).toEqual([]);
    db.close();
  });
  it("distinguishes failed decode from unavailable originals and resumes only incomplete work", async () => {
    const { db, run, account } = setup();
    account.files.set("1", new Uint8Array([1, 2, 3]));
    expect(await run().result).toMatchObject({
      status: "stopped",
      counts: { failed: 1, fitReads: 1 },
    });
    expect(
      db
        .prepare(
          "select status from garmin_data_coverage where data_group='snow_run_lift_splits' and subject_id='1'",
        )
        .get(),
    ).toEqual({ status: "failed" });
    account.files.delete("1");
    expect(await run().result).toMatchObject({
      status: "completed",
      counts: { processed: 2, fitReads: 2 },
    });
    expect(
      db
        .prepare(
          "select status,reason from garmin_data_coverage where data_group='snow_run_lift_splits' and subject_id='1'",
        )
        .get(),
    ).toEqual({ status: "unavailable", reason: "no-original-file" });
    db.close();
  });
});
