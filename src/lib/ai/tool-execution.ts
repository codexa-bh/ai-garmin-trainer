import { executeAnalyticsTool } from "./tool-analytics";
import { executeLocalDataTool } from "./tool-local-data";
import { executeTrainingPlanTool } from "./tool-training-plan";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolStep } from "./tool-types";

/** Executes an admitted, parsed call; orchestration retains all admission policy. */
export async function executeTrainerTool(
  input: TrainerToolExecutionInput,
): Promise<TrainerToolStep> {
  try {
    switch (input.toolName) {
      case "describeGarminDatabase":
      case "runReadOnlySql":
      case "runMathAnalysis":
        return executeAnalyticsTool(input);
      case "runGarminSync":
      case "getSyncStatus":
      case "verifyActivityReference":
      case "forceRefreshActivityDetail":
      case "getActivityDetailAvailability":
      case "getActivityDetailSlice":
        return await executeLocalDataTool(input);
      case "getTrainingPlan":
      case "saveTrainingPlan":
        return executeTrainingPlanTool(input);
    }
  } catch {
    return {
      index: input.index,
      tool: input.toolName,
      status: "failed",
      summary: `${input.toolName} failed before returning bounded evidence.`,
      privacy:
        "No raw provider, connector, credential, or stream details are exposed in this failure.",
      reason: "tool_exception",
    };
  }
}
