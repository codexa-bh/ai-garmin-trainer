import { weekly } from "../weekly/composition";
import { describeGarminDatabase, runReadOnlySql } from "./sql-analysis";
import {
  analyzeActivityTerrain,
  getActivityDashboard,
  getActivityDashboardEvidence,
  getActivityByGarminId,
  getActivityDetailForAnalytics,
  listActivityDetailAvailability,
  verifyActivityReference,
  summarizeSyncStatus,
} from "../local-data/composition";
import { backfillActivityDetail, runGarminSync } from "../garmin/composition";
import { renderActivityImages } from "../local-data/activity-image-renderer";
import {
  readCompleteTrainingPlan,
  saveGuardedTrainingPlan,
} from "../training-plan/composition";
import { executeTrainerTool as execute } from "./tool-execution";
import type { TrainerToolExecutionInput } from "./tool-execution-input";
import type { TrainerToolPorts } from "./tool-ports";

// Binding is inert. Feature adapters retain their existing lazy lifetimes and
// synchronous compare/write boundaries; each turn still owns its own context.
const ports: TrainerToolPorts = {
  weekly,
  analytics: { describeGarminDatabase, runReadOnlySql, analyzeActivityTerrain },
  localData: {
    getActivityDashboard,
    getActivityDashboardEvidence,
    renderActivityImages,
    getActivityByGarminId,
    getActivityDetailForAnalytics,
    listActivityDetailAvailability,
    verifyActivityReference,
    summarizeSyncStatus,
    backfillActivityDetail,
    runGarminSync,
  },
  trainingPlan: {
    readComplete: readCompleteTrainingPlan,
    saveGuarded: saveGuardedTrainingPlan,
  },
};

export const executeTrainerTool = (input: TrainerToolExecutionInput) =>
  execute(input, ports);
