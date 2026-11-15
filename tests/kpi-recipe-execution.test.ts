import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import type { KpiMeasurementWindow } from "../src/lib/weekly/kpi-contracts";
import { validateRecipeSql } from "../src/lib/ai/analytics/policy";

// Authored synthetic data only. Week of 2026-11-09 (UTC calendar).
const window: KpiMeasurementWindow = {
  weekStart: "2026-11-09",
  timeZone: "UTC",
  startMs: Date.parse("2026-11-09T00:00:00Z"),
  endMs: Date.parse("2026-11-16T00:00:00Z"),
  asOfMs: Date.parse("2026-11-16T00:00:00Z"),
};
const at = (day: number, hour = 9) =>
  Date.parse(`2026-11-${String(day).padStart(2, "0")}T0${hour}:00:00Z`);

// Current approved hiking definition: Hiking+Walking, timer Time (duration_sec),
// longest qualifying >= 7200s, deterministic tie by earliest start then id;
// others = every other eligible outing in the window.
export const HIKING_SQL = `with eligible as (
  select garmin_id, started_at, duration_sec, elevation_gain_meters from activity
  where sport in ('hiking','walking') and started_at >= :week_start_ms and started_at < :week_end_ms
), long as (
  select garmin_id, duration_sec, elevation_gain_meters from eligible where duration_sec >= 7200
  order by duration_sec desc, started_at asc, garmin_id asc limit 1
)
select
  (select duration_sec from long) as long_time,
  (select elevation_gain_meters from long) as long_ascent,
  (select count(*) from eligible where garmin_id not in (select garmin_id from long)) as others,
  (select count(*) from eligible where duration_sec is null) as missing_source`;

let db: Database.Database;
async function load() {
  const { getDatabase } = await import("../src/lib/db/connection");
  db = getDatabase();
  const insert = db.prepare(
    "insert into activity(id,garmin_id,name,sport,started_at,duration_sec,elevation_gain_meters) values (?,?,?,?,?,?,?)",
  );
  return insert;
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "kpi-recipe-")), "authored.sqlite"),
  );
});
afterEach(() => {
  db?.close();
  vi.unstubAllEnvs();
});

it("admits only parameterized, unquoted, unqualified saved recipe SQL", () => {
  expect(validateRecipeSql(HIKING_SQL)).toEqual({ ok: true });
  for (const [sql, reason] of [
    ["select count(*) as n from activity", "recipe_parameters"],
    [
      "select count(*) as n from activity where started_at >= :week_start_ms and started_at < :other",
      "recipe_parameters",
    ],
    [
      'select count(*) as n from activity where "started_at" >= :week_start_ms and started_at < :week_end_ms',
      "quoted_identifier",
    ],
    [
      "select count(*) as n from activity, main.activity where started_at >= :week_start_ms and started_at < :week_end_ms",
      "forbidden_token",
    ],
    [
      "select count(*) as n from activity_calculated_grade where garmin_id = 'x' and :week_start_ms < :week_end_ms",
      "forbidden_token",
    ],
    [
      "select count(*) as n from weekly_kpi where :week_start_ms < :week_end_ms",
      "disallowed_table",
    ],
    [
      "delete from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
      "unsafe_statement",
    ],
  ] as const)
    expect(validateRecipeSql(sql)).toMatchObject({ ok: false, reason });
  // A literal string containing a quote character is not an identifier.
  expect(
    validateRecipeSql(
      "select count(*) as n from activity where name <> 'a\"b' and started_at >= :week_start_ms and started_at < :week_end_ms",
    ),
  ).toEqual({ ok: true });
});

it("measures the approved hiking definition with timer Time, replacement, ties and exclusions", async () => {
  const insert = await load();
  const { createKpiRecipeExecution } =
    await import("../src/lib/ai/analytics/recipe-execution");
  const execution = createKpiRecipeExecution();
  const recipe = {
    conceptId: "hike",
    sql: HIKING_SQL,
    tracks: ["long_time", "long_ascent", "others"].map((key) => ({
      key,
      signature: "s",
    })),
  };
  const measure = async () => (await execution.run([recipe], window)).outcomes;
  expect(await measure()).toEqual([
    {
      conceptId: "hike",
      status: "measured",
      values: { long_time: null, long_ascent: null, others: 0 },
    },
  ]);
  // Tuesday 1h59m walk never becomes long; cycling never counts.
  insert.run("a", "a", "Walk", "walking", at(10), 7199, 120);
  insert.run("b", "b", "Ride", "cycling", at(10, 8), 20000, 900);
  insert.run("c", "c", "Prior week", "hiking", at(8), 30000, 2000);
  expect((await measure())[0]).toMatchObject({
    values: { long_time: null, long_ascent: null, others: 1 },
  });
  // Exactly 2h qualifies; the long outing is excluded from others.
  insert.run("d", "d", "Hike", "hiking", at(11), 7200, 500);
  expect((await measure())[0]).toMatchObject({
    values: { long_time: 7200, long_ascent: 500, others: 1 },
  });
  // A later longer hike replaces it coherently; the former long becomes an other.
  insert.run("e", "e", "Long hike", "hiking", at(13), 14400, 1300);
  expect((await measure())[0]).toMatchObject({
    values: { long_time: 14400, long_ascent: 1300, others: 2 },
  });
  // Equal Time: earliest start wins, deterministically.
  insert.run("f", "f", "Tie", "walking", at(14), 14400, 50);
  expect((await measure())[0]).toMatchObject({
    values: { long_time: 14400, long_ascent: 1300, others: 3 },
  });
  // Missing timer Time among candidates marks the selection incomplete.
  insert.run("g", "g", "No timer", "hiking", at(15), null, 400);
  expect((await measure())[0]).toMatchObject({ status: "incomplete" });
});

it("avoids HR-zone join fan-out and keeps missing ascent unknown, not zero", async () => {
  const insert = await load();
  insert.run("h", "h", "Hike", "hiking", at(11), 9000, null);
  const zone = db.prepare(
    "insert into activity_hr_zone_time(garmin_id,zone,fetched_at,source,status,seconds,source_total_seconds) values (?,?,?,?,?,?,1800)",
  );
  for (const z of [1, 2, 3]) zone.run("h", z, 1, "authored", "available", 600);
  const { createKpiRecipeExecution } =
    await import("../src/lib/ai/analytics/recipe-execution");
  const run = await createKpiRecipeExecution().run(
    [
      {
        conceptId: "hike",
        sql: HIKING_SQL,
        tracks: ["long_time", "long_ascent", "others"].map((key) => ({
          key,
          signature: "s",
        })),
      },
      {
        conceptId: "zone",
        sql: "select count(distinct a.garmin_id) as outings, sum(z.seconds) as z_seconds from activity a join activity_hr_zone_time z on z.garmin_id = a.garmin_id where a.started_at >= :week_start_ms and a.started_at < :week_end_ms",
        tracks: ["outings", "z_seconds"].map((key) => ({
          key,
          signature: "s",
        })),
      },
    ],
    window,
  );
  expect(run.outcomes).toEqual([
    {
      conceptId: "hike",
      status: "measured",
      values: { long_time: 9000, long_ascent: null, others: 0 },
    },
    {
      conceptId: "zone",
      status: "measured",
      values: { outings: 1, z_seconds: 1800 },
    },
  ]);
});

it("hard-stops expensive and allocation-heavy recipes and isolates them from valid ones", async () => {
  await load();
  const { createKpiRecipeExecution } =
    await import("../src/lib/ai/analytics/recipe-execution");
  const execution = createKpiRecipeExecution();
  const valid = {
    conceptId: "count",
    sql: "select count(*) as n from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
    tracks: [{ key: "n", signature: "s" }],
  };
  const forever = {
    conceptId: "forever",
    sql: "with recursive c(x) as (select 1 union all select x+1 from c) select count(*) as n from c left join activity on 0 where :week_start_ms < :week_end_ms",
    tracks: [{ key: "n", signature: "s" }],
  };
  const heavy = {
    conceptId: "heavy",
    sql: "with recursive c(x) as (select 1 union all select x+1 from c limit 5000000) select length(group_concat(hex(randomblob(64)))) as n from c left join activity on 0 where :week_start_ms < :week_end_ms",
    tracks: [{ key: "n", signature: "s" }],
  };
  const started = Date.now();
  let ticks = 0;
  const interval = setInterval(() => (ticks += 1), 50);
  const run = await execution.run([forever, valid, heavy], window);
  clearInterval(interval);
  expect(Date.now() - started).toBeLessThan(8000);
  // The parent event loop stays responsive while recipes run in the child.
  expect(ticks).toBeGreaterThan(10);
  expect(run.outcomes).toEqual([
    { conceptId: "forever", status: "failed", reason: "resource_limit" },
    { conceptId: "count", status: "measured", values: { n: 0 } },
    expect.objectContaining({ conceptId: "heavy", status: "failed" }),
  ]);
  expect(run.basis).toMatch(/^[0-9a-f]{64}$/);
}, 20000);

it("re-admits every execution, hides unlisted columns and reports schema drift honestly", async () => {
  await load();
  db.exec("create table if not exists secret_probe (x)");
  const { createKpiRecipeExecution } =
    await import("../src/lib/ai/analytics/recipe-execution");
  const execution = createKpiRecipeExecution();
  const recipe = (sql: string, key = "n") => ({
    conceptId: key,
    sql,
    tracks: [{ key, signature: "s" }],
  });
  const run = await execution.run(
    [
      // Saved SQL is re-admitted, not trusted from an earlier save.
      recipe("select 1 as n from sqlite_master", "a"),
      // id is a real activity column but not in the analytical allowlist.
      recipe(
        "select count(id) as b from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
        "b",
      ),
      recipe(
        "select sum(duration_sec) as c, sum(duration_sec) as c from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
        "c",
      ),
      recipe(
        "select garmin_id as d from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
        "d",
      ),
      recipe(
        "select coalesce(max(name), 'x') as e from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
        "e",
      ),
    ],
    window,
  );
  expect(
    run.outcomes.map((o) => [
      o.conceptId,
      o.status,
      "reason" in o ? o.reason : null,
    ]),
  ).toEqual([
    ["a", "failed", "disallowed_table"],
    ["b", "failed", "unknown_column"],
    ["c", "failed", "column_mismatch"],
    ["d", "failed", "no_row"],
    ["e", "failed", "non_numeric"],
  ]);
});

it("changes the imported-data basis on relevant writes and settlement only", async () => {
  const insert = await load();
  const { createKpiRecipeExecution } =
    await import("../src/lib/ai/analytics/recipe-execution");
  const execution = createKpiRecipeExecution();
  const first = execution.basis(window);
  insert.run("x", "x", "Other week", "hiking", at(2), 9000, 1);
  expect(execution.basis(window)).toBe(first);
  insert.run("y", "y", "Hike", "hiking", at(12), 9000, 1);
  const second = execution.basis(window);
  expect(second).not.toBe(first);
  db.prepare("update activity set duration_sec=9100 where garmin_id='y'").run();
  expect(execution.basis(window)).not.toBe(second);
  const third = execution.basis(window);
  db.prepare(
    "insert into sync_run(id,status,started_at,finished_at) values ('r','completed',1,2)",
  ).run();
  expect(execution.basis(window)).not.toBe(third);
  const run = await execution.run([], window);
  expect(run.outcomes).toEqual([]);
});
