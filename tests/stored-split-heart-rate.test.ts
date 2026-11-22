import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../src/lib/db/migrations";
import { upsertActivities } from "../src/lib/db/repository";
import { deriveActivitySplitHeartRates } from "../src/lib/db/split-heart-rate-repository";
import { snowActivityEvidence } from "../src/lib/db/snow-split-repository";
import { getActivitySupplement } from "../src/lib/db/supplement-repository";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("../src/lib/db/connection", () => ({ getDatabase: () => state.db }));
const start = Date.parse("2026-01-10T10:00:00Z");
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
const stored = (seconds: number) =>
  at(seconds).replace("T", " ").replace(".000Z", "");
const lowers = [100, 120, 140, 160, 180];
afterEach(() => {
  state.db?.close();
  state.db = null;
});

function seed() {
  const db = new Database(":memory:");
  state.db = db;
  migrateDatabase(db);
  upsertActivities([
    {
      garminId: "a",
      name: "Authored stored snow",
      sport: "resort_snowboarding",
      startedAt: new Date(start),
      durationSec: 160,
      distanceMeters: 0,
      calories: 0,
      avgHeartRate: null,
      maxHeartRate: null,
      steps: null,
      elevationGainMeters: null,
      elevationLossMeters: null,
      trainingEffect: null,
    },
  ]);
  expect(
    db.prepare("select started_at from activity where garmin_id='a'").get(),
  ).toEqual({ started_at: start });
  const point = db.prepare(
    "insert into activity_stream_point(garmin_id,elapsed_sec,timestamp,heart_rate) values('a',?,?,?)",
  );
  // Intentionally insert out of order: the anchor is elapsed 0, not insertion order.
  for (const second of [20, 10, 0, 2, 15, 100, 160])
    point.run(second, stored(second), second < 10 ? 100 : 170);
  const split = db.prepare(
    "insert into activity_snow_split(garmin_id,split_key,message_index,source_order,split_type,start_time,end_time,fetched_at) values('a',?,?,?,?,?,?,1)",
  );
  split.run("run", 0, 0, "run", at(0), at(10));
  split.run("lift", 1, 1, "lift", at(10), at(20));
  split.run("sparse", 2, 2, "run", at(100), at(160));
  for (const [index, lower] of lowers.entries())
    db.prepare(
      "insert into activity_hr_zone_time(garmin_id,zone,fetched_at,source,status,seconds,source_lower_bpm,source_total_seconds) values('a',?,1,'garmin_mcp','available',999,?,999)",
    ).run(index + 1, lower + 20);
  lap(db, 1, lowers);
  return db;
}
function lap(
  db: Database.Database,
  number: number,
  bounds: Array<number | null>,
) {
  db.prepare(
    "insert into activity_lap(garmin_id,lap_number) values('a',?)",
  ).run(number);
  for (const [i, lower] of bounds.entries())
    db.prepare(
      "insert into activity_lap_hr_zone_time(garmin_id,lap_number,bucket,zone,bucket_kind,seconds,lower_bpm,fetched_at) values('a',?,?,?,'zone',999,?,1)",
    ).run(number, i + 1, i + 1, lower);
}
function first(db: Database.Database) {
  return deriveActivitySplitHeartRates(db, "a")[0].heartRate;
}

describe("schema-30 stored snow history", () => {
  it("derives proven zone-less UTC and lap-only file limits through repository, dashboard and trainer without writes", () => {
    const db = seed();
    const before = db.serialize();
    db.pragma("query_only=ON");
    const result = deriveActivitySplitHeartRates(db, "a");
    expect(result.map((s) => s.heartRate.avgHeartRate)).toEqual([
      100,
      170,
      null,
    ]);
    expect(result[0].heartRate.zones.buckets?.map((b) => b.seconds)).toEqual([
      0, 10, 0, 0, 0, 0,
    ]);
    expect(result[1].heartRate.zones.buckets?.map((b) => b.seconds)).toEqual([
      0, 0, 0, 0, 10, 0,
    ]);
    expect(result[2].heartRate.unavailableReason).toBe("insufficient-support");
    expect(getActivitySupplement("a").snowRuns.entries[0].heartRate).toEqual(
      result[0].heartRate,
    );
    const evidence = snowActivityEvidence(db, "a", {
      splitHeartRate: true,
    }).splitHeartRate!;
    expect(evidence.zoneLowerBpm).toEqual(lowers);
    expect(evidence.types[0].rows[0].avgHeartRate).toBe(100);
    expect(evidence.types[1].rows[0].zoneSeconds).toEqual([0, 0, 0, 0, 10, 0]);
    expect(JSON.stringify(evidence)).not.toMatch(
      /2026-|timestamp|heart_rate|elapsed_sec/,
    );
    expect(db.serialize().equals(before)).toBe(true);
    expect(() => db.prepare("update activity set started_at=1").run()).toThrow(
      /readonly/,
    );
  });

  it("admits exact 80% stored run and lift support with stationary samples and no writes", () => {
    const db = seed();
    db.prepare("delete from activity_stream_point").run();
    db.prepare("delete from activity_snow_split").run();
    const point = db.prepare(
      "insert into activity_stream_point(garmin_id,elapsed_sec,timestamp,heart_rate,speed_mps) values('a',?,?,?,0)",
    );
    for (let second = 0; second <= 400; second += 20) {
      if (second === 60 || second === 260) continue;
      point.run(second, stored(second), second < 200 ? 100 : 170);
    }
    const split = db.prepare(
      "insert into activity_snow_split(garmin_id,split_key,message_index,source_order,split_type,start_time,end_time,fetched_at) values('a',?,?,?,?,?,?,1)",
    );
    split.run("run", 0, 0, "run", at(0), at(200));
    split.run("lift", 1, 1, "lift", at(200), at(400));
    const before = db.serialize();
    db.pragma("query_only=ON");
    const results = deriveActivitySplitHeartRates(db, "a");
    expect(results.map((s) => s.heartRate.avgHeartRate)).toEqual([100, 170]);
    for (const result of results) {
      expect(result.heartRate).toMatchObject({
        supportSeconds: 160,
        windowSeconds: 200,
        hasLongGap: true,
      });
      expect(
        result.heartRate.zones.buckets?.reduce((n, b) => n + b.seconds, 0),
      ).toBe(160);
    }
    expect(getActivitySupplement("a").snowRuns.entries[0].heartRate).toEqual(
      results[0].heartRate,
    );
    const evidence = snowActivityEvidence(db, "a", {
      splitHeartRate: true,
    }).splitHeartRate!;
    expect(evidence.types.map((t) => t.rows[0].avgHeartRate)).toEqual([
      100, 170,
    ]);
    for (const type of evidence.types) {
      expect(type.rows[0]).toMatchObject({
        supportSeconds: 160,
        windowSeconds: 200,
        hasLongGap: true,
      });
      expect(Object.keys(type.rows[0]).sort()).toEqual([
        "avgHeartRate",
        "descentMeters",
        "distanceMeters",
        "hasLongGap",
        "hrUnavailableReason",
        "splitKey",
        "supportSeconds",
        "timerSeconds",
        "windowSeconds",
        "zoneSeconds",
        "zoneUnavailableReason",
      ]);
    }
    expect(evidence.meaning).toContain("supported time only");
    expect(JSON.stringify(evidence)).not.toMatch(
      /2026-|timestamp|speed_mps|elapsed_sec/,
    );
    expect(db.serialize().equals(before)).toBe(true);
  });

  it.each([null, "bad", "2026-01-10 09:00:00", "2026-02-30 10:00:00"])(
    "never replaces rejected first timestamp %s with a later convenient anchor",
    (timestamp) => {
      const db = seed();
      db.prepare(
        "update activity_stream_point set timestamp=? where elapsed_sec=0",
      ).run(timestamp);
      expect(first(db).unavailableReason).toBe("unproven-sample-timezone");
    },
  );

  it("proves real writer milliseconds, nonzero elapsed anchor and independence from HR/window", () => {
    const db = seed();
    db.prepare(
      "update activity_stream_point set elapsed_sec=1, heart_rate=null where elapsed_sec=0",
    ).run();
    db.prepare(
      "update activity_snow_split set start_time=? where split_key='run'",
    ).run(at(2));
    expect(first(db).avgHeartRate).toBe(100);
    db.prepare("update activity set started_at=?").run(start / 1000); // seconds are not the repository's stored milliseconds
    expect(first(db).unavailableReason).toBe("unproven-sample-timezone");
  });

  it("cannot borrow another activity's matching anchor", () => {
    const db = seed();
    db.prepare(
      "insert into activity(id,garmin_id,sport,started_at) values('b','b','resort_snowboarding',?)",
    ).run(start);
    db.prepare(
      "update activity set started_at=started_at+1 where garmin_id='a'",
    ).run();
    expect(first(db).unavailableReason).toBe("unproven-sample-timezone");
    const row = snowActivityEvidence(db, "a", { splitHeartRate: true })
      .splitHeartRate!.types[0].rows[0];
    expect(row).toMatchObject({
      hrUnavailableReason: "unproven-sample-timezone",
      zoneUnavailableReason: "heart-rate-unavailable",
      avgHeartRate: null,
      zoneSeconds: null,
    });
    expect(
      getActivitySupplement("a").snowRuns.entries[0].heartRate
        ?.unavailableReason,
    ).toBe("unproven-sample-timezone");
  });

  it("already accepts complete lap-only file limits when timestamps are explicit-zone", () => {
    const db = seed();
    db.prepare(
      "update activity_stream_point set timestamp=replace(timestamp,' ','T') || 'Z'",
    ).run();
    expect(first(db).zones.buckets?.map((b) => b.lowerBpm)).toEqual([
      null,
      ...lowers,
    ]);
  });

  it("keeps Avg HR with MCP/list-only or absent limits and never reads today's baseline", () => {
    const db = seed();
    db.prepare("delete from activity_lap_hr_zone_time").run();
    const reads = vi.spyOn(db, "prepare");
    expect(first(db)).toMatchObject({
      avgHeartRate: 100,
      zones: { buckets: null, unavailableReason: "missing-zone-boundaries" },
    });
    db.prepare(
      "update activity_hr_zone_time set source='garmin_official_list'",
    ).run();
    expect(first(db).zones.unavailableReason).toBe("missing-zone-boundaries");
    db.prepare("delete from activity_hr_zone_time").run();
    expect(first(db).avgHeartRate).toBe(100);
    expect(reads.mock.calls.map(([sql]) => sql).join(" ")).not.toContain(
      "garmin_athlete_baseline",
    );
    for (const [sql] of reads.mock.calls.filter(([sql]) =>
      sql.includes("from activity_lap_hr_zone_time"),
    ))
      expect(sql).not.toContain("seconds");
  });

  it("admits a complete lap beyond the UI cap, but never combines incomplete lap floors", () => {
    const db = seed();
    db.prepare("delete from activity_lap_hr_zone_time").run();
    for (let i = 2; i <= 100; i++)
      db.prepare(
        "insert into activity_lap(garmin_id,lap_number) values('a',?)",
      ).run(i);
    lap(db, 101, lowers);
    expect(first(db).zones.buckets).not.toBeNull();
    db.prepare(
      "delete from activity_lap_hr_zone_time where lap_number=101 and bucket > 2",
    ).run();
    lap(db, 102, [null, null, 140, 160, 180]);
    expect(first(db).zones.unavailableReason).toBe("missing-zone-boundaries");
  });

  it.each([
    [100, 100, 140, 160, 180],
    [100, null, 90, null, null],
    [100, 120, 140, 160, 181],
    [100, 120, 140, 160, null],
  ])(
    "validates eligible lap candidates %j against complete trusted session bounds",
    (...candidate) => {
      const db = seed();
      db.prepare(
        "update activity_hr_zone_time set source='garmin_official_fit', source_lower_bpm=source_lower_bpm-20",
      ).run();
      db.prepare("delete from activity_lap_hr_zone_time").run();
      lap(db, 2, candidate);
      expect(first(db).zones.unavailableReason).toBe(
        candidate[2] === 140 && candidate[4] === null
          ? null
          : "conflicting-zone-boundaries",
      );
    },
  );

  it("does not hide contradictory incomplete lap bounds", () => {
    const db = seed();
    db.prepare(
      "update activity_stream_point set timestamp=replace(timestamp,' ','T') || 'Z'",
    ).run();
    lap(db, 2, [101, null, null, null, null]);
    expect(first(db).zones.unavailableReason).toBe(
      "conflicting-zone-boundaries",
    );
  });

  it("does not hide limits beyond the UI's first 100 laps", () => {
    const db = seed();
    db.prepare(
      "update activity_stream_point set timestamp=replace(timestamp,' ','T') || 'Z'",
    ).run();
    for (let i = 2; i <= 100; i++)
      db.prepare(
        "insert into activity_lap(garmin_id,lap_number) values('a',?)",
      ).run(i);
    lap(db, 101, [100, 120, 140, 160, 181]);
    expect(first(db).zones.unavailableReason).toBe(
      "conflicting-zone-boundaries",
    );
  });

  it("refuses an incomplete present trusted session instead of treating it as absent", () => {
    const db = seed();
    db.prepare(
      "update activity_stream_point set timestamp=replace(timestamp,' ','T') || 'Z'",
    ).run();
    db.prepare(
      "update activity_hr_zone_time set source='garmin_official_fit' where zone < 5",
    ).run();
    expect(first(db).avgHeartRate).toBe(100);
    expect(first(db).zones.unavailableReason).toBe("missing-zone-boundaries");
  });
});
