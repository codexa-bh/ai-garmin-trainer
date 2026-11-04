import Database from "better-sqlite3";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { assertDesktopDatabase } from "@/lib/db/desktop-preflight";
import { currentSchemaVersion, migrateDatabase } from "@/lib/db/migrations";
import { removeIntegratedSummaryFixtureSchema } from "./conversation-migration-fixture";

function baseline(db: Database.Database) {
  migrateDatabase(db);
  removeIntegratedSummaryFixtureSchema(db);
  db.exec(`update app_metadata set value='19' where key='schema_version';
    insert into conversation values('synthetic-chat','Original title',1,1,1);
    insert into message values('synthetic-user','synthetic-chat','user','Original preference',null,1);
    insert into message values('synthetic-answer','synthetic-chat','assistant','Original answer','{"debugTrace":{"legacy":true}}',2);
    insert into trainer_profile(id,goals_json,updated_at) values('default','["Synthetic goal"]',1);
    insert into trainer_memory(id,category,value,status,source_type,provenance_text,created_at,updated_at)
      values('legacy','preference','Original legacy fact','confirmed','user','Synthetic original',1,1);
    insert into semantic_memory(id,user_id,kind,text,status,embedding_json,embedding_model,source,created_at,updated_at)
      values('vector','default','preference','Original vector fact','active','[0.1,0.2]','old-model','legacy',1,1);
    insert into activity(id,garmin_id,sport,started_at) values('activity','fictional-1','running',1);
    insert into daily_health(date,steps) values('2026-01-01',1234);
    insert into training_plan values('default','Original plan','Original plan text',1,1);
    insert into weekly_artifact values('2026-01-05','{"synthetic":"original commitment"}');
    insert into app_metadata values('memory_migration_v1','preserved',1);
    insert into app_metadata values('selected_conversation_id','synthetic-chat',1);
    insert into app_metadata values('synthetic_inactive_settings','{"MEMORY_ENABLED":true,"embedding_model":"original"}',1);
  `);
}

// Compare every original table/column, not just rows selected for the scenario.
function snapshot(db: Database.Database) {
  const tables = db
    .prepare(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
    )
    .all() as { name: string }[];
  return tables.map(({ name }) => {
    const columns = (
      db.prepare(`pragma table_info("${name}")`).all() as { name: string }[]
    ).map((row) => row.name);
    const query = `select ${columns.map((column) => `"${column}"`).join(",")} from "${name}"${name === "app_metadata" ? " where key<>'schema_version'" : ""}`;
    return { name, columns, query, rows: db.prepare(query).all() };
  });
}
function preserved(db: Database.Database, before: ReturnType<typeof snapshot>) {
  for (const table of before)
    expect(db.prepare(table.query).all(), table.name).toEqual(table.rows);
}

it("rehearses additive19→21 on a populated online copy and restores only a separate pre-write backup", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "summary-transition-")));
  const source = new Database(join(root, "original.sqlite"));
  let copy: Database.Database | undefined;
  let restored: Database.Database | undefined;
  try {
    source.pragma("journal_mode = WAL");
    baseline(source);
    const before = snapshot(source);
    const path = join(root, "copy.sqlite");
    const backup = join(root, "pre-upgrade.sqlite");
    await source.backup(path);
    await source.backup(backup);
    expect(() => assertDesktopDatabase(path)).toThrow(
      "schema is not supported",
    );
    copy = new Database(path);
    expect(currentSchemaVersion(copy)).toBe(19);
    migrateDatabase(copy);
    expect(currentSchemaVersion(copy)).toBe(21);
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    preserved(copy, before);
    expect(() => assertDesktopDatabase(path)).not.toThrow();
    for (const table of [
      "conversation_summary_pin",
      "summary_manual",
      "summary_import",
      "summary_import_disposition",
      "conversation_title_spend",
    ])
      expect(
        copy.prepare(`select count(*) as count from ${table}`).get(),
      ).toEqual({ count: 0 });
    const after = snapshot(copy);
    migrateDatabase(copy);
    preserved(copy, after);
    copy.exec(
      "insert into summary_manual values('synthetic-new','{\"version\":1}');",
    );
    const recovery = new Database(backup, { readonly: true });
    try {
      await recovery.backup(join(root, "restored.sqlite"));
    } finally {
      recovery.close();
    }
    restored = new Database(join(root, "restored.sqlite"));
    expect(currentSchemaVersion(restored)).toBe(19);
    preserved(restored, before);
    // Restore is a separate earlier state, not a downgrade/copy-back of new writes.
    expect(
      copy.prepare("select count(*) as count from summary_manual").get(),
    ).toEqual({ count: 1 });
    expect(currentSchemaVersion(source)).toBe(19);
    preserved(source, before);
  } finally {
    restored?.close();
    copy?.close();
    source.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("rolls back a failed additive transition instead of publishing a partial schema", () => {
  const db = new Database(":memory:");
  try {
    baseline(db);
    const before = snapshot(db);
    db.exec("create table summary_import(collision text)");
    expect(() => migrateDatabase(db)).toThrow();
    expect(currentSchemaVersion(db)).toBe(19);
    preserved(db, before);
    expect(
      db
        .prepare(
          "select name from sqlite_master where name='conversation_summary_pin'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      (
        db.prepare("pragma table_info(summary_attempt)").all() as {
          name: string;
        }[]
      ).some((column) => column.name === "import_id"),
    ).toBe(false);
    db.exec("update app_metadata set value='22' where key='schema_version'");
    expect(() => migrateDatabase(db)).toThrow();
    expect(currentSchemaVersion(db)).toBe(22);
  } finally {
    db.close();
  }
});
