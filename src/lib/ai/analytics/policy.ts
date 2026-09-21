import type {
  AnalysisCell,
  AnalysisRow,
  AnalysisResult,
  AnalysisColumnDescriptor,
} from "./contracts";
import { SQL_LIMITS } from "./contracts";
import { ANALYTICAL_SCHEMA, PRIVACY } from "./schema";

const ALLOWED_TABLES = new Set(Object.keys(ANALYTICAL_SCHEMA));
const FORBIDDEN_IDENTIFIERS = new Set([
  "user",
  "session",
  "account",
  "verification",
  "trainer_memory",
  "semantic_memory",
  "trainer_profile",
  "training_plan",
  "message",
  "conversation",
  "app_metadata",
  "sync_checkpoint",
  "sync_run",
  "garmin_raw_payload",
  "activity_detail_attempt",
  "garmin_athlete_baseline_attempt",
  "garmin_body_metric_attempt",
  "sqlite_master",
  "sqlite_schema",
  "pragma_table_info",
]);

export function clampRows(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return SQL_LIMITS.defaultRows;
  return Math.min(SQL_LIMITS.maxRows, Math.max(1, Math.trunc(value as number)));
}

export function safeResultName(value: string | undefined): string {
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

export function reject(
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

function skipWhitespace(sql: string, index: number): number {
  while (index < sql.length && /\s/.test(sql[index] ?? "")) index += 1;
  return index;
}

function readIdentifier(
  sql: string,
  index: number,
): { name: string; end: number } | null {
  const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(sql.slice(index));
  if (!match) return null;
  return { name: match[0].toLowerCase(), end: index + match[0].length };
}

function skipBalancedParentheses(sql: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let index = openIndex; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        const next = sql[index + 1];
        if (next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return sql.length;
}

function cteNamesForSql(sql: string): Set<string> {
  const names = new Set<string>();
  let index = skipWhitespace(sql, 0);
  if (!/^with\b/i.test(sql.slice(index))) return names;
  index += "with".length;
  index = skipWhitespace(sql, index);
  if (/^recursive\b/i.test(sql.slice(index))) {
    index += "recursive".length;
  }

  while (index < sql.length) {
    index = skipWhitespace(sql, index);
    const identifier = readIdentifier(sql, index);
    if (!identifier) break;
    names.add(identifier.name);
    index = skipWhitespace(sql, identifier.end);
    if (sql[index] === "(") {
      index = skipBalancedParentheses(sql, index);
      index = skipWhitespace(sql, index);
    }
    if (!/^as\b/i.test(sql.slice(index))) break;
    index += "as".length;
    index = skipWhitespace(sql, index);
    if (sql[index] !== "(") break;
    index = skipBalancedParentheses(sql, index);
    index = skipWhitespace(sql, index);
    if (sql[index] !== ",") break;
    index += 1;
  }

  return names;
}

type SqlValidationResult =
  { ok: true } | ({ ok: false; reason: string } & SqlFailureDetails);

function disallowedTableDetails(
  sql: string,
  tableRefs: string[],
): SqlFailureDetails {
  const disallowedRefs = Array.from(
    new Set(tableRefs.filter((table) => !ALLOWED_TABLES.has(table))),
  );
  if (
    !disallowedRefs.length ||
    disallowedRefs.some((table) => FORBIDDEN_IDENTIFIERS.has(table))
  ) {
    return {};
  }
  const schemaHints = schemaHintsForSql(sql);
  const allowedTables = Array.from(ALLOWED_TABLES).join(", ");
  const referencedTable = disallowedRefs[0];
  return {
    correctionAllowed: true,
    correctionHint:
      "Correct the SQL using exact allowlisted normalized Garmin analytical table/column names from describeGarminDatabase; for activity dates use activity.started_at, for daily totals use daily_health.date, and for HR-zone totals join activity_hr_zone_time to activity by garmin_id.",
    message: [
      sanitizedMessage("disallowed_table"),
      referencedTable ? `Referenced table: ${referencedTable}.` : "",
      `Allowed analytical tables: ${allowedTables}.`,
      ...schemaHints,
    ]
      .filter(Boolean)
      .join(" "),
    missingIdentifier: referencedTable,
    schemaHints,
  };
}

export function validateSql(sql: string): SqlValidationResult {
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
  const cteNames = cteNamesForSql(trimmed);
  const tableRefs = tableRefsForSql(trimmed).filter(
    (table) => !cteNames.has(table),
  );
  if (!tableRefs.length) return { ok: false, reason: "disallowed_table" };
  if (tableRefs.some((table) => !ALLOWED_TABLES.has(table)))
    return {
      ok: false,
      reason: "disallowed_table",
      ...disallowedTableDetails(trimmed, tableRefs),
    };
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

export function classifySqliteError(
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
      "Correct the SQL using exact allowlisted normalized Garmin analytical table/column names from describeGarminDatabase; for activity windows use activity.started_at, daily-health windows use daily_health.date, and HR-zone totals use activity_hr_zone_time joined to activity by garmin_id.",
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

export function interpretSqlRows(
  rawRows: Array<Record<string, unknown>>,
  columns: string[],
  maxRows: number,
  resultName: string,
): AnalysisResult {
  if (columns.length > SQL_LIMITS.maxColumns)
    return reject("too_many_columns", resultName);
  const normalizedRows = rawRows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, normalizeCell(value)]),
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
}
