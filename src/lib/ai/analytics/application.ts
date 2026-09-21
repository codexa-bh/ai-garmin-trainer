import type {
  AnalyticalExecution,
  AnalysisResult,
  SqlAnalysisInput,
} from "./contracts";
import { SQL_LIMITS } from "./contracts";
import { describeAnalyticalSchema } from "./schema";
import {
  safeResultName,
  validateSql,
  reject,
  clampRows,
  interpretSqlRows,
  classifySqliteError,
} from "./policy";

export function createSqlAnalysis(
  execution: AnalyticalExecution,
  now: () => number,
) {
  return {
    describeGarminDatabase: () =>
      describeAnalyticalSchema(execution.inspectTables()),
    runReadOnlySql(input: SqlAnalysisInput): AnalysisResult {
      const resultName = safeResultName(input.resultName);
      const validation = validateSql(input.sql);
      if (!validation.ok)
        return reject(validation.reason, resultName, validation);

      const maxRows = clampRows(input.maxRows);
      const sql = input.sql.trim().replace(/;$/, "");
      // Keep initialization/open and the first clock read outside the catch/finally.
      const session = execution.openQuery();
      const start = now();
      try {
        const rawRows = session.readRows(sql);
        if (now() - start > SQL_LIMITS.timeoutMs)
          return { ...reject("timeout", resultName), status: "failed" };
        const columns = rawRows.length
          ? Object.keys(rawRows[0])
          : session.readColumnNames();
        return interpretSqlRows(rawRows, columns, maxRows, resultName);
      } catch (error) {
        const details = classifySqliteError(error, sql);
        return {
          ...reject(details.reason, resultName, details),
          status: "failed",
        };
      } finally {
        session.close();
      }
    },
  };
}
