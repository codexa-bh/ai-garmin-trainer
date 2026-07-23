import type Database from "better-sqlite3";

export const LATEST_SCHEMA_VERSION = 5;
export const SCHEMA_VERSION_KEY = "schema_version";

const BASE_SCHEMA_SQL = [
  `create table if not exists user (id text primary key, name text, email text not null unique, email_verified integer default 0, image text, created_at integer not null, updated_at integer not null)`,
  `create table if not exists session (id text primary key, expires_at integer not null, token text not null unique, created_at integer not null, updated_at integer not null, ip_address text, user_agent text, user_id text not null)`,
  `create table if not exists account (id text primary key, account_id text not null, provider_id text not null, user_id text not null, access_token text, refresh_token text, id_token text, access_token_expires_at integer, refresh_token_expires_at integer, scope text, password text, created_at integer not null, updated_at integer not null)`,
  `create table if not exists verification (id text primary key, identifier text not null, value text not null, expires_at integer not null, created_at integer, updated_at integer)`,
  `create table if not exists activity (id text primary key, garmin_id text not null unique, name text, sport text not null, started_at integer not null, duration_sec integer, distance_meters real, calories integer, avg_heart_rate integer, max_heart_rate integer, steps integer, elevation_gain_meters real, elevation_loss_meters real, training_effect real, source_updated_at integer)`,
  `create table if not exists daily_health (date text primary key, sleep_minutes integer, resting_heart_rate integer, hrv_status text, hrv_ms real, stress_avg integer, steps integer, calories integer, body_battery_avg integer, availability text not null default 'partial')`,
  `create table if not exists activity_detail_availability (garmin_id text primary key, fetched_at integer, source text not null, status text not null, has_session integer not null default 0, has_laps integer not null default 0, has_streams integer not null default 0, has_gps integer not null default 0, has_elevation integer not null default 0, has_heart_rate integer not null default 0, has_grade integer not null default 0, has_power integer not null default 0, has_recovery integer not null default 0, record_count integer not null default 0, lap_count integer not null default 0, unavailable_reason text, session_json text, derived_json text)`,
  `create table if not exists activity_detail_attempt (garmin_id text primary key, attempted_at integer not null, completed_at integer, force integer not null default 0, status text not null, detail_status text, retryable integer not null default 0, error_class text, error_message text, preserved_previous integer not null default 0)`,
  `create table if not exists activity_lap (garmin_id text not null, lap_number integer not null, start_time text, duration_sec real, distance_meters real, avg_speed_mps real, avg_heart_rate real, max_heart_rate real, elevation_gain_meters real, elevation_loss_meters real, avg_power_watts real, normalized_power_watts real, primary key (garmin_id, lap_number))`,
  `create table if not exists activity_stream_point (garmin_id text not null, elapsed_sec integer not null, timestamp text, heart_rate integer, speed_mps real, altitude_meters real, grade_pct real, lat real, lon real, cadence real, power_watts real, temperature_c real, primary key (garmin_id, elapsed_sec))`,
  `create table if not exists garmin_athlete_baseline (id text primary key default 'default', fetched_at integer not null, source text not null, availability text not null, running_lactate_threshold_heart_rate_bpm integer, cycling_lactate_threshold_heart_rate_bpm integer, rowing_lactate_threshold_heart_rate_bpm integer, cycling_ftp_watts integer, cycling_ftp_measured_on text, cycling_ftp_source_stale integer, vo2_max_running real, vo2_max_cycling real, available_training_days_json text not null default '[]', preferred_long_training_days_json text not null default '[]')`,
  `create table if not exists garmin_athlete_baseline_attempt (id text primary key default 'default', attempted_at integer not null, completed_at integer, status text not null, error_message text, preserved_previous integer not null default 0)`,
  `create table if not exists garmin_raw_payload (id text primary key, source_tool text not null, subject_type text not null, subject_id text not null, fetched_at integer not null, content_type text not null, payload_json text, payload_text text, sha256 text not null, redaction_version integer not null, redacted_field_count integer not null default 0)`,
  `create index if not exists garmin_raw_payload_subject_idx on garmin_raw_payload(subject_type, subject_id)`,
  `create table if not exists sync_run (id text primary key, status text not null, started_at integer not null, finished_at integer, coverage_start text, coverage_end text, last_error text)`,
  `create table if not exists sync_checkpoint (key text primary key, value text not null, updated_at integer not null)`,
  `create table if not exists conversation (id text primary key, title text not null, created_at integer not null, updated_at integer not null)`,
  `create table if not exists message (id text primary key, conversation_id text not null, role text not null, content text not null, grounding_json text, created_at integer not null)`,
  `create table if not exists trainer_profile (id text primary key default 'default', goals_json text not null default '[]', sports_json text not null default '[]', preferences_json text not null default '{}', constraints_json text not null default '[]', updated_at integer not null)`,
  `create table if not exists trainer_memory (id text primary key, category text not null, value text not null, status text not null, source_type text not null, source_ref text, provenance_text text not null, valid_from integer, expires_at integer, reconfirm_after integer, supersedes_id text, superseded_by_id text, created_at integer not null, updated_at integer not null)`,
  `create table if not exists semantic_memory (id text primary key, user_id text not null, kind text not null, text text not null, status text not null, embedding_json text not null, embedding_model text not null, source_conversation_id text, source_message_ids_json text not null default '[]', source text not null, created_at integer not null, updated_at integer not null, expires_at integer)`,
  `create index if not exists semantic_memory_user_status_idx on semantic_memory(user_id, status, updated_at)`,
  `create index if not exists semantic_memory_conversation_idx on semantic_memory(source_conversation_id)`,
  `create table if not exists app_metadata (key text primary key, value text not null, updated_at integer not null)`,
];

export type SchemaMigration = {
  version: number;
  name: string;
  statements: string[];
};

export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    name: "source_beta_foundation",
    statements: BASE_SCHEMA_SQL,
  },
  {
    version: 2,
    name: "garmin_athlete_baseline_latest_snapshot",
    statements: [
      `create table if not exists garmin_athlete_baseline (id text primary key default 'default', fetched_at integer not null, source text not null, availability text not null, running_lactate_threshold_heart_rate_bpm integer, cycling_lactate_threshold_heart_rate_bpm integer, rowing_lactate_threshold_heart_rate_bpm integer, cycling_ftp_watts integer, cycling_ftp_measured_on text, cycling_ftp_source_stale integer, vo2_max_running real, vo2_max_cycling real, available_training_days_json text not null default '[]', preferred_long_training_days_json text not null default '[]')`,
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
];

export function createSchemaSql(): string[] {
  return [
    ...BASE_SCHEMA_SQL,
    `insert into app_metadata (key, value, updated_at) values ('${SCHEMA_VERSION_KEY}', '${LATEST_SCHEMA_VERSION}', strftime('%s','now') * 1000) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at`,
  ];
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
    "garmin_raw_payload",
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

export function setSchemaVersion(
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
  const fromVersion = currentSchemaVersion(db);
  const applied: string[] = [];
  db.transaction(() => {
    for (const migration of SCHEMA_MIGRATIONS) {
      if (migration.version <= fromVersion) continue;
      for (const statement of migration.statements) db.exec(statement);
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
