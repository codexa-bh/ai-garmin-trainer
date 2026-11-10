import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

export const LATEST_SCHEMA_VERSION = 26;
const SCHEMA_VERSION_KEY = "schema_version";

const LEGACY_ATHLETE_BASELINE_TABLE_SQL = `create table if not exists garmin_athlete_baseline (id text primary key default 'default', fetched_at integer not null, source text not null, availability text not null, running_lactate_threshold_heart_rate_bpm integer, cycling_lactate_threshold_heart_rate_bpm integer, rowing_lactate_threshold_heart_rate_bpm integer, cycling_ftp_watts integer, cycling_ftp_measured_on text, cycling_ftp_source_stale integer, vo2_max_running real, vo2_max_cycling real, available_training_days_json text not null default '[]', preferred_long_training_days_json text not null default '[]')`;

const ATHLETE_BASELINE_TABLE_SQL = `create table if not exists garmin_athlete_baseline (id text primary key default 'default', fetched_at integer not null, source text not null, availability text not null, configured_max_heart_rate_bpm integer, heart_rate_zones_status text, heart_rate_zones_formula text, heart_rate_zones_json text not null default '[]', cycling_ftp_watts integer, cycling_ftp_measured_on text, cycling_ftp_source_stale integer, available_training_days_json text not null default '[]', preferred_long_training_days_json text not null default '[]')`;

const LEGACY_CONVERSATION_TABLE_SQL = `create table if not exists conversation (id text primary key, title text not null, created_at integer not null, updated_at integer not null)`;
const CONVERSATION_TABLE_SQL = `create table if not exists conversation (id text primary key, title text not null, manual_title integer not null default 0, created_at integer not null, updated_at integer not null)`;

const LEGACY_ACTIVITY_STREAM_POINT_TABLE_SQL = `create table if not exists activity_stream_point (garmin_id text not null, elapsed_sec integer not null, timestamp text, heart_rate integer, speed_mps real, altitude_meters real, grade_pct real, lat real, lon real, cadence real, power_watts real, temperature_c real, primary key (garmin_id, elapsed_sec))`;
const ACTIVITY_STREAM_POINT_TABLE_SQL = `create table if not exists activity_stream_point (garmin_id text not null, elapsed_sec integer not null, timestamp text, distance_meters real, heart_rate integer, speed_mps real, altitude_meters real, grade_pct real, lat real, lon real, cadence real, power_watts real, temperature_c real, primary key (garmin_id, elapsed_sec))`;

const BODY_METRICS_SCHEMA_SQL = [
  `create table if not exists garmin_body_metrics (id text primary key default 'default', fetched_at integer not null, source text not null, availability text not null, weight_kg real, height_cm real, history_availability text not null, history_range_start text, history_range_end text, history_count integer not null default 0)`,
  `create table if not exists garmin_body_metric_attempt (id text primary key default 'default', attempted_at integer not null, completed_at integer, status text not null, error_message text, preserved_previous integer not null default 0)`,
  `create table if not exists garmin_body_weight_history (date text primary key, weight_kg real not null, source text not null, fetched_at integer not null)`,
];

const BODY_METRICS_WEIGH_IN_COLUMNS_SQL = [
  `alter table garmin_body_metrics add column history_source text`,
  `alter table garmin_body_metrics add column current_weight_source text`,
  `alter table garmin_body_metrics add column weigh_in_availability text`,
];

const WEEKLY_SCHEMA_SQL = [
  `create table if not exists weekly_artifact (week_start text primary key, document_json text not null)`,
  `create table if not exists weekly_proposal (id text primary key, conversation_id text not null unique, proposal_json text not null)`,
];

const TRAINING_PLAN_TABLE_SQL = `create table if not exists training_plan (id text primary key default 'default', title text not null, content_markdown text not null, revised_at integer not null, updated_at integer not null)`;

const LEGACY_ACTIVITY_TABLE_SQL = `create table if not exists activity (id text primary key, garmin_id text not null unique, name text, sport text not null, started_at integer not null, duration_sec integer, distance_meters real, calories integer, avg_heart_rate integer, max_heart_rate integer, steps integer, elevation_gain_meters real, elevation_loss_meters real, training_effect real, source_updated_at integer)`;
const ACTIVITY_TABLE_SQL = `create table if not exists activity (id text primary key, garmin_id text not null unique, name text, sport text not null, started_at integer not null, duration_sec integer, distance_meters real, calories integer, avg_heart_rate integer, max_heart_rate integer, steps integer, elevation_gain_meters real, elevation_loss_meters real, training_effect real, anaerobic_training_effect real, training_effect_label text, training_load real, moderate_intensity_minutes real, vigorous_intensity_minutes real, total_intensity_minutes real, source_updated_at integer)`;
const LEGACY_DAILY_HEALTH_TABLE_SQL = `create table if not exists daily_health (date text primary key, sleep_minutes integer, resting_heart_rate integer, hrv_status text, hrv_ms real, stress_avg integer, steps integer, calories integer, body_battery_avg integer, availability text not null default 'partial')`;
const DAILY_HEALTH_TABLE_SQL = `create table if not exists daily_health (date text primary key, sleep_minutes integer, sleep_score integer, sleep_deep_minutes integer, sleep_light_minutes integer, sleep_rem_minutes integer, sleep_awake_minutes integer, sleep_nap_minutes integer, resting_heart_rate integer, hrv_status text, hrv_ms real, stress_avg integer, steps integer, calories integer, active_calories integer, resting_calories integer, total_calories integer, intensity_minutes integer, body_battery_avg integer, body_battery_morning integer, body_battery_evening integer, availability text not null default 'partial')`;

const DAILY_HEALTH_SLEEP_DETAIL_COLUMNS_SQL = [
  `alter table daily_health add column sleep_score integer`,
  `alter table daily_health add column sleep_deep_minutes integer`,
  `alter table daily_health add column sleep_light_minutes integer`,
  `alter table daily_health add column sleep_rem_minutes integer`,
  `alter table daily_health add column sleep_awake_minutes integer`,
  `alter table daily_health add column sleep_nap_minutes integer`,
];

const ACTIVITY_EFFORT_COLUMNS_SQL = [
  `alter table activity add column anaerobic_training_effect real`,
  `alter table activity add column training_effect_label text`,
  `alter table activity add column training_load real`,
  `alter table activity add column moderate_intensity_minutes real`,
  `alter table activity add column vigorous_intensity_minutes real`,
  `alter table activity add column total_intensity_minutes real`,
];

const DAILY_HEALTH_SOURCE_METRIC_COLUMNS_SQL = [
  `alter table daily_health add column active_calories integer`,
  `alter table daily_health add column resting_calories integer`,
  `alter table daily_health add column total_calories integer`,
  `alter table daily_health add column intensity_minutes integer`,
  `alter table daily_health add column body_battery_morning integer`,
  `alter table daily_health add column body_battery_evening integer`,
];

const BASE_SCHEMA_SQL = [
  `create table if not exists user (id text primary key, name text, email text not null unique, email_verified integer default 0, image text, created_at integer not null, updated_at integer not null)`,
  `create table if not exists session (id text primary key, expires_at integer not null, token text not null unique, created_at integer not null, updated_at integer not null, ip_address text, user_agent text, user_id text not null)`,
  `create table if not exists account (id text primary key, account_id text not null, provider_id text not null, user_id text not null, access_token text, refresh_token text, id_token text, access_token_expires_at integer, refresh_token_expires_at integer, scope text, password text, created_at integer not null, updated_at integer not null)`,
  `create table if not exists verification (id text primary key, identifier text not null, value text not null, expires_at integer not null, created_at integer, updated_at integer)`,
  ACTIVITY_TABLE_SQL,
  DAILY_HEALTH_TABLE_SQL,
  `create table if not exists activity_detail_availability (garmin_id text primary key, fetched_at integer, source text not null, status text not null, has_session integer not null default 0, has_laps integer not null default 0, has_streams integer not null default 0, has_gps integer not null default 0, has_elevation integer not null default 0, has_heart_rate integer not null default 0, has_grade integer not null default 0, has_power integer not null default 0, has_recovery integer not null default 0, record_count integer not null default 0, lap_count integer not null default 0, unavailable_reason text, session_json text, derived_json text)`,
  `create table if not exists activity_detail_attempt (garmin_id text primary key, attempted_at integer not null, completed_at integer, force integer not null default 0, status text not null, detail_status text, retryable integer not null default 0, error_class text, error_message text, preserved_previous integer not null default 0)`,
  `create table if not exists activity_lap (garmin_id text not null, lap_number integer not null, start_time text, duration_sec real, distance_meters real, avg_speed_mps real, avg_heart_rate real, max_heart_rate real, elevation_gain_meters real, elevation_loss_meters real, avg_power_watts real, normalized_power_watts real, primary key (garmin_id, lap_number))`,
  ACTIVITY_STREAM_POINT_TABLE_SQL,
  `create table if not exists activity_hr_zone_time (garmin_id text not null, zone integer not null, fetched_at integer not null, source text not null, status text not null, seconds integer not null, source_lower_bpm integer, source_total_seconds integer not null, primary key (garmin_id, zone))`,
  LEGACY_ATHLETE_BASELINE_TABLE_SQL,
  `create table if not exists garmin_athlete_baseline_attempt (id text primary key default 'default', attempted_at integer not null, completed_at integer, status text not null, error_message text, preserved_previous integer not null default 0)`,
  ...BODY_METRICS_SCHEMA_SQL,
  `create table if not exists garmin_raw_payload (id text primary key, source_tool text not null, subject_type text not null, subject_id text not null, fetched_at integer not null, content_type text not null, payload_json text, payload_text text, sha256 text not null, redaction_version integer not null, redacted_field_count integer not null default 0)`,
  `create index if not exists garmin_raw_payload_subject_idx on garmin_raw_payload(subject_type, subject_id)`,
  `create table if not exists sync_run (id text primary key, status text not null, started_at integer not null, finished_at integer, coverage_start text, coverage_end text, last_error text)`,
  `create table if not exists sync_checkpoint (key text primary key, value text not null, updated_at integer not null)`,
  CONVERSATION_TABLE_SQL,
  `create table if not exists message (id text primary key, conversation_id text not null, role text not null, content text not null, grounding_json text, created_at integer not null)`,
  `create table if not exists trainer_profile (id text primary key default 'default', goals_json text not null default '[]', sports_json text not null default '[]', preferences_json text not null default '{}', constraints_json text not null default '[]', updated_at integer not null)`,
  `create table if not exists trainer_memory (id text primary key, category text not null, value text not null, status text not null, source_type text not null, source_ref text, provenance_text text not null, valid_from integer, expires_at integer, reconfirm_after integer, supersedes_id text, superseded_by_id text, created_at integer not null, updated_at integer not null)`,
  `create table if not exists semantic_memory (id text primary key, user_id text not null, kind text not null, text text not null, status text not null, embedding_json text not null, embedding_model text not null, source_conversation_id text, source_message_ids_json text not null default '[]', source text not null, created_at integer not null, updated_at integer not null, expires_at integer)`,
  `create index if not exists semantic_memory_user_status_idx on semantic_memory(user_id, status, updated_at)`,
  `create index if not exists semantic_memory_conversation_idx on semantic_memory(source_conversation_id)`,
  TRAINING_PLAN_TABLE_SQL,
  ...WEEKLY_SCHEMA_SQL,
  `create table if not exists app_metadata (key text primary key, value text not null, updated_at integer not null)`,
];

type SchemaMigration = {
  version: number;
  name: string;
  statements: string[];
};

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: "source_beta_foundation",
    statements: BASE_SCHEMA_SQL.map((statement) => {
      if (statement === CONVERSATION_TABLE_SQL)
        return LEGACY_CONVERSATION_TABLE_SQL;
      if (statement === ACTIVITY_STREAM_POINT_TABLE_SQL)
        return LEGACY_ACTIVITY_STREAM_POINT_TABLE_SQL;
      if (statement === ACTIVITY_TABLE_SQL) return LEGACY_ACTIVITY_TABLE_SQL;
      if (statement === DAILY_HEALTH_TABLE_SQL)
        return LEGACY_DAILY_HEALTH_TABLE_SQL;
      return statement;
    }),
  },
  {
    version: 2,
    name: "garmin_athlete_baseline_latest_snapshot",
    statements: [
      LEGACY_ATHLETE_BASELINE_TABLE_SQL,
      `create table if not exists garmin_athlete_baseline_attempt (id text primary key default 'default', attempted_at integer not null, completed_at integer, status text not null, error_message text, preserved_previous integer not null default 0)`,
    ],
  },
  {
    version: 3,
    name: "garmin_raw_payload_retention",
    statements: [
      `create table if not exists garmin_raw_payload (id text primary key, source_tool text not null, subject_type text not null, subject_id text not null, fetched_at integer not null, content_type text not null, payload_json text, payload_text text, sha256 text not null, redaction_version integer not null, redacted_field_count integer not null default 0)`,
      `create index if not exists garmin_raw_payload_subject_idx on garmin_raw_payload(subject_type, subject_id)`,
    ],
  },
  {
    version: 4,
    name: "garmin_athlete_baseline_hr_zones",
    statements: [
      `alter table garmin_athlete_baseline add column configured_max_heart_rate_bpm integer`,
      `alter table garmin_athlete_baseline add column heart_rate_zones_status text`,
      `alter table garmin_athlete_baseline add column heart_rate_zones_formula text`,
      `alter table garmin_athlete_baseline add column heart_rate_zones_json text not null default '[]'`,
    ],
  },
  {
    version: 5,
    name: "embedded_semantic_memory",
    statements: [
      `create table if not exists semantic_memory (id text primary key, user_id text not null, kind text not null, text text not null, status text not null, embedding_json text not null, embedding_model text not null, source_conversation_id text, source_message_ids_json text not null default '[]', source text not null, created_at integer not null, updated_at integer not null, expires_at integer)`,
      `create index if not exists semantic_memory_user_status_idx on semantic_memory(user_id, status, updated_at)`,
      `create index if not exists semantic_memory_conversation_idx on semantic_memory(source_conversation_id)`,
    ],
  },

  {
    version: 6,
    name: "prune_athlete_baseline_fields",
    statements: [
      ATHLETE_BASELINE_TABLE_SQL.replace(
        "create table if not exists garmin_athlete_baseline",
        "create table garmin_athlete_baseline_next",
      ),
      `insert into garmin_athlete_baseline_next (id, fetched_at, source, availability, configured_max_heart_rate_bpm, heart_rate_zones_status, heart_rate_zones_formula, heart_rate_zones_json, cycling_ftp_watts, cycling_ftp_measured_on, cycling_ftp_source_stale, available_training_days_json, preferred_long_training_days_json)
       select id, fetched_at, source, availability, configured_max_heart_rate_bpm, heart_rate_zones_status, heart_rate_zones_formula, heart_rate_zones_json, cycling_ftp_watts, cycling_ftp_measured_on, cycling_ftp_source_stale, available_training_days_json, preferred_long_training_days_json from garmin_athlete_baseline`,
      `drop table garmin_athlete_baseline`,
      `alter table garmin_athlete_baseline_next rename to garmin_athlete_baseline`,
    ],
  },
  {
    version: 7,
    name: "conversation_manual_title",
    statements: [
      `alter table conversation add column manual_title integer not null default 0`,
    ],
  },
  {
    version: 8,
    name: "activity_hr_zone_time",
    statements: [
      `create table if not exists activity_hr_zone_time (garmin_id text not null, zone integer not null, fetched_at integer not null, source text not null, status text not null, seconds integer not null, source_lower_bpm integer, source_total_seconds integer not null, primary key (garmin_id, zone))`,
    ],
  },
  {
    version: 9,
    name: "activity_stream_point_distance",
    statements: [
      LEGACY_ACTIVITY_STREAM_POINT_TABLE_SQL,
      `alter table activity_stream_point add column distance_meters real`,
    ],
  },
  {
    version: 10,
    name: "garmin_body_metrics",
    statements: BODY_METRICS_SCHEMA_SQL,
  },
  {
    version: 11,
    name: "training_plan_singleton",
    statements: [TRAINING_PLAN_TABLE_SQL],
  },
  {
    version: 12,
    name: "activity_effort_fields",
    statements: [LEGACY_ACTIVITY_TABLE_SQL, ...ACTIVITY_EFFORT_COLUMNS_SQL],
  },
  {
    version: 13,
    name: "daily_health_source_metrics",
    statements: [
      LEGACY_DAILY_HEALTH_TABLE_SQL,
      ...DAILY_HEALTH_SOURCE_METRIC_COLUMNS_SQL,
    ],
  },
  {
    version: 14,
    name: "garmin_weigh_in_sources",
    statements: [
      ...BODY_METRICS_SCHEMA_SQL,
      ...BODY_METRICS_WEIGH_IN_COLUMNS_SQL,
    ],
  },
  {
    version: 15,
    name: "daily_health_sleep_details",
    statements: [
      LEGACY_DAILY_HEALTH_TABLE_SQL,
      ...DAILY_HEALTH_SLEEP_DETAIL_COLUMNS_SQL,
    ],
  },
  {
    version: 16,
    name: "weekly_plans_and_reviews",
    statements: WEEKLY_SCHEMA_SQL,
  },
  {
    version: 17,
    name: "conversation_title_attempt",
    statements: [
      `create table if not exists conversation_title_attempt (conversation_id text primary key, message_id text, claimed integer not null default 1, pending integer not null default 0)`,
    ],
  },
  {
    version: 18,
    name: "conversation_completion_and_segments",
    statements: [
      `create table conversation_history_control (id integer primary key check(id=1), privacy_generation integer not null default 0)`,
      `insert into conversation_history_control(id) values (1)`,
      `create table conversation_turn (admission_seq integer primary key autoincrement, turn_id text not null unique, conversation_id text not null, user_id text not null unique, assistant_id text unique, source_version integer not null default 1, summary_eligible integer not null default 0, status text not null check(status in ('admitted','completed','aborted')), boot_id text not null, privacy_generation integer not null)`,
      `create index conversation_turn_order on conversation_turn(conversation_id,admission_seq)`,
      `create table conversation_completion (event_seq integer primary key autoincrement, turn_id text not null unique)`,
      `create table conversation_segment (conversation_id text primary key, format_version integer not null default 1, revision integer not null default 0, privacy_generation integer not null, covered_through integer not null default 0, compact text not null default '', compact_sha256 text not null default '', compact_characters integer not null default 0, policy_identity text not null)`,
      `create table conversation_compaction_spend (day text primary key, attempts integer not null, reserved_usd real not null)`,
      `create trigger conversation_history_invalidation after update of privacy_generation on conversation_history_control begin
        update conversation_segment set compact='', compact_sha256='', compact_characters=0, covered_through=0, revision=revision+1, privacy_generation=new.privacy_generation;
        update conversation_turn set status='aborted' where status='admitted';
       end`,
      ...["delete", "update"].map(
        (action) =>
          `create trigger conversation_message_${action} after ${action}${action === "update" ? " of id,content,role,conversation_id" : ""} on message begin
          update conversation_turn set source_version=source_version+1,status='aborted' where user_id=old.id or assistant_id=old.id;
          update conversation_history_control set privacy_generation=privacy_generation+1 where id=1;
         end`,
      ),
      ...["insert", "update", "delete"].map(
        (action) =>
          `create trigger conversation_profile_${action} after ${action} on trainer_profile begin update conversation_history_control set privacy_generation=privacy_generation+1 where id=1; end`,
      ),
      `create trigger conversation_memory_edit after update of text,status on semantic_memory when old.text<>new.text or old.status<>new.status begin update conversation_history_control set privacy_generation=privacy_generation+1 where id=1; end`,
      `create trigger conversation_memory_disable after update of value on app_metadata when new.key='memory.user_disabled' and old.value<>new.value begin update conversation_history_control set privacy_generation=privacy_generation+1 where id=1; end`,
      `create trigger conversation_memory_control_create after insert on app_metadata when new.key='memory.user_disabled' begin update conversation_history_control set privacy_generation=privacy_generation+1 where id=1; end`,
      ...["activity", "daily_health", "semantic_memory"].map(
        (table) =>
          `create trigger conversation_${table}_delete after delete on ${table} begin update conversation_history_control set privacy_generation=privacy_generation+1 where id=1; end`,
      ),
    ],
  },
  {
    version: 19,
    name: "incremental_global_summary",
    statements: [
      `create table summary_state(id integer primary key check(id=1),format_version integer not null default 1,revision integer not null default 0,frontier integer not null default 0,payload text not null default '{"version":1,"items":[],"text":""}',checksum text not null default '',privacy_generation integer not null,published_at integer)`,
      `insert into summary_state(id,privacy_generation) select 1,privacy_generation from conversation_history_control where id=1`,
      `create table summary_control(id integer primary key check(id=1),enabled integer not null default 0,configured_enabled integer not null default 0,model text not null default '',cap integer not null default 6000,generation integer not null default 0,manual_revision integer not null default 0,cutoff integer not null default 0,job_id text,lease_until integer not null default 0,pending_since integer,last_started integer not null default 0,retry_at integer not null default 0,failures integer not null default 0,reason text,day text not null default '')`,
      `insert into summary_control(id,cutoff) select 1,coalesce(max(admission_seq),0) from conversation_turn`,
      `create table summary_disposition(event_seq integer primary key,source_id text not null,reason text not null,revision integer not null)`,
      `create table summary_item_disposition(item_id text not null,revision integer not null,reason text not null,primary key(item_id,revision))`,
      `create table summary_attempt(job_id text primary key,started_at integer not null,finished_at integer,outcome text not null,reserved integer not null,policy_identity text,usage_json text,source_ids_json text not null,upper_event integer not null,prior_revision integer not null,privacy_generation integer not null,control_generation integer not null)`,
      `create table summary_spend(day text primary key,attempts integer not null,reserved_usd real not null)`,
      `create table summary_suppression(source_id text primary key)`,
      `create trigger summary_completion after insert on conversation_completion begin
        update conversation_turn set summary_eligible=(select enabled from summary_control where id=1) where turn_id=new.turn_id;
       end`,
      `create trigger summary_privacy after update of privacy_generation on conversation_history_control begin
        update summary_state set payload='{"version":1,"items":[],"text":""}',checksum='',published_at=null,revision=revision+1,privacy_generation=new.privacy_generation where id=1;
        update summary_control set generation=generation+1,job_id=null,lease_until=0,reason='summary_invalidated' where id=1;
        update summary_attempt set outcome='invalidated' where outcome='admitted';
       end`,
      // A narrow explicit correction signal, not an arbitrary-language classifier.
      // H has no global consumer; its own accepted answer must not invalidate itself.
      `create trigger summary_explicit_correction after insert on conversation_completion when exists(select 1 from conversation_turn t join message m on m.id=t.user_id where t.turn_id=new.turn_id and (lower(m.content) like 'actually %' or lower(m.content) like 'correction:%')) begin
        update summary_state set payload='{"version":1,"items":[],"text":""}',checksum='',published_at=null,revision=revision+1 where id=1;
        update summary_control set generation=generation+1,job_id=null,lease_until=0,reason='summary_correction_pending' where id=1;
        update summary_attempt set outcome='superseded' where outcome='admitted';
       end`,
    ],
  },
  {
    version: 20,
    name: "integrated_summary_pins",
    statements: [
      `create table conversation_summary_pin(conversation_id text primary key references conversation(id) on delete cascade,format_version integer not null default 1,payload text not null,seal text not null,reason text)`,
      `create table summary_manual(item_id text primary key,payload text not null)`,
      `create table conversation_title_spend(id text primary key,day text not null,reserved_usd real not null,usage_json text)`,
      `create index conversation_title_spend_day on conversation_title_spend(day)`,
      `alter table summary_attempt add column import_id text`,
      `create table summary_import(id text primary key,format_version integer not null default 1,selection_json text not null,checksum text not null default '',position integer not null default 0,state text not null,privacy_generation integer not null,control_generation integer not null,manual_revision integer not null,cutoff integer not null)`,
      `create table summary_import_disposition(source_id text primary key,manifest_id text not null,reason text not null)`,
      `create trigger summary_import_invalidation after update of generation,manual_revision on summary_control when old.generation<>new.generation or old.manual_revision<>new.manual_revision begin update summary_import set state='review-required' where state in ('active','paused'); end`,
      `create trigger summary_manual_privacy after update of privacy_generation on conversation_history_control begin delete from summary_manual; end`,
      `create trigger summary_pin_privacy after update of privacy_generation on conversation_history_control begin
        update conversation_summary_pin set payload='null',seal='',reason='invalidated';
       end`,
      `create trigger summary_pin_control after update of generation,manual_revision on summary_control when old.generation<>new.generation or old.manual_revision<>new.manual_revision begin
        update conversation_summary_pin set payload='null',seal='',reason='invalidated';
        update conversation_segment set compact='',compact_sha256='',compact_characters=0,covered_through=0,revision=revision+1;
        update message set grounding_json=json_set(json_remove(grounding_json,'$.debugTrace','$.conversationContext.summaryRevision'),'$.conversationContext.summaryRevoked',json('true'))
          where case when json_valid(grounding_json) then json_type(grounding_json,'$.conversationContext.summaryRevision')='integer' else 0 end;
       end`,
    ],
  },
  {
    version: 21,
    name: "size_aware_summary_accounting",
    statements: [
      `alter table summary_attempt add column reserved_usd real`,
      `alter table summary_attempt add column spend_day text`,
      `alter table summary_attempt add column price_basis text`,
      // Preserve old liabilities exactly; no usage-derived refund or replay.
      `update summary_attempt set reserved_usd=0.01,price_basis='legacy-flat-reservation' where reserved=1`,
    ],
  },
  {
    version: 22,
    name: "staged_history_rebuild",
    statements: [
      // Prior Clear operations did not record original-message authority. Do not
      // retrospectively grant export to unlinked originals by timestamp.
      `create table summary_original_boundary(id integer primary key check(id=1),floor integer not null)`,
      `insert into summary_original_boundary select 1,coalesce(max(rowid),0) from message`,
      `create table summary_rebuild(id text primary key,format_version integer not null default 1,boot text not null,snapshot text not null,selection_json text not null,authority_json text not null,candidate_json text not null,candidate_checksum text not null,dispositions_json text not null default '[]',position integer not null default 0,state text not null,reason text,created_at integer not null,deadline integer not null,checksum text not null)`,
      `create unique index summary_rebuild_live on summary_rebuild(state) where state='active'`,
      `create trigger summary_rebuild_invalidation after update of generation,manual_revision on summary_control when old.generation<>new.generation or old.manual_revision<>new.manual_revision begin update summary_rebuild set state=case when state='active' then 'invalidated' else state end,reason=case when state='active' then 'summary_authority_changed' else reason end,candidate_json='{"version":1,"items":[],"text":""}',candidate_checksum=''; end`,
    ],
  },
  {
    version: 23,
    name: "reviewed_legacy_recovery",
    statements: [
      // Historical floor mixes migration and Clear: do not invent a receipt.
      // Only future recorded Clear operations advance this independently.
      `alter table summary_original_boundary add column clear_floor integer not null default 0`,
    ],
  },
  {
    version: 24,
    name: "whole_generated_summary",
    statements: [
      `create table summary_preference(id text primary key,text text not null)`,
      `drop trigger summary_manual_privacy`,
      `drop trigger summary_privacy`,
      `drop trigger summary_explicit_correction`,
      `drop trigger summary_rebuild_invalidation`,
      `create trigger summary_privacy after update of privacy_generation on conversation_history_control begin
        update summary_state set payload='{"version":2,"text":""}',checksum='',published_at=null,revision=revision+1,privacy_generation=new.privacy_generation where id=1;
        update summary_control set generation=generation+1,job_id=null,lease_until=0,reason='summary_invalidated' where id=1;
        update summary_attempt set outcome='invalidated' where outcome='admitted';
       end`,
      `create trigger summary_explicit_correction after insert on conversation_completion when exists(select 1 from conversation_turn t join message m on m.id=t.user_id where t.turn_id=new.turn_id and (lower(m.content) like 'actually %' or lower(m.content) like 'correction:%')) begin
        update summary_state set payload='{"version":2,"text":""}',checksum='',published_at=null,revision=revision+1 where id=1;
        update summary_control set generation=generation+1,job_id=null,lease_until=0,reason='summary_correction_pending' where id=1;
        update summary_attempt set outcome='superseded' where outcome='admitted';
       end`,
      `create trigger summary_rebuild_invalidation after update of generation,manual_revision on summary_control when old.generation<>new.generation or old.manual_revision<>new.manual_revision begin update summary_rebuild set state=case when state='active' then 'invalidated' else state end,reason=case when state='active' then 'summary_authority_changed' else reason end,candidate_json='{"version":2,"text":""}',candidate_checksum=''; end`,
    ],
  },
  {
    version: 25,
    name: "memory_freshness_without_erasure",
    statements: [
      // Ordinary corrections are new learning, not privacy commands. Profile
      // freshness is compared by current owners, not global derivative erasure.
      `drop trigger summary_explicit_correction`,
      `drop trigger conversation_profile_insert`,
      `drop trigger conversation_profile_update`,
      `drop trigger conversation_profile_delete`,
    ],
  },
  {
    version: 26,
    name: "structured_weekly_kpis",
    statements: [
      `create table weekly_kpi (week_start text primary key, state_json text not null check(json_valid(state_json)))`,
      `create table weekly_kpi_track (concept_id text not null, track_key text not null, signature text not null, primary key(concept_id,track_key))`,
    ],
  },
];

// Compatibility admission only: never used by current generation or consumption.
function legacySummary(db: Database.Database) {
  const row = db.prepare("select * from summary_state where id=1").get() as {
    format_version: number;
    revision: number;
    frontier: number;
    privacy_generation: number;
    payload: string;
    checksum: string;
  };
  const value = JSON.parse(row.payload) as {
    version: number;
    text: string;
    items: {
      id: string;
      text: string;
      stance: string;
      category: string;
      sourceIds: string[];
      expiresAt: number | null;
      priority: number;
      reviewAt: number;
    }[];
  };
  return { row, value };
}
function validateLegacySummary(db: Database.Database): void {
  try {
    validateLegacySummaryState(db);
    validateLegacyDerivatives(db);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "summary_legacy_authored_decision_required"
    )
      throw error;
    throw new Error("summary_legacy_corrupt_or_unsupported");
  }
}
function validateLegacySummaryState(db: Database.Database): void {
  const { row, value } = legacySummary(db);
  const fail = () => {
    throw new Error("summary_legacy_corrupt_or_unsupported");
  };
  const checkpoint = (
    db
      .prepare("select coalesce(max(event_seq),0) n from summary_disposition")
      .get() as { n: number }
  ).n;
  const privacy = (
    db
      .prepare(
        "select privacy_generation n from conversation_history_control where id=1",
      )
      .get() as { n: number }
  ).n;
  if (
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    !Number.isSafeInteger(row.frontier) ||
    row.frontier !== checkpoint ||
    row.privacy_generation !== privacy ||
    row.format_version !== 1 ||
    value.version !== 1 ||
    typeof value.text !== "string" ||
    !Array.isArray(value.items) ||
    value.items.length > 256 ||
    Object.keys(value).sort().join() !== "items,text,version"
  )
    fail();
  const ids = new Set<string>();
  for (const item of value.items) {
    if (
      !item ||
      Object.keys(item).sort().join() !==
        "category,expiresAt,id,priority,reviewAt,sourceIds,stance,text" ||
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      /[\uD800-\uDFFF]/u.test(item.text) ||
      [...item.text].length > 1200 ||
      ![
        "decision",
        "constraint",
        "goal",
        "rejected",
        "question",
        "temporary",
        "discussion",
      ].includes(item.category) ||
      !["user-stated", "endorsed", "discussed-not-endorsed"].includes(
        item.stance,
      ) ||
      !Array.isArray(item.sourceIds) ||
      !item.sourceIds.length ||
      item.sourceIds.length > 32 ||
      new Set(item.sourceIds).size !== item.sourceIds.length ||
      item.sourceIds.some((s) => typeof s !== "string" || s.length > 160) ||
      !Number.isInteger(item.priority) ||
      item.priority < 0 ||
      item.priority > 5 ||
      !Number.isSafeInteger(item.reviewAt) ||
      (item.expiresAt !== null && !Number.isSafeInteger(item.expiresAt))
    )
      fail();
    ids.add(item.id);
  }
  const cap = (
    db.prepare("select cap from summary_control where id=1").get() as {
      cap: number;
    }
  ).cap;
  if (
    value.text !==
      value.items
        .map((i) => `[${i.stance}; ${i.category}] ${i.text}`)
        .join("\n") ||
    [...value.text].length > cap
  )
    fail();
  const expected = createHash("sha256")
    .update(
      JSON.stringify([
        row.revision,
        row.frontier,
        row.privacy_generation,
        row.payload,
      ]),
    )
    .digest("hex");
  if (
    row.checksum !== expected &&
    !(
      row.checksum === "" &&
      row.payload === '{"version":1,"items":[],"text":""}'
    )
  )
    fail();
  for (const manual of db
    .prepare("select item_id,payload from summary_manual")
    .all() as { item_id: string; payload: string }[]) {
    const item = JSON.parse(manual.payload) as {
      id: string;
      text: string;
      sourceIds: string[];
      expiresAt: unknown;
      stance: unknown;
      category: unknown;
      priority: unknown;
      reviewAt: unknown;
    };
    if (
      !item ||
      item.id !== manual.item_id ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      /[\uD800-\uDFFF]/u.test(item.text) ||
      !Array.isArray(item.sourceIds) ||
      !item.sourceIds.length ||
      item.sourceIds.some((s) => typeof s !== "string")
    )
      fail();
    if (
      item.sourceIds.some((s) => !s.startsWith("manual:")) ||
      item.expiresAt !== null
    )
      throw new Error("summary_legacy_authored_decision_required");
    // A manual-looking source prefix alone does not prove a valid authored row.
    // Preserve unsupported/corrupt metadata transactionally, never launder it
    // into an asserted preference by ignoring the rest of the old contract.
    if (
      Object.keys(item).sort().join() !==
        "category,expiresAt,id,priority,reviewAt,sourceIds,stance,text" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
      item.stance !== "user-stated" ||
      item.priority !== 5 ||
      ![
        "decision",
        "constraint",
        "goal",
        "rejected",
        "question",
        "temporary",
        "discussion",
      ].includes(String(item.category)) ||
      !Number.isSafeInteger(item.reviewAt) ||
      item.sourceIds.length > 32 ||
      new Set(item.sourceIds).size !== item.sourceIds.length ||
      item.sourceIds.some((source) => source.length > 160)
    )
      fail();
  }
}
function validateLegacyDerivatives(db: Database.Database): void {
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const refuse = () => {
    throw new Error("summary_legacy_corrupt_or_unsupported");
  };
  for (const row of db.prepare("select * from summary_rebuild").all() as Record<
    string,
    unknown
  >[]) {
    const seal = digest([
      row.format_version,
      row.id,
      row.boot,
      row.snapshot,
      row.selection_json,
      row.authority_json,
      row.dispositions_json,
      row.position,
      row.created_at,
      row.deadline,
    ]);
    if (
      ![1, 2].includes(Number(row.format_version)) ||
      ![
        "active",
        "complete",
        "cancelled",
        "interrupted",
        "invalidated",
      ].includes(String(row.state)) ||
      row.checksum !== seal ||
      String(row.selection_json).length > 5_000_000 ||
      String(row.candidate_json).length > 1048576
    )
      refuse();
    const selected = JSON.parse(String(row.selection_json)) as {
      sourceId: string;
    }[];
    const dispositions = JSON.parse(String(row.dispositions_json)) as {
      sourceId: string;
    }[];
    const candidate = JSON.parse(String(row.candidate_json)) as {
      version: number;
      text: string;
      items: unknown[];
    };
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.length > 10000 ||
      !Number.isSafeInteger(row.position) ||
      Number(row.position) < 0 ||
      Number(row.position) > selected.length ||
      !Array.isArray(dispositions) ||
      dispositions.length !== row.position ||
      dispositions.some((d, i) => d.sourceId !== selected[i]?.sourceId) ||
      candidate.version !== 1 ||
      typeof candidate.text !== "string" ||
      !Array.isArray(candidate.items) ||
      Object.keys(candidate).sort().join() !== "items,text,version"
    )
      refuse();
    if (
      row.candidate_checksum !== digest(row.candidate_json) &&
      !(
        row.state !== "active" &&
        row.candidate_checksum === "" &&
        row.candidate_json === '{"version":1,"items":[],"text":""}'
      )
    )
      refuse();
    const authority = JSON.parse(String(row.authority_json)) as {
      cap: number;
      selection?: unknown;
    };
    if (
      !Number.isSafeInteger(authority.cap) ||
      authority.cap < 1000 ||
      authority.cap > 20000 ||
      [...candidate.text].length > authority.cap ||
      /[\uD800-\uDFFF]/u.test(candidate.text)
    )
      refuse();
  }
  for (const row of db
    .prepare("select * from conversation_summary_pin")
    .all() as { format_version: number; payload: string; seal: string }[]) {
    if (row.format_version !== 1 || row.payload.length > 1048576) refuse();
    if (row.payload === "null") continue;
    if (createHash("sha256").update(row.payload).digest("hex") !== row.seal)
      refuse();
    const pin = JSON.parse(row.payload) as {
      version: number;
      value: { version: number; text: string; items: unknown[] };
    };
    if (
      pin.version !== 1 ||
      pin.value?.version !== 1 ||
      typeof pin.value.text !== "string" ||
      !Array.isArray(pin.value.items) ||
      Object.keys(pin).sort().join() !== "omitted,stamp,tokens,value,version"
    )
      refuse();
  }
  for (const row of db.prepare("select * from summary_import").all() as Record<
    string,
    unknown
  >[]) {
    const ids = JSON.parse(String(row.selection_json)) as string[];
    const done = db
      .prepare(
        "select source_id from summary_import_disposition where manifest_id=? order by rowid",
      )
      .all(row.id) as { source_id: string }[];
    if (
      row.format_version !== 1 ||
      row.checksum !==
        digest([
          row.format_version,
          row.id,
          row.selection_json,
          row.privacy_generation,
          row.control_generation,
          row.manual_revision,
          row.cutoff,
        ]) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || id.length > 160) ||
      !Number.isSafeInteger(row.position) ||
      row.position !== done.length ||
      done.some((entry, index) => entry.source_id !== ids[index])
    )
      refuse();
  }
}
function transitionWholeSummary(db: Database.Database): void {
  const { row, value } = legacySummary(db);
  const manual = db
    .prepare("select item_id,payload from summary_manual")
    .all() as { item_id: string; payload: string }[];
  for (const entry of manual)
    db.prepare("insert into summary_preference(id,text) values(?,?)").run(
      entry.item_id,
      (JSON.parse(entry.payload) as { text: string }).text,
    );
  const authored = new Set(manual.map((m) => m.item_id));
  const text = value.items
    .filter((item) => !authored.has(item.id))
    .map((item) => `[${item.stance}; ${item.category}] ${item.text}`)
    .join("\n");
  const payload = JSON.stringify({ version: 2, text });
  const revision = row.revision + 1;
  const checksum = createHash("sha256")
    .update(
      JSON.stringify([revision, row.frontier, row.privacy_generation, payload]),
    )
    .digest("hex");
  db.prepare(
    "update summary_state set format_version=2,revision=?,payload=?,checksum=? where id=1",
  ).run(revision, payload, checksum);
  db.prepare(
    "update summary_attempt set outcome='interrupted' where outcome='admitted'",
  ).run();
  db.prepare(
    "update summary_control set generation=generation+1,manual_revision=manual_revision+1,job_id=null,lease_until=0 where id=1",
  ).run();
  // New invalidation trigger scrubs old staged derivatives, not original sources/receipts/costs.
  db.prepare(
    "update conversation_summary_pin set format_version=2,payload='null',seal='',reason='format-transition'",
  ).run();
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

export function databaseHasUserData(db: Database.Database): boolean {
  const tables = [
    "activity",
    "daily_health",
    "message",
    "conversation",
    "trainer_profile",
    "trainer_memory",
    "semantic_memory",
    "sync_run",
    "garmin_athlete_baseline",
    "garmin_athlete_baseline_attempt",
    "garmin_body_metrics",
    "garmin_body_metric_attempt",
    "garmin_body_weight_history",
    "garmin_raw_payload",
    "activity_hr_zone_time",
    "training_plan",
    "weekly_artifact",
    "weekly_proposal",
    "weekly_kpi",
    "weekly_kpi_track",
    "conversation_turn",
    "conversation_completion",
    "conversation_segment",
    "conversation_compaction_spend",
    "summary_disposition",
    "summary_attempt",
    "summary_spend",
    "summary_manual",
    "summary_preference",
    "conversation_summary_pin",
    "conversation_title_spend",
    "summary_import",
    "summary_import_disposition",
    "summary_rebuild",
  ];
  return tables.some((table) => {
    if (!hasTable(db, table)) return false;
    const row = db.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    };
    return row.count > 0;
  });
}

export function currentSchemaVersion(db: Database.Database): number {
  if (!hasTable(db, "app_metadata")) return 0;
  const row = db
    .prepare("select value from app_metadata where key = ?")
    .get(SCHEMA_VERSION_KEY) as { value?: string } | undefined;
  const version = Number(row?.value ?? 0);
  return Number.isFinite(version) ? version : 0;
}

function setSchemaVersion(
  db: Database.Database,
  version: number,
  now = Date.now(),
): void {
  db.prepare(
    `insert into app_metadata (key, value, updated_at)
     values (?, ?, ?)
     on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
  ).run(SCHEMA_VERSION_KEY, String(version), now);
}

export function runIntegrityCheck(db: Database.Database): string {
  const row = db.prepare("pragma integrity_check").get() as {
    integrity_check: string;
  };
  return row.integrity_check;
}

export type MigrationResult = {
  fromVersion: number;
  toVersion: number;
  applied: string[];
  integrity: string;
};

export function migrateDatabase(db: Database.Database): MigrationResult {
  if (hasTable(db, "app_metadata")) {
    const raw = db
      .prepare("select value from app_metadata where key=?")
      .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;
    if (raw && !/^(0|[1-9][0-9]*)$/.test(raw.value))
      throw new Error(
        "Unsupported SQLite schema version; preserve data and use a compatible build.",
      );
  }
  const fromVersion = currentSchemaVersion(db);
  if (
    !Number.isSafeInteger(fromVersion) ||
    fromVersion < 0 ||
    fromVersion > LATEST_SCHEMA_VERSION
  )
    throw new Error(
      "Unsupported SQLite schema version; preserve data and use a compatible build.",
    );
  const applied: string[] = [];
  db.transaction(() => {
    for (const migration of SCHEMA_MIGRATIONS) {
      if (migration.version <= fromVersion) continue;
      if (migration.version === 24) validateLegacySummary(db);
      for (const statement of migration.statements) db.exec(statement);
      if (migration.version === 24) transitionWholeSummary(db);
      setSchemaVersion(db, migration.version);
      applied.push(`${migration.version}:${migration.name}`);
    }
    if (applied.length === 0) {
      for (const statement of BASE_SCHEMA_SQL) db.exec(statement);
      if (currentSchemaVersion(db) === 0)
        setSchemaVersion(db, LATEST_SCHEMA_VERSION);
    }
  })();
  const integrity = runIntegrityCheck(db);
  if (integrity !== "ok")
    throw new Error(`SQLite integrity check failed: ${integrity}`);
  return {
    fromVersion,
    toVersion: currentSchemaVersion(db),
    applied,
    integrity,
  };
}
