import { renderWeeklyProposal } from "../weekly/application";
import {
  COMPLETION_TOOL,
  COMPLETION_LIMITATION,
  validatedCompletion,
} from "./turn-completion";
import type {
  WeeklyProposal,
  WeeklyRead,
  WeeklyTurn,
} from "../weekly/contracts";
import {
  TRAINER_PROVIDER_CALL_TIMEOUT_MS,
  type TrainerGenerationResult,
  type TrainerOrchestrationPorts,
} from "./orchestration-ports";
import { TrainerToolExecutionContext } from "./tool-execution-context";
import { providerFailureMessage } from "./provider-errors";
import {
  completeTrainingPlanSchema,
  renderCompleteTrainingPlan,
} from "./training-plan-evidence";
import { groundingForSteps, renderToolSteps } from "./tool-evidence";
import { canToolRunWithinBudget, selectSafeToolCalls } from "./tool-selection";
import { failedStep } from "./tool-step-diagnostics";
import type {
  TrainerToolCall,
  TrainerToolName,
  TrainerToolStep,
} from "./tool-types";
import {
  buildLlmDebugTrace,
  debugProviderCall,
  type LlmDebugProviderCall,
  type LlmDebugTrace,
} from "@/lib/ai/debug-trace";
import type { ChatGrounding, ChatTurnContext } from "@/lib/chat/contracts";
import {
  buildFinalSynthesisInstructions,
  buildPlannerInstructions,
} from "@/lib/ai/trainer-instructions";

import {
  TRAINER_EXECUTION_POLICY,
  trainerExecutionBudget,
  type TrainerExecutionBudget,
} from "@/lib/ai/execution-budget";

const MAX_TOTAL_TURN_EXECUTIONS = TRAINER_EXECUTION_POLICY.hardLimit;
const MAX_PLANNER_CALLS = MAX_TOTAL_TURN_EXECUTIONS;
const MAX_TOOL_CALLS = MAX_TOTAL_TURN_EXECUTIONS;
const MAX_GENERAL_TOOL_CALLS = MAX_TOTAL_TURN_EXECUTIONS;
const MAX_SCHEMA_CALLS = TRAINER_EXECUTION_POLICY.analyticalSuccessLimit;
const MAX_SQL_CALLS = TRAINER_EXECUTION_POLICY.analyticalSuccessLimit;
const MAX_MATH_CALLS = TRAINER_EXECUTION_POLICY.analyticalSuccessLimit;

import {
  answerPreparationMessage,
  modelWaitMessage,
  toolProgressMessage,
  type TrainerProgressCounters,
} from "./trainer-progress";

type OrchestrateTrainerStatus = (
  message: string,
  counters?: TrainerProgressCounters,
) => void;

export type OrchestrateTrainerChatInput = {
  system: string;
  userRequest: string;
  turnContext?: ChatTurnContext;
  weeklyTurn?: WeeklyTurn;
  onStatus?: OrchestrateTrainerStatus;
  debug?: {
    enabled: boolean;
    provider?: string;
    model?: string | null;
  };
};

export type OrchestrateTrainerChatResult = {
  text: string;
  grounding: ChatGrounding | null;
  toolSteps: TrainerToolStep[];
  providerCalls: number;
  progressCounters: TrainerProgressCounters;
  debugTrace?: LlmDebugTrace;
};

function bounded(value: string, max = 2200): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function extractToolCall(raw: unknown): TrainerToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const toolName = record.toolName ?? record.tool ?? record.name;
  const input = record.input ?? record.args ?? record.arguments ?? {};
  if (typeof toolName !== "string") return null;
  let parsedInput: unknown = input;
  if (typeof input === "string") {
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch {
      parsedInput = input;
    }
  }
  return { toolName, input: parsedInput };
}

function systemWithTurnContext(input: OrchestrateTrainerChatInput): string {
  return `${input.system}\n\nExplicit server turn context (date basis and recorded prior failures, not current-turn evidence):\n${JSON.stringify(input.turnContext ?? {})}`;
}

function plannerSystem(
  baseSystem: string,
  priorSteps: TrainerToolStep[],
  budget: TrainerExecutionBudget,
  analysisToolCounts: Map<TrainerToolName, number>,
): string {
  const prior = priorSteps.length
    ? synthesisEvidenceForSteps(priorSteps)
    : "No prior tool step in this user turn.";
  return buildPlannerInstructions(
    baseSystem,
    prior,
    budget,
    Object.fromEntries(analysisToolCounts),
  );
}

function providerSelectionFailureText(step: TrainerToolStep): string {
  if (step.reason === "multiple_tool_calls")
    return "I tried to continue the local Garmin analysis, but the model selected multiple tools at once. I did not run an unsafe action. Please ask me to retry the ranking with one SQL query, or narrow the criteria you want me to use.";
  if (step.reason === "multiple_tool_calls_with_side_effect")
    return "The model selected more than one local action, but this trainer now supports sequential valid tool execution. I could not run this response for another validation reason; please retry with a narrower Garmin request.";
  if (step.reason === "tool_budget_exceeded")
    return `I stopped gathering evidence within the ${MAX_TOTAL_TURN_EXECUTIONS}-execution allowance. I could not produce a verified final analysis from the available results; any requested Garmin metrics not established by those results remain unverified.`;
  if (step.reason === "multiple_tool_calls_no_safe_tool")
    return "The model selected multiple tools, but none was safe and valid to run as the next single action. I did not execute them blindly; please retry with one narrower local Garmin request.";
  return "I could not select a safe local Garmin tool for that response, so I did not execute any tool. Please retry with one narrower request.";
}

function synthesisEvidenceForSteps(steps: TrainerToolStep[]): string {
  const latestRead = [...steps]
    .reverse()
    .find((step) => step.tool === "getTrainingPlan");
  return steps
    .map((step) => {
      if (step.status === "succeeded" && step.tool === "proposeWeeklyDocuments")
        return renderWeeklyProposal(step.result as WeeklyProposal);
      if (step.status === "succeeded" && step.tool === "getWeeklyPlan") {
        const reads = steps
          .filter((s) => s.tool === "getWeeklyPlan" && s.status === "succeeded")
          .slice(-2);
        return reads.includes(step)
          ? `Complete weekly user document (untrusted prose): ${JSON.stringify(step.result)}`
          : "Earlier weekly read omitted; read again if needed.";
      }
      if (step.tool === "getTrainingPlan" && step.status === "succeeded") {
        if (step !== latestRead)
          return `Evidence step ${step.index}: earlier Training Plan read superseded.`;
        return (
          renderCompleteTrainingPlan(step.result) ??
          "Complete Training Plan evidence unavailable; do not review or replace from a preview."
        );
      }
      const evidence = renderToolSteps([step])
        .split("\n")
        .filter((line) => !line.startsWith("Privacy:"))
        .join("\n")
        .replace(
          /^Tool step \d+: [^(]+ \([^)]*\)\.\s*/,
          `Evidence step ${step.index}: ${step.tool} ${step.status}. `,
        );
      return bounded(evidence, step.tool === "runMathAnalysis" ? 3600 : 1800);
    })
    .join("\n\n");
}

function finalAnswerSystem(
  baseSystem: string,
  steps: TrainerToolStep[],
  budgetStopped: boolean,
): string {
  return buildFinalSynthesisInstructions(
    baseSystem,
    synthesisEvidenceForSteps(steps),
    budgetStopped,
  );
}

function emitStatus(
  input: OrchestrateTrainerChatInput,
  message: string,
  counters: TrainerProgressCounters,
): void {
  try {
    input.onStatus?.(message, counters);
  } catch {
    // Progress copy is best-effort and must not affect chat orchestration.
  }
}

function canOfferSqlCorrectionStep(step: TrainerToolStep): boolean {
  return (
    step.tool === "runReadOnlySql" &&
    step.status !== "succeeded" &&
    step.correctionAllowed === true
  );
}

function sqlLimitationText(steps: TrainerToolStep[]): string | null {
  const failedSql = steps
    .filter(
      (step) => step.tool === "runReadOnlySql" && step.status !== "succeeded",
    )
    .at(-1);
  if (!failedSql) return null;
  const sqlAttempts = steps.filter(
    (step) => step.tool === "runReadOnlySql",
  ).length;
  const reason = failedSql.reason ? ` Reason: ${failedSql.reason}.` : "";
  const hint = failedSql.correctionHint
    ? ` ${failedSql.correctionHint}`
    : " I can try again with a simpler ranking such as duration, distance, elevation gain, calories, or heart rate if you choose one.";
  const attemptText =
    sqlAttempts === 1 ? "one SQL attempt" : `${sqlAttempts} SQL attempts`;
  return `I couldn't complete that local Garmin ranking after ${attemptText}.${reason}${hint}`;
}

function genericToolLimitationText(steps: TrainerToolStep[]): string | null {
  const failed = [...steps]
    .reverse()
    .find((step) => step.status === "failed" || step.status === "rejected");
  if (!failed || failed.tool === "providerToolSelection") return null;
  if (failed.tool === "getTrainingPlan")
    return "I couldn't read the complete current Training Plan safely, so I can't review the missing sections from its preview. This read did not change the plan.";
  if (failed.tool === "saveTrainingPlan") {
    if (failed.status === "failed")
      return "I couldn't confirm that the Training Plan was saved. Check the current saved plan before retrying; I won't claim a successful update without persistence evidence.";
    const reasons: Record<string, string> = {
      complete_plan_read_required:
        "I need a complete current-plan read in a previous planning step before revising it. Read the plan again before retrying.",
      training_plan_changed_read_again:
        "The saved plan changed after I read it. Read the latest plan and reapply only the intended edits.",
      plan_edit_not_unique_or_overlapping:
        "The proposed edits did not match unique, non-overlapping text in the plan. Read it again and choose exact distinct passages.",
      invalid_plan_content_length:
        "The proposed plan was empty or exceeded the supported length. Keep the plan nonempty and within 32,000 characters.",
      malformed_input:
        "The save arguments were invalid. Use either exact edits or a complete document for an explicitly requested creation or replacement, not both.",
    };
    return `This Training Plan save was rejected. ${reasons[failed.reason ?? ""] ?? "The proposed save did not meet the supported plan-edit requirements. Read the current plan and check the requested changes before retrying."} The rejected save did not change the plan.`;
  }
  const reason = failed.reason ? ` Reason: ${failed.reason}.` : "";
  return `I couldn't complete the local ${failed.tool} request within the safety guardrails.${reason} ${failed.summary}`;
}

function duplicateSideEffectPriorResultText(
  steps: TrainerToolStep[],
): string | null {
  const duplicate = [...steps]
    .reverse()
    .find((step) => step.reason === "duplicate_side_effect");
  if (!duplicate) return null;
  const prior = [...steps]
    .reverse()
    .find(
      (step) =>
        step.index < duplicate.index &&
        step.tool === duplicate.tool &&
        step.status !== "rejected",
    );
  if (!prior) return null;
  if (prior.status !== "succeeded") return genericToolLimitationText([prior]);
  return `I completed the requested local ${prior.tool} action once. ${prior.summary.trim()}`;
}

function toolFailureLimitationText(steps: TrainerToolStep[]): string {
  const providerSelectionFailure = [...steps]
    .reverse()
    .find(
      (step) =>
        step.tool === "providerToolSelection" && step.status !== "succeeded",
    );
  return (
    (providerSelectionFailure
      ? providerSelectionFailureText(providerSelectionFailure)
      : null) ??
    duplicateSideEffectPriorResultText(steps) ??
    sqlLimitationText(steps) ??
    genericToolLimitationText(steps) ??
    "I couldn't complete that local Garmin tool request within the safety guardrails. Please try a narrower request."
  );
}

async function synthesizeFinalAnswer(
  input: OrchestrateTrainerChatInput,
  steps: TrainerToolStep[],
  recordProviderCall: (call: LlmDebugProviderCall) => void,
  generate: TrainerOrchestrationPorts["generate"],
  budgetStopped = false,
): Promise<string | null> {
  let result: TrainerGenerationResult;
  try {
    result = await generate({
      purpose: "final_synthesis",
      system: finalAnswerSystem(
        systemWithTurnContext(input),
        steps,
        budgetStopped,
      ),
      prompt: input.userRequest,
    });
  } catch (error) {
    recordProviderCall?.(
      debugProviderCall({
        index: 0,
        purpose: "final_synthesis",
        error: providerFailureMessage(input.debug?.provider, error),
      }),
    );
    return null;
  }
  if (
    !result ||
    (result.toolCalls !== undefined && !Array.isArray(result.toolCalls))
  )
    return null;

  const text = result.text?.trim() ?? "";
  const toolCalls = (result.toolCalls ?? [])
    .map(extractToolCall)
    .filter((call): call is TrainerToolCall => Boolean(call));
  recordProviderCall?.(
    debugProviderCall({
      index: 0,
      purpose: "final_synthesis",
      toolCalls,
      text:
        validatedCompletion(
          toolCalls.find((call) => call.toolName === COMPLETION_TOOL)?.input,
          steps,
        ) ?? text,
    }),
  );
  if (
    (result.toolCalls?.length ?? 0) !== 1 ||
    toolCalls.length !== 1 ||
    toolCalls[0].toolName !== COMPLETION_TOOL
  )
    return null;
  return validatedCompletion(toolCalls[0].input, steps);
}

export async function orchestrateTrainerChat(
  input: OrchestrateTrainerChatInput,
  ports: TrainerOrchestrationPorts,
): Promise<OrchestrateTrainerChatResult> {
  const context = new TrainerToolExecutionContext();
  try {
    return await orchestrateTurn(input, context, ports);
  } finally {
    context.dispose();
  }
}

async function orchestrateTurn(
  input: OrchestrateTrainerChatInput,
  context: TrainerToolExecutionContext,
  ports: TrainerOrchestrationPorts,
): Promise<OrchestrateTrainerChatResult> {
  const steps: TrainerToolStep[] = [];
  const analysisToolCounts = new Map<TrainerToolName, number>();
  let providerCalls = 0;
  let toolAttempts = 0;
  let toolsSucceeded = 0;
  let toolsUnsuccessful = 0;
  const progress = (message: string) =>
    emitStatus(input, message, {
      modelCalls: providerCalls,
      toolsSucceeded,
      toolsUnsuccessful,
    });
  const budget = () => trainerExecutionBudget(providerCalls, toolAttempts);
  const debugEnabled = input.debug?.enabled === true;
  const debugProviderCalls: LlmDebugProviderCall[] = [];
  const recordProviderCall = (call: LlmDebugProviderCall) => {
    if (!debugEnabled) return;
    debugProviderCalls.push({ ...call, index: debugProviderCalls.length + 1 });
  };
  const finish = (
    result: Omit<
      OrchestrateTrainerChatResult,
      "debugTrace" | "progressCounters"
    >,
    finalAnswerSource?: LlmDebugTrace["finalAnswerSource"],
  ) => {
    const proposalStep = [...result.toolSteps]
      .reverse()
      .find(
        (step) =>
          step.tool === "proposeWeeklyDocuments" && step.status === "succeeded",
      );
    const completed = {
      ...result,
      ...(proposalStep
        ? { text: renderWeeklyProposal(proposalStep.result as WeeklyProposal) }
        : {}),
      progressCounters: {
        modelCalls: providerCalls,
        toolsSucceeded,
        toolsUnsuccessful,
      },
    };
    if (!debugEnabled) return completed;
    return {
      ...completed,
      debugTrace: buildLlmDebugTrace({
        provider: input.debug?.provider,
        model: input.debug?.model,
        userRequest: input.userRequest,
        providerCalls: debugProviderCalls,
        toolSteps: result.toolSteps,
        finalAnswer: result.text,
        finalAnswerSource:
          finalAnswerSource ??
          (result.toolSteps.length ? "provider" : "direct"),
      }),
    };
  };

  // Every explicit synthesis attempt uses this admission boundary, including
  // invalid-prose repair and analytical failure paths, not just budget wrap-up.
  const synthesize = async (budgetStopped = false) => {
    if (budget().remaining <= 0) return null;
    providerCalls += 1;
    progress(answerPreparationMessage(budgetStopped || toolsUnsuccessful > 0));
    return synthesizeFinalAnswer(
      input,
      steps,
      recordProviderCall,
      ports.generate,
      budgetStopped,
    );
  };
  const finishAtBudget = async (skipped = 0) => {
    steps.push(
      failedStep(
        steps.length + 1,
        "tool_budget_exceeded",
        "providerToolSelection",
        `Evidence gathering stopped with ${budget().consumed} executions consumed of ${MAX_TOTAL_TURN_EXECUTIONS}; ${TRAINER_EXECUTION_POLICY.finalAnswerReserve} final-answer execution reserved. ${skipped} selected tool calls skipped. This diagnostic is not an execution.`,
      ),
    );
    const synthesized = await synthesize(true);
    const completedActions = steps
      .filter(
        (step) =>
          step.status === "succeeded" &&
          [
            "saveTrainingPlan",
            "applyWeeklyProposal",
            "runGarminSync",
            "forceRefreshActivityDetail",
          ].includes(step.tool),
      )
      .map((step) => step.tool);
    const fallback =
      providerSelectionFailureText(steps[steps.length - 1]) +
      (completedActions.length
        ? ` Completed local actions: ${[...new Set(completedActions)].join(", ")}. These were not repeated during wrap-up.`
        : " No further local actions were run during wrap-up.");
    return finish(
      {
        text: synthesized ?? fallback,
        grounding: groundingForSteps(steps),
        toolSteps: steps,
        providerCalls,
      },
      synthesized ? "provider" : "deterministic_fallback",
    );
  };

  const failedMathCorrections = new Set<string>();
  while (budget().exploratoryRemaining > 0) {
    providerCalls += 1;
    progress(modelWaitMessage(steps));
    let result: TrainerGenerationResult;
    try {
      result = await ports.generate({
        purpose: "planner",
        system: plannerSystem(
          systemWithTurnContext(input),
          steps,
          budget(),
          analysisToolCounts,
        ),
        prompt: input.userRequest,
      });
    } catch (error) {
      recordProviderCall(
        debugProviderCall({
          index: 0,
          purpose: steps.length ? "failure_fallback" : "planner",
          error: providerFailureMessage(input.debug?.provider, error),
        }),
      );
      if (steps.length) {
        return finish(
          {
            text: toolFailureLimitationText(steps),
            grounding: groundingForSteps(steps),
            toolSteps: steps,
            providerCalls,
          },
          "deterministic_fallback",
        );
      }
      return finish(
        {
          text:
            input.debug?.provider === "openrouter"
              ? `${providerFailureMessage("openrouter", error)} No Garmin tool was executed.`
              : "I could not get a valid response from the configured model. No Garmin tool was executed.",
          grounding: null,
          toolSteps: [],
          providerCalls,
        },
        "deterministic_fallback",
      );
    }

    if (!result) result = {};
    if (result.toolCalls !== undefined && !Array.isArray(result.toolCalls)) {
      return finish(
        {
          text: COMPLETION_LIMITATION,
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        },
        "deterministic_fallback",
      );
    }
    const toolCalls = (result.toolCalls ?? [])
      .map(extractToolCall)
      .filter((call): call is TrainerToolCall => Boolean(call));
    recordProviderCall(
      debugProviderCall({
        index: 0,
        purpose: toolCalls.some((call) => call.toolName !== COMPLETION_TOOL)
          ? "planner"
          : steps.length
            ? "final_synthesis"
            : "direct_answer",
        toolCalls,
        text:
          validatedCompletion(
            toolCalls.find((call) => call.toolName === COMPLETION_TOOL)?.input,
            steps,
          ) ??
          result.text?.trim() ??
          "",
      }),
    );
    const terminal = toolCalls.find(
      (call) => call.toolName === COMPLETION_TOOL,
    );
    const malformedCalls = toolCalls.length !== (result.toolCalls?.length ?? 0);
    if (malformedCalls || (terminal && toolCalls.length !== 1)) {
      return finish(
        {
          text: COMPLETION_LIMITATION,
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        },
        "deterministic_fallback",
      );
    }
    if (terminal || toolCalls.length === 0) {
      const completed = terminal
        ? validatedCompletion(terminal.input, steps)
        : null;
      if (completed) progress("Formatting the completed answer…");
      const answer = completed ?? (await synthesize());
      return finish(
        {
          text:
            answer ??
            (steps.some((step) => step.status !== "succeeded")
              ? toolFailureLimitationText(steps)
              : COMPLETION_LIMITATION),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        },
        answer
          ? steps.length
            ? "provider"
            : "direct"
          : "deterministic_fallback",
      );
    }

    const selection = selectSafeToolCalls({
      toolCalls,
      priorSteps: steps,
      analysisToolCounts,
      exploratoryRemaining: budget().exploratoryRemaining,
    });
    if (!selection.ok) {
      if (selection.step.reason === "tool_budget_exceeded")
        return finishAtBudget(toolCalls.length);
      const allSteps = [...steps, selection.step];
      return finish(
        {
          text: toolFailureLimitationText(allSteps),
          grounding: groundingForSteps(allSteps),
          toolSteps: allSteps,
          providerCalls,
        },
        "deterministic_fallback",
      );
    }

    // Only a complete read already shown to this planner pass can support a revision.
    const priorPlanRead = [...steps]
      .reverse()
      .find((step) => step.tool === "getTrainingPlan");
    const snapshot =
      priorPlanRead?.status === "succeeded"
        ? completeTrainingPlanSchema.safeParse(priorPlanRead.result)
        : null;
    const weeklySnapshots = steps
      .filter(
        (step) => step.tool === "getWeeklyPlan" && step.status === "succeeded",
      )
      .slice(-2)
      .map((step) => step.result as WeeklyRead);
    let skippedForTurnBudget = selection.skippedForTurnBudget;
    for (const selected of selection.calls) {
      const stepIndex = steps.length + 1;
      const { accepted } = selected;
      if (budget().exploratoryRemaining <= 0) {
        skippedForTurnBudget += 1;
        break;
      }
      if (!canToolRunWithinBudget(accepted.toolName, analysisToolCounts)) {
        const step = failedStep(
          stepIndex,
          "tool_budget_exceeded",
          accepted.toolName,
          `${accepted.toolName} was rejected because its per-turn budget was already exhausted.`,
        );
        const allSteps = [...steps, step];
        return finish(
          {
            text: toolFailureLimitationText(allSteps),
            grounding: groundingForSteps(allSteps),
            toolSteps: allSteps,
            providerCalls,
          },
          "deterministic_fallback",
        );
      }
      if (
        ["saveTrainingPlan", "applyWeeklyProposal"].includes(
          accepted.toolName,
        ) &&
        steps.some((step) =>
          ["saveTrainingPlan", "applyWeeklyProposal"].includes(step.tool),
        )
      ) {
        const allSteps = [
          ...steps,
          failedStep(
            stepIndex,
            "duplicate_side_effect",
            accepted.toolName,
            "A plan/document save was already attempted this turn and was not repeated.",
          ),
        ];
        return finish(
          {
            text: toolFailureLimitationText(allSteps),
            grounding: groundingForSteps(allSteps),
            toolSteps: allSteps,
            providerCalls,
          },
          "deterministic_fallback",
        );
      }
      progress(toolProgressMessage(accepted.toolName));
      toolAttempts += 1;
      const step = await ports.executeTool({
        context,
        index: stepIndex,
        ...accepted,
        trainingPlanSnapshot: snapshot?.success ? snapshot.data : undefined,
        weeklyTurn: input.weeklyTurn,
        weeklySnapshots: weeklySnapshots,
      });
      if (selected.metadata) step.selection = selected.metadata;
      if (
        step.status === "succeeded" &&
        (accepted.toolName === "describeGarminDatabase" ||
          accepted.toolName === "runReadOnlySql" ||
          accepted.toolName === "runMathAnalysis")
      ) {
        analysisToolCounts.set(
          accepted.toolName,
          (analysisToolCounts.get(accepted.toolName) ?? 0) + 1,
        );
      }
      steps.push(step);
      if (step.status === "succeeded") toolsSucceeded += 1;
      else toolsUnsuccessful += 1;

      if (
        step.status === "succeeded" &&
        (step.tool === "runReadOnlySql" || step.tool === "runMathAnalysis")
      )
        failedMathCorrections.clear();
      if (step.status !== "succeeded") {
        if (
          step.tool === "runMathAnalysis" &&
          step.correctionAllowed === true
        ) {
          const fingerprint = JSON.stringify(accepted.input);
          if (!failedMathCorrections.has(fingerprint)) {
            failedMathCorrections.add(fingerprint);
            // A correction needs fresh arguments: never run a stale dependent
            // batch tail, even if a prior successful handle has the same name.
            skippedForTurnBudget = 0;
            break;
          }
        }
        if (canOfferSqlCorrectionStep(step)) {
          continue;
        }
        if (step.tool === "runReadOnlySql" || step.tool === "runMathAnalysis") {
          const synthesized = await synthesize();
          return finish(
            {
              text: synthesized ?? toolFailureLimitationText(steps),
              grounding: groundingForSteps(steps),
              toolSteps: steps,
              providerCalls,
            },
            synthesized ? "provider" : "deterministic_fallback",
          );
        }
        return finish(
          {
            text: toolFailureLimitationText(steps),
            grounding: groundingForSteps(steps),
            toolSteps: steps,
            providerCalls,
          },
          "deterministic_fallback",
        );
      }
    }

    if (skippedForTurnBudget > 0 || budget().exploratoryRemaining <= 0) {
      return finishAtBudget(skippedForTurnBudget);
    }
  }

  return finishAtBudget();
}

export const trainerOrchestrationLimits = {
  maxTotalTurnExecutions: MAX_TOTAL_TURN_EXECUTIONS,
  softTargetExecutions: TRAINER_EXECUTION_POLICY.softTarget,
  finalAnswerReserve: TRAINER_EXECUTION_POLICY.finalAnswerReserve,
  maxPlannerCalls: MAX_PLANNER_CALLS,
  maxToolCalls: MAX_TOOL_CALLS,
  maxGeneralToolCalls: MAX_GENERAL_TOOL_CALLS,
  maxSchemaCalls: MAX_SCHEMA_CALLS,
  maxSqlCalls: MAX_SQL_CALLS,
  maxMathCalls: MAX_MATH_CALLS,
  providerCallTimeoutMs: TRAINER_PROVIDER_CALL_TIMEOUT_MS,
};
