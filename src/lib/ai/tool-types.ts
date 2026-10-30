export type CompletionRejection = {
  reason:
    | "invalid_schema"
    | "invalid_tool_claim"
    | "kind_evidence_conflict"
    | "step_not_succeeded"
    | "tool_mismatch"
    | "metric_step_required"
    | "latest_metric_unsuccessful"
    | "incomplete_analysis"
    | "result_mismatch"
    | "cell_mismatch";
  claimIndex?: number;
};

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
  | "analyzeActivityTerrain"
  | "getTrainingPlan"
  | "saveTrainingPlan"
  | "getWeeklyPlan"
  | "saveWeeklyDocuments";

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
