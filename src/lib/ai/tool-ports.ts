import type { createWeekly } from "../weekly/application";
import type {
  ActivityDashboardEvidence,
  ActivityVisualInput,
  ActivityPanel,
  ActivityVisualResult,
} from "../local-data/activity-visuals";
import type {
  AnalysisResult,
  GarminDatabaseDescription,
  SqlAnalysisInput,
} from "./analytics/contracts";
import type {
  createActivityDashboard,
  createLocalData,
} from "../local-data/application";
import type { createTrainingPlan } from "../training-plan/application";
import type {
  DetailedBackfillResult,
  DetailRefreshOptions,
  GarminSyncResult,
} from "../garmin/import-contracts";

/** Only guarded feature use cases are supplied, never SQL execution/storage. */
export type AnalyticsToolPorts = {
  analyzeActivityTerrain: ReturnType<
    typeof import("../local-data/application").createTerrainAnalysis
  >;
  describeGarminDatabase(): GarminDatabaseDescription;
  runReadOnlySql(input: SqlAnalysisInput): AnalysisResult;
};

export type LocalDataToolPorts = Pick<
  ReturnType<typeof createLocalData>,
  | "getActivityByGarminId"
  | "getActivityDetailForAnalytics"
  | "listActivityDetailAvailability"
  | "verifyActivityReference"
  | "summarizeSyncStatus"
> & {
  getActivityDashboard: ReturnType<typeof createActivityDashboard>;
  getActivityDashboardEvidence?(id: string): ActivityDashboardEvidence | null;
  renderActivityImages?(
    input: ActivityVisualInput,
    panels: readonly ActivityPanel[],
  ): Promise<ActivityVisualResult>;
  runGarminSync(): Promise<GarminSyncResult>;
  backfillActivityDetail(
    garminId: string,
    options: DetailRefreshOptions,
  ): Promise<DetailedBackfillResult>;
};

export type TrainingPlanToolPorts = Pick<
  ReturnType<typeof createTrainingPlan>,
  "readComplete" | "saveGuarded"
>;

export type TrainerToolPorts = {
  analytics: AnalyticsToolPorts;
  localData: LocalDataToolPorts;
  trainingPlan: TrainingPlanToolPorts;
  weekly?: Pick<ReturnType<typeof createWeekly>, "read" | "save">;
};
