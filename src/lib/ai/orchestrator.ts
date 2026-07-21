import { generateText } from "ai";
import {
  executeTrainerTool,
  groundingForSteps,
  renderToolSteps,
  trainerToolDefinitions,
  validateTrainerToolCall,
  type TrainerToolCall,
  type TrainerToolName,
  type TrainerToolStep,
} from "@/lib/ai/tools";
import type { ChatGrounding } from "@/lib/db/repository";

const MAX_PLANNER_CALLS = 2;
const MAX_TOOL_CALLS = 2;
const SIDE_EFFECT_TOOLS = new Set<TrainerToolName>([
  "runGarminSync",
  "forceRefreshActivityDetail",
]);

export type OrchestrateTrainerChatInput = {
  model: unknown;
  system: string;
  userRequest: string;
};

export type OrchestrateTrainerChatResult = {
  text: string;
  grounding: ChatGrounding | null;
  toolSteps: TrainerToolStep[];
  providerCalls: number;
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
    ? priorSteps
        .map(
          (step) =>
            `Step ${step.index}: ${step.tool} ${step.status}; ${bounded(step.summary, 500)}; privacy: ${step.privacy}`,
        )
        .join("\n")
    : "No prior tool step in this user turn.";
  return `${baseSystem}\n\nTrainer tool-selection policy:\n- Choose at most one listed tool when the current user request needs a Garmin/local-data action; otherwise answer directly without a tool.\n- The server validates and executes tools. Do not invent Garmin IDs, activity names/dates, rankings, metrics, sync/detail status, or connector results.\n- Prior assistant prose is not authoritative Garmin evidence. Names/dates must be verified before analysis.\n- Do not ask for credentials, raw FIT, full streams, filesystem paths, SQL, URLs, or arbitrary connector methods.\n- A user turn may execute at most two sequential tools. If a prior server step exists, either answer from that bounded evidence or select one valid second tool.\n\nCurrent turn server-authored prior tool summaries (fresh-call boundary; no provider response/tool-result messages are replayed):\n${prior}`;
}

function failedStep(index: 1 | 2, reason: string): TrainerToolStep {
  return {
    index,
    tool: "verifyActivityReference",
    status: "rejected",
    summary: `Provider tool selection was rejected: ${reason}.`,
    privacy:
      "No Garmin connector action or local analytics tool was executed for the rejected provider response.",
    reason,
  };
}

export async function orchestrateTrainerChat(
  input: OrchestrateTrainerChatInput,
): Promise<OrchestrateTrainerChatResult> {
  const steps: TrainerToolStep[] = [];
  const sideEffectsUsed = new Set<TrainerToolName>();
  let providerCalls = 0;

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
      })) as RawGenerateTextResult;
    } catch {
      if (steps.length) {
        return {
          text: renderToolSteps(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        };
      }
      return {
        text: "I could not get a valid response from the configured model. No Garmin tool was executed.",
        grounding: null,
        toolSteps: [],
        providerCalls,
      };
    }

    const toolCalls = (result.toolCalls ?? [])
      .map(extractToolCall)
      .filter((call): call is TrainerToolCall => Boolean(call));
    if (toolCalls.length === 0) {
      if (steps.length) {
        return {
          text: renderToolSteps(steps),
          grounding: groundingForSteps(steps),
          toolSteps: steps,
          providerCalls,
        };
      }
      const text = result.text?.trim();
      return {
        text:
          text || "I could not produce a useful answer from the local context.",
        grounding: null,
        toolSteps: [],
        providerCalls,
      };
    }

    const stepIndex = (steps.length + 1) as 1 | 2;
    if (toolCalls.length !== 1) {
      const step = failedStep(stepIndex, "invalid_tool_cardinality");
      return {
        text: renderToolSteps([step]),
        grounding: groundingForSteps([step]),
        toolSteps: [step],
        providerCalls,
      };
    }
    if (steps.length >= MAX_TOOL_CALLS) {
      const step = failedStep(2, "tool_budget_exceeded");
      return {
        text: renderToolSteps([...steps, step]),
        grounding: groundingForSteps([...steps, step]),
        toolSteps: [...steps, step],
        providerCalls,
      };
    }

    const accepted = validateTrainerToolCall(toolCalls[0]);
    if (!accepted.ok) {
      const step = failedStep(stepIndex, accepted.reason);
      return {
        text: renderToolSteps([...steps, step]),
        grounding: groundingForSteps([...steps, step]),
        toolSteps: [...steps, step],
        providerCalls,
      };
    }
    if (SIDE_EFFECT_TOOLS.has(accepted.toolName)) {
      if (sideEffectsUsed.has(accepted.toolName)) {
        const step = failedStep(stepIndex, "duplicate_side_effect");
        return {
          text: renderToolSteps([...steps, step]),
          grounding: groundingForSteps([...steps, step]),
          toolSteps: [...steps, step],
          providerCalls,
        };
      }
      sideEffectsUsed.add(accepted.toolName);
    }

    const step = await executeTrainerTool({
      index: stepIndex,
      toolName: accepted.toolName,
      args: accepted.input,
    });
    steps.push(step);

    if (step.status !== "succeeded") {
      return {
        text: renderToolSteps(steps),
        grounding: groundingForSteps(steps),
        toolSteps: steps,
        providerCalls,
      };
    }

    if (steps.length >= MAX_TOOL_CALLS) break;
  }

  return {
    text: renderToolSteps(steps),
    grounding: groundingForSteps(steps),
    toolSteps: steps,
    providerCalls,
  };
}

export const trainerOrchestrationLimits = {
  maxPlannerCalls: MAX_PLANNER_CALLS,
  maxToolCalls: MAX_TOOL_CALLS,
};
