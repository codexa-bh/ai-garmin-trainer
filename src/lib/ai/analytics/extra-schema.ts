import type {
  AnalysisColumnDescriptor,
  SchemaTableDescriptor,
} from "./contracts";

/**
 * Allowlisted descriptors for the additional normalized Garmin evidence
 * relations. Feedback values are Garmin enum codes, not sentences; ranges are
 * Garmin-reported evidence, not app-authored thresholds.
 */
type Descriptor = Omit<SchemaTableDescriptor, "rowCount" | "dateRange">;

const date: AnalysisColumnDescriptor = {
  name: "date",
  type: "text",
  note: "YYYY-MM-DD; join daily_health.date",
};
const garminId: AnalysisColumnDescriptor = {
  name: "garmin_id",
  type: "text",
  note: "join activity.garmin_id",
};
const fetched: AnalysisColumnDescriptor = {
  name: "fetched_at",
  type: "integer",
  unit: "Unix epoch ms",
};
const code = (name: string, note: string): AnalysisColumnDescriptor => ({
  name,
  type: "text",
  nullable: true,
  note: `${note} Garmin enum code, not prose.`,
});
const value = (
  name: string,
  unit?: string,
  note?: string,
  type = "real",
): AnalysisColumnDescriptor => ({
  name,
  type,
  nullable: true,
  ...(unit ? { unit } : {}),
  ...(note ? { note } : {}),
});

export const EXTRA_ANALYTICAL_SCHEMA: Record<string, Descriptor> = {
  daily_sleep_detail: {
    name: "daily_sleep_detail",
    description:
      "One row per sleep date with source sleep timing and related measures. Sleep can cross midnight: the row date is Garmin's sleep date; local times use the source offset, never a host timezone.",
    columns: [
      date,
      value(
        "start_gmt_ms",
        "Unix epoch ms",
        "sleep window start (UTC)",
        "integer",
      ),
      value("end_gmt_ms", "Unix epoch ms", "sleep window end (UTC)", "integer"),
      value("start_local", undefined, "source local wall clock", "text"),
      value("end_local", undefined, "source local wall clock", "text"),
      value(
        "utc_offset_minutes",
        "minutes",
        "source local minus UTC",
        "integer",
      ),
      value("awake_count", "count", undefined, "integer"),
      value("avg_sleep_stress", "stress level"),
      value("avg_heart_rate", "bpm"),
      value("unmeasurable_seconds", "seconds", undefined, "integer"),
      code("window_confirmation_type", "How the window was confirmed."),
      value(
        "overall_score",
        "score 0-100",
        "same as daily_health.sleep_score when both present",
        "integer",
      ),
      code("overall_qualifier", "Overall score qualifier."),
      code("feedback_code", "Sleep score feedback."),
      code("insight_code", "Sleep score insight."),
      code("personalized_insight_code", "Personalized insight."),
      fetched,
    ],
    joins: ["daily_sleep_detail.date = daily_health.date"],
  },
  daily_sleep_score_component: {
    name: "daily_sleep_score_component",
    description:
      "Sleep sub-score components, several rows per date. Only overall/deep/light/rem carry a numeric value; total_duration/stress/awake_count/restlessness have qualifier and optimal range only (no invented score). Filter by component; do not average across components.",
    columns: [
      date,
      {
        name: "component",
        type: "text",
        note: "overall|deep|light|rem|total_duration|stress|awake_count|restlessness",
      },
      value(
        "value",
        "score 0-100",
        "null for qualifier-only components",
        "integer",
      ),
      code("qualifier", "Component qualifier (e.g. EXCELLENT/GOOD/FAIR/POOR)."),
      value(
        "optimal_start",
        undefined,
        "Garmin optimal range lower bound (component's own unit: % for stages)",
      ),
      value("optimal_end", undefined, "Garmin optimal range upper bound"),
      value("ideal_start_seconds", "seconds", "stage ideal range lower bound"),
      value("ideal_end_seconds", "seconds", "stage ideal range upper bound"),
    ],
    joins: ["daily_sleep_score_component.date = daily_health.date"],
  },
  daily_hrv_detail: {
    name: "daily_hrv_detail",
    description:
      "HRV weekly average, best 5-minute night value and Garmin's personal baseline ranges per date (nightly average/status stay in daily_health.hrv_ms/hrv_status). Baselines are Garmin evidence, not medical thresholds.",
    columns: [
      date,
      value("weekly_avg_ms", "ms"),
      value("last_night_5min_high_ms", "ms"),
      value("baseline_low_upper_ms", "ms", "upper bound of Garmin LOW range"),
      value("baseline_balanced_low_ms", "ms", "lower bound of BALANCED range"),
      value(
        "baseline_balanced_upper_ms",
        "ms",
        "upper bound of BALANCED range",
      ),
      value(
        "baseline_marker_value",
        undefined,
        "where the weekly average falls in the range (Garmin marker)",
      ),
      code("feedback_code", "HRV feedback phrase."),
      fetched,
    ],
    joins: ["daily_hrv_detail.date = daily_health.date"],
  },
  vo2_max_reading: {
    name: "vo2_max_reading",
    description:
      "Sparse dated VO2 max measurements, one row per date and Garmin branch (generic/cycling/rowing). Not a daily series: never forward-fill; trend by measured dates. Generic readings may come from walking or running (see sport).",
    columns: [
      date,
      { name: "branch", type: "text", note: "generic|cycling|rowing" },
      value("vo2_max", "ml/kg/min", "Garmin rounded value"),
      value("vo2_max_precise", "ml/kg/min", "Garmin precise value"),
      value("sport", undefined, "source sport when provided", "text"),
      value("sub_sport", undefined, "source sub-sport when provided", "text"),
      fetched,
    ],
  },
  daily_body_battery: {
    name: "daily_body_battery",
    description:
      "Daily Body Battery range/charge/drain and Garmin feedback events. latest_level is the latest reading at sync time, not end of day; end_of_day_level is only what Garmin reports. Distinct from daily_health.body_battery_morning/evening.",
    columns: [
      date,
      value("min_level", "level 0-100", undefined, "integer"),
      value("max_level", "level 0-100", undefined, "integer"),
      value(
        "charged",
        "level points",
        "total increase over the day",
        "integer",
      ),
      value(
        "drained",
        "level points",
        "total decrease over the day",
        "integer",
      ),
      value("latest_level", "level 0-100", undefined, "integer"),
      value("end_of_day_level", "level 0-100", undefined, "integer"),
      value("feedback_level", "level 0-100", undefined, "integer"),
      value("feedback_at_gmt", undefined, "UTC timestamp", "text"),
      code("feedback_short_code", "Dynamic feedback."),
      code("feedback_long_code", "Dynamic feedback."),
      value("end_of_day_feedback_level", "level 0-100", undefined, "integer"),
      value("end_of_day_feedback_at_gmt", undefined, "UTC timestamp", "text"),
      code("end_of_day_feedback_short_code", "End-of-day feedback."),
      code("end_of_day_feedback_long_code", "End-of-day feedback."),
      fetched,
    ],
    joins: ["daily_body_battery.date = daily_health.date"],
  },
  body_battery_event: {
    name: "body_battery_event",
    description:
      "Garmin Body Battery events per date (SLEEP, STRESS, ACTIVITY, RECOVERY, NAP). impact is a signed level change. Events carry no activity link unless source_activity_id is present; never match to activities by time.",
    columns: [
      date,
      { name: "event_key", type: "text", note: "stable event identity" },
      code("event_type", "Event type."),
      value("start_gmt", undefined, "UTC start", "text"),
      value("start_local", undefined, "source local start", "text"),
      value("duration_seconds", "seconds"),
      value("impact", "level points (signed)", undefined, "integer"),
      code("feedback_type", "Event feedback."),
      code("short_feedback", "Event feedback."),
      value(
        "source_activity_id",
        undefined,
        "only when Garmin supplied it",
        "text",
      ),
    ],
    joins: ["body_battery_event.date = daily_health.date"],
  },
  daily_stress: {
    name: "daily_stress",
    description:
      "Daily stress buckets. Durations are seconds; fractions are 0-1 shares of total_seconds (null when the source scale was not verifiable). rest/activity/uncategorized/low/medium/high are separate buckets: activity and uncategorized time are not high stress. Do not sum fractions from different days.",
    columns: [
      date,
      value("avg_level", "stress level 0-100", undefined, "integer"),
      value("max_level", "stress level 0-100", undefined, "integer"),
      code("qualifier", "Day stress qualifier."),
      value("total_seconds", "seconds"),
      value("rest_seconds", "seconds"),
      value("activity_seconds", "seconds"),
      value("uncategorized_seconds", "seconds"),
      value("low_seconds", "seconds"),
      value("medium_seconds", "seconds"),
      value("high_seconds", "seconds"),
      value("rest_fraction", "fraction 0-1"),
      value("activity_fraction", "fraction 0-1"),
      value("uncategorized_fraction", "fraction 0-1"),
      value("low_fraction", "fraction 0-1"),
      value("medium_fraction", "fraction 0-1"),
      value("high_fraction", "fraction 0-1"),
      fetched,
    ],
    joins: ["daily_stress.date = daily_health.date"],
  },
  activity_extra_metrics: {
    name: "activity_extra_metrics",
    description:
      "Per-activity Body Battery delta and running dynamics. body_battery_delta is a signed change over the activity, not a level. List cadence is steps/min; fit_* cadence is FIT cycles/min (one cycle = one stride, two steps, for foot sports; one revolution for cycling). Advanced dynamics need a running pod/strap and are usually null.",
    columns: [
      garminId,
      value(
        "body_battery_delta",
        "level points (signed)",
        undefined,
        "integer",
      ),
      value("avg_run_cadence_spm", "steps/min"),
      value("max_run_cadence_spm", "steps/min"),
      value("avg_double_cadence_spm", "steps/min"),
      value("max_double_cadence_spm", "steps/min"),
      value("avg_fractional_cadence_spm", "steps/min"),
      value("max_fractional_cadence_spm", "steps/min"),
      value("avg_stride_length_cm", "cm"),
      value("avg_vertical_oscillation_cm", "cm"),
      value("avg_ground_contact_time_ms", "ms"),
      value("avg_ground_contact_balance_pct", "%"),
      value("avg_vertical_ratio_pct", "%"),
      value("avg_grade_adjusted_speed_mps", "m/s"),
      value("fit_avg_cadence_cpm", "cycles/min"),
      value("fit_max_cadence_cpm", "cycles/min"),
      value("fit_total_cycles", "cycles"),
      value("fit_avg_vertical_oscillation_cm", "cm"),
      value("fit_avg_stance_time_ms", "ms"),
      value("fit_avg_stance_time_balance_pct", "%"),
      value("fit_avg_vertical_ratio_pct", "%"),
      value("fit_avg_step_length_m", "m"),
      value("fit_avg_grade_adjusted_speed_mps", "m/s"),
      fetched,
    ],
    joins: ["activity_extra_metrics.garmin_id = activity.garmin_id"],
  },
  activity_split_summary: {
    name: "activity_split_summary",
    description:
      "Snowboard/ski per-type split TOTALS (one row per activity and type, e.g. all runs together), never individual runs. split_count is how many splits of that type; duration/distance are totals; max_* are the best single split.",
    columns: [
      garminId,
      {
        name: "split_type",
        type: "text",
        note: "SKI_RUN_SPLIT|SKI_LIFT_SPLIT|ASCENT_SPLIT|DESCENT_SPLIT|TRANSITION",
      },
      value("split_count", "count", undefined, "integer"),
      value("duration_sec", "seconds"),
      value("distance_meters", "meters"),
      value("avg_speed_mps", "m/s"),
      value("max_speed_mps", "m/s"),
      value("total_ascent_meters", "meters"),
      value("elevation_loss_meters", "meters"),
      value("avg_elevation_gain_meters", "meters"),
      value("max_elevation_gain_meters", "meters"),
      value("max_distance_meters", "meters"),
      value("num_falls", "count", undefined, "integer"),
      value("num_climb_sends", "count", undefined, "integer"),
      fetched,
    ],
    joins: ["activity_split_summary.garmin_id = activity.garmin_id"],
  },
  activity_lap_hr_zone_time: {
    name: "activity_lap_hr_zone_time",
    description:
      "Per-lap heart-rate time in zone from the activity file, with that file's own historical boundaries. bucket_kind zone (zone 1-5), below (under zone 1) or above (over the top boundary): exclude below/above from zone totals. Separate from session totals in activity_hr_zone_time; never add the two. Aggregate per activity before joining activity rows.",
    columns: [
      garminId,
      {
        name: "lap_number",
        type: "integer",
        note: "join activity_lap.lap_number",
      },
      { name: "bucket", type: "integer", note: "source bucket index" },
      value(
        "zone",
        undefined,
        "1-5 for zone buckets, null otherwise",
        "integer",
      ),
      { name: "bucket_kind", type: "text", note: "below|zone|above" },
      { name: "seconds", type: "real", unit: "seconds" },
      value("lower_bpm", "bpm", undefined, "integer"),
      value("upper_bpm", "bpm", undefined, "integer"),
      code("calc_method", "Zone calculation method."),
      value("source_max_heart_rate", "bpm", "max HR the file used", "integer"),
      value(
        "source_resting_heart_rate",
        "bpm",
        "resting HR the file used",
        "integer",
      ),
      fetched,
    ],
    joins: [
      "activity_lap_hr_zone_time.garmin_id = activity_lap.garmin_id and activity_lap_hr_zone_time.lap_number = activity_lap.lap_number",
    ],
  },
  garmin_data_coverage: {
    name: "garmin_data_coverage",
    description:
      "Import coverage for the additional groups. status populated (stored), empty (source replied without it), unavailable (source cannot supply it, e.g. no file) or failed (read failed). A date/activity with no row was not yet imported or backfilled: that is unknown, not empty.",
    columns: [
      {
        name: "data_group",
        type: "text",
        note: "sleep|hrv|vo2_max|body_battery|stress (subject date); activity_body_battery|running_dynamics|snowboard_splits|lap_hr_zones (subject activity)",
      },
      { name: "subject_type", type: "text", note: "date|activity" },
      { name: "subject_id", type: "text", note: "YYYY-MM-DD or garmin_id" },
      { name: "status", type: "text" },
      value("reason", undefined, "closed short code", "text"),
      { name: "updated_at", type: "integer", unit: "Unix epoch ms" },
    ],
  },
};

/** Activity-lap FIT dynamics columns appended to the existing lap descriptor. */
export const LAP_DYNAMICS_COLUMNS: AnalysisColumnDescriptor[] = [
  value(
    "fit_avg_cadence_cpm",
    "cycles/min",
    "FIT cycles; stride for foot sports",
  ),
  value("fit_max_cadence_cpm", "cycles/min"),
  value("fit_total_cycles", "cycles"),
  value("fit_avg_vertical_oscillation_cm", "cm"),
  value("fit_avg_stance_time_ms", "ms"),
  value("fit_avg_step_length_m", "m"),
];

/** Bounded examples, one per group, appended to the schema discovery. */
export const EXTRA_EXAMPLES = [
  "select c.date, c.component, c.value, c.qualifier, d.start_local, d.end_local from daily_sleep_score_component c join daily_sleep_detail d on d.date = c.date where c.component in ('overall','deep','rem') and c.date >= date('now','-28 days') order by c.date, c.component limit 100",
  "select h.date, h.weekly_avg_ms, h.baseline_balanced_low_ms, h.baseline_balanced_upper_ms, d.hrv_ms from daily_hrv_detail h left join daily_health d on d.date = h.date order by h.date desc limit 30",
  "select date, branch, sport, vo2_max_precise from vo2_max_reading order by date desc limit 30",
  "select b.date, b.charged, b.drained, (select sum(e.impact) from body_battery_event e where e.date = b.date and e.event_type = 'ACTIVITY') as activity_event_impact from daily_body_battery b order by b.date desc limit 14",
  "select date, low_seconds, medium_seconds, high_seconds, rest_seconds, activity_seconds, uncategorized_seconds from daily_stress order by date desc limit 14",
  "select a.garmin_id, a.name, z.zone, sum(z.seconds) as lap_zone_seconds, min(z.lower_bpm) as file_lower_bpm from activity a join activity_lap_hr_zone_time z on z.garmin_id = a.garmin_id where z.bucket_kind = 'zone' group by a.garmin_id, z.zone order by a.started_at desc, z.zone limit 50",
  "select a.sport, avg(m.avg_run_cadence_spm) as avg_cadence_spm, avg(m.avg_stride_length_cm) as avg_stride_cm, count(m.avg_ground_contact_time_ms) as activities_with_gct from activity a join activity_extra_metrics m on m.garmin_id = a.garmin_id group by a.sport",
  "select a.garmin_id, date(a.started_at / 1000, 'unixepoch') as day, s.split_type, s.split_count, s.distance_meters, s.max_speed_mps from activity a join activity_split_summary s on s.garmin_id = a.garmin_id where s.split_type = 'SKI_RUN_SPLIT' order by a.started_at desc limit 20",
  "select data_group, status, count(*) as subjects from garmin_data_coverage group by data_group, status order by data_group, status",
];
