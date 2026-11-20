import { getDatabase } from "./connection";
import { invalidateConversationHistory } from "./conversation-history";

/** @public Runtime capability passed by namespace through local-data/composition to
 * createLocalData/createLocalDataDeletion; Knip cannot follow that property use. */
export function clearChatAndProfile(): string[] {
  const db = getDatabase();
  db.transaction(() => {
    invalidateConversationHistory();
    db.prepare(
      `insert into conversation_title_attempt (conversation_id)
      select id from conversation where true
      on conflict(conversation_id) do update set pending = 0, claimed = 1`,
    ).run();
    db.prepare("delete from weekly_proposal").run();
    db.prepare("delete from message").run();
    db.prepare("delete from conversation").run();
    db.prepare("delete from trainer_profile").run();
  })();
  return ["messages", "conversations", "trainer_profile"];
}

// Additional Garmin evidence relations (schema 29) are Garmin data too.
const GARMIN_EXTRA_TABLES = [
  "daily_sleep_detail",
  "daily_sleep_score_component",
  "daily_hrv_detail",
  "vo2_max_reading",
  "daily_body_battery",
  "body_battery_event",
  "daily_stress",
  "activity_extra_metrics",
  "activity_split_summary",
  "activity_lap_hr_zone_time",
  "garmin_data_coverage",
] as const;

/** @public Runtime capability passed by namespace through local-data/composition to
 * createLocalData/createLocalDataDeletion; Knip cannot follow that property use. */
export function clearGarminData(): string[] {
  const db = getDatabase();
  db.transaction(() => {
    invalidateConversationHistory();
    db.prepare("delete from garmin_raw_payload").run();
    for (const table of GARMIN_EXTRA_TABLES)
      db.prepare(`delete from ${table}`).run();
    db.prepare("delete from activity_stream_point").run();
    db.prepare("delete from activity_lap").run();
    db.prepare("delete from activity_detail_availability").run();
    db.prepare("delete from garmin_athlete_baseline").run();
    db.prepare("delete from garmin_athlete_baseline_attempt").run();
    db.prepare("delete from garmin_body_metrics").run();
    db.prepare("delete from garmin_body_metric_attempt").run();
    db.prepare("delete from garmin_body_weight_history").run();
    db.prepare("delete from activity").run();
    db.prepare("delete from daily_health").run();
    db.prepare("delete from sync_checkpoint").run();
    db.prepare("delete from sync_run").run();
  })();
  return [
    "garmin_raw_payload",
    ...GARMIN_EXTRA_TABLES,
    "activity_stream_point",
    "activity_lap",
    "activity_detail_availability",
    "garmin_athlete_baseline",
    "garmin_athlete_baseline_attempt",
    "garmin_body_metrics",
    "garmin_body_metric_attempt",
    "garmin_body_weight_history",
    "activity",
    "daily_health",
    "sync_checkpoint",
    "sync_run",
  ];
}
