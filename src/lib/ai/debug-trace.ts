import type { TrainerToolCall, TrainerToolStep } from "@/lib/ai/tools";

export type LlmDebugProviderCallPurpose =
  "planner" | "final_synthesis" | "direct_answer" | "failure_fallback";

export type LlmDebugProviderCall = {
  index: number;
  purpose: LlmDebugProviderCallPurpose;
  toolCalls?: Array<{ toolName: string; input: unknown; truncated?: boolean }>;
  text?: string;
  unavailable?: string[];
  error?: string;
  truncated?: boolean;
};

export type LlmDebugTrace = {
  schemaVersion: 1;
  capturedAt: string;
  provider?: string;
  model?: string | null;
  userRequest?: string;
  providerCalls: LlmDebugProviderCall[];
  toolSteps: Array<{
    index: number;
    tool: string;
    status: "succeeded" | "rejected" | "failed";
    validatedInput?: unknown;
    result?: unknown;
    summary?: string;
    privacy?: string;
    reason?: string;
    selection?: unknown;
    truncated?: boolean;
  }>;
  finalAnswer: string;
  finalAnswerSource?: "provider" | "deterministic_fallback" | "direct";
  caps: Record<string, number>;
  truncated?: boolean;
};

const LLM_DEBUG_TRACE_CAPS = {
  string: 1200,
  finalAnswer: 4000,
  userRequest: 2000,
  arrayItems: 20,
  objectKeys: 40,
  depth: 5,
  providerCalls: 12,
  toolSteps: 4,
} as const;

type BoundedResult = { value: unknown; truncated: boolean };
type DebuggableToolStep = Pick<
  TrainerToolStep,
  "index" | "status" | "summary" | "privacy"
> & {
  tool: string;
  reason?: string;
  result?: unknown;
  selection?: unknown;
};

function compactString(value: string, max: number): BoundedResult {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return { value: compact, truncated: false };
  return { value: `${compact.slice(0, max - 1)}…`, truncated: true };
}

function boundedDebugValue(
  value: unknown,
  depth: number = LLM_DEBUG_TRACE_CAPS.depth,
): BoundedResult {
  if (typeof value === "string")
    return compactString(value, LLM_DEBUG_TRACE_CAPS.string);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { value, truncated: false };
  }
  if (typeof value === "undefined" || typeof value === "function") {
    return { value: undefined, truncated: true };
  }
  if (depth <= 0) return { value: "[capped-depth]", truncated: true };
  if (Array.isArray(value)) {
    let truncated = value.length > LLM_DEBUG_TRACE_CAPS.arrayItems;
    const items = value
      .slice(0, LLM_DEBUG_TRACE_CAPS.arrayItems)
      .map((item) => {
        const bounded = boundedDebugValue(item, depth - 1);
        truncated = truncated || bounded.truncated;
        return bounded.value;
      });
    return { value: items, truncated };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    let truncated = entries.length > LLM_DEBUG_TRACE_CAPS.objectKeys;
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(
      0,
      LLM_DEBUG_TRACE_CAPS.objectKeys,
    )) {
      const bounded = boundedDebugValue(item, depth - 1);
      if (typeof bounded.value !== "undefined") out[key] = bounded.value;
      truncated = truncated || bounded.truncated;
    }
    return { value: out, truncated };
  }
  return { value: String(value), truncated: true };
}

export function debugProviderCall(input: {
  index: number;
  purpose: LlmDebugProviderCallPurpose;
  toolCalls?: TrainerToolCall[];
  text?: string;
  error?: string;
}): LlmDebugProviderCall {
  let truncated = false;
  const text = input.text
    ? compactString(input.text, LLM_DEBUG_TRACE_CAPS.string)
    : null;
  const error = input.error
    ? compactString(input.error, LLM_DEBUG_TRACE_CAPS.string)
    : null;
  const toolCalls = input.toolCalls?.map((call) => {
    const bounded = boundedDebugValue(
      call.toolName === "saveTrainingPlan"
        ? { documentContent: "omitted" }
        : call.input,
    );
    truncated = truncated || bounded.truncated;
    return {
      toolName: call.toolName,
      input: bounded.value,
      truncated: bounded.truncated || undefined,
    };
  });
  truncated =
    truncated || Boolean(text?.truncated) || Boolean(error?.truncated);
  return {
    index: input.index,
    purpose: input.purpose,
    ...(toolCalls?.length ? { toolCalls } : {}),
    ...(text ? { text: text.value as string } : {}),
    unavailable: ["raw provider request", "raw provider response"],
    ...(error ? { error: error.value as string } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}

export function buildLlmDebugTrace(input: {
  provider?: string;
  model?: string | null;
  userRequest: string;
  providerCalls: LlmDebugProviderCall[];
  toolSteps: DebuggableToolStep[];
  finalAnswer: string;
  finalAnswerSource?: LlmDebugTrace["finalAnswerSource"];
  capturedAt?: string;
}): LlmDebugTrace {
  let truncated = false;
  const userRequest = compactString(
    input.userRequest,
    LLM_DEBUG_TRACE_CAPS.userRequest,
  );
  const finalAnswer = compactString(
    input.finalAnswer,
    LLM_DEBUG_TRACE_CAPS.finalAnswer,
  );
  truncated = userRequest.truncated || finalAnswer.truncated;
  const providerCalls = input.providerCalls.slice(
    0,
    LLM_DEBUG_TRACE_CAPS.providerCalls,
  );
  truncated =
    truncated ||
    input.providerCalls.length > providerCalls.length ||
    providerCalls.some((call) => call.truncated);
  const toolSteps = input.toolSteps
    .slice(0, LLM_DEBUG_TRACE_CAPS.toolSteps)
    .map((step) => {
      const result = boundedDebugValue(
        step.tool === "getTrainingPlan"
          ? { documentContent: "omitted; see compact step summary" }
          : step.result,
      );
      truncated = truncated || result.truncated;
      const summary = compactString(step.summary, LLM_DEBUG_TRACE_CAPS.string);
      const privacy = compactString(step.privacy, LLM_DEBUG_TRACE_CAPS.string);
      const reason = step.reason
        ? compactString(step.reason, LLM_DEBUG_TRACE_CAPS.string)
        : null;
      truncated =
        truncated ||
        summary.truncated ||
        privacy.truncated ||
        Boolean(reason?.truncated);
      return {
        index: step.index,
        tool: step.tool,
        status: step.status,
        result: result.value,
        summary: summary.value as string,
        privacy: privacy.value as string,
        ...(reason ? { reason: reason.value as string } : {}),
        ...(step.selection ? { selection: step.selection } : {}),
        ...(result.truncated ||
        summary.truncated ||
        privacy.truncated ||
        reason?.truncated
          ? { truncated: true }
          : {}),
      };
    });
  truncated = truncated || input.toolSteps.length > toolSteps.length;
  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    userRequest: userRequest.value as string,
    providerCalls,
    toolSteps,
    finalAnswer: finalAnswer.value as string,
    finalAnswerSource: input.finalAnswerSource,
    caps: { ...LLM_DEBUG_TRACE_CAPS },
    ...(truncated ? { truncated: true } : {}),
  };
}

export function fallbackLlmDebugTrace(input: {
  provider?: string;
  model?: string | null;
  userRequest: string;
  finalAnswer: string;
  toolSteps?: DebuggableToolStep[];
  reason: string;
}): LlmDebugTrace {
  return buildLlmDebugTrace({
    provider: input.provider,
    model: input.model,
    userRequest: input.userRequest,
    providerCalls: [
      debugProviderCall({
        index: 1,
        purpose: "failure_fallback",
        text: input.reason,
      }),
    ],
    toolSteps: input.toolSteps ?? [],
    finalAnswer: input.finalAnswer,
    finalAnswerSource: "deterministic_fallback",
  });
}
