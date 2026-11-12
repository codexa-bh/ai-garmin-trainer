import { asSchema, tool } from "ai";
import {
  trainerToolContracts as contracts,
  trainerToolInputSchemas,
} from "./tool-contracts";

// Advertise minimal new inputs while SDK parsing still accepts strict rich
// legacy calls. Dispatch uses that same parser, not a second compatibility rule.
function weeklyTool(name: "saveWeeklyKpis" | "saveWeeklyDocuments") {
  return tool({
    description: contracts[name].description,
    inputSchema: {
      ...asSchema<unknown>(contracts[name].inputSchema),
      validate(value: unknown) {
        const parsed = trainerToolInputSchemas[name].safeParse(value);
        return parsed.success
          ? { success: true as const, value: parsed.data }
          : { success: false as const, error: parsed.error };
      },
    },
  });
}

/** SDK wrapping belongs to the provider adapter, never selection or validation. */
export const trainerToolDefinitions = {
  getWeeklyKpis: tool(contracts.getWeeklyKpis),
  saveWeeklyKpis: weeklyTool("saveWeeklyKpis"),
  getKpiProgress: tool(contracts.getKpiProgress),
  getActivityDashboard: tool(contracts.getActivityDashboard),
  analyzeActivityTerrain: tool(contracts.analyzeActivityTerrain),
  getWeeklyPlan: tool(contracts.getWeeklyPlan),
  saveWeeklyDocuments: weeklyTool("saveWeeklyDocuments"),
  runGarminSync: tool(contracts.runGarminSync),
  getSyncStatus: tool(contracts.getSyncStatus),
  verifyActivityReference: tool(contracts.verifyActivityReference),
  forceRefreshActivityDetail: tool(contracts.forceRefreshActivityDetail),
  getActivityDetailAvailability: tool(contracts.getActivityDetailAvailability),
  getActivityDetailSlice: tool(contracts.getActivityDetailSlice),
  describeGarminDatabase: tool(contracts.describeGarminDatabase),
  runReadOnlySql: tool(contracts.runReadOnlySql),
  runMathAnalysis: tool(contracts.runMathAnalysis),
  getTrainingPlan: tool(contracts.getTrainingPlan),
  saveTrainingPlan: tool(contracts.saveTrainingPlan),
};
