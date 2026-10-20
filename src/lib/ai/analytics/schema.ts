import type {
  SchemaTableDescriptor,
  GarminDatabaseDescription,
  AnalyticalTableStatistics,
} from "./contracts";
import { SQL_LIMITS } from "./contracts";

export const PRIVACY =
  "Read-only local SQLite analytics over allowlisted app-owned normalized Garmin analytical tables by default, including bounded normalized GPS route coordinates when route/GPS evidence is requested; auth/session/account/verification, conversations/messages/memory/profile, operational sync/import internals, secrets, connector credentials, raw payloads, and filesystem paths are excluded.";

const FORBIDDEN_DATA_CLASSES = [
  "auth/session/account/verification rows",
  "conversation/message/memory/profile/training-plan rows outside the Garmin SQL analytics surface",
  "operational sync/import attempt/checkpoint metadata and app metadata",
  "secrets, tokens, passwords, cookies, provider credentials, and connector handles",
  "filesystem paths, database paths, environment variables, process/network access",
  "raw unrestricted FIT streams, unrestricted GPS stream dumps, or raw Garmin connector payload dumps",
];

export const ANALYTICAL_SCHEMA: Record<
  string,
  Omit<SchemaTableDescriptor, "rowCount" | "dateRange">
> = {
  activity: {
    name: "activity",
    description:
      "One normalized imported Garmin activity per row; use for activity rankings, windows, sport filters, duration/distance/heart-rate/elevation/calorie/training-effect analytics.",
    columns: [
      {
        name: "garmin_id",
        type: "text",
        note: "stable imported Garmin activity id",
      },
      { name: "name", type: "text", nullable: true },
      { name: "sport", type: "text" },
      { name: "started_at", type: "integer", unit: "Unix epoch ms" },
      {
        name: "duration_sec",
        type: "integer",
        unit: "seconds",
        nullable: true,
      },
      { name: "distance_meters", type: "real", unit: "meters", nullable: true },
      { name: "calories", type: "integer", unit: "kcal", nullable: true },
      { name: "avg_heart_rate", type: "integer", unit: "bpm", nullable: true },
      { name: "max_heart_rate", type: "integer", unit: "bpm", nullable: true },
      { name: "steps", type: "integer", nullable: true },
      {
        name: "elevation_gain_meters",
        type: "real",
        unit: "meters",
        nullable: true,
      },
      {
        name: "elevation_loss_meters",
        type: "real",
        unit: "meters",
        nullable: true,
      },
      {
        name: "training_effect",
        type: "real",
        nullable: true,
        note: "Garmin-reported activity training effect when exposed; do not infer from other columns.",
      },
      {
        name: "anaerobic_training_effect",
        type: "real",
        nullable: true,
        note: "Garmin-reported anaerobic training effect when exposed.",
      },
      {
        name: "training_effect_label",
        type: "text",
        nullable: true,
        note: "Garmin-provided training-effect benefit/label when exposed.",
      },
      {
        name: "training_load",
        type: "real",
        nullable: true,
        note: "Garmin-reported activity training load when exposed.",
      },
      {
        name: "moderate_intensity_minutes",
        type: "real",
        unit: "minutes",
        nullable: true,
        note: "Garmin-reported moderate intensity minutes for the activity when exposed.",
      },
      {
        name: "vigorous_intensity_minutes",
        type: "real",
        unit: "minutes",
        nullable: true,
        note: "Garmin-reported vigorous intensity minutes for the activity when exposed.",
      },
      {
        name: "total_intensity_minutes",
        type: "real",
        unit: "minutes",
        nullable: true,
        note: "Garmin total if exposed, otherwise the normalized sum of Garmin moderate and vigorous minutes when either component is available.",
      },
      {
        name: "source_updated_at",
        type: "integer",
        unit: "Unix epoch ms",
        nullable: true,
      },
    ],
    joins: [
      "activity.garmin_id = activity_detail_availability.garmin_id",
      "activity.garmin_id = activity_lap.garmin_id",
      "activity.garmin_id = activity_stream_point.garmin_id",
      "activity.garmin_id = activity_hr_zone_time.garmin_id",
    ],
  },
  daily_health: {
    name: "daily_health",
    description:
      "One normalized local health/recovery day where available; use for recovery context, sleep/resting-HR/HRV/stress/body-battery trends, and safe joins by calendar date.",
    columns: [
      { name: "date", type: "text", note: "YYYY-MM-DD" },
      {
        name: "sleep_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
      },
      {
        name: "sleep_score",
        type: "integer",
        unit: "score",
        nullable: true,
        note: "Garmin/source-provided sleep score when imported; do not infer.",
      },
      {
        name: "sleep_deep_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
        note: "Source-provided deep sleep duration when imported.",
      },
      {
        name: "sleep_light_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
        note: "Source-provided light sleep duration when imported.",
      },
      {
        name: "sleep_rem_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
        note: "Source-provided REM sleep duration when imported.",
      },
      {
        name: "sleep_awake_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
        note: "Source-provided awake sleep-period duration when imported.",
      },
      {
        name: "sleep_nap_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
        note: "Source-provided nap duration when imported.",
      },
      {
        name: "resting_heart_rate",
        type: "integer",
        unit: "bpm",
        nullable: true,
      },
      { name: "hrv_status", type: "text", nullable: true },
      { name: "hrv_ms", type: "real", unit: "ms", nullable: true },
      { name: "stress_avg", type: "integer", nullable: true },
      { name: "steps", type: "integer", nullable: true },
      { name: "calories", type: "integer", unit: "kcal", nullable: true },
      {
        name: "active_calories",
        type: "integer",
        unit: "kcal",
        nullable: true,
        note: "Source-provided daily active calories when exposed by Garmin stats.",
      },
      {
        name: "resting_calories",
        type: "integer",
        unit: "kcal",
        nullable: true,
        note: "Source-provided daily BMR/resting calories when exposed by Garmin stats.",
      },
      {
        name: "total_calories",
        type: "integer",
        unit: "kcal",
        nullable: true,
      },
      {
        name: "intensity_minutes",
        type: "integer",
        unit: "minutes",
        nullable: true,
        note: "Daily Garmin health-source intensity minutes; not activity-derived fallback.",
      },
      { name: "body_battery_avg", type: "integer", nullable: true },
      { name: "body_battery_morning", type: "integer", nullable: true },
      { name: "body_battery_evening", type: "integer", nullable: true },
      { name: "availability", type: "text" },
    ],
    joins: [
      "date(activity.started_at / 1000, 'unixepoch') = daily_health.date",
    ],
  },
  activity_detail_availability: {
    name: "activity_detail_availability",
    description:
      "Bounded metadata showing whether normalized session/lap/stream/detail rows exist for an activity; not raw FIT content.",
    columns: [
      { name: "garmin_id", type: "text" },
      {
        name: "fetched_at",
        type: "integer",
        unit: "Unix epoch ms",
        nullable: true,
      },
      { name: "source", type: "text", note: "garmin-fit | garmin-summary" },
      { name: "status", type: "text" },
      { name: "has_session", type: "integer", note: "0/1 boolean" },
      { name: "has_laps", type: "integer", note: "0/1 boolean" },
      { name: "has_streams", type: "integer", note: "0/1 boolean" },
      { name: "has_gps", type: "integer", note: "0/1 boolean" },
      { name: "has_elevation", type: "integer", note: "0/1 boolean" },
      { name: "has_heart_rate", type: "integer", note: "0/1 boolean" },
      {
        name: "has_grade",
        type: "integer",
        note: "0/1 source-grade availability; does not describe calculated-grade availability",
      },
      { name: "has_power", type: "integer", note: "0/1 boolean" },
      { name: "has_recovery", type: "integer", note: "0/1 boolean" },
      { name: "record_count", type: "integer" },
      { name: "lap_count", type: "integer" },
      { name: "unavailable_reason", type: "text", nullable: true },
      {
        name: "session_json",
        type: "text",
        nullable: true,
        note: "app-normalized bounded session summary JSON; not raw FIT or connector payload",
      },
      {
        name: "derived_json",
        type: "text",
        nullable: true,
        note: "app-derived bounded detail metrics JSON; not raw FIT or connector payload",
      },
    ],
    joins: ["activity_detail_availability.garmin_id = activity.garmin_id"],
  },
  activity_lap: {
    name: "activity_lap",
    description:
      "Normalized lap rows for imported details; row output is capped.",
    columns: [
      { name: "garmin_id", type: "text" },
      { name: "lap_number", type: "integer" },
      { name: "start_time", type: "text", nullable: true },
      { name: "duration_sec", type: "real", unit: "seconds", nullable: true },
      { name: "distance_meters", type: "real", unit: "meters", nullable: true },
      { name: "avg_speed_mps", type: "real", unit: "m/s", nullable: true },
      { name: "avg_heart_rate", type: "real", unit: "bpm", nullable: true },
      { name: "max_heart_rate", type: "real", unit: "bpm", nullable: true },
      {
        name: "elevation_gain_meters",
        type: "real",
        unit: "meters",
        nullable: true,
      },
      {
        name: "elevation_loss_meters",
        type: "real",
        unit: "meters",
        nullable: true,
      },
      { name: "avg_power_watts", type: "real", unit: "watts", nullable: true },
      {
        name: "normalized_power_watts",
        type: "real",
        unit: "watts",
        nullable: true,
      },
    ],
    joins: ["activity_lap.garmin_id = activity.garmin_id"],
  },
  activity_stream_point: {
    name: "activity_stream_point",
    description:
      "Normalized bounded stream points for imported details, including route coordinates for GPS questions. Avoid broad dumps; aggregate or limit heavily.",
    columns: [
      { name: "garmin_id", type: "text" },
      { name: "elapsed_sec", type: "integer", unit: "seconds" },
      { name: "timestamp", type: "text", nullable: true },
      { name: "distance_meters", type: "real", unit: "meters", nullable: true },
      { name: "heart_rate", type: "integer", unit: "bpm", nullable: true },
      { name: "speed_mps", type: "real", unit: "m/s", nullable: true },
      { name: "altitude_meters", type: "real", unit: "meters", nullable: true },
      {
        name: "grade_pct",
        type: "real",
        unit: "%",
        nullable: true,
        note: "Imported source grade only; null does not rule out activity_calculated_grade(activity_id) estimates",
      },
      {
        name: "lat",
        type: "real",
        unit: "degrees",
        nullable: true,
        note: "normalized GPS latitude; use only bounded/limited route slices for route or GPS questions",
      },
      {
        name: "lon",
        type: "real",
        unit: "degrees",
        nullable: true,
        note: "normalized GPS longitude; use only bounded/limited route slices for route or GPS questions",
      },
      { name: "cadence", type: "real", nullable: true },
      { name: "power_watts", type: "real", unit: "watts", nullable: true },
      { name: "temperature_c", type: "real", unit: "°C", nullable: true },
    ],
    joins: ["activity_stream_point.garmin_id = activity.garmin_id"],
  },
  activity_calculated_grade: {
    name: "activity_calculated_grade",
    description:
      "Read-time table-valued relation: activity_calculated_grade('verified-id'), or join activity_calculated_grade(a.garmin_id). REQUIRED: pass the activity ID as function argument OR WHERE garmin_id = 'verified-id'. Unconstrained queries fail, never mean unavailable. Discovery rowCount=0 is registration metadata only, NOT activity/window evidence. Approximate signed altitude/distance sections, NOT measured instantaneous gradient, dashboard centered readout, terrain or technicality. Timestamp-only timing (stored elapsed may be sample indexes); timezone-less Garmin calendar timestamps use relative clock arithmetic, never host timezone or absolute-time claims; mixed absolute/relative bases rejected; consecutive sections close at first sample >=180s, share endpoints, final short section allowed. Requires >=60s, >=3 complete samples, >=10m net distance, strictly increasing timestamps, adjacent gaps <=30s, nonnegative nondecreasing cumulative distance. Invalid sections return null with quality_status; no stream returns one unavailable sentinel. Coverage denominator is all returned sections: count(calculated_grade_pct)/count(*), not unique samples or activity distance. Aggregate with method and coverage. Max 100000 points/activity (excess yields input_limit null sentinel); max 32 invocations/query. Filter selected activities before calling; aggregate rather than dump windows.",
    columns: [
      {
        name: "garmin_id",
        type: "text",
        note: "Hidden required argument: function('verified-id') or WHERE garmin_id='verified-id'; selectable explicitly (not in SELECT *). Numeric safe integer IDs also accepted. Never infer availability from discovery rowCount.",
      },
      {
        name: "window_index",
        type: "integer",
        note: "zero-based consecutive section index",
      },
      {
        name: "start_elapsed_sec",
        type: "real",
        unit: "seconds",
        nullable: true,
        note: "timestamp-relative to first parseable stream timestamp, not stored sample indexes",
      },
      {
        name: "end_elapsed_sec",
        type: "real",
        unit: "seconds",
        nullable: true,
      },
      {
        name: "calculated_grade_pct",
        type: "real",
        unit: "%",
        nullable: true,
        note: "100 * altitude change / recorded cumulative-distance change; approximate, smoothed section grade, not peak instantaneous slope",
      },
      {
        name: "grade_method",
        type: "text",
        note: "altitude_distance_sections_v1",
      },
      { name: "target_window_sec", type: "integer", unit: "seconds" },
      {
        name: "support_seconds",
        type: "real",
        unit: "seconds",
        nullable: true,
      },
      {
        name: "support_distance_meters",
        type: "real",
        unit: "meters",
        nullable: true,
      },
      {
        name: "sample_count",
        type: "integer",
        note: "shared endpoints counted in both sections; input_limit counts only capped input",
      },
      {
        name: "usable_sample_count",
        type: "integer",
        note: "finite timestamp/altitude/nonnegative distance; not a continuity certificate",
      },
      {
        name: "source_grade_sample_count",
        type: "integer",
        note: "finite imported grade values, independent of calculated validity",
      },
      {
        name: "quality_status",
        type: "text",
        note: "available | no_stream | input_limit | invalid_timing | missing_values | sampling_gap | distance_reset | insufficient_time | insufficient_distance | nonfinite_result",
      },
    ],
    joins: ["activity a join activity_calculated_grade(a.garmin_id) g"],
  },
  activity_hr_zone_time: {
    name: "activity_hr_zone_time",
    description:
      "Normalized per-activity Garmin heart-rate-zone duration totals. Join to activity by garmin_id for date/month/sport filtering; aggregate seconds by zone for HR-zone summaries when status is available.",
    columns: [
      { name: "garmin_id", type: "text" },
      { name: "zone", type: "integer", note: "heart-rate zone number 1-5" },
      { name: "fetched_at", type: "integer", unit: "Unix epoch ms" },
      {
        name: "source",
        type: "text",
        note: "normalized Garmin HR-zone source",
      },
      {
        name: "status",
        type: "text",
        note: "filter to status = 'available' for totals",
      },
      { name: "seconds", type: "integer", unit: "seconds" },
      {
        name: "source_lower_bpm",
        type: "integer",
        unit: "bpm",
        nullable: true,
      },
      {
        name: "source_total_seconds",
        type: "integer",
        unit: "seconds",
        note: "source total repeated on each zone row for coverage checks",
      },
    ],
    joins: ["activity_hr_zone_time.garmin_id = activity.garmin_id"],
  },
  garmin_body_metrics: {
    name: "garmin_body_metrics",
    description:
      "Single normalized Garmin body-metrics snapshot with explicit units, source, and freshness; excludes raw profile/account/demographic fields.",
    columns: [
      { name: "availability", type: "text" },
      { name: "fetched_at", type: "integer", unit: "Unix epoch ms" },
      { name: "weight_kg", type: "real", unit: "kg", nullable: true },
      { name: "height_cm", type: "real", unit: "cm", nullable: true },
      { name: "history_availability", type: "text" },
      { name: "history_range_start", type: "text", nullable: true },
      { name: "history_range_end", type: "text", nullable: true },
      { name: "history_count", type: "integer" },
      {
        name: "history_source",
        type: "text",
        nullable: true,
        note: "weigh_in | body_composition | mixed",
      },
      {
        name: "current_weight_source",
        type: "text",
        nullable: true,
        note: "profile | weigh_in",
      },
      {
        name: "weigh_in_availability",
        type: "text",
        nullable: true,
        note: "available | unavailable | failed",
      },
    ],
    joins: [],
  },
  garmin_body_weight_history: {
    name: "garmin_body_weight_history",
    description:
      "Normalized Garmin body-weight history rows imported from read-only weigh-in and body-composition data; one row per date, no raw profile payload.",
    columns: [
      { name: "date", type: "text", note: "YYYY-MM-DD" },
      { name: "weight_kg", type: "real", unit: "kg" },
      { name: "source", type: "text", note: "garmin_mcp" },
      { name: "fetched_at", type: "integer", unit: "Unix epoch ms" },
    ],
  },
  garmin_athlete_baseline: {
    name: "garmin_athlete_baseline",
    description:
      "Single normalized athlete baseline values when available; excludes connector credentials and raw account data.",
    columns: [
      { name: "fetched_at", type: "integer", unit: "Unix epoch ms" },
      { name: "source", type: "text" },
      { name: "availability", type: "text" },
      {
        name: "configured_max_heart_rate_bpm",
        type: "integer",
        unit: "bpm",
        nullable: true,
      },
      {
        name: "cycling_ftp_watts",
        type: "integer",
        unit: "watts",
        nullable: true,
      },
      { name: "cycling_ftp_measured_on", type: "text", nullable: true },
      {
        name: "cycling_ftp_source_stale",
        type: "integer",
        nullable: true,
        note: "0/1 boolean indicating preserved stale FTP source state",
      },
      { name: "heart_rate_zones_status", type: "text", nullable: true },
      { name: "heart_rate_zones_formula", type: "text", nullable: true },
      {
        name: "heart_rate_zones_json",
        type: "text",
        note: "app-normalized HR-zone boundary JSON, not raw connector payload",
      },
      { name: "available_training_days_json", type: "text", nullable: true },
      {
        name: "preferred_long_training_days_json",
        type: "text",
        nullable: true,
      },
    ],
  },
};

export function describeAnalyticalSchema(
  statistics: Record<string, AnalyticalTableStatistics>,
): GarminDatabaseDescription {
  const tables = Object.values(ANALYTICAL_SCHEMA).map((descriptor) => ({
    ...descriptor,
    ...statistics[descriptor.name],
  }));
  return {
    tool: "describeGarminDatabase",
    status: "succeeded",
    tables,
    forbiddenDataClasses: FORBIDDEN_DATA_CLASSES,
    examples: [
      "select grade_method, target_window_sec, count(*) as total_sections, count(calculated_grade_pct) as valid_sections, min(calculated_grade_pct) as min_section_grade_pct, max(calculated_grade_pct) as max_section_grade_pct, sum(source_grade_sample_count) as source_grade_samples from activity_calculated_grade('verified-id') group by grade_method, target_window_sec",
      "with selected as (select garmin_id from activity order by started_at desc limit 5) select a.garmin_id, g.grade_method, g.target_window_sec, count(*) as total_sections, count(g.calculated_grade_pct) as valid_sections, min(g.calculated_grade_pct) as min_section_grade_pct, max(g.calculated_grade_pct) as max_section_grade_pct from selected a join activity_calculated_grade(a.garmin_id) g group by a.garmin_id, g.grade_method, g.target_window_sec limit 5",
      "select garmin_id, name, sport, date(started_at / 1000, 'unixepoch') as date, duration_sec from activity order by duration_sec desc limit 10",
      "select strftime('%Y-%m', started_at / 1000, 'unixepoch') as month, count(*) as activities, coalesce(sum(calories), 0) as activity_calories_kcal from activity where strftime('%Y', started_at / 1000, 'unixepoch') = strftime('%Y', 'now') group by month order by month",
      "select substr(date, 1, 7) as month, sum(steps) as steps, sum(active_calories) as active_calories_kcal, sum(resting_calories) as resting_calories_kcal, sum(total_calories) as total_calories_kcal from daily_health group by month order by month",
      "select strftime('%Y-%m', a.started_at / 1000, 'unixepoch') as month, z.zone, sum(z.seconds) as hr_zone_seconds from activity a join activity_hr_zone_time z on z.garmin_id = a.garmin_id where z.status = 'available' group by month, z.zone order by month, z.zone",
      "select garmin_id, coalesce(name, sport || ' on ' || date(started_at / 1000, 'unixepoch')) as label, name, sport, date(started_at / 1000, 'unixepoch') as date, duration_sec, distance_meters, calories, avg_heart_rate, max_heart_rate, elevation_gain_meters, elevation_loss_meters, training_effect from activity where started_at >= unixepoch('now', '-365 days') * 1000 order by started_at desc limit 200 -- then use runMathAnalysis score/normalize with a transparent model-selected formula over these columns, e.g. duration_sec + distance_meters + elevation_gain_meters + calories + avg_heart_rate + max_heart_rate + training_effect",
      "select sport, count(*) as activities, avg(duration_sec) as avg_duration_sec from activity group by sport order by activities desc",
      "select a.garmin_id, a.name, d.status, d.record_count from activity a join activity_detail_availability d on d.garmin_id = a.garmin_id limit 20",
    ],
    limits: SQL_LIMITS,
    privacy: PRIVACY,
  };
}
