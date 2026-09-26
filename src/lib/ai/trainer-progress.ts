import type { TrainerToolName, TrainerToolStep } from "./tool-types";

export type TrainerProgressCounters = {
  modelCalls: number;
  toolsSucceeded: number;
  toolsUnsuccessful: number;
};

export type TrainerProgress = {
  message: string;
  counters?: TrainerProgressCounters;
};

// Shared wire boundary: malformed diagnostics must not become visible counters.
export function validProgressCounters(
  value: unknown,
): TrainerProgressCounters | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const { modelCalls, toolsSucceeded, toolsUnsuccessful } = record;
  if (
    ![modelCalls, toolsSucceeded, toolsUnsuccessful].every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    )
  )
    return undefined;
  return {
    modelCalls: modelCalls as number,
    toolsSucceeded: toolsSucceeded as number,
    toolsUnsuccessful: toolsUnsuccessful as number,
  };
}

const activity: Record<TrainerToolName, string> = {
  describeGarminDatabase:
    "Checking which local activity and health fields are available…",
  runReadOnlySql: "Reading local Garmin records for this analysis…",
  runMathAnalysis: "Calculating from the returned local records…",
  getSyncStatus: "Checking imported data and local sync coverage…",
  verifyActivityReference:
    "Checking whether the activity reference matches local records…",
  getActivityDetailAvailability:
    "Checking which local activity details are available…",
  getActivityDetailSlice: "Reading a bounded portion of local activity detail…",
  runGarminSync: "Running the requested Garmin sync action…",
  forceRefreshActivityDetail: "Refreshing the requested activity detail…",
  getWeeklyPlan: "Reading the selected weekly documents…",
  proposeWeeklyDocuments: "Preparing a weekly draft for confirmation…",
  applyWeeklyProposal: "Saving the confirmed weekly proposal…",
  getTrainingPlan: "Reading the complete current training plan…",
  saveTrainingPlan: "Saving the requested training plan update…",
};

const evidence: Record<TrainerToolName, string> = {
  describeGarminDatabase: "the available local data fields",
  runReadOnlySql: "the local query result",
  runMathAnalysis: "the calculation result",
  getSyncStatus: "the local import and sync coverage",
  verifyActivityReference: "the activity reference check",
  getActivityDetailAvailability: "the local detail availability",
  getActivityDetailSlice: "the returned portion of activity detail",
  runGarminSync: "the completed sync outcome",
  forceRefreshActivityDetail: "the activity detail refresh outcome",
  getWeeklyPlan: "the selected weekly documents",
  proposeWeeklyDocuments: "the unconfirmed weekly draft",
  applyWeeklyProposal: "the saved weekly documents",
  getTrainingPlan: "the current training plan result",
  saveTrainingPlan: "the saved training plan update",
};

export function toolProgressMessage(tool: TrainerToolName): string {
  return activity[tool];
}

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Only server-owned numeric/enum metadata is projected. Never use summaries,
// reasons, rows, SQL, tool arguments, names, plan content, or result handles.
export function modelWaitMessage(steps: TrainerToolStep[]): string {
  const step = [...steps]
    .reverse()
    .find((item) => item.tool !== "providerToolSelection");
  if (!step || step.tool === "providerToolSelection")
    return "Considering your request with the available local context…";
  if (step.status !== "succeeded") {
    const operation =
      step.tool === "runReadOnlySql"
        ? "local query"
        : step.tool === "runMathAnalysis"
          ? "calculation"
          : "local operation";
    return step.status === "rejected"
      ? `Reviewing the rejected ${operation}; no result was produced…`
      : `Reviewing the ${operation} failure and available evidence…`;
  }
  const result = metadata(step.result);
  let context = evidence[step.tool];
  if (
    step.tool === "describeGarminDatabase" &&
    Array.isArray(result.tables) &&
    result.tables.length <= 100
  ) {
    context = `the fields available across ${result.tables.length} local data tables`;
  } else if (
    step.tool === "runReadOnlySql" ||
    step.tool === "runMathAnalysis"
  ) {
    const count = result.returnedRows;
    const limit = step.tool === "runReadOnlySql" ? 200 : 100;
    if (
      result.status === "succeeded" &&
      typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 0 &&
      count <= limit
    ) {
      const kind = step.tool === "runReadOnlySql" ? "query" : "calculation";
      context =
        count === 0
          ? `the ${kind}'s empty result`
          : `${count} returned ${kind} ${count === 1 ? "row" : "rows"}`;
      if (result.truncated === true) context += " (limited result)";
    }
  } else if (step.tool === "getTrainingPlan" && result.plan === null) {
    context = "the absence of a saved training plan";
  } else if (
    step.tool === "getActivityDetailAvailability" &&
    Array.isArray(step.result) &&
    step.result.length === 0
  ) {
    context = "the empty local detail availability result";
  }
  return `Reviewing ${context} for your response…`;
}

export function answerPreparationMessage(incomplete: boolean): string {
  return incomplete
    ? "Preparing an answer from the available evidence, with its limits…"
    : "Preparing an answer from the available local results…";
}
