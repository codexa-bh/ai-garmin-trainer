import { getDatabase } from "./connection";

export function clearChatAndProfile(): string[] {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("delete from weekly_proposal").run();
    db.prepare("delete from message").run();
    db.prepare("delete from conversation").run();
    db.prepare("delete from trainer_profile").run();
  })();
  return ["messages", "conversations", "trainer_profile"];
}

export function clearGarminData(): string[] {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("delete from garmin_raw_payload").run();
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
