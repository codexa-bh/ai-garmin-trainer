export type TrainerToolName =
  | "runGarminSync"
  | "getSyncStatus"
  | "verifyActivityReference"
  | "forceRefreshActivityDetail"
  | "getActivityDetailAvailability"
  | "getActivityDetailSlice"
  | "describeGarminDatabase"
  | "runReadOnlySql"
  | "runMathAnalysis"
  | "getTrainingPlan"
  | "saveTrainingPlan";

export type TrainerToolStepName = TrainerToolName | "providerToolSelection";

export type TrainerToolSelectionMetadata = {
  reason: "multiple_tool_calls";
  count: number;
  toolNames: string[];
  selectedTool?: TrainerToolName;
};

export type TrainerToolStep = {
  index: number;
  tool: TrainerToolStepName;
  status: "succeeded" | "rejected" | "failed";
  summary: string;
  activityIds?: string[];
  privacy: string;
  reason?: string;
  correctionAllowed?: boolean;
  failureMessage?: string;
  correctionHint?: string;
  selection?: TrainerToolSelectionMetadata;
  result?: unknown;
};

export type TrainerToolCall = {
  toolName: string;
  input: unknown;
};
