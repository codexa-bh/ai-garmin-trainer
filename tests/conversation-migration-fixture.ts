import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { SCHEMA_MIGRATIONS } from "@/lib/db/migrations";

/** Authored fixture reconstruction only, never a product downgrade or actual-data operation. */
function removeWholeSummaryFixtureSchema(db: Database.Database): void {
  if (
    !db
      .prepare("select 1 from sqlite_master where name='summary_preference'")
      .get()
  )
    return;
  db.transaction(() => {
    for (const name of [
      "summary_privacy",
      "summary_explicit_correction",
      "summary_rebuild_invalidation",
    ])
      db.exec(`drop trigger ${name}`);
    const row = db.prepare("select * from summary_state").get() as {
      revision: number;
      frontier: number;
      privacy_generation: number;
      payload: string;
    };
    const value = JSON.parse(row.payload) as { text: string };
    const generated = value.text
      ? [
          {
            id: "fixture_generated",
            text: value.text,
            category: "discussion",
            stance: "user-stated",
            sourceIds: ["fixture:1"],
            priority: 4,
            expiresAt: null,
            reviewAt: 1,
          },
        ]
      : [];
    const preferences = db
      .prepare("select * from summary_preference")
      .all() as { id: string; text: string }[];
    const manual = preferences.map((preference) => ({
      id: preference.id,
      text: preference.text,
      category: "constraint",
      stance: "user-stated",
      sourceIds: [`manual:${preference.id}:1`],
      priority: 5,
      expiresAt: null,
      reviewAt: 1,
    }));
    for (const item of manual)
      db.prepare(
        "insert into summary_manual(item_id,payload) values(?,?) on conflict(item_id) do update set payload=excluded.payload",
      ).run(item.id, JSON.stringify(item));
    const items = [...generated, ...manual];
    const payload = JSON.stringify({
      version: 1,
      items,
      text: items
        .map((item) => `[${item.stance}; ${item.category}] ${item.text}`)
        .join("\n"),
    });
    const checksum = createHash("sha256")
      .update(
        JSON.stringify([
          row.revision,
          row.frontier,
          row.privacy_generation,
          payload,
        ]),
      )
      .digest("hex");
    db.prepare(
      "update summary_state set format_version=1,payload=?,checksum=?",
    ).run(payload, checksum);
    db.prepare(
      "update conversation_summary_pin set format_version=1,payload='null',seal='',reason='authored-fixture'",
    ).run();
    db.exec("drop table summary_preference");
    for (const migration of SCHEMA_MIGRATIONS.filter((m) => m.version < 24))
      for (const statement of migration.statements)
        if (
          [
            "summary_privacy",
            "summary_explicit_correction",
            "summary_rebuild_invalidation",
            "summary_manual_privacy",
          ].some((name) => statement.startsWith(`create trigger ${name} `))
        )
          db.exec(statement);
  })();
}

/** Only for exclusively owned synthetic migration fixtures, never app recovery.
 * Relabelling today's full schema as an older version is not a valid fixture:
 * remove the exact H/S-owned additions before rehearsing their creation again.
 */
export function removeConversationHistoryFixtureSchema(
  db: Database.Database,
): void {
  removeGlobalSummaryFixtureSchema(db);
  const triggers = [
    "conversation_history_invalidation",
    "conversation_message_delete",
    "conversation_message_update",
    "conversation_profile_insert",
    "conversation_profile_update",
    "conversation_profile_delete",
    "conversation_memory_edit",
    "conversation_memory_disable",
    "conversation_memory_control_create",
    "conversation_activity_delete",
    "conversation_daily_health_delete",
    "conversation_semantic_memory_delete",
  ];
  db.transaction(() => {
    for (const name of triggers) db.exec(`drop trigger ${name}`);
    for (const name of [
      "conversation_completion",
      "conversation_turn",
      "conversation_segment",
      "conversation_compaction_spend",
      "conversation_history_control",
    ])
      db.exec(`drop table ${name}`);
  })();
}

/** Reconstruct schema21 on an exclusively owned authored fixture. */
export function removeRebuildFixtureSchema(db: Database.Database): void {
  removeWholeSummaryFixtureSchema(db);
  db.transaction(() => {
    db.exec("drop trigger summary_rebuild_invalidation");
    db.exec("drop table summary_rebuild");
    db.exec("drop table summary_original_boundary");
  })();
}

/** Remove schema21+ additions on an exclusive authored schema20 fixture. */
export function removeSizeAwareSummaryFixtureSchema(
  db: Database.Database,
): void {
  removeRebuildFixtureSchema(db);
  db.transaction(() => {
    for (const column of ["reserved_usd", "spend_day", "price_basis"])
      db.exec(`alter table summary_attempt drop column ${column}`);
  })();
}

/** Reconstruct exactly schema19 on an exclusive synthetic fixture. */
export function removeIntegratedSummaryFixtureSchema(
  db: Database.Database,
): void {
  removeSizeAwareSummaryFixtureSchema(db);
  db.transaction(() => {
    for (const name of [
      "summary_import_invalidation",
      "summary_manual_privacy",
      "summary_pin_privacy",
      "summary_pin_control",
    ])
      db.exec(`drop trigger ${name}`);
    for (const name of [
      "conversation_summary_pin",
      "summary_manual",
      "conversation_title_spend",
      "summary_import",
      "summary_import_disposition",
    ])
      db.exec(`drop table ${name}`);
    db.exec("alter table summary_attempt drop column import_id");
  })();
}

/** Reconstruct exactly the pre-S/schema18 shape on an exclusive synthetic fixture. */
export function removeGlobalSummaryFixtureSchema(db: Database.Database): void {
  removeIntegratedSummaryFixtureSchema(db);
  db.transaction(() => {
    for (const name of [
      "summary_completion",
      "summary_privacy",
      "summary_explicit_correction",
    ])
      db.exec(`drop trigger ${name}`);
    for (const name of [
      "summary_state",
      "summary_control",
      "summary_disposition",
      "summary_item_disposition",
      "summary_attempt",
      "summary_spend",
      "summary_suppression",
    ])
      db.exec(`drop table ${name}`);
  })();
}
