import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { authoredWeeklyKpis } from "../scripts/ci/kpi-fixture";
import { createWeekly } from "../src/lib/weekly/application";
import {
  kpiAwarded,
  kpiScoredUnits,
  latestKpiMeasurement,
  latestKpiScore,
  projectKpis,
} from "../src/lib/weekly/kpis";
import { reconcileKpiSources } from "../src/lib/weekly/backfill";
import { createWeeklyStore } from "../src/lib/db/weekly-repository";
import { migrateDatabase } from "../src/lib/db/migrations";
import type { WeeklyRecord } from "../src/lib/weekly/contracts";

const week = "2026-11-09";
const now = new Date("2026-11-11T12:00:00Z");
const doc = {
  title: "Authored",
  contentMarkdown: "Independent synthetic plan",
  revision: "document",
  savedAt: "2026-11-08T12:00:00Z",
};
const source: WeeklyRecord = {
  weekStart: week,
  timeZone: "UTC",
  revision: "source",
  original: doc,
  latest: { ...doc, revision: "adapted-document" },
  review: null,
};
let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
});
afterEach(() => db.close());

it("uses only latest targets and exact assessment, not an obsolete high score or newer correction", () => {
  const state = authoredWeeklyKpis(now);
  expect(latestKpiScore(projectKpis(week, state))).toMatchObject({
    total: null,
    percentage: null,
    reason: "Not assessed",
  });
  state.assessments[0].savedAt = now.toISOString();
  state.assessments[0].totalPoints = 999;
  expect(latestKpiScore(projectKpis(week, state)).total).toBeNull();
  state.assessments.push({
    ...structuredClone(state.assessments[0]),
    setId: state.latestId!,
    totalPoints: 0,
  });
  expect(latestKpiScore(projectKpis(week, state))).toMatchObject({
    total: 0,
    available: 80,
    percentage: 0,
  });
});
it("sums independent per-measurement allocations, ignores monitoring and never adds extras twice or caps above100", () => {
  const state = authoredWeeklyKpis(now);
  state.latestId = state.originalId;
  state.sets = [state.sets[0]];
  const monitoring = structuredClone(state.sets[0].items[0]);
  monitoring.id = "monitor";
  monitoring.conceptId = "context";
  for (const track of monitoring.tracks) delete track.availablePoints;
  state.sets[0].items.push(monitoring);
  const monitoringResult = structuredClone(state.assessments[0].items[0]);
  monitoringResult.itemId = monitoring.id;
  for (const actual of monitoringResult.actuals) delete actual.awardedPoints;
  state.assessments[0].items.push(monitoringResult);
  expect(latestKpiScore(projectKpis(week, state))).toMatchObject({
    total: 112.5,
    available: 100,
    percentage: 112.5,
    provisional: true,
  });
  // One scored plus one monitoring measurement: only the scored one counts.
  delete state.sets[0].items[0].tracks[1].availablePoints;
  delete state.assessments[0].items[0].actuals[1].awardedPoints;
  expect(latestKpiScore(projectKpis(week, state)).available).toBe(60);
  // A scored measurement with an unknown award is an incomplete score, not zero.
  state.assessments[0].items[0].actuals[0].awardedPoints = null;
  expect(latestKpiScore(projectKpis(week, state))).toMatchObject({
    total: null,
    reason: "Overall score unavailable",
  });
});
it("reads an unmapped legacy multi-measurement pool once, never split or duplicated", () => {
  const state = authoredWeeklyKpis(now);
  state.latestId = state.originalId;
  const item = state.sets[0].items[0];
  for (const track of item.tracks) delete track.availablePoints;
  item.availablePoints = 100;
  const result = state.assessments[0].items[0];
  for (const actual of result.actuals) delete actual.awardedPoints;
  result.awardedPoints = 100;
  expect(kpiScoredUnits(item)).toEqual([{ trackKey: null, available: 100 }]);
  expect(latestKpiScore(projectKpis(week, state))).toMatchObject({
    total: 112.5,
    available: 100,
  });
  // A legacy single-numeric-measurement pool is exactly that measurement's.
  item.tracks = [item.tracks[0]];
  result.actuals = [{ trackKey: item.tracks[0].key, value: 4 }];
  expect(kpiScoredUnits(item)).toEqual([
    { trackKey: item.tracks[0].key, available: 100 },
  ]);
  expect(kpiAwarded(item, result, item.tracks[0].key)).toBe(100);
});
it("keeps missing totals, incomplete/unavailable assessments, zero denominator and incomplete reads as gaps", () => {
  const state = authoredWeeklyKpis(now);
  state.latestId = state.originalId;
  const score = () => latestKpiScore(projectKpis(week, state));
  state.assessments[0].totalPoints = null;
  expect(score().percentage).toBeNull();
  state.assessments[0].totalPoints = 37;
  state.assessments[0].items = [];
  expect(score().percentage).toBeNull();
  state.assessments[0].items = authoredWeeklyKpis(now).assessments[0].items;
  state.assessments[0].status = "unavailable";
  expect(score().percentage).toBeNull();
  state.assessments[0].status = "provisional";
  state.sets[0].items[0].tracks[0].availablePoints = 0;
  state.sets[0].items[0].tracks[1].availablePoints = 0;
  expect(score().percentage).toBeNull();
  expect(
    latestKpiScore({ ...projectKpis(week, state), complete: false }).percentage,
  ).toBeNull();
});
it("admits a review-defined saved score only with explicit latest-plan source binding", () => {
  const state = authoredWeeklyKpis(now);
  state.originalId = null;
  state.latestId = null;
  state.sets = [state.sets[0]];
  state.sets[0].origin = "review-defined";
  state.reviewDefinedId = state.sets[0].id;
  expect(
    latestKpiScore(projectKpis(week, state, undefined, source)).total,
  ).toBeNull();
  state.sets[0].planRevision = source.latest!.revision;
  expect(
    latestKpiScore(projectKpis(week, state, undefined, source)),
  ).toMatchObject({ total: 112.5, provisional: true });
  const newer = { ...source, latest: { ...source.latest!, revision: "newer" } };
  expect(
    latestKpiScore(projectKpis(week, state, undefined, newer)).total,
  ).toBeNull();
});
it("finds latest established plan independently of chart range, skips empty slots and never resurrects old choices for a real KPI-free plan", () => {
  const store = createWeeklyStore(() => db);
  store.saveKpis(week, authoredWeeklyKpis(now));
  const app = createWeekly(
    store,
    () => now,
    () => "id",
  );
  expect(app.progress("2026-08-03", "2026-08-10").latestPlan?.weekStart).toBe(
    week,
  );
  store.save({
    ...source,
    weekStart: "2026-11-16",
    original: null,
    latest: null,
  });
  expect(app.progress("2026-08-03", "2026-08-10").latestPlan?.weekStart).toBe(
    week,
  );
  store.save({ ...source, weekStart: "2026-11-16" });
  expect(app.progress("2026-08-03", "2026-08-10").latestPlan).toMatchObject({
    weekStart: "2026-11-16",
    complete: true,
    sets: [],
  });
});
it("joins renamed historical labels and changed targets by stable exact meaning, never obsolete sets, conflicting candidates or incompatible semantics", () => {
  const state = authoredWeeklyKpis(now);
  const selected = state.sets[0].items[0].tracks[0];
  state.assessments.push({
    ...structuredClone(state.assessments[0]),
    setId: state.latestId!,
    totalPoints: 65,
  });
  state.sets[1].items[0].label = "Renamed synthetic sessions";
  expect(
    latestKpiMeasurement(
      projectKpis(week, state),
      "authored-sessions",
      selected,
    ),
  ).toMatchObject({ value: 4, track: { target: { value: 5 } } });
  state.sets[1].items[0].tracks[0].unit = "different";
  expect(
    latestKpiMeasurement(
      projectKpis(week, state),
      "authored-sessions",
      selected,
    ),
  ).toBeNull();
  state.sets[1].items = [];
  expect(
    latestKpiMeasurement(
      projectKpis(week, state),
      "authored-sessions",
      selected,
    ),
  ).toBeNull();
  state.sets[1].items = [
    state.sets[0].items[0],
    structuredClone(state.sets[0].items[0]),
  ];
  expect(
    latestKpiMeasurement(
      projectKpis(week, state),
      "authored-sessions",
      selected,
    ),
  ).toBeNull();
});
it("adds only reviewed source bindings/conflict revision, preserves every other value/reference and reconciles an identical rerun", () => {
  const store = createWeeklyStore(() => db);
  store.save(source);
  const expected = authoredWeeklyKpis(now);
  store.saveKpis(week, expected);
  const mapping = {
    source,
    expected,
    newRevision: "reconciled",
    planRevisions: {
      [expected.originalId!]: source.original!.revision,
      [expected.latestId!]: source.latest!.revision,
    },
  };
  const narrative = db.prepare("select * from weekly_artifact").all();
  const registry = db.prepare("select * from weekly_kpi_track").all();
  expect(reconcileKpiSources(store, [mapping])).toEqual({
    applied: 1,
    reconciled: 0,
    weeks: 1,
  });
  expect(reconcileKpiSources(store, [mapping])).toEqual({
    applied: 0,
    reconciled: 1,
    weeks: 1,
  });
  const saved = store.readKpis(week)!;
  expect(saved.sets.map((value) => value.planRevision)).toEqual([
    source.original!.revision,
    source.latest!.revision,
  ]);
  expect({
    ...saved,
    revision: expected.revision,
    sets: saved.sets.map(({ planRevision: _binding, ...set }) => set),
  }).toEqual(expected);
  expect(db.prepare("select * from weekly_artifact").all()).toEqual(narrative);
  expect(db.prepare("select * from weekly_kpi_track").all()).toEqual(registry);
  store.saveKpis(week, { ...saved, revision: "newer-write" });
  expect(() => reconcileKpiSources(store, [mapping])).toThrow(
    "structured_source_changed",
  );
});
it("refuses changed narratives and invalid bindings and atomically rolls back earlier writes in a finite batch", () => {
  const store = createWeeklyStore(() => db);
  store.save(source);
  const expected = authoredWeeklyKpis(now);
  store.saveKpis(week, expected);
  const mapping = {
    source,
    expected,
    newRevision: "reconciled",
    planRevisions: { [expected.latestId!]: source.latest!.revision },
  };
  const other = { ...source, weekStart: "2026-11-02" };
  store.save(other);
  store.saveKpis(other.weekStart, expected);
  expect(() =>
    reconcileKpiSources(store, [
      mapping,
      { ...mapping, source: other, planRevisions: { unknown: "missing" } },
    ]),
  ).toThrow("incompatible_kpi_source_binding");
  expect(store.readKpis(week)).toEqual(expected);
  store.save({ ...source, revision: "newer" });
  expect(() => reconcileKpiSources(store, [mapping])).toThrow("source_changed");
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
