import { afterEach, beforeEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWeekly } from "../src/lib/weekly/application";
import type { WeeklyStore, WeeklyTurn } from "../src/lib/weekly/contracts";
import type {
  KpiAssessmentInput,
  KpiSetInput,
  WeeklyKpis,
} from "../src/lib/weekly/kpi-contracts";
import { migrateDatabase, databaseHasUserData } from "../src/lib/db/migrations";

const now = new Date("2026-11-10T12:00:00Z");
const week = "2026-11-09";
const turn: WeeklyTurn = {
  conversationId: "synthetic",
  turnId: "current",
  previousAssistantId: null,
  timeZone: "UTC",
};
let db: Database.Database;
let current = true;
let n = 0;
let app: ReturnType<typeof createWeekly>;
let store: WeeklyStore;
let path: string;
const authoredKpiSet = (): KpiSetInput => ({
  origin: "planned",
  provenance: "Independently authored synthetic agreement",
  items: [
    {
      id: "outings",
      conceptId: "outdoor-sessions",
      label: "Outdoor sessions",
      definition: "Qualifying outdoor sessions",
      selection: "Count selected sessions and their combined duration, once",
      evidenceRequired: "Imported summary plus user qualification",
      availablePoints: 100,
      scoring: "Model explained allocation, not app evaluation",
      tracks: [
        {
          key: "count",
          kind: "numeric",
          unit: "sessions",
          meaning: "Number of qualifying sessions",
          target: { comparator: "at-least", value: 3 },
        },
        {
          key: "duration",
          kind: "numeric",
          unit: "minutes",
          meaning: "Total duration of the same sessions",
          target: { comparator: "at-least", value: 90 },
        },
      ],
    },
  ],
});
const evidence = {
  origin: "user-report" as const,
  references: ["Current user report"],
  qualification: "User-selected sessions",
  limitations: "Not fresh Garmin verification",
};
const authoredAssessment = (setId = "new"): KpiAssessmentInput => ({
  setId,
  asOf: now.toISOString(),
  status: "provisional",
  totalPoints: 112.5,
  explanation:
    "100 agreed points plus explained relevant additional work; no automatic bonus",
  items: [
    {
      itemId: "outings",
      actuals: [
        { trackKey: "count", value: 4 },
        { trackKey: "duration", value: 120 },
      ],
      awardedPoints: 100,
      status: "provisional",
      explanation: "Reported complete; qualification remains provisional",
      evidence,
    },
  ],
  extras: [
    {
      label: "Goal-relevant additional work",
      points: 12.5,
      explanation: "Trainer explained relevance without double counting",
      evidence,
    },
  ],
});
beforeEach(() => {
  path = join(
    mkdtempSync(join(tmpdir(), "weekly-kpi-test-")),
    "authored.sqlite",
  );
  db = new Database(path);
  migrateDatabase(db);
  current = true;
  n = 0;
  store = {
    transaction: (action) => db.transaction(action)(),
    read: (key) => {
      const r = db
        .prepare(
          "select document_json as json from weekly_artifact where week_start=?",
        )
        .get(key) as { json: string } | undefined;
      return r ? JSON.parse(r.json) : null;
    },
    save: (record) => {
      db.prepare(
        "insert into weekly_artifact values (?,?) on conflict(week_start) do update set document_json=excluded.document_json",
      ).run(record.weekStart, JSON.stringify(record));
    },
    readKpis: (key) => {
      const r = db
        .prepare("select state_json as json from weekly_kpi where week_start=?")
        .get(key) as { json: string } | undefined;
      return r ? (JSON.parse(r.json) as WeeklyKpis) : null;
    },
    saveKpis: (key, state) => {
      db.prepare(
        "insert into weekly_kpi values (?,?) on conflict(week_start) do update set state_json=excluded.state_json",
      ).run(key, JSON.stringify(state));
    },
    registerTrack: (concept, key, signature) => {
      const r = db
        .prepare(
          "select signature from weekly_kpi_track where concept_id=? and track_key=?",
        )
        .get(concept, key) as { signature: string } | undefined;
      if (r && r.signature !== signature)
        throw new Error("incompatible_kpi_track_identity");
      db.prepare("insert or ignore into weekly_kpi_track values (?,?,?)").run(
        concept,
        key,
        signature,
      );
    },
    history: () => [],
    isCurrentTurn: () => current,
    proposal: () => null,
    pending: () => null,
    saveProposal: () => {},
    invalidate: () => {},
    messageExists: () => false,
  };
  app = createWeekly(
    store,
    () => now,
    () => `revision-${++n}`,
  );
});
afterEach(() => db.close());
it("round trips compound baselines, above-100 credit, original/adapted comparisons and corrections across restart", () => {
  app.saveKpis(
    {
      weekStart: week,
      commitment: authoredKpiSet(),
      assessments: [authoredAssessment()],
    },
    turn,
    [app.readKpis(week)],
  );
  const original = app.readKpis(week);
  expect(original.assessments[0].totalPoints).toBe(112.5);
  const adapted = authoredKpiSet();
  adapted.origin = "adaptation";
  adapted.items[0].tracks[0].target!.value = 5;
  app.saveKpis(
    {
      weekStart: week,
      commitment: adapted,
      assessments: [authoredAssessment()],
    },
    turn,
    [original],
  );
  const dual = app.readKpis(week);
  expect(dual.originalId).toBe(original.originalId);
  expect(dual.latestId).not.toBe(original.originalId);
  expect(dual.assessments).toHaveLength(2);
  const correction = authoredAssessment(original.originalId!);
  correction.items[0].actuals[0].value = 0;
  correction.items[0].actuals[1].value = null;
  correction.totalPoints = null;
  app.saveKpis({ weekStart: week, assessments: [correction] }, turn, [dual]);
  db.close();
  db = new Database(path);
  expect(
    app
      .readKpis(week)
      .assessments.find((a) => a.setId === original.originalId)
      ?.items[0].actuals.map((a) => a.value),
  ).toEqual([0, null]);
  expect(app.readKpis(week).assessments).toHaveLength(2);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
it("refuses missing/incomplete/stale reads, superseded turns and incompatible recurring identities without changes", () => {
  const change = { weekStart: week, commitment: authoredKpiSet() };
  expect(() => app.saveKpis(change, turn, [])).toThrow("prior_complete");
  expect(() =>
    app.saveKpis(change, turn, [{ ...app.readKpis(week), complete: false }]),
  ).toThrow("prior_complete");
  const before = app.readKpis(week);
  app.saveKpis(change, turn, [before]);
  expect(() => app.saveKpis(change, turn, [before])).toThrow("prior_complete");
  current = false;
  expect(() => app.saveKpis(change, turn, [app.readKpis(week)])).toThrow(
    "superseded",
  );
  current = true;
  const bad = authoredKpiSet();
  bad.origin = "adaptation";
  bad.items[0].tracks[0].unit = "km";
  const saved = app.readKpis(week);
  expect(() =>
    app.saveKpis({ weekStart: week, commitment: bad }, turn, [saved]),
  ).toThrow("incompatible_kpi_track");
  expect(app.readKpis(week)).toEqual(saved);
});
it("makes combined narrative, sets, assessments and signature registration atomic; focused writes leave narrative bytes intact", () => {
  const narrative = {
    weekStart: week,
    kind: "plan" as const,
    title: "Authored plan",
    contentMarkdown: "Preserve this exact source",
  };
  app.save(
    [narrative],
    turn,
    [app.read(week)],
    [{ weekStart: week, commitment: authoredKpiSet() }],
    [app.readKpis(week)],
  );
  const bytes = db.prepare("select document_json from weekly_artifact").get();
  app.saveKpis(
    {
      weekStart: week,
      assessments: [authoredAssessment(app.readKpis(week).originalId!)],
    },
    turn,
    [app.readKpis(week)],
  );
  expect(db.prepare("select document_json from weekly_artifact").get()).toEqual(
    bytes,
  );
  const failing = createWeekly(
    {
      ...store,
      saveKpis: () => {
        throw new Error("synthetic_write_failure");
      },
    },
    () => now,
    () => `failure-${++n}`,
  );
  const adaptation = authoredKpiSet();
  adaptation.origin = "adaptation";
  adaptation.items[0].conceptId = "another-concept";
  const saved = app.readKpis(week);
  expect(() =>
    failing.save(
      [{ ...narrative, contentMarkdown: "Must roll back" }],
      turn,
      [app.read(week)],
      [{ weekStart: week, commitment: adaptation }],
      [saved],
    ),
  ).toThrow("synthetic_write_failure");
  expect(db.prepare("select document_json from weekly_artifact").get()).toEqual(
    bytes,
  );
  expect(app.readKpis(week)).toEqual(saved);
  expect(
    db
      .prepare(
        "select count(*) as n from weekly_kpi_track where concept_id='another-concept'",
      )
      .get(),
  ).toEqual({ n: 0 });
});
it("keeps provisional legacy interpretations out of agreed originals and rejects past plan edits and invalid references/values", () => {
  const past = "2026-10-26";
  db.prepare("insert into weekly_artifact values (?,?)").run(
    past,
    JSON.stringify({
      weekStart: past,
      timeZone: "UTC",
      revision: "legacy",
      original: {
        title: "Legacy",
        contentMarkdown: "Recorded commitments",
        revision: "old",
        savedAt: now.toISOString(),
      },
      latest: null,
      review: null,
    }),
  );
  const provisional = authoredKpiSet();
  provisional.origin = "review-defined";
  app.saveKpis(
    {
      weekStart: past,
      commitment: provisional,
      assessments: [authoredAssessment()],
    },
    turn,
    [app.readKpis(past)],
  );
  expect(app.readKpis(past)).toMatchObject({
    originalId: null,
    latestId: null,
    reviewDefinedId: expect.any(String),
  });
  expect(() =>
    app.saveKpis({ weekStart: past, commitment: authoredKpiSet() }, turn, [
      app.readKpis(past),
    ]),
  ).toThrow("read_only");
  const wrong = authoredAssessment(app.readKpis(past).reviewDefinedId!);
  wrong.items[0].actuals[0].value = Infinity;
  expect(() =>
    app.saveKpis({ weekStart: past, assessments: [wrong] }, turn, [
      app.readKpis(past),
    ]),
  ).toThrow("incompatible_kpi_actual");
  expect(() =>
    app.saveKpis(
      { weekStart: past, assessments: [authoredAssessment("absent")] },
      turn,
      [app.readKpis(past)],
    ),
  ).toThrow("unknown_kpi_set");
});
it("projects explicit gaps with a bounded read-only progress range and schema rerun preserves KPI-only user data", () => {
  app.saveKpis({ weekStart: week, commitment: authoredKpiSet() }, turn, [
    app.readKpis(week),
  ]);
  const prior = app.readKpis(week);
  const progress = app.progress("2026-11-02", "2026-11-16");
  expect(progress.weeks.map((w) => w.kpis.sets.length)).toEqual([0, 1, 0]);
  expect(app.readKpis(week)).toEqual(prior);
  expect(() => app.progress("2026-01-05", week)).toThrow(
    "invalid_progress_range",
  );
  expect(databaseHasUserData(db)).toBe(true);
  migrateDatabase(db);
  expect(app.readKpis(week)).toEqual(prior);
});
it("refuses oversized default evidence and admits complete narrower objects without widening budgets", () => {
  const large = authoredKpiSet();
  const item = large.items[0];
  large.items = Array.from({ length: 10 }, (_, index) => ({
    ...item,
    id: `item-${index}`,
    conceptId: `series-${index}`,
    definition: "d".repeat(700),
    selection: "s".repeat(700),
    evidenceRequired: "e".repeat(100),
    scoring: "m".repeat(100),
  }));
  const assessment = authoredAssessment();
  const result = assessment.items[0];
  assessment.items = large.items.map((item) => ({
    ...result,
    itemId: item.id,
    explanation: "x".repeat(400),
    evidence: {
      ...evidence,
      qualification: "q".repeat(400),
      limitations: "l".repeat(400),
    },
  }));
  app.saveKpis(
    { weekStart: week, commitment: large, assessments: [assessment] },
    turn,
    [app.readKpis(week)],
  );
  const prior = app.readKpis(week);
  app.saveKpis(
    {
      weekStart: week,
      commitment: { ...large, origin: "adaptation" },
      assessments: [assessment],
    },
    turn,
    [prior],
  );
  const incomplete = app.readKpis(week);
  expect(incomplete.complete).toBe(false);
  expect(incomplete.sets).toEqual([]);
  expect(incomplete.narrowToSetIds).toEqual([
    incomplete.originalId,
    incomplete.latestId,
  ]);
  const correction = { ...assessment, setId: incomplete.originalId! };
  expect(() =>
    app.saveKpis({ weekStart: week, assessments: [correction] }, turn, [
      incomplete,
    ]),
  ).toThrow("prior_complete");
  const narrow = app.readKpis(week, incomplete.originalId!);
  expect(narrow.complete).toBe(true);
  expect(JSON.stringify(narrow).length).toBeLessThan(60000);
  app.saveKpis({ weekStart: week, assessments: [correction] }, turn, [narrow]);
  expect(app.readKpis(week, incomplete.originalId!).assessments[0].setId).toBe(
    incomplete.originalId,
  );
});

it("round trips qualifying monitoring with no target/points, explicit unknown and independently explained partial credit", () => {
  const set = authoredKpiSet();
  set.items[0].availablePoints = null;
  set.items[0].scoring = "";
  set.items[0].tracks = [
    {
      key: "qualifies",
      kind: "qualifying",
      unit: "qualification",
      meaning: "User-reported qualifying outcome",
      target: null,
    },
  ];
  app.saveKpis({ weekStart: week, commitment: set }, turn, [
    app.readKpis(week),
  ]);
  const assessment = authoredAssessment(app.readKpis(week).originalId!);
  assessment.totalPoints = null;
  assessment.extras = [];
  assessment.items[0].awardedPoints = null;
  assessment.items[0].actuals = [{ trackKey: "qualifies", value: null }];
  app.saveKpis({ weekStart: week, assessments: [assessment] }, turn, [
    app.readKpis(week),
  ]);
  expect(app.readKpis(week).sets[0].items[0]).toMatchObject({
    availablePoints: null,
    tracks: [{ target: null }],
  });
  expect(
    app.readKpis(week).assessments[0].items[0].actuals[0].value,
  ).toBeNull();
});
it("rejects malformed/duplicate/nonfinite targets, wrong calendar and future cutoffs atomically", () => {
  const invalidSets = [authoredKpiSet(), authoredKpiSet(), authoredKpiSet()];
  invalidSets[0].items[0].tracks[0].target!.value = NaN;
  invalidSets[1].items.push(invalidSets[1].items[0]);
  invalidSets[2].items[0].tracks[0].target = {
    comparator: "range",
    value: 3,
    upper: 2,
  };
  for (const commitment of invalidSets)
    expect(() =>
      app.saveKpis({ weekStart: week, commitment }, turn, [app.readKpis(week)]),
    ).toThrow();
  expect(app.readKpis(week).revision).toBeNull();
  app.saveKpis({ weekStart: week, commitment: authoredKpiSet() }, turn, [
    app.readKpis(week),
  ]);
  const before = app.readKpis(week);
  const future = authoredAssessment(before.originalId!);
  future.asOf = "2026-11-11T12:00:00Z";
  expect(() =>
    app.saveKpis({ weekStart: week, assessments: [future] }, turn, [before]),
  ).toThrow("cutoff");
  expect(() =>
    app.saveKpis(
      {
        weekStart: week,
        assessments: [authoredAssessment(before.originalId!)],
      },
      { ...turn, timeZone: "Europe/Zagreb" },
      [before],
    ),
  ).toThrow("calendar_changed");
  expect(app.readKpis(week)).toEqual(before);
  expect(() => app.readKpis("2026-11-10")).toThrow("invalid_week");
});
