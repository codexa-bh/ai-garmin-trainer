import { generateText } from "ai";
import {
  clearTrainerAnalysisResultHandles,
  executeTrainerTool,
  groundingForSteps,
  renderToolSteps,
  trainerToolDefinitions,
  validateTrainerToolCall,
  type TrainerToolCall,
  type TrainerToolName,
  type TrainerToolSelectionMetadata,
  type TrainerToolStep,
  type TrainerToolStepName,
} from "@/lib/ai/tools";
import {
  buildLlmDebugTrace,
  debugProviderCall,
  type LlmDebugProviderCall,
  type LlmDebugTrace,
} from "@/lib/ai/debug-trace";
import type { ChatGrounding } from "@/lib/db/repository";
import {
  buildFinalSynthesisInstructions,
  buildPlannerInstructions,
} from "@/lib/ai/trainer-instructions";

const MAX_PLANNER_CALLS = 5;
const MAX_TOOL_CALLS = 4;
const MAX_GENERAL_TOOL_CALLS = 4;
const MAX_SCHEMA_CALLS = 1;
const MAX_SQL_CALLS = 2;
const MAX_MATH_CALLS = 1;
const SIDE_EFFECT_TOOLS = new Set<TrainerToolName>([
  "runGarminSync",
  "forceRefreshActivityDetail",
]);

export type OrchestrateTrainerChatInput = {
  model: unknown;
  system: string;
  userRequest: string;
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
  debugTrace?: LlmDebugTrace;
};

type RawGenerateTextResult = {
  text?: string;
  toolCalls?: unknown[];
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

function plannerSystem(
  baseSystem: string,
  priorSteps: TrainerToolStep[],
): string {
  const prior = priorSteps.length
    ? synthesisEvidenceForSteps(priorSteps)
    : "No prior tool step in this user turn.";
  return buildPlannerInstructions(baseSystem, prior);
}

function failedStep(
  index: 1 | 2 | 3 | 4,
  reason: string,
  tool: TrainerToolStepName = "providerToolSelection",
  summary?: string,
): TrainerToolStep {
  return {
    index,
    tool,
    status: "rejected",
    summary: summary ?? `Provider tool selection was rejected: ${reason}.`,
    privacy:
      "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
    reason,
  };
}

function providerSelectionFailureText(step: TrainerToolStep): string {
  if (step.reason === "multiple_tool_calls")
    return "I tried to continue the local Garmin analysis, but the model selected multiple tools at once. I did not run an unsafe action. Please ask me to retry the ranking with one SQL query, or narrow the criteria you want me to use.";
  if (step.reason === "multiple_tool_calls_with_side_effect")
    return "The model selected more than one tool, including a tool that can change local sync/detail state. I did not run those actions blindly. Please ask for the single sync, refresh, status, or analysis action you want next.";
  if (step.reason === "multiple_tool_calls_no_safe_tool")
    return "The model selected multiple tools, but none was safe and valid to run as the next single action. I did not execute them blindly; please retry with one narrower local Garmin request.";
  return "I could not select a safe local Garmin tool for that response, so I did not execute any tool. Please retry with one narrower request.";
}

function synthesisEvidenceForSteps(steps: TrainerToolStep[]): string {
  return steps
    .map((step) => {
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
): string {
  return buildFinalSynthesisInstructions(
    baseSystem,
    synthesisEvidenceForSteps(steps),
  );
}

function isAcceptableToolSynthesisText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\bTool step \d+:/i.test(trimmed)) return false;
  if (/^Privacy:/im.test(trimmed)) return false;
  return true;
}

const NON_TERMINAL_LOCAL_DATA_LIMITATION =
  "I couldn't complete that local Garmin check because the model returned a plan instead of selecting a safe local-data tool. Please retry or narrow the activity/date you want me to check.";

function isLikelyLocalDataRequest(userRequest: string): boolean {
  const normalized = userRequest.toLowerCase();
  const hasPersonalAnchor =
    /\b(my|mine|me|i)\b/.test(normalized) ||
    /\b(yesterday|today|last|recent|near (to )?my home)\b/.test(normalized);
  const hasLocalDataSubject =
    /\b(garmin|activity|activities|hike|hikes|run|runs|ride|rides|walk|walks|route|routes|sync|detail|details|variation|variations)\b/.test(
      normalized,
    );
  return hasPersonalAnchor && hasLocalDataSubject;
}

function isNonTerminalLocalDataPlan(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const hasFutureMarker =
    /\b(i['’]?ll|i will|i would|i need to|i'm going to|i am going to|let me)\b/.test(
      normalized,
    ) || /\b(first|next|then|after that)\b/.test(normalized);
  const hasLocalDataAction =
    /\b(pull up|look up|fetch|retrieve|check|inspect|review|verify|find|compare|analy[sz]e|query)\b/.test(
      normalized,
    );
  const hasLocalDataSubject =
    /\b(garmin|activity|activities|hike|hikes|run|runs|ride|rides|route|routes|local data|metadata|detail|details|database|sql|nearby|variation|variations|yesterday|recent)\b/.test(
      normalized,
    );
  return hasFutureMarker && hasLocalDataAction && hasLocalDataSubject;
}

function isNonTerminalLocalDataDirectAnswer(input: {
  userRequest: string;
  text: string;
}): boolean {
  return (
    isLikelyLocalDataRequest(input.userRequest) &&
    isNonTerminalLocalDataPlan(input.text)
  );
}

function canToolRunWithinBudget(
  toolName: TrainerToolName,
  analysisToolCounts: Map<TrainerToolName, number>,
): boolean {
  const currentCount = analysisToolCounts.get(toolName) ?? 0;
  if (toolName === "describeGarminDatabase")
    return currentCount < MAX_SCHEMA_CALLS;
  if (toolName === "runReadOnlySql") return currentCount < MAX_SQL_CALLS;
  if (toolName === "runMathAnalysis") return currentCount < MAX_MATH_CALLS;
  return true;
}

function selectedToolPriority(
  toolName: TrainerToolName,
  priorSteps: TrainerToolStep[],
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

function selectOneSafeToolCall(input: {
  toolCalls: TrainerToolCall[];
  priorSteps: TrainerToolStep[];
  analysisToolCounts: Map<TrainerToolName, number>;
}):
  | { ok: true; call: TrainerToolCall; metadata: TrainerToolSelectionMetadata }
  | { ok: false; step: TrainerToolStep } {
  const toolNames = input.toolCalls
    .map((call) => call.toolName)
    .filter((toolName, index, names) => names.indexOf(toolName) === index)
    .slice(0, 8);
  const validCalls = input.toolCalls.flatMap((call, order) => {
    const accepted = validateTrainerToolCall(call);
    if (!accepted.ok) return [];
    return [{ call, order, toolName: accepted.toolName }];
  });
  const sideEffectCalls = validCalls.filter((item) =>
    SIDE_EFFECT_TOOLS.has(item.toolName),
  );
  const stepIndex = (input.priorSteps.length + 1) as 1 | 2 | 3 | 4;
  if (sideEffectCalls.length) {
    return {
      ok: false,
      step: failedStep(
        stepIndex,
        "multiple_tool_calls_with_side_effect",
        "providerToolSelection",
        `Provider selected ${input.toolCalls.length} tools (${toolNames.join(", ")}); at least one can change local sync/detail state, so none was executed.`,
      ),
    };
  }
  const candidates = validCalls
    .filter((item) =>
      canToolRunWithinBudget(item.toolName, input.analysisToolCounts),
    )
    .sort((left, right) => {
      const priority =
        selectedToolPriority(left.toolName, input.priorSteps) -
        selectedToolPriority(right.toolName, input.priorSteps);
      return priority || left.order - right.order;
    });
  const selected = candidates[0];
  if (!selected) {
    return {
      ok: false,
      step: failedStep(
        stepIndex,
        "multiple_tool_calls_no_safe_tool",
        "providerToolSelection",
        `Provider selected ${input.toolCalls.length} tools (${toolNames.join(", ") || "none recognized"}); none was a safe valid next tool.`,
      ),
    };
  }
  return {
    ok: true,
    call: selected.call,
    metadata: {
      reason: "multiple_tool_calls",
      count: input.toolCalls.length,
      toolNames,
      selectedTool: selected.toolName,
    },
  };
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
  const reason = failed.reason ? ` Reason: ${failed.reason}.` : "";
  return `I couldn't complete the local ${failed.tool} request within the safety guardrails.${reason} ${failed.summary}`;
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
    sqlLimitationText(steps) ??
    genericToolLimitationText(steps) ??
    "I couldn't complete that local Garmin tool request within the safety guardrails. Please try a narrower request."
  );
}

async function synthesizeFinalAnswer(
  input: OrchestrateTrainerChatInput,
  steps: TrainerToolStep[],
  recordProviderCall?: (call: LlmDebugProviderCall) => void,
): Promise<string | null> {
  let result: RawGenerateTextResult;
  try {
    result = (await (
      generateText as unknown as (
        options: Record<string, unknown>,
      ) => Promise<RawGenerateTextResult>
    )({
      model: input.model,
      system: finalAnswerSystem(input.system, steps),
      prompt: input.userRequest,
      toolChoice: "none",
    })) as RawGenerateTextResult;
  } catch (error) {
    recordProviderCall?.(
      debugProviderCall({
        index: 0,
        purpose: "final_synthesis",
        error: error instanceof Error ? error.message : "provider_exception",
      }),
    );
    return null;
  }
  if (!result) return null;

  const text = result.text?.trim() ?? "";
  const toolCalls = (result.toolCalls ?? [])
    .map(extractToolCall)
    .filter((call): call is TrainerToolCall => Boolean(call));
  recordProviderCall?.(
    debugProviderCall({
      index: 0,
      purpose: "final_synthesis",
      toolCalls,
      text,
    }),
  );
  if (toolCalls.length || !isAcceptableToolSynthesisText(text)) return null;
  return text;
}

export async function orchestrateTrainerChat(
  input: OrchestrateTrainerChatInput,
): Promise<OrchestrateTrainerChatResult> {
  clearTrainerAnalysisResultHandles();
  const steps: TrainerToolStep[] = [];
  const sideEffectsUsed = new Set<TrainerToolName>();
  const analysisToolCounts = new Map<TrainerToolName, number>();
  let providerCalls = 0;
  const debugEnabled = input.debug?.enabled === true;
  const debugProviderCalls: LlmDebugProviderCall[] = [];
  const recordProviderCall = (call: LlmDebugProviderCall) => {
    if (!debugEnabled) return;
    debugProviderCalls.push({ ...call, index: debugProviderCalls.length + 1 });
  };
  const finish = (
    result: Omit<OrchestrateTrainerChatResult, "debugTrace">,
    finalAnswerSource?: LlmDebugTrace["finalAnswerSource"],
  ) => {
    if (!debugEnabled) return result;
    return {
      ...result,
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

  for (let plannerCall = 0; plannerCall < MAX_PLANNER_CALLS; plannerCall += 1) {
    providerCalls += 1;
    let result: RawGenerateTextResult;
    try {
      result = (await (
        generateText as unknown as (
          options: Record<string, unknown>,
        ) => Promise<RawGenerateTextResult>
      )({
        model: input.model,
        system: plannerSystem(input.system, steps),
        prompt: input.userRequest,
        tools: trainerToolDefinitions,
        toolChoice: "auto",
        parallelToolCalls: false,
        providerOptions: {
          openai: { parallelToolCalls: false },
          deepseek: { parallelToolCalls: false },
        },
      })) as RawGenerateTextResult;
    } catch (error) {
      recordProviderCall(
        debugProviderCall({
          index: 0,
          purpose: steps.length ? "failure_fallback" : "planner",
          error: error instanceof Error ? error.message : "provider_exception",
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
          text: "I could not get a valid response from the configured model. No Garmin tool was executed.",
          grounding: null,
          toolSteps: [],
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
        purpose: toolCalls.length
          ? "planner"
          : steps.length
            ? "final_synthesis"
            : "direct_answer",
        toolCalls,
        text: result.text?.trim() ?? "",
      }),
    );
    if (toolCalls.length === 0) {
      if (steps.length) {
        const text = result.text?.trim() ?? "";
        const synthesized = isAcceptableToolSynthesisText(text)
          ? text
          : await synthesizeFinalAnswer(input, steps, recordProviderCall);
        return finish({
          text: synthesized ?? toolFailureLimitationText(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        });
      }
      const text = result.text?.trim() ?? "";
      if (
        isNonTerminalLocalDataDirectAnswer({
          userRequest: input.userRequest,
          text,
        })
      ) {
        return finish(
          {
            text: NON_TERMINAL_LOCAL_DATA_LIMITATION,
            grounding: null,
            toolSteps: [],
            providerCalls,
          },
          "deterministic_fallback",
        );
      }
      return finish({
        text:
          text || "I could not produce a useful answer from the local context.",
        grounding: null,
        toolSteps: [],
        providerCalls,
      });
    }

    const stepIndex = (steps.length + 1) as 1 | 2 | 3 | 4;
    let selectedToolCall = toolCalls[0];
    let selectionMetadata: TrainerToolSelectionMetadata | undefined;
    if (toolCalls.length > 1) {
      const selection = selectOneSafeToolCall({
        toolCalls,
        priorSteps: steps,
        analysisToolCounts,
      });
      if (!selection.ok) {
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
      selectedToolCall = selection.call;
      selectionMetadata = selection.metadata;
    }
    if (steps.length >= MAX_TOOL_CALLS) {
      const step = failedStep(
        2,
        "tool_budget_exceeded",
        "providerToolSelection",
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

    const accepted = validateTrainerToolCall(selectedToolCall);
    if (!accepted.ok) {
      const attemptedTool =
        Object.prototype.hasOwnProperty.call(
          trainerToolDefinitions,
          selectedToolCall.toolName,
        ) && typeof selectedToolCall.toolName === "string"
          ? (selectedToolCall.toolName as TrainerToolName)
          : "providerToolSelection";
      const step = failedStep(stepIndex, accepted.reason, attemptedTool);
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
    if (SIDE_EFFECT_TOOLS.has(accepted.toolName)) {
      if (sideEffectsUsed.has(accepted.toolName)) {
        const step = failedStep(
          stepIndex,
          "duplicate_side_effect",
          accepted.toolName,
          `${accepted.toolName} was rejected because that side-effect tool was already used in this turn.`,
        );
        return finish(
          {
            text: toolFailureLimitationText([...steps, step]),
            grounding: groundingForSteps([...steps, step]),
            toolSteps: [...steps, step],
            providerCalls,
          },
          "deterministic_fallback",
        );
      }
      sideEffectsUsed.add(accepted.toolName);
    }
    const currentCount = analysisToolCounts.get(accepted.toolName) ?? 0;
    if (!canToolRunWithinBudget(accepted.toolName, analysisToolCounts)) {
      const step = failedStep(
        stepIndex,
        "tool_budget_exceeded",
        accepted.toolName,
        `${accepted.toolName} was rejected because the per-turn tool budget was already exhausted.`,
      );
      const allSteps = [...steps, step];
      const synthesized = await synthesizeFinalAnswer(
        input,
        allSteps,
        recordProviderCall,
      );
      return finish(
        {
          text: synthesized ?? toolFailureLimitationText(allSteps),
          grounding: groundingForSteps(allSteps),
          toolSteps: allSteps,
          providerCalls,
        },
        synthesized ? "provider" : "deterministic_fallback",
      );
    }
    if (
      accepted.toolName === "describeGarminDatabase" ||
      accepted.toolName === "runReadOnlySql" ||
      accepted.toolName === "runMathAnalysis"
    ) {
      analysisToolCounts.set(accepted.toolName, currentCount + 1);
    }

    const step = await executeTrainerTool({
      index: stepIndex,
      toolName: accepted.toolName,
      args: accepted.input,
    });
    if (selectionMetadata) step.selection = selectionMetadata;
    steps.push(step);

    if (step.status !== "succeeded") {
      if (
        canOfferSqlCorrectionStep(step) &&
        steps.length < MAX_TOOL_CALLS &&
        plannerCall + 1 < MAX_PLANNER_CALLS
      ) {
        continue;
      }
      if (step.tool === "runReadOnlySql" || step.tool === "runMathAnalysis") {
        const synthesized = await synthesizeFinalAnswer(
          input,
          steps,
          recordProviderCall,
        );
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

    if (steps.length >= MAX_GENERAL_TOOL_CALLS) {
      providerCalls += 1;
      const text = await synthesizeFinalAnswer(
        input,
        steps,
        recordProviderCall,
      );
      return finish(
        {
          text: text ?? toolFailureLimitationText(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        },
        text ? "provider" : "deterministic_fallback",
      );
    }
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

export const trainerOrchestrationLimits = {
  maxPlannerCalls: MAX_PLANNER_CALLS,
  maxToolCalls: MAX_TOOL_CALLS,
  maxGeneralToolCalls: MAX_GENERAL_TOOL_CALLS,
  maxSchemaCalls: MAX_SCHEMA_CALLS,
  maxSqlCalls: MAX_SQL_CALLS,
  maxMathCalls: MAX_MATH_CALLS,
};
