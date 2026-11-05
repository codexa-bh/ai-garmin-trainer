import type Database from "better-sqlite3";

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
