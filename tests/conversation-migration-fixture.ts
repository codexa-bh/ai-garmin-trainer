import type Database from "better-sqlite3";

/** Only for exclusively owned synthetic migration fixtures, never app recovery.
 * Relabelling today's full schema as an older version is not a valid fixture:
 * remove the exact H-owned additions before rehearsing their creation again.
 */
export function removeConversationHistoryFixtureSchema(
  db: Database.Database,
): void {
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
