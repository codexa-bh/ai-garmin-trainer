import { executeWeeklyTool } from "./tool-weekly";
import { executeAnalyticsTool } from "./tool-analytics";
import { executeLocalDataTool } from "./tool-local-data";
import { executeTrainingPlanTool } from "./tool-training-plan";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolStep } from "./tool-types";
import type { TrainerToolPorts } from "./tool-ports";

/** Executes an admitted, parsed call; orchestration retains all admission policy. */
export async function executeTrainerTool(
  input: TrainerToolExecutionInput,
  ports: TrainerToolPorts,
): Promise<TrainerToolStep> {
  try {
    switch (input.toolName) {
      case "getWeeklyPlan":
      case "saveWeeklyDocuments":
        return executeWeeklyTool(input, ports.weekly);
      case "describeGarminDatabase":
      case "runReadOnlySql":
      case "runMathAnalysis":
        return executeAnalyticsTool(input, ports.analytics);
      case "runGarminSync":
      case "getSyncStatus":
      case "verifyActivityReference":
      case "forceRefreshActivityDetail":
      case "getActivityDetailAvailability":
      case "getActivityDetailSlice":
        return await executeLocalDataTool(input, ports.localData);
      case "getTrainingPlan":
      case "saveTrainingPlan":
        return executeTrainingPlanTool(input, ports.trainingPlan);
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
