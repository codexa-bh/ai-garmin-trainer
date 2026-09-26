import { tool } from "ai";
import { trainerToolContracts as contracts } from "./tool-contracts";

/** SDK wrapping belongs to the provider adapter, never selection or validation. */
export const trainerToolDefinitions = {
  getWeeklyPlan: tool(contracts.getWeeklyPlan),
  proposeWeeklyDocuments: tool(contracts.proposeWeeklyDocuments),
  applyWeeklyProposal: tool(contracts.applyWeeklyProposal),
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
