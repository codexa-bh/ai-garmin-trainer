// Production composition/compatibility entry point: only guarded operations escape.
import { createSqlAnalysis } from "./analytics/application";
import { createSqliteAnalyticalExecution } from "./analytics/sqlite-execution";

export type { AnalysisRow } from "./analytics/contracts";

export const { describeGarminDatabase, runReadOnlySql } = createSqlAnalysis(
  createSqliteAnalyticalExecution(),
  () => Date.now(),
);
