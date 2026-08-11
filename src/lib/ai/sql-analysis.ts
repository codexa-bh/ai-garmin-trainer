import Database from "better-sqlite3";
import { getOptionalEnv } from "@/lib/env";
import { getDatabase } from "@/lib/db/repository";

export type AnalysisCell = string | number | boolean | null;
export type AnalysisRow = Record<string, AnalysisCell>;

export type AnalysisColumnDescriptor = {
  name: string;
  type?: string;
  unit?: string;
  nullable?: boolean;
  note?: string;
};

export type AnalysisResult = {
  status: "succeeded" | "rejected" | "failed";
  resultName: string;
  columns: AnalysisColumnDescriptor[];
  rows: AnalysisRow[];
  rowCount: number;
  returnedRows: number;
  truncated: boolean;
  reason?: string;
  message?: string;
  correctionAllowed?: boolean;
  correctionHint?: string;
  sqliteMessage?: string;
  missingIdentifier?: string;
  schemaHints?: string[];
  privacy: string;
};

export type SchemaTableDescriptor = {
  name: string;
  description: string;
  rowCount: number;
  dateRange?: { min: string | null; max: string | null };
  columns: AnalysisColumnDescriptor[];
  joins?: string[];
};

export type GarminDatabaseDescription = {
  tool: "describeGarminDatabase";
  status: "succeeded";
  tables: SchemaTableDescriptor[];
  forbiddenDataClasses: string[];
  examples: string[];
  limits: typeof SQL_LIMITS;
  privacy: string;
};

export const SQL_LIMITS = {
  maxSqlBytes: 6000,
  defaultRows: 50,
  maxRows: 200,
  maxColumns: 32,
  maxBytes: 60_000,
  timeoutMs: 750,
};

const PRIVACY =
  "Read-only local SQLite analytics over allowlisted normalized Garmin tables only, including bounded normalized GPS route coordinates when route/GPS evidence is requested; auth/session/account/verification, secrets, connector credentials, raw payloads, and filesystem paths are excluded.";

const FORBIDDEN_DATA_CLASSES = [
  "auth/session/account/verification rows",
  "secrets, tokens, passwords, cookies, provider credentials, and connector handles",
  "filesystem paths, database paths, environment variables, process/network access",
  "raw unrestricted FIT streams, unrestricted GPS stream dumps, or raw Garmin connector payload dumps",
];

const ANALYTICAL_SCHEMA: Record<
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
      { name: "training_effect", type: "real", nullable: true },
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
      { name: "body_battery_avg", type: "integer", nullable: true },
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
      { name: "status", type: "text" },
      { name: "has_session", type: "integer", note: "0/1 boolean" },
      { name: "has_laps", type: "integer", note: "0/1 boolean" },
      { name: "has_streams", type: "integer", note: "0/1 boolean" },
      { name: "has_gps", type: "integer", note: "0/1 boolean" },
      { name: "has_heart_rate", type: "integer", note: "0/1 boolean" },
      { name: "record_count", type: "integer" },
      { name: "lap_count", type: "integer" },
      { name: "unavailable_reason", type: "text", nullable: true },
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
      { name: "heart_rate", type: "integer", unit: "bpm", nullable: true },
      { name: "speed_mps", type: "real", unit: "m/s", nullable: true },
      { name: "altitude_meters", type: "real", unit: "meters", nullable: true },
      { name: "grade_pct", type: "real", unit: "%", nullable: true },
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
    ],
    joins: ["activity_stream_point.garmin_id = activity.garmin_id"],
  },
  garmin_athlete_baseline: {
    name: "garmin_athlete_baseline",
    description:
      "Single normalized athlete baseline values when available; excludes connector credentials and raw account data.",
    columns: [
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
      { name: "heart_rate_zones_status", type: "text", nullable: true },
      { name: "available_training_days_json", type: "text", nullable: true },
      {
        name: "preferred_long_training_days_json",
        type: "text",
        nullable: true,
      },
    ],
  },
};

const ALLOWED_TABLES = new Set(Object.keys(ANALYTICAL_SCHEMA));
const FORBIDDEN_IDENTIFIERS = new Set([
  "user",
  "session",
  "account",
  "verification",
  "trainer_memory",
  "message",
  "conversation",
  "sync_checkpoint",
  "sync_run",
  "garmin_raw_payload",
  "activity_detail_attempt",
  "garmin_athlete_baseline_attempt",
  "sqlite_master",
  "sqlite_schema",
  "pragma_table_info",
]);

function readonlyDb(): Database.Database {
  getDatabase();
  const path = getOptionalEnv().DATABASE_PATH;
  const db = new Database(path, {
    readonly: true,
    fileMustExist: true,
    timeout: SQL_LIMITS.timeoutMs,
  });
  db.pragma("query_only = ON");
  return db;
}

function clampRows(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return SQL_LIMITS.defaultRows;
  return Math.min(SQL_LIMITS.maxRows, Math.max(1, Math.trunc(value as number)));
}

function safeResultName(value: string | undefined): string {
  const cleaned = (value ?? "sql_result")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "sql_result";
}

function sanitizedMessage(reason: string): string {
  const messages: Record<string, string> = {
    oversized_sql: "SQL text is too large for the local analytics tool.",
    comments_denied: "SQL comments are not accepted by this bounded tool.",
    multi_statement: "Use exactly one read-only SELECT statement.",
    unsafe_statement:
      "Only SELECT or WITH ... SELECT analytical queries are allowed.",
    forbidden_token:
      "The query requested a mutation, pragma, attach/load, or other forbidden operation.",
    disallowed_table:
      "The query referenced a table outside the analytical allowlist.",
    too_many_columns:
      "The query returned too many columns for bounded evidence.",
    too_many_bytes: "The result was larger than the bounded evidence cap.",
    timeout: "The query exceeded the local runtime guard.",
    unknown_column:
      "SQLite rejected the query because it referenced an unknown column.",
    unknown_table:
      "SQLite rejected the query because it referenced an unknown table.",
    ambiguous_column:
      "SQLite rejected the query because a column name was ambiguous.",
    syntax_error: "SQLite rejected the query syntax.",
    sql_error: "SQLite rejected the bounded query.",
  };
  return messages[reason] ?? "The query was rejected by local SQL guardrails.";
}

type SqlFailureDetails = {
  message?: string;
  correctionAllowed?: boolean;
  correctionHint?: string;
  sqliteMessage?: string;
  missingIdentifier?: string;
  schemaHints?: string[];
};

function reject(
  reason: string,
  resultName = "sql_result",
  details: SqlFailureDetails = {},
): AnalysisResult {
  return {
    status: "rejected",
    resultName,
    columns: [],
    rows: [],
    rowCount: 0,
    returnedRows: 0,
    truncated: false,
    reason,
    message: details.message ?? sanitizedMessage(reason),
    correctionAllowed: details.correctionAllowed,
    correctionHint: details.correctionHint,
    sqliteMessage: details.sqliteMessage,
    missingIdentifier: details.missingIdentifier,
    schemaHints: details.schemaHints,
    privacy: PRIVACY,
  };
}

function hasComments(sql: string): boolean {
  return /--|\/\*|\*\//.test(sql);
}

function hasMultipleStatements(sql: string): boolean {
  const trimmed = sql.trim();
  const withoutOneTrailing = trimmed.endsWith(";")
    ? trimmed.slice(0, -1)
    : trimmed;
  return withoutOneTrailing.includes(";");
}

function normalizedTokens(sql: string): string[] {
  return Array.from(sql.toLowerCase().matchAll(/[a-z_][a-z0-9_]*/g)).map(
    (match) => match[0],
  );
}

function tableRefsForSql(sql: string): string[] {
  return Array.from(
    sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi),
  ).map((match) => match[1].toLowerCase());
}

function validateSql(
  sql: string,
): { ok: true } | { ok: false; reason: string } {
  const encodedBytes = new TextEncoder().encode(sql).length;
  if (encodedBytes > SQL_LIMITS.maxSqlBytes)
    return { ok: false, reason: "oversized_sql" };
  if (hasComments(sql)) return { ok: false, reason: "comments_denied" };
  if (hasMultipleStatements(sql))
    return { ok: false, reason: "multi_statement" };
  const trimmed = sql.trim().replace(/;$/, "").trim();
  if (!/^(select|with)\b/i.test(trimmed))
    return { ok: false, reason: "unsafe_statement" };
  const tokens = normalizedTokens(trimmed);
  const forbiddenTokens = new Set([
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "create",
    "replace",
    "truncate",
    "vacuum",
    "reindex",
    "analyze",
    "attach",
    "detach",
    "pragma",
    "load_extension",
    "load",
    "returning",
  ]);
  if (tokens.some((token) => forbiddenTokens.has(token)))
    return { ok: false, reason: "forbidden_token" };
  if (tokens.some((token) => FORBIDDEN_IDENTIFIERS.has(token)))
    return { ok: false, reason: "disallowed_table" };
  const tableRefs = tableRefsForSql(trimmed);
  if (
    !tableRefs.length ||
    tableRefs.some((table) => !ALLOWED_TABLES.has(table))
  )
    return { ok: false, reason: "disallowed_table" };
  return { ok: true };
}

function schemaHintsForSql(sql: string): string[] {
  const tableRefs = tableRefsForSql(sql).filter((table) =>
    ALLOWED_TABLES.has(table),
  );
  const uniqueRefs = Array.from(new Set(tableRefs));
  const tables = uniqueRefs.length ? uniqueRefs : ["activity"];
  return tables.slice(0, 3).map((table) => {
    const columns = ANALYTICAL_SCHEMA[table]?.columns.map((column) =>
      column.unit ? `${column.name} (${column.unit})` : column.name,
    );
    return columns?.length
      ? `Allowed ${table} columns: ${columns.join(", ")}.`
      : `Allowed analytical tables: ${Array.from(ALLOWED_TABLES).join(", ")}.`;
  });
}

function compactSqliteMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(?:[A-Za-z]:)?(?:\/[\w .:@-]+)+/g, "<redacted path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function classifySqliteError(
  error: unknown,
  sql: string,
): { reason: string } & SqlFailureDetails {
  const sqliteMessage = compactSqliteMessage(error);
  const lower = sqliteMessage.toLowerCase();
  let reason = "sql_error";
  let missingIdentifier: string | undefined;
  const missingColumn = /no such column:\s*([A-Za-z_][A-Za-z0-9_.]*)/i.exec(
    sqliteMessage,
  );
  const missingTable = /no such table:\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(
    sqliteMessage,
  );
  const ambiguousColumn =
    /ambiguous column name:\s*([A-Za-z_][A-Za-z0-9_.]*)/i.exec(sqliteMessage);
  if (missingColumn) {
    reason = "unknown_column";
    missingIdentifier = missingColumn[1];
  } else if (missingTable) {
    reason = "unknown_table";
    missingIdentifier = missingTable[1];
  } else if (ambiguousColumn) {
    reason = "ambiguous_column";
    missingIdentifier = ambiguousColumn[1];
  } else if (lower.includes("syntax error")) {
    reason = "syntax_error";
  }
  const schemaHints = schemaHintsForSql(sql);
  const detailParts = [
    `${sanitizedMessage(reason)} SQLite detail: ${sqliteMessage}.`,
  ];
  if (missingIdentifier)
    detailParts.push(`Referenced identifier: ${missingIdentifier}.`);
  detailParts.push(...schemaHints);
  return {
    reason,
    message: detailParts.join(" "),
    correctionAllowed: true,
    correctionHint:
      "Correct the SQL using exact allowlisted table/column names from describeGarminDatabase; for last-365-days activity windows use started_at >= unixepoch('now', '-365 days') * 1000.",
    sqliteMessage,
    missingIdentifier,
    schemaHints,
  };
}

function describeColumns(rows: AnalysisRow[]): AnalysisColumnDescriptor[] {
  const first = rows[0] ?? {};
  return Object.keys(first).map((name) => ({ name }));
}

function normalizeCell(value: unknown): AnalysisCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string")
    return value.length > 500 ? `${value.slice(0, 499)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  return JSON.stringify(value).slice(0, 500);
}

function rowBytes(rows: AnalysisRow[]): number {
  return new TextEncoder().encode(JSON.stringify(rows)).length;
}

export function describeGarminDatabase(): GarminDatabaseDescription {
  const db = readonlyDb();
  try {
    const tables = Object.values(ANALYTICAL_SCHEMA).map((descriptor) => {
      const row = db
        .prepare(`select count(*) as count from ${descriptor.name}`)
        .get() as { count: number };
      let dateRange: { min: string | null; max: string | null } | undefined;
      if (descriptor.name === "activity") {
        dateRange = db
          .prepare(
            "select date(min(started_at) / 1000, 'unixepoch') as min, date(max(started_at) / 1000, 'unixepoch') as max from activity",
          )
          .get() as { min: string | null; max: string | null };
      } else if (descriptor.name === "daily_health") {
        dateRange = db
          .prepare(
            "select min(date) as min, max(date) as max from daily_health",
          )
          .get() as { min: string | null; max: string | null };
      }
      return { ...descriptor, rowCount: row.count, dateRange };
    });
    return {
      tool: "describeGarminDatabase",
      status: "succeeded",
      tables,
      forbiddenDataClasses: FORBIDDEN_DATA_CLASSES,
      examples: [
        "select garmin_id, name, sport, date(started_at / 1000, 'unixepoch') as date, duration_sec from activity order by duration_sec desc limit 10",
        "select garmin_id, coalesce(name, sport || ' on ' || date(started_at / 1000, 'unixepoch')) as label, name, sport, date(started_at / 1000, 'unixepoch') as date, duration_sec, distance_meters, calories, avg_heart_rate, max_heart_rate, elevation_gain_meters, elevation_loss_meters, training_effect from activity where started_at >= unixepoch('now', '-365 days') * 1000 order by started_at desc limit 200 -- then use runMathAnalysis score/normalize with a transparent model-selected formula over these columns, e.g. duration_sec + distance_meters + elevation_gain_meters + calories + avg_heart_rate + max_heart_rate + training_effect",
        "select sport, count(*) as activities, avg(duration_sec) as avg_duration_sec from activity group by sport order by activities desc",
        "select a.garmin_id, a.name, d.status, d.record_count from activity a join activity_detail_availability d on d.garmin_id = a.garmin_id limit 20",
      ],
      limits: SQL_LIMITS,
      privacy: PRIVACY,
    };
  } finally {
    db.close();
  }
}

export function runReadOnlySql(input: {
  sql: string;
  purpose?: string;
  maxRows?: number;
  resultName?: string;
}): AnalysisResult {
  const resultName = safeResultName(input.resultName);
  const validation = validateSql(input.sql);
  if (!validation.ok) return reject(validation.reason, resultName);

  const maxRows = clampRows(input.maxRows);
  const sql = input.sql.trim().replace(/;$/, "");
  const db = readonlyDb();
  const start = Date.now();
  try {
    const stmt = db.prepare(sql);
    stmt.safeIntegers(false);
    const rawRows = stmt.all() as Array<Record<string, unknown>>;
    if (Date.now() - start > SQL_LIMITS.timeoutMs)
      return { ...reject("timeout", resultName), status: "failed" };
    const columns = rawRows.length
      ? Object.keys(rawRows[0])
      : stmt.columns().map((column) => column.name);
    if (columns.length > SQL_LIMITS.maxColumns)
      return reject("too_many_columns", resultName);
    const normalizedRows = rawRows.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            normalizeCell(value),
          ]),
        ) as AnalysisRow,
    );
    let rows = normalizedRows.slice(0, maxRows);
    let truncated = normalizedRows.length > maxRows;
    while (rowBytes(rows) > SQL_LIMITS.maxBytes && rows.length > 0) {
      rows = rows.slice(0, -1);
      truncated = true;
    }
    if (!rows.length && normalizedRows.length)
      return reject("too_many_bytes", resultName);
    return {
      status: "succeeded",
      resultName,
      columns: rows.length
        ? describeColumns(rows)
        : columns.map((name) => ({ name })),
      rows,
      rowCount: normalizedRows.length,
      returnedRows: rows.length,
      truncated,
      privacy: PRIVACY,
    };
  } catch (error) {
    const details = classifySqliteError(error, sql);
    return {
      ...reject(details.reason, resultName, details),
      status: "failed",
    };
  } finally {
    db.close();
  }
}
