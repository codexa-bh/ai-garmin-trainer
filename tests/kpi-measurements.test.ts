import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { authoredWeeklyKpis } from "../scripts/ci/kpi-fixture";
import { createWeekly } from "../src/lib/weekly/application";
import { createKpiMeasurements } from "../src/lib/weekly/measurements";
import { createWeeklyStore } from "../src/lib/db/weekly-repository";
import { migrateDatabase } from "../src/lib/db/migrations";
import {
  kpiActual,
  latestKpiScore,
  latestKpiMeasurement,
} from "../src/lib/weekly/kpis";
import type { WeeklyTurn } from "../src/lib/weekly/contracts";
import type {
  KpiMeasurementExecution,
  KpiMeasurementRun,
  KpiRead,
  KpiRecipeOutcome,
} from "../src/lib/weekly/kpi-contracts";

const week = "2026-11-09";
const now = new Date("2026-11-11T12:00:00Z");
const turn: WeeklyTurn = {
  conversationId: "authored",
  turnId: "user",
  previousAssistantId: null,
  timeZone: "UTC",
};
const sql =
  "select count(*) as count, sum(duration_sec)/60.0 as duration from activity where started_at >= :week_start_ms and started_at < :week_end_ms";

let db: Database.Database;
let basis: string;
let outcome: (conceptId: string, weekStart: string) => KpiRecipeOutcome;
let runs: { weekStart: string; concepts: string[]; endMs: number }[];
let during: (() => void) | undefined;
let current: boolean;
const execution: KpiMeasurementExecution = {
  async run(recipes, window): Promise<KpiMeasurementRun> {
    runs.push({
      weekStart: window.weekStart,
      concepts: recipes.map((r) => r.conceptId),
      endMs: window.endMs,
    });
    const seen = basis;
    await Promise.resolve();
    during?.();
    return {
      basis: seen,
      outcomes: recipes.map((r) => outcome(r.conceptId, window.weekStart)),
    };
  },
  basis: () => basis,
};
function setup() {
  const store = createWeeklyStore(() => db);
  const guarded = { ...store, isCurrentTurn: () => current };
  const weekly = createWeekly(
    guarded,
    () => now,
    () => "id",
  );
  let n = 0;
  const measurements = createKpiMeasurements(
    guarded,
    execution,
    () => now,
    () => `rev-${++n}`,
  );
  return { store, weekly, measurements };
}
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  basis = "b1";
  runs = [];
  during = undefined;
  current = true;
  outcome = (conceptId) => ({
    conceptId,
    status: "measured",
    values: { count: 6, duration: 240 },
  });
  createWeeklyStore(() => db).saveKpis(week, authoredWeeklyKpis(now));
});
afterEach(() => db.close());

async function establish() {
  const { weekly, measurements } = setup();
  return measurements.saveRecipes(
    week,
    [{ conceptId: "authored-sessions", sql, tracks: ["count", "duration"] }],
    turn,
    [weekly.readKpis(week)],
  );
}

it("verifies over two periods before accepting, then publishes the verified current week without touching assessments", async () => {
  const before = db.prepare("select * from weekly_kpi").all();
  const saved = await establish();
  expect(saved).toMatchObject({
    status: "saved",
    saved: [{ conceptId: "authored-sessions", version: 1 }],
  });
  expect(runs.map((r) => r.weekStart)).toEqual([week, "2026-11-02"]);
  // Reviewed assessments, points and track registry are unchanged.
  expect(db.prepare("select * from weekly_kpi").all()).toEqual(before);
  const { weekly } = setup();
  const read: KpiRead = weekly.readKpis(week);
  const track = read.sets.find((s) => s.id === read.latestPlanSetId)!.items[0]
    .tracks[0];
  expect(kpiActual(read, "authored-sessions", track)).toMatchObject({
    source: "measured",
    value: 6,
    stale: false,
  });
  // Reviewed points/score and the assessment's recorded actual stay independent.
  expect(latestKpiScore(read).total).toBe(
    latestKpiScore({ ...read, measured: null }).total,
  );
  expect(latestKpiMeasurement(read, "authored-sessions", track)?.value).toBe(
    latestKpiMeasurement(
      { ...read, measured: null },
      "authored-sessions",
      track,
    )?.value,
  );
  // The same stored values reach the progress read used by charts and tools.
  const progress = weekly.progress(week, week, 12);
  expect(progress.weeks[0].kpis.measured).toEqual(read.measured);
  expect(progress.recipes?.map((r) => r.version)).toEqual([1]);
});

it("refuses an untested/broken recipe and preserves the previous recipe and value", async () => {
  await establish();
  outcome = (conceptId, weekStart) =>
    weekStart === "2026-11-02"
      ? { conceptId, status: "failed", reason: "unknown_column" }
      : { conceptId, status: "measured", values: { count: 1, duration: 1 } };
  const { weekly, measurements } = setup();
  const refused = await measurements.saveRecipes(
    week,
    [
      {
        conceptId: "authored-sessions",
        sql: sql.replace("count(*)", "count(garmin_id)"),
        tracks: ["count", "duration"],
      },
    ],
    turn,
    [weekly.readKpis(week)],
  );
  expect(refused).toMatchObject({
    status: "refused",
    failures: [{ conceptId: "authored-sessions", reason: "unknown_column" }],
  });
  expect(measurements.recipes()).toMatchObject([{ version: 1, sql }]);
  expect(
    weekly.readKpis(week).measured?.concepts["authored-sessions"].success
      ?.values,
  ).toEqual({ count: 6, duration: 240 });
});

it("requires a complete current read, the current turn and plan tracks; unchanged SQL creates no version", async () => {
  const { weekly, measurements } = setup();
  const save = (snapshots: KpiRead[], tracks = ["count"]) =>
    measurements.saveRecipes(
      week,
      [{ conceptId: "authored-sessions", sql, tracks }],
      turn,
      snapshots,
    );
  await expect(save([])).rejects.toThrow("prior_complete_kpi_read_required");
  await expect(save([weekly.readKpis(week)], ["unknown"])).rejects.toThrow(
    "recipe_tracks_not_in_plan",
  );
  current = false;
  await expect(save([weekly.readKpis(week)])).rejects.toThrow(
    "weekly_turn_superseded",
  );
  expect(measurements.recipes()).toEqual([]);
  current = true;
  await establish();
  runs = [];
  expect(await establish()).toMatchObject({ saved: [], unchanged: 1 });
  expect(runs).toEqual([]);
  expect(measurements.recipes()).toHaveLength(1);
});

it("keeps useful prior values with stale failure facts, never zeroes them, and refuses obsolete publication", async () => {
  await establish();
  const { weekly, measurements } = setup();
  outcome = (conceptId) => ({ conceptId, status: "failed", reason: "timeout" });
  expect(await measurements.refresh("UTC")).toMatchObject({
    status: "refreshed",
    failed: ["authored-sessions"],
  });
  const read = weekly.readKpis(week);
  const concept = read.measured!.concepts["authored-sessions"];
  expect(concept.success?.values).toEqual({ count: 6, duration: 240 });
  expect(concept.failure?.reason).toBe("timeout");
  const track = read.sets.find((s) => s.id === read.latestPlanSetId)!.items[0]
    .tracks[0];
  expect(kpiActual(read, "authored-sessions", track)).toMatchObject({
    value: 6,
    stale: true,
  });
  // Imported data changes during every execution: publication is refused.
  outcome = (conceptId) => ({
    conceptId,
    status: "measured",
    values: { count: 99, duration: 1 },
  });
  during = () => (basis = `${basis}+`);
  expect(await measurements.refresh("UTC")).toMatchObject({
    status: "superseded",
  });
  expect(
    weekly.readKpis(week).measured!.concepts["authored-sessions"].success
      ?.values,
  ).toEqual({ count: 6, duration: 240 });
  // Basis changed once: a single bounded retry publishes the coherent result.
  let once = true;
  during = () => {
    if (once) basis = "b3";
    once = false;
  };
  expect(await measurements.refresh("UTC")).toMatchObject({
    status: "refreshed",
  });
  expect(
    weekly.readKpis(week).measured!.concepts["authored-sessions"].success,
  ).toMatchObject({ values: { count: 99, duration: 1 }, basis: "b3" });
});

it("coalesces repeated triggers, defaults to the current week and bounds deliberate history", async () => {
  await establish();
  runs = [];
  const { measurements } = setup();
  const [a, b] = await Promise.all([
    measurements.refresh("UTC"),
    measurements.refresh("UTC"),
  ]);
  expect(a).toBe(b);
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ weekStart: week, endMs: now.getTime() });
  expect(() => measurements.refresh("UTC", "2026-11-16")).toThrow(
    "invalid_measurement_week",
  );
  expect(() => measurements.refresh("UTC", "2026-08-17")).toThrow(
    "invalid_measurement_week",
  );
  expect(await measurements.refresh("UTC", "2026-11-02")).toMatchObject({
    status: "no_plan",
  });
});

it("does not apply a recipe whose track meaning changed, and keeps the measured value bound to its meaning", async () => {
  await establish();
  const store = createWeeklyStore(() => db);
  const state = store.readKpis(week)!;
  const latest = state.sets.find((s) => s.id === state.latestId)!;
  latest.items[0].tracks[0].meaning = "Different selection";
  store.saveKpis(week, state);
  runs = [];
  const { weekly, measurements } = setup();
  expect(await measurements.refresh("UTC")).toMatchObject({
    status: "no_recipes",
  });
  expect(runs).toEqual([]);
  const read = weekly.readKpis(week);
  const track = read.sets.find((s) => s.id === read.latestPlanSetId)!.items[0]
    .tracks[0];
  expect(kpiActual(read, "authored-sessions", track)?.source).not.toBe(
    "measured",
  );
});
