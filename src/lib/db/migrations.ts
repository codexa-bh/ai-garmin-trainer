export function createSchemaSql(): string[] {
  return [
    `create table if not exists user (id text primary key, name text, email text not null unique, email_verified integer default 0, image text, created_at integer not null, updated_at integer not null)`,
    `create table if not exists session (id text primary key, expires_at integer not null, token text not null unique, created_at integer not null, updated_at integer not null, ip_address text, user_agent text, user_id text not null)`,
    `create table if not exists account (id text primary key, account_id text not null, provider_id text not null, user_id text not null, access_token text, refresh_token text, id_token text, access_token_expires_at integer, refresh_token_expires_at integer, scope text, password text, created_at integer not null, updated_at integer not null)`,
    `create table if not exists verification (id text primary key, identifier text not null, value text not null, expires_at integer not null, created_at integer, updated_at integer)`,
    `create table if not exists activity (id text primary key, garmin_id text not null unique, name text, sport text not null, started_at integer not null, duration_sec integer, distance_meters real, calories integer, avg_heart_rate integer, max_heart_rate integer, steps integer, elevation_gain_meters real, elevation_loss_meters real, training_effect real, source_updated_at integer)`,
    `create table if not exists daily_health (date text primary key, sleep_minutes integer, resting_heart_rate integer, hrv_status text, hrv_ms real, stress_avg integer, steps integer, calories integer, body_battery_avg integer, availability text not null default 'partial')`,
    `create table if not exists sync_run (id text primary key, status text not null, started_at integer not null, finished_at integer, coverage_start text, coverage_end text, last_error text)`,
    `create table if not exists sync_checkpoint (key text primary key, value text not null, updated_at integer not null)`,
    `create table if not exists conversation (id text primary key, title text not null, created_at integer not null, updated_at integer not null)`,
    `create table if not exists message (id text primary key, conversation_id text not null, role text not null, content text not null, grounding_json text, created_at integer not null)`,
    `create table if not exists trainer_profile (id text primary key default 'default', goals_json text not null default '[]', sports_json text not null default '[]', preferences_json text not null default '{}', constraints_json text not null default '[]', updated_at integer not null)`,
  ];
}
