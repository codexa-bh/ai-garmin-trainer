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

export type SqlAnalysisInput = {
  sql: string;
  purpose?: string;
  maxRows?: number;
  resultName?: string;
};

// Consumer-owned capabilities: no Database or Statement crosses this boundary.
// A session belongs to one admitted query and is closed by the application.
export type AnalyticalQuerySession = {
  readRows(sql: string): Array<Record<string, unknown>>;
  readColumnNames(): string[];
  close(): void;
};
export type AnalyticalTableStatistics = Pick<
  SchemaTableDescriptor,
  "rowCount" | "dateRange"
>;
export type AnalyticalExecution = {
  openQuery(): AnalyticalQuerySession;
  inspectTables(): Record<string, AnalyticalTableStatistics>;
};
