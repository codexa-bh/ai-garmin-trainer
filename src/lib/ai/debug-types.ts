/**
 * Closed structural comparison of the locked-SDK output against the validated
 * terminal receipt. Never carries text, arguments, IDs or hashes.
 */
export type ReceiptMismatchDiagnostic =
  | { receipt: "absent" }
  | {
      receipt: "present";
      text:
        | "match"
        | "observed_empty"
        | "receipt_empty"
        | "observed_prefix"
        | "different";
      calls: "match" | "mismatch";
      observedCalls: number;
      receiptCalls: number;
      /** Canonical order; present only for a call mismatch. */
      callDifferences?: Array<"count" | "order" | "id" | "name" | "arguments">;
    };

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
  receipt?: ReceiptMismatchDiagnostic;
  /** Actual locked-SDK fallback outcomes, in canonical fixed-kind order. */
  dropped?: Array<{
    kind:
      | "response.output_item.added"
      | "response.output_item.done"
      | "response.output_text.delta";
    count: number;
  }>;
  responseCorrelation?: { source: "response.created"; id: string };
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
