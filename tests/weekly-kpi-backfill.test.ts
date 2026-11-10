import { afterEach, beforeEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { migrateDatabase } from "../src/lib/db/migrations";
import { createWeeklyStore } from "../src/lib/db/weekly-repository";
import { backfillWeeklyKpis } from "../src/lib/weekly/backfill";
import { authoredWeeklyKpis } from "../scripts/ci/kpi-fixture";
import type { WeeklyRecord } from "../src/lib/weekly/contracts";

let db: Database.Database;
const source: WeeklyRecord = {
  weekStart: "2026-11-09",
  timeZone: "UTC",
  revision: "source-revision",
  original: {
    title: "Authored original",
    contentMarkdown: "Entirely synthetic historical commitment",
    revision: "original-document",
    savedAt: "2026-11-08T10:00:00Z",
  },
  latest: null,
  review: null,
};
const now = new Date("2026-11-10T12:00:00Z");
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  db.prepare("insert into weekly_artifact values (?,?)").run(
    source.weekStart,
    JSON.stringify(source),
  );
});
afterEach(() => db.close());
it("applies finite dual comparisons idempotently without changing original source bytes and refuses changed sources/conflicting mappings", () => {
  const store = createWeeklyStore(() => db);
  const mapping = { source, state: authoredWeeklyKpis(now) };
  const bytes = db.prepare("select document_json from weekly_artifact").get();
  expect(backfillWeeklyKpis(store, [mapping], now)).toEqual({
    applied: 1,
    reconciled: 0,
    weeks: 1,
  });
  expect(backfillWeeklyKpis(store, [mapping], now)).toEqual({
    applied: 0,
    reconciled: 1,
    weeks: 1,
  });
  expect(db.prepare("select document_json from weekly_artifact").get()).toEqual(
    bytes,
  );
  expect(() =>
    backfillWeeklyKpis(
      store,
      [{ ...mapping, source: { ...source, revision: "changed" } }],
      now,
    ),
  ).toThrow("source_changed");
  expect(() =>
    backfillWeeklyKpis(
      store,
      [{ ...mapping, state: { ...mapping.state, revision: "conflict" } }],
      now,
    ),
  ).toThrow("existing_state_conflict");
});
it("rolls back a partially staged batch and refuses broken references without manufacturing data", () => {
  const store = createWeeklyStore(() => db);
  const original = authoredWeeklyKpis(now);
  const another = { ...source, weekStart: "2026-11-02", revision: "second" };
  db.prepare("insert into weekly_artifact values (?,?)").run(
    another.weekStart,
    JSON.stringify(another),
  );
  const bad = authoredWeeklyKpis(now);
  bad.assessments[0].setId = "absent";
  expect(() =>
    backfillWeeklyKpis(
      store,
      [
        { source, state: original },
        { source: another, state: bad },
      ],
      now,
    ),
  ).toThrow("invalid_backfill_reference");
  expect(db.prepare("select count(*) as n from weekly_kpi").get()).toEqual({
    n: 0,
  });
  expect(
    db.prepare("select count(*) as n from weekly_kpi_track").get(),
  ).toEqual({ n: 0 });
  expect(() => backfillWeeklyKpis(store, [], now)).toThrow(
    "invalid_backfill_manifest",
  );
});
it("keeps review-defined history distinct from agreed originals and leaves KPI-free weeks absent", () => {
  const state = authoredWeeklyKpis(now);
  state.originalId = null;
  state.latestId = null;
  state.sets = [state.sets[0]];
  state.sets[0].origin = "review-defined";
  state.reviewDefinedId = state.sets[0].id;
  backfillWeeklyKpis(
    createWeeklyStore(() => db),
    [{ source, state }],
    now,
  );
  const saved = createWeeklyStore(() => db).readKpis(source.weekStart)!;
  expect(saved.originalId).toBeNull();
  expect(saved.reviewDefinedId).toBe(state.sets[0].id);
  expect(createWeeklyStore(() => db).readKpis("2026-10-26")).toBeNull();
});
it("explicit migration refuses live ownership and creates a verified online backup of stopped committed WAL data", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kpi-backup-")));
  const path = join(root, "synthetic.sqlite");
  const initial = new Database(path);
  migrateDatabase(initial);
  initial.exec(
    "drop table weekly_kpi; drop table weekly_kpi_track; update app_metadata set value='25' where key='schema_version'",
  );
  initial.close();
  const migrate = () =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_PATH: path },
      timeout: 20000,
    });
  const live = new Database(path);
  const refused = migrate();
  expect(refused.status).not.toBe(0);
  live.close();
  // Dead writer intentionally leaves a committed WAL without an open owner.
  const writer = spawnSync(
    process.execPath,
    [
      "-e",
      `const D=require('better-sqlite3');const d=new D(process.argv[1]);d.pragma('journal_mode=WAL');d.exec("insert into app_metadata values('synthetic_wal_sentinel','committed',0)");process.exit(0)`,
      path,
    ],
    { encoding: "utf8" },
  );
  expect(writer.status).toBe(0);
  expect(readdirSync(root)).toContain("synthetic.sqlite-wal");
  const result = migrate();
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as {
    backupPath: string;
    schemaVersionAfter: number;
  };
  expect(output.schemaVersionAfter).toBe(26);
  expect(readdirSync(join(root, "backups"))).toHaveLength(1);
  const backup = new Database(output.backupPath, { readonly: true });
  expect(
    backup
      .prepare("select value from app_metadata where key='schema_version'")
      .get(),
  ).toEqual({ value: "25" });
  expect(
    backup
      .prepare(
        "select value from app_metadata where key='synthetic_wal_sentinel'",
      )
      .get(),
  ).toEqual({ value: "committed" });
  expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
  backup.close();
});
