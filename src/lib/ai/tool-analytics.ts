import type { AnalyticsToolPorts } from "./tool-ports";
import { runMathAnalysis } from "./math-analysis";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolStep } from "./tool-types";

export function executeAnalyticsTool(
  input: Extract<
    TrainerToolExecutionInput,
    {
      toolName: "describeGarminDatabase" | "runReadOnlySql" | "runMathAnalysis";
    }
  >,
  ports: AnalyticsToolPorts,
): TrainerToolStep {
  switch (input.toolName) {
    case "describeGarminDatabase": {
      const result = ports.describeGarminDatabase();
      return {
        index: input.index,
        tool: input.toolName,
        status: "succeeded",
        summary: `Described ${result.tables.length} allowlisted analytical tables; forbidden auth/session/account/verification/secrets/path surfaces excluded.`,
        privacy: result.privacy,
        result,
      };
    }
    case "runReadOnlySql": {
      const result = ports.runReadOnlySql(input.input);
      if (result.status === "succeeded")
        input.context.analysisResults.set(result.resultName, result.rows);
      return {
        index: input.index,
        tool: input.toolName,
        status: result.status,
        summary:
          result.status === "succeeded"
            ? `Read-only SQL ${result.resultName}; returned ${result.returnedRows}/${result.rowCount} rows${result.truncated ? "; truncated" : ""}.`
            : `Read-only SQL rejected: ${result.reason ?? result.status}.`,
        privacy: result.privacy,
        reason: result.status === "succeeded" ? undefined : result.reason,
        correctionAllowed:
          result.status === "succeeded" ? undefined : result.correctionAllowed,
        correctionHint:
          result.status === "succeeded" ? undefined : result.correctionHint,
        failureMessage:
          result.status === "succeeded" ? undefined : result.message,
        result,
      };
    }
    case "runMathAnalysis": {
      const args = input.input;
      const result = runMathAnalysis({
        ...args,
        rowsByResult: input.context.analysisResults,
      });
      if (result.status === "succeeded")
        input.context.analysisResults.set(result.resultName, result.rows);
      return {
        index: input.index,
        tool: input.toolName,
        status: result.status,
        summary:
          result.status === "succeeded"
            ? `Math ${result.operation} ${result.resultName}; returned ${result.returnedRows}/${result.rowCount} rows${result.truncated ? "; truncated" : ""}.`
            : `Math analysis rejected: ${result.reason ?? result.status}.`,
        privacy: result.privacy,
        reason: result.status === "succeeded" ? undefined : result.reason,
        correctionAllowed:
          result.status === "succeeded" ? undefined : result.correctionAllowed,
        correctionHint:
          result.status === "succeeded" ? undefined : result.correctionHint,
        failureMessage:
          result.status === "succeeded" ? undefined : result.message,
        result,
      };
    }
  }
}
