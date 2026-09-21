import {
  trainerToolDefinitions,
  validateTrainerToolCall,
  type ValidatedTrainerToolCall,
} from "./tool-contracts";
import { TRAINER_EXECUTION_POLICY } from "./execution-budget";
import { failedStep } from "./tool-step-diagnostics";
import type {
  TrainerToolCall,
  TrainerToolName,
  TrainerToolSelectionMetadata,
  TrainerToolStep,
  TrainerToolStepName,
} from "./tool-types";

// Selection observes successful counts; the turn loop rechecks and updates them.
export function canToolRunWithinBudget(
  toolName: TrainerToolName,
  analysisToolCounts: ReadonlyMap<TrainerToolName, number>,
): boolean {
  const currentCount = analysisToolCounts.get(toolName) ?? 0;
  if (
    toolName === "describeGarminDatabase" ||
    toolName === "runReadOnlySql" ||
    toolName === "runMathAnalysis"
  )
    return currentCount < TRAINER_EXECUTION_POLICY.analyticalSuccessLimit;
  return true;
}

function selectedToolPriority(
  toolName: TrainerToolName,
  priorSteps: readonly TrainerToolStep[],
): number {
  const hasSchema = priorSteps.some(
    (step) =>
      step.tool === "describeGarminDatabase" && step.status === "succeeded",
  );
  const hasSql = priorSteps.some(
    (step) => step.tool === "runReadOnlySql" && step.status === "succeeded",
  );
  const hasMath = priorSteps.some(
    (step) => step.tool === "runMathAnalysis" && step.status === "succeeded",
  );
  if (!hasSchema && toolName === "describeGarminDatabase") return 0;
  if (hasSchema && !hasSql && toolName === "runReadOnlySql") return 0;
  if (hasSql && !hasMath && toolName === "runMathAnalysis") return 0;
  if (toolName === "runReadOnlySql") return 1;
  if (toolName === "runMathAnalysis") return 2;
  if (toolName === "describeGarminDatabase") return 3;
  return 10;
}

function attemptedToolName(call: TrainerToolCall): TrainerToolStepName {
  return Object.prototype.hasOwnProperty.call(
    trainerToolDefinitions,
    call.toolName,
  ) && typeof call.toolName === "string"
    ? (call.toolName as TrainerToolName)
    : "providerToolSelection";
}

type SelectedTrainerToolCall = {
  call: TrainerToolCall;
  accepted: ValidatedTrainerToolCall;
  metadata?: TrainerToolSelectionMetadata;
};

export function selectSafeToolCalls(input: {
  toolCalls: readonly TrainerToolCall[];
  priorSteps: readonly TrainerToolStep[];
  analysisToolCounts: ReadonlyMap<TrainerToolName, number>;
  exploratoryRemaining: number;
}):
  | {
      ok: true;
      calls: SelectedTrainerToolCall[];
      skippedForTurnBudget: number;
    }
  | { ok: false; step: TrainerToolStep } {
  const toolNames = input.toolCalls
    .map((call) => call.toolName)
    .filter((toolName, index, names) => names.indexOf(toolName) === index)
    .slice(0, 8);
  const stepIndex = input.priorSteps.length + 1;
  const evaluated: Array<{
    call: TrainerToolCall;
    order: number;
    accepted: ValidatedTrainerToolCall;
  }> = [];

  for (const [order, call] of input.toolCalls.entries()) {
    const accepted = validateTrainerToolCall(call);
    if (!accepted.ok) {
      return {
        ok: false,
        step: failedStep(
          stepIndex,
          accepted.reason,
          attemptedToolName(call),
          `Provider selected ${input.toolCalls.length} tools (${toolNames.join(", ") || "none recognized"}); call ${order + 1} was rejected as ${accepted.reason}, so no tools from that provider response were executed.`,
        ),
      };
    }
    evaluated.push({ call, order, accepted });
  }

  const candidates = evaluated
    .filter((item) =>
      canToolRunWithinBudget(item.accepted.toolName, input.analysisToolCounts),
    )
    .sort((left, right) => {
      const priority =
        selectedToolPriority(left.accepted.toolName, input.priorSteps) -
        selectedToolPriority(right.accepted.toolName, input.priorSteps);
      return priority || left.order - right.order;
    });
  if (!candidates.length) {
    return {
      ok: false,
      step: failedStep(
        stepIndex,
        "multiple_tool_calls_no_safe_tool",
        "providerToolSelection",
        `Provider selected ${input.toolCalls.length} tools (${toolNames.join(", ") || "none recognized"}); none was a safe valid next tool within the remaining per-tool budgets.`,
      ),
    };
  }

  const remaining = input.exploratoryRemaining;
  if (remaining <= 0) {
    return {
      ok: false,
      step: failedStep(
        stepIndex,
        "tool_budget_exceeded",
        "providerToolSelection",
        `Provider selected ${input.toolCalls.length} tools (${toolNames.join(", ") || "none recognized"}), but the per-turn limit of ${TRAINER_EXECUTION_POLICY.hardLimit} total planner/tool executions was already exhausted.`,
      ),
    };
  }

  const selected = candidates.slice(0, remaining);
  const metadataFor = (
    toolName: TrainerToolName,
  ): TrainerToolSelectionMetadata | undefined =>
    input.toolCalls.length > 1
      ? {
          reason: "multiple_tool_calls",
          count: input.toolCalls.length,
          toolNames,
          selectedTool: toolName,
        }
      : undefined;

  return {
    ok: true,
    calls: selected.map((item) => ({
      call: item.call,
      accepted: item.accepted,
      metadata: metadataFor(item.accepted.toolName),
    })),
    skippedForTurnBudget: Math.max(0, candidates.length - selected.length),
  };
}
