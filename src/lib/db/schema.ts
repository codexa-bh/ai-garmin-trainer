import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  garminId: text("garmin_id").notNull().unique(),
  name: text("name"),
  sport: text("sport").notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  durationSec: integer("duration_sec"),
  distanceMeters: real("distance_meters"),
  calories: integer("calories"),
  avgHeartRate: integer("avg_heart_rate"),
  maxHeartRate: integer("max_heart_rate"),
  steps: integer("steps"),
  elevationGainMeters: real("elevation_gain_meters"),
  elevationLossMeters: real("elevation_loss_meters"),
  trainingEffect: real("training_effect"),
  sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp" }),
});

export const dailyHealth = sqliteTable("daily_health", {
  date: text("date").primaryKey(),
  sleepMinutes: integer("sleep_minutes"),
  restingHeartRate: integer("resting_heart_rate"),
  hrvStatus: text("hrv_status"),
  hrvMs: real("hrv_ms"),
  stressAvg: integer("stress_avg"),
  steps: integer("steps"),
  calories: integer("calories"),
  bodyBatteryAvg: integer("body_battery_avg"),
  availability: text("availability").notNull().default("partial"),
});

export const activityDetailAvailability = sqliteTable(
  "activity_detail_availability",
  {
    garminId: text("garmin_id").primaryKey(),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }),
    source: text("source").notNull(),
    status: text("status").notNull(),
    hasSession: integer("has_session", { mode: "boolean" })
      .notNull()
      .default(false),
    hasLaps: integer("has_laps", { mode: "boolean" }).notNull().default(false),
    hasStreams: integer("has_streams", { mode: "boolean" })
      .notNull()
      .default(false),
    hasGps: integer("has_gps", { mode: "boolean" }).notNull().default(false),
    hasElevation: integer("has_elevation", { mode: "boolean" })
      .notNull()
      .default(false),
    hasHeartRate: integer("has_heart_rate", { mode: "boolean" })
      .notNull()
      .default(false),
    hasGrade: integer("has_grade", { mode: "boolean" })
      .notNull()
      .default(false),
    hasPower: integer("has_power", { mode: "boolean" })
      .notNull()
      .default(false),
    hasRecovery: integer("has_recovery", { mode: "boolean" })
      .notNull()
      .default(false),
    recordCount: integer("record_count").notNull().default(0),
    lapCount: integer("lap_count").notNull().default(0),
    unavailableReason: text("unavailable_reason"),
    sessionJson: text("session_json"),
    derivedJson: text("derived_json"),
  },
);

export const activityDetailAttempt = sqliteTable("activity_detail_attempt", {
  garminId: text("garmin_id").primaryKey(),
  attemptedAt: integer("attempted_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  force: integer("force", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull(),
  detailStatus: text("detail_status"),
  retryable: integer("retryable", { mode: "boolean" }).notNull().default(false),
  errorClass: text("error_class"),
  errorMessage: text("error_message"),
  preservedPrevious: integer("preserved_previous", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const activityLap = sqliteTable("activity_lap", {
  garminId: text("garmin_id").notNull(),
  lapNumber: integer("lap_number").notNull(),
  startTime: text("start_time"),
  durationSec: real("duration_sec"),
  distanceMeters: real("distance_meters"),
  avgSpeedMps: real("avg_speed_mps"),
  avgHeartRate: real("avg_heart_rate"),
  maxHeartRate: real("max_heart_rate"),
  elevationGainMeters: real("elevation_gain_meters"),
  elevationLossMeters: real("elevation_loss_meters"),
  avgPowerWatts: real("avg_power_watts"),
  normalizedPowerWatts: real("normalized_power_watts"),
});

export const activityStreamPoint = sqliteTable("activity_stream_point", {
  garminId: text("garmin_id").notNull(),
  elapsedSec: integer("elapsed_sec").notNull(),
  timestamp: text("timestamp"),
  distanceMeters: real("distance_meters"),
  heartRate: integer("heart_rate"),
  speedMps: real("speed_mps"),
  altitudeMeters: real("altitude_meters"),
  gradePct: real("grade_pct"),
  lat: real("lat"),
  lon: real("lon"),
  cadence: real("cadence"),
  powerWatts: real("power_watts"),
  temperatureC: real("temperature_c"),
});

export const activityHrZoneTime = sqliteTable("activity_hr_zone_time", {
  garminId: text("garmin_id").notNull(),
  zone: integer("zone").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  seconds: integer("seconds").notNull(),
  sourceLowerBpm: integer("source_lower_bpm"),
  sourceTotalSeconds: integer("source_total_seconds").notNull(),
});

export const garminAthleteBaseline = sqliteTable("garmin_athlete_baseline", {
  id: text("id").primaryKey().default("default"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  source: text("source").notNull(),
  availability: text("availability").notNull(),
  configuredMaxHeartRateBpm: integer("configured_max_heart_rate_bpm"),
  heartRateZonesStatus: text("heart_rate_zones_status"),
  heartRateZonesFormula: text("heart_rate_zones_formula"),
  heartRateZonesJson: text("heart_rate_zones_json").notNull().default("[]"),
  cyclingFtpWatts: integer("cycling_ftp_watts"),
  cyclingFtpMeasuredOn: text("cycling_ftp_measured_on"),
  cyclingFtpSourceStale: integer("cycling_ftp_source_stale", {
    mode: "boolean",
  }),
  availableTrainingDaysJson: text("available_training_days_json")
    .notNull()
    .default("[]"),
  preferredLongTrainingDaysJson: text("preferred_long_training_days_json")
    .notNull()
    .default("[]"),
});

export const garminAthleteBaselineAttempt = sqliteTable(
  "garmin_athlete_baseline_attempt",
  {
    id: text("id").primaryKey().default("default"),
    attemptedAt: integer("attempted_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    preservedPrevious: integer("preserved_previous", { mode: "boolean" })
      .notNull()
      .default(false),
  },
);

export const garminRawPayload = sqliteTable("garmin_raw_payload", {
  id: text("id").primaryKey(),
  sourceTool: text("source_tool").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  contentType: text("content_type").notNull(),
  payloadJson: text("payload_json"),
  payloadText: text("payload_text"),
  sha256: text("sha256").notNull(),
  redactionVersion: integer("redaction_version").notNull(),
  redactedFieldCount: integer("redacted_field_count").notNull().default(0),
});

export const syncRun = sqliteTable("sync_run", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  coverageStart: text("coverage_start"),
  coverageEnd: text("coverage_end"),
  lastError: text("last_error"),
});

export const syncCheckpoint = sqliteTable("sync_checkpoint", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const conversation = sqliteTable("conversation", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  manualTitle: integer("manual_title", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const message = sqliteTable("message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  groundingJson: text("grounding_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const trainerProfile = sqliteTable("trainer_profile", {
  id: text("id").primaryKey().default("default"),
  goalsJson: text("goals_json").notNull().default("[]"),
  sportsJson: text("sports_json").notNull().default("[]"),
  preferencesJson: text("preferences_json").notNull().default("{}"),
  constraintsJson: text("constraints_json").notNull().default("[]"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const trainerMemory = sqliteTable("trainer_memory", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  value: text("value").notNull(),
  status: text("status").notNull(),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref"),
  provenanceText: text("provenance_text").notNull(),
  validFrom: integer("valid_from", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  reconfirmAfter: integer("reconfirm_after", { mode: "timestamp" }),
  supersedesId: text("supersedes_id"),
  supersededById: text("superseded_by_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const semanticMemory = sqliteTable("semantic_memory", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  status: text("status").notNull(),
  embeddingJson: text("embedding_json").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  sourceConversationId: text("source_conversation_id"),
  sourceMessageIdsJson: text("source_message_ids_json").notNull().default("[]"),
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const healthDateIdx = uniqueIndex("health_date_idx").on(
  dailyHealth.date,
);
