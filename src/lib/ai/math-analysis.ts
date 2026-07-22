import type { AnalysisCell, AnalysisRow } from "@/lib/ai/sql-analysis";

export type MathAnalysisOperation =
  | "score"
  | "normalize"
  | "aggregate"
  | "correlate"
  | "summarize"
  | "customFormula";

export type MathAnalysisResult = {
  status: "succeeded" | "rejected" | "failed";
  resultName: string;
  inputResult: string;
  operation: MathAnalysisOperation;
  rows: AnalysisRow[];
  rowCount: number;
  returnedRows: number;
  truncated: boolean;
  reason?: string;
  message?: string;
  privacy: string;
};

const PRIVACY =
  "Bounded TypeScript math over same-turn SQL result rows only; no filesystem, network, process, environment, database, connector, or arbitrary script access.";

const MATH_LIMITS = {
  maxInputRows: 200,
  maxOutputRows: 100,
  maxFormulaBytes: 800,
  maxOutputBytes: 60_000,
};

const OPTIONAL_ACTIVITY_METRIC_COLUMNS = new Set([
  "duration_sec",
  "distance_meters",
  "calories",
  "avg_heart_rate",
  "max_heart_rate",
  "steps",
  "elevation_gain_meters",
  "elevation_loss_meters",
  "training_effect",
]);

const FORMULA_COLUMN_ALIASES: Record<string, string> = {
  duration: "duration_sec",
  duration_seconds: "duration_sec",
  time_sec: "duration_sec",
  distance: "distance_meters",
  distance_m: "distance_meters",
  elevation: "elevation_gain_meters",
  elevation_gain: "elevation_gain_meters",
  elevation_gain_m: "elevation_gain_meters",
  elevation_loss: "elevation_loss_meters",
  elevation_loss_m: "elevation_loss_meters",
  avg_hr: "avg_heart_rate",
  average_heart_rate: "avg_heart_rate",
  heart_rate: "avg_heart_rate",
  max_hr: "max_heart_rate",
  maximum_heart_rate: "max_heart_rate",
  training_effect_score: "training_effect",
  kcal: "calories",
};

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "paren"; value: "(" | ")" };

function safeResultName(value: string | undefined): string {
  const cleaned = (value ?? "math_result")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "math_result";
}

function resultHandleKey(value: string): string {
  return safeResultName(value).replace(/[_-]+/g, "");
}

function resolveRowsByResult(
  rowsByResult: Map<string, AnalysisRow[]>,
  inputResult: string,
): AnalysisRow[] | undefined {
  return (
    rowsByResult.get(inputResult) ??
    rowsByResult.get(safeResultName(inputResult)) ??
    Array.from(rowsByResult.entries()).find(
      ([name]) => resultHandleKey(name) === resultHandleKey(inputResult),
    )?.[1]
  );
}

function reject(
  reason: string,
  inputResult: string,
  operation: MathAnalysisOperation,
  resultName: string,
): MathAnalysisResult {
  const messages: Record<string, string> = {
    unknown_result:
      "The requested SQL result handle is not available in this user turn.",
    oversized_input: "The SQL result is too large for bounded math analysis.",
    missing_formula:
      "This math operation needs a bounded formula over SQL result columns.",
    unsafe_formula:
      "The formula can contain only numbers, column names, parentheses, and + - * / operators.",
    unknown_column:
      "The formula or ordering referenced a column not present in the SQL result.",
    non_numeric_column:
      "The requested math column contains missing or non-numeric values.",
    non_finite_output: "The math formula produced a non-finite value.",
    unsupported_operation: "That bounded math operation is not supported.",
    oversized_output: "The math result exceeded the bounded evidence cap.",
  };
  return {
    status: "rejected",
    resultName,
    inputResult,
    operation,
    rows: [],
    rowCount: 0,
    returnedRows: 0,
    truncated: false,
    reason,
    message:
      messages[reason] ?? "The math request was rejected by local guardrails.",
    privacy: PRIVACY,
  };
}

function tokenize(formula: string): Token[] | null {
  if (new TextEncoder().encode(formula).length > MATH_LIMITS.maxFormulaBytes)
    return null;
  const tokens: Token[] = [];
  let index = 0;
  while (index < formula.length) {
    const char = formula[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = formula.slice(index).match(/^\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = formula.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens.length ? tokens : null;
}

function precedence(operator: string): number {
  return operator === "*" || operator === "/" ? 2 : 1;
}

function toRpn(tokens: Token[]): Token[] | null {
  const output: Token[] = [];
  const operators: Token[] = [];
  for (const token of tokens) {
    if (token.type === "number" || token.type === "identifier")
      output.push(token);
    else if (token.type === "operator") {
      while (
        operators.at(-1)?.type === "operator" &&
        precedence((operators.at(-1) as { value: string }).value) >=
          precedence(token.value)
      ) {
        output.push(operators.pop() as Token);
      }
      operators.push(token);
    } else if (token.value === "(") operators.push(token);
    else {
      while (operators.length && operators.at(-1)?.type !== "paren")
        output.push(operators.pop() as Token);
      if (!operators.length) return null;
      operators.pop();
    }
  }
  while (operators.length) {
    const token = operators.pop() as Token;
    if (token.type === "paren") return null;
    output.push(token);
  }
  return output;
}

function numeric(value: AnalysisCell): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericForFormula(value: AnalysisCell): number | null {
  if (value === null || value === undefined) return 0;
  return numeric(value);
}

function formulaColumnName(identifier: string): string {
  return FORMULA_COLUMN_ALIASES[identifier] ?? identifier;
}

function evaluateRpn(rpn: Token[], row: AnalysisRow): number | null {
  const stack: number[] = [];
  for (const token of rpn) {
    if (token.type === "number") stack.push(token.value);
    else if (token.type === "identifier") {
      const value = numericForFormula(row[formulaColumnName(token.value)]);
      if (value === null) return null;
      stack.push(value);
    } else if (token.type === "operator") {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) return null;
      const value =
        token.value === "+"
          ? left + right
          : token.value === "-"
            ? left - right
            : token.value === "*"
              ? left * right
              : left / right;
      if (!Number.isFinite(value)) return null;
      stack.push(value);
    }
  }
  return stack.length === 1 && Number.isFinite(stack[0]) ? stack[0] : null;
}

function rowBytes(rows: AnalysisRow[]): number {
  return new TextEncoder().encode(JSON.stringify(rows)).length;
}

function orderFieldName(field: string, rows: AnalysisRow[]): string {
  if (field === "normalized_score") return "normalizedScore";
  if (
    field !== "score" &&
    field.endsWith("_score") &&
    rows.some((row) => Object.prototype.hasOwnProperty.call(row, "score"))
  )
    return "score";
  return field;
}

function applyOrder(
  rows: AnalysisRow[],
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>,
): AnalysisRow[] | null {
  if (!orderBy?.length) return rows;
  const normalizedOrderBy = orderBy.map((order) => ({
    ...order,
    field: orderFieldName(order.field, rows),
  }));
  const sorted = [...rows];
  for (const order of normalizedOrderBy) {
    if (
      !rows.every((row) =>
        Object.prototype.hasOwnProperty.call(row, order.field),
      )
    )
      return null;
  }
  sorted.sort((left, right) => {
    for (const order of normalizedOrderBy) {
      const l = left[order.field];
      const r = right[order.field];
      if (l === r) continue;
      const direction = order.direction === "asc" ? 1 : -1;
      if (typeof l === "number" && typeof r === "number")
        return (l - r) * direction;
      return String(l ?? "").localeCompare(String(r ?? "")) * direction;
    }
    return 0;
  });
  return sorted;
}

function capRows(
  rows: AnalysisRow[],
  limit: number,
): { rows: AnalysisRow[]; truncated: boolean } | null {
  let capped = rows.slice(
    0,
    Math.min(Math.max(1, limit), MATH_LIMITS.maxOutputRows),
  );
  let truncated = rows.length > capped.length;
  while (rowBytes(capped) > MATH_LIMITS.maxOutputBytes && capped.length) {
    capped = capped.slice(0, -1);
    truncated = true;
  }
  return capped.length || !rows.length ? { rows: capped, truncated } : null;
}

function formulaRows(
  rows: AnalysisRow[],
  formula: string,
  scoreField = "score",
): AnalysisRow[] | string {
  const tokens = tokenize(formula);
  if (!tokens) return "unsafe_formula";
  const columns = new Set(Object.keys(rows[0] ?? {}));
  for (const token of tokens) {
    if (token.type !== "identifier") continue;
    const column = formulaColumnName(token.value);
    if (!columns.has(column) && !OPTIONAL_ACTIVITY_METRIC_COLUMNS.has(column))
      return "unknown_column";
  }
  const rpn = toRpn(tokens);
  if (!rpn) return "unsafe_formula";
  const output: AnalysisRow[] = [];
  for (const row of rows) {
    const value = evaluateRpn(rpn, row);
    if (value === null) return "non_numeric_column";
    output.push({ ...row, [scoreField]: Number(value.toFixed(6)) });
  }
  return output;
}

function summarizeRows(rows: AnalysisRow[]): AnalysisRow[] {
  const columns = Object.keys(rows[0] ?? {});
  const result: AnalysisRow[] = [];
  for (const column of columns) {
    const values = rows
      .map((row) => numeric(row[column]))
      .filter((value): value is number => value !== null);
    if (!values.length) continue;
    const sum = values.reduce((total, value) => total + value, 0);
    result.push({
      column,
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Number((sum / values.length).toFixed(6)),
      sum: Number(sum.toFixed(6)),
    });
  }
  return result;
}

function aggregateRows(
  rows: AnalysisRow[],
  groupBy: string[] | undefined,
): AnalysisRow[] | string {
  if (!groupBy?.length) return "unknown_column";
  const columns = new Set(Object.keys(rows[0] ?? {}));
  if (groupBy.some((field) => !columns.has(field))) return "unknown_column";
  const groups = new Map<string, AnalysisRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(groupBy.map((field) => row[field]));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.entries()).map(([key, group]) => {
    const values = JSON.parse(key) as AnalysisCell[];
    const base: AnalysisRow = Object.fromEntries(
      groupBy.map((field, index) => [field, values[index]]),
    );
    return {
      ...base,
      rowCount: group.length,
      numericColumns: summarizeRows(group).length,
    };
  });
}

export function runMathAnalysis(input: {
  inputResult: string;
  operation: MathAnalysisOperation;
  formula?: string;
  groupBy?: string[];
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
  limit?: number;
  outputName?: string;
  rowsByResult: Map<string, AnalysisRow[]>;
}): MathAnalysisResult {
  const resultName = safeResultName(input.outputName);
  const rows = resolveRowsByResult(input.rowsByResult, input.inputResult);
  if (!rows)
    return reject(
      "unknown_result",
      input.inputResult,
      input.operation,
      resultName,
    );
  if (rows.length > MATH_LIMITS.maxInputRows)
    return reject(
      "oversized_input",
      input.inputResult,
      input.operation,
      resultName,
    );

  let output: AnalysisRow[] | string;
  if (
    input.operation === "score" ||
    input.operation === "customFormula" ||
    input.operation === "normalize"
  ) {
    if (!input.formula)
      return reject(
        "missing_formula",
        input.inputResult,
        input.operation,
        resultName,
      );
    output = formulaRows(
      rows,
      input.formula,
      input.operation === "normalize" ? "normalizedScore" : "score",
    );
    if (Array.isArray(output) && input.operation === "normalize") {
      const values = output
        .map((row) => numeric(row.normalizedScore))
        .filter((value): value is number => value !== null);
      const min = Math.min(...values);
      const max = Math.max(...values);
      output = output.map((row) => ({
        ...row,
        normalizedScore:
          max === min
            ? 1
            : Number(
                (((row.normalizedScore as number) - min) / (max - min)).toFixed(
                  6,
                ),
              ),
      }));
    }
  } else if (
    input.operation === "summarize" ||
    input.operation === "correlate"
  ) {
    output = summarizeRows(rows);
  } else if (input.operation === "aggregate") {
    output = aggregateRows(rows, input.groupBy);
  } else output = "unsupported_operation";

  if (!Array.isArray(output))
    return reject(output, input.inputResult, input.operation, resultName);
  const defaultOrder =
    input.operation === "score" || input.operation === "customFormula"
      ? [{ field: "score", direction: "desc" } as const]
      : input.operation === "normalize"
        ? [{ field: "normalizedScore", direction: "desc" } as const]
        : undefined;
  const ordered = applyOrder(output, input.orderBy ?? defaultOrder);
  if (!ordered)
    return reject(
      "unknown_column",
      input.inputResult,
      input.operation,
      resultName,
    );
  const capped = capRows(ordered, input.limit ?? 10);
  if (!capped)
    return reject(
      "oversized_output",
      input.inputResult,
      input.operation,
      resultName,
    );
  if (
    capped.rows.some((row) =>
      Object.values(row).some(
        (value) => typeof value === "number" && !Number.isFinite(value),
      ),
    )
  ) {
    return reject(
      "non_finite_output",
      input.inputResult,
      input.operation,
      resultName,
    );
  }
  return {
    status: "succeeded",
    resultName,
    inputResult: input.inputResult,
    operation: input.operation,
    rows: capped.rows,
    rowCount: ordered.length,
    returnedRows: capped.rows.length,
    truncated: capped.truncated,
    privacy: PRIVACY,
  };
}
