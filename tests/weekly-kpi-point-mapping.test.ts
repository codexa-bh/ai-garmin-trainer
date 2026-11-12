import { afterEach, beforeEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { migrateDatabase } from "../src/lib/db/migrations";
import { createWeeklyStore } from "../src/lib/db/weekly-repository";
import {
  mapKpiPoints,
  type ReviewedKpiPointMapping,
} from "../src/lib/weekly/backfill";
import { latestKpiScore, projectKpis } from "../src/lib/weekly/kpis";
import { authoredWeeklyKpis } from "../scripts/ci/kpi-fixture";
import type { WeeklyRecord } from "../src/lib/weekly/contracts";
import type { WeeklyKpis } from "../src/lib/weekly/kpi-contracts";

const now = new Date("2026-11-11T12:00:00Z");
const week = "2026-11-09";
const other = "2026-11-02";
const narrative = (text: string) => ({
  title: "Authored plan",
  contentMarkdown: text,
  revision: "plan-doc",
  savedAt: "2026-11-08T12:00:00Z",
});
const source: WeeklyRecord = {
  weekStart: week,
  timeZone: "UTC",
  revision: "narrative-rev",
  original: narrative("Sessions: ≥3 sessions and ≥90 min — 100 points shared."),
  latest: narrative("Sessions: ≥3 sessions and ≥90 min — 100 points shared."),
  review: {
    ...narrative("Review: 4 sessions; awarded 100/100 shared. Keep easy."),
    revision: "review-doc",
    asOf: "2026-11-10T12:00:00Z",
    planRevision: "plan-doc",
  },
};
/** Authored legacy shape: one 100-point pool across count and duration. */
function legacyState(): WeeklyKpis {
  const state = authoredWeeklyKpis(now);
  state.latestId = state.originalId;
  state.sets = [state.sets[0]];
  const item = state.sets[0].items[0];
  for (const track of item.tracks) delete track.availablePoints;
  item.availablePoints = 100;
  const result = state.assessments[0].items[0];
  for (const actual of result.actuals) delete actual.awardedPoints;
  result.awardedPoints = 100;
  return state;
}
function approved(): ReviewedKpiPointMapping {
  const expected = legacyState();
  const state = structuredClone(expected);
  const item = state.sets[0].items[0];
  delete item.availablePoints;
  item.tracks[0].availablePoints = 60;
  item.tracks[1].availablePoints = 40;
  const result = state.assessments[0].items[0];
  delete result.awardedPoints;
  result.actuals[0].awardedPoints = 60;
  result.actuals[1].awardedPoints = 40;
  state.revision = "mapped-rev";
  const record = structuredClone(source);
  record.revision = "mapped-rev";
  const plan = "Sessions: ≥3 sessions (60 points) and ≥90 min (40 points).";
  record.original!.contentMarkdown = plan;
  record.latest!.contentMarkdown = plan;
  record.review!.contentMarkdown =
    "Review: 4 sessions; awarded 60/60 and 40/40. Keep easy.";
  return {
    source,
    expected,
    replacement: { record, state },
    newRevision: "mapped-rev",
  };
}
/** A valid approved mapping for the separate authored week. */
function approvedOther(): ReviewedKpiPointMapping {
  const mapping = approved();
  mapping.source = { ...source, weekStart: other, revision: "other" };
  mapping.expected = { ...legacyState(), revision: "other-state" };
  mapping.replacement.record.weekStart = other;
  return mapping;
}
let db: Database.Database;
const fingerprint = (week: string) =>
  JSON.stringify([
    db.prepare("select * from weekly_artifact where week_start=?").get(week),
    db.prepare("select * from weekly_kpi where week_start=?").get(week),
  ]);
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  const store = createWeeklyStore(() => db);
  store.save(source);
  store.saveKpis(week, legacyState());
  store.save({ ...source, weekStart: other, revision: "other" });
  store.saveKpis(other, { ...legacyState(), revision: "other-state" });
  db.prepare(
    "insert into weekly_kpi_track(concept_id,track_key,signature) values ('authored-sessions','count','[\"numeric\",\"sessions\",\"Selected session count\"]'),('authored-sessions','duration','[\"numeric\",\"minutes\",\"Selected session duration\"]')",
  ).run();
});
afterEach(() => db.close());

it("applies an approved per-measurement mapping atomically and idempotently without touching unlisted weeks", () => {
  const store = createWeeklyStore(() => db);
  const unaffected = fingerprint(other);
  const tracks = db.prepare("select * from weekly_kpi_track").all();
  const mapping = approved();
  expect(mapKpiPoints(store, [mapping], now)).toEqual({
    applied: 1,
    reconciled: 0,
    weeks: 1,
  });
  expect(store.read(week)).toEqual(mapping.replacement.record);
  expect(store.readKpis(week)).toEqual(mapping.replacement.state);
  const score = latestKpiScore(projectKpis(week, store.readKpis(week)));
  expect(score).toMatchObject({ available: 100, total: 112.5 });
  expect(mapKpiPoints(store, [mapping], now)).toEqual({
    applied: 0,
    reconciled: 1,
    weeks: 1,
  });
  expect(fingerprint(other)).toBe(unaffected);
  expect(db.prepare("select * from weekly_kpi_track").all()).toEqual(tracks);
});

it("refuses changed narrative/structured sources, newer writes and identity changes without partial writes", () => {
  const store = createWeeklyStore(() => db);
  const before = fingerprint(week);
  const otherBefore = fingerprint(other);
  // Sanity: the companion mapping alone is valid.
  expect(() =>
    db.transaction(() => {
      mapKpiPoints(store, [approvedOther()], now);
      throw new Error("rollback");
    })(),
  ).toThrow("rollback");
  const cases: [string, (m: ReviewedKpiPointMapping) => void][] = [
    [
      "point_mapping_source_changed",
      (m) => (m.source = { ...m.source, revision: "x" }),
    ],
    [
      "point_mapping_state_changed",
      (m) => (m.expected = { ...m.expected, revision: "x" }),
    ],
    [
      "invalid_point_mapping",
      (m) => (m.replacement.state.sets[0].items[0].conceptId = "renamed"),
    ],
    [
      "invalid_point_mapping",
      (m) => (m.replacement.record.latest!.title = "Retitled"),
    ],
    ["invalid_point_mapping", (m) => (m.replacement.state.revision = "other")],
    [
      "kpi_item_pool_unsupported",
      (m) => (m.replacement.state.sets[0].items[0].availablePoints = 100),
    ],
    [
      "invalid_kpi_track_award",
      (m) =>
        delete m.replacement.state.assessments[0].items[0].actuals[0]
          .awardedPoints,
    ],
  ];
  for (const [reason, mutate] of cases) {
    const mapping = approved();
    mutate(mapping);
    // A valid earlier mapping in the same batch must also roll back.
    expect(() => mapKpiPoints(store, [approvedOther(), mapping], now)).toThrow(
      reason,
    );
    expect(fingerprint(other)).toBe(otherBefore);
    expect(fingerprint(week)).toBe(before);
  }
  // A newer user write after the inventory refuses rather than overwriting it.
  const newer = structuredClone(source);
  newer.latest!.contentMarkdown += " User edit after inventory.";
  store.save(newer);
  expect(() => mapKpiPoints(store, [approved()], now)).toThrow(
    "point_mapping_source_changed",
  );
});

it("runs as an explicit owner-private hash-bound CLI on a real SQLite file", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kpi-points-")));
  const path = join(root, "synthetic.sqlite");
  const manifest = join(root, "manifest.json");
  const file = new Database(path);
  migrateDatabase(file);
  const store = createWeeklyStore(() => file);
  store.save(source);
  store.saveKpis(week, legacyState());
  file.close();
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const read = () => {
    const check = new Database(path, { readonly: true });
    try {
      return {
        narrative: (
          check
            .prepare(
              "select document_json from weekly_artifact where week_start=?",
            )
            .get(week) as { document_json: string }
        ).document_json,
        state: (
          check
            .prepare("select state_json from weekly_kpi where week_start=?")
            .get(week) as { state_json: string }
        ).state_json,
      };
    } finally {
      check.close();
    }
  };
  const writeManifest = (sourceSha256: string, stateSha256: string) => {
    writeFileSync(
      manifest,
      JSON.stringify({
        version: 1,
        mappings: [{ ...approved(), sourceSha256, stateSha256 }],
      }),
    );
    chmodSync(manifest, 0o600);
  };
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/map-weekly-kpi-points.ts", manifest],
      {
        encoding: "utf8",
        env: { ...process.env, DATABASE_PATH: path },
        timeout: 20000,
      },
    );
  const before = read();
  // A wrong narrative hash refuses before any mutation.
  writeManifest("0".repeat(64), sha(before.state));
  expect(run().status).not.toBe(0);
  expect(read()).toEqual(before);
  writeManifest(sha(before.narrative), sha(before.state));
  const first = run();
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, applied: 1 });
  expect(JSON.parse(read().state)).toEqual(approved().replacement.state);
  expect(JSON.parse(read().narrative)).toEqual(approved().replacement.record);
  // An identical rerun reconciles even though source hashes no longer match.
  const second = run();
  expect(second.status, second.stderr).toBe(0);
  expect(JSON.parse(second.stdout)).toMatchObject({
    applied: 0,
    reconciled: 1,
  });
});
