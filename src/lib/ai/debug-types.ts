export type ProviderFailureDiagnostic = {
  category: string;
  stage:
    | "upstream_request"
    | "upstream_read"
    | "stream_validation"
    | "sdk_decode"
    | "native_credential"
    | "native_poll"
    | "native_final_current"
    | "local_admission"
    | "aborted"
    | "generation";
  elapsedMs?: number;
  status?: number;
  requestId?: string;
};

export type TrainerTokenUsage = {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Ordinary input, excluding both reads and reported writes. */
  uncachedInputTokens?: number;
  outputTokens?: number;
};

export type LlmDebugProviderCallPurpose =
  "planner" | "final_synthesis" | "direct_answer" | "failure_fallback";

export type LlmDebugProviderCall = {
  index: number;
  purpose: LlmDebugProviderCallPurpose;
  tokenUsage?: TrainerTokenUsage;
  toolCalls?: Array<{ toolName: string; input: unknown; truncated?: boolean }>;
  text?: string;
  unavailable?: string[];
  error?: string;
  failure?: ProviderFailureDiagnostic;
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
