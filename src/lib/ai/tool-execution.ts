import { executeMeasurementTool, executeWeeklyTool } from "./tool-weekly";
import { weeklyCalendar } from "../weekly/calendar";
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
      case "getWeeklyKpis":
      case "getKpiProgress":
        return executeWeeklyTool(input, ports.weekly);
      case "saveWeeklyDocuments":
      case "saveWeeklyKpis": {
        const step = executeWeeklyTool(input, ports.weekly);
        if (
          step.status === "succeeded" &&
          input.weeklyTurn &&
          ports.weekly &&
          ports.measurements
        ) {
          // Save already committed. This one best-effort effect must never
          // change its result or cause an uncertain/repeated weekly save.
          try {
            const week = weeklyCalendar(
              new Date(),
              input.weeklyTurn.timeZone,
            ).weekStart;
            const changes =
              input.toolName === "saveWeeklyKpis"
                ? [input.input]
                : (input.input.kpiChanges ?? []);
            if (
              changes.some(
                (change) =>
                  change.weekStart === week &&
                  change.commitment &&
                  change.commitment.origin !== "review-defined",
              ) &&
              ports.weekly.readKpis(week).latestId !==
                input.kpiSnapshots?.find((read) => read.weekStart === week)
                  ?.latestId
            ) {
              await ports.measurements.refresh(input.weeklyTurn.timeZone, week);
            }
          } catch {
            /* Measurement failure does not undo a confirmed save. */
          }
        }
        return step;
      }
      case "saveKpiRecipes":
      case "refreshKpiMeasurements":
        return await executeMeasurementTool(input, ports.measurements);
      case "analyzeActivityTerrain":
      case "describeGarminDatabase":
      case "runReadOnlySql":
      case "runMathAnalysis":
        return executeAnalyticsTool(input, ports.analytics);
      case "runGarminSync":
      case "getSyncStatus":
      case "verifyActivityReference":
      case "forceRefreshActivityDetail":
      case "getActivityDetailAvailability":
      case "getActivityDashboard":
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
