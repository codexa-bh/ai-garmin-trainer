import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  migrateDatabase,
  currentSchemaVersion,
} from "../src/lib/db/migrations";
import { upsertSnowSplits } from "../src/lib/db/snow-split-repository";
import { upsertFitActivityExtras } from "../src/lib/db/extra-data-repository";
import { decodeActivityFit } from "../src/lib/garmin/official-fit";
import { buildFit } from "./official-fit-fixture";

function populated() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  db.pragma("foreign_keys=ON");
  db.exec(`insert into activity(id,garmin_id,sport,started_at) values('a','a','resort_snowboarding',1);
    insert into garmin_data_coverage values('lap_hr_zones','activity','a','populated',null,1);
    insert into sync_checkpoint(key,value,updated_at) values('garmin_extra_backfill','completed-T0352',1);`);
  return db;
}
const splits = [
  { index: 1, type: 29, start: 0, end: 5, distanceCm: 12345 },
  { index: 2, type: 28, start: 6, end: 10 },
];
async function decoded(rows = splits) {
  return decodeActivityFit(buildFit({ sport: 14, snowSplits: rows }));
}

describe("snow split additive storage", () => {
  it("migrates populated schema 29, preserving coverage, core facts and checkpoints", () => {
    const db = populated();
    db.exec(`drop table activity_snow_split;
      create table coverage29 (data_group text not null check(data_group in ('sleep','hrv','vo2_max','body_battery','stress','activity_body_battery','running_dynamics','snowboard_splits','lap_hr_zones')), subject_type text not null check(subject_type in ('date','activity')), subject_id text not null, status text not null check(status in ('populated','empty','unavailable','failed')), reason text, updated_at integer not null, primary key(data_group,subject_type,subject_id));
      insert into coverage29 select * from garmin_data_coverage;
      drop table garmin_data_coverage; alter table coverage29 rename to garmin_data_coverage;
      update app_metadata set value='29' where key='schema_version'`);
    const before = db.prepare("select * from activity").all();
    const coverage = db.prepare("select * from garmin_data_coverage").all();
    const checkpoints = db.prepare("select * from sync_checkpoint").all();
    migrateDatabase(db);
    expect(currentSchemaVersion(db)).toBe(30);
    expect(db.prepare("select * from activity").all()).toEqual(before);
    expect(db.prepare("select * from garmin_data_coverage").all()).toEqual(
      coverage,
    );
    expect(db.prepare("select * from sync_checkpoint").all()).toEqual(
      checkpoints,
    );
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
  it("persists independently of stored laps and preserves facts on failed/empty/ambiguous reads", async () => {
    const db = populated();
    const d = await decoded();
    expect(upsertFitActivityExtras("a", d.extras, db).lapsMatched).toBe(false);
    const rows = () =>
      db.prepare("select * from activity_snow_split order by split_key").all();
    expect(rows()).toHaveLength(2);
    const before = rows();
    for (const status of ["empty", "unavailable", "failed"] as const) {
      upsertSnowSplits(db, "a", { rows: [], status, reason: "test" });
      expect(rows()).toEqual(before);
      expect(
        db
          .prepare(
            "select status from garmin_data_coverage where data_group='snow_run_lift_splits'",
          )
          .get(),
      ).toEqual({ status });
    }
    expect(db.prepare("select value from sync_checkpoint").get()).toEqual({
      value: "completed-T0352",
    });
    db.close();
  });
  it("reconciles known complete sets, preserves nulls/zeros and survives lap replacement", async () => {
    const db = populated();
    upsertSnowSplits(db, "a", (await decoded()).extras.snowSplits!);
    const changed = (await decoded([{ ...splits[0], distanceCm: undefined }]))
      .extras.snowSplits!;
    upsertSnowSplits(db, "a", changed);
    expect(
      db
        .prepare("select split_key,distance_meters from activity_snow_split")
        .all(),
    ).toEqual([{ split_key: "index:1", distance_meters: 123.45 }]);
    changed.rows[0].distanceMeters = 0;
    upsertSnowSplits(db, "a", changed);
    db.exec("delete from activity_lap");
    expect(
      db.prepare("select distance_meters from activity_snow_split").get(),
    ).toEqual({ distance_meters: 0 });
    db.exec("delete from activity");
    expect(
      db.prepare("select count(*) n from activity_snow_split").get(),
    ).toEqual({ n: 0 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
  it("rolls back a rejected set with coverage and existing rows intact", async () => {
    const db = populated();
    const evidence = (await decoded()).extras.snowSplits!;
    upsertSnowSplits(db, "a", evidence);
    const before = db.serialize();
    expect(() =>
      upsertSnowSplits(db, "a", {
        ...evidence,
        rows: [evidence.rows[0], evidence.rows[0]],
      }),
    ).toThrow("snow-duplicate-key");
    expect(db.serialize().equals(before)).toBe(true);
    db.close();
  });
});
