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
