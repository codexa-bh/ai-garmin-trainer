import type {
  ProviderFailureDiagnostic,
  ReceiptMismatchDiagnostic,
} from "../ai/debug-types";

// Shared pure trust boundary for adapters, stored metadata and presentation.
// Closed semantic values: syntactically harmless provider text can still be private.
const categories = new Set([
  "request_failed",
  "unsupported_request",
  "unsupported_tools",
  "unsupported_tool_call",
  "malformed_tool_arguments",
  "unsupported_output",
  "malformed_stream",
  "missing_completion",
  "events_after_completion",
  "malformed_completion",
  "stream_too_large",
  "stream_event_too_large",
  "response_incomplete",
  "incomplete_sdk_decoding",
  "sdk_text_lifecycle_failed",
  "streaming_required",
  "response_decoding_failed",
  "provider_transport_failed",
  "generation_failed",
  "connection_unavailable",
  "connection_invalidated",
  "stream_interrupted",
  "request_interrupted",
  "admission_invalidated",
  "request_aborted",
  "subscription_sharing_usage_limit_exceeded",
  "rate_limit_exceeded",
  "insufficient_quota",
]);
const fullMatch = (pattern: RegExp, value: string) =>
  pattern.exec(value)?.[0] === value;
export function safeFailureCategory(value: unknown): string {
  return typeof value === "string" &&
    (categories.has(value) ||
      fullMatch(/^http_[1-5][0-9]{2}$/, value) ||
      fullMatch(
        /^unsupported_response_[1-5][0-9]{2}_(json|html|other|missing_type|bounded_body|empty_body|empty_body_no_url|sse_like|json_error|json_completed|json_incomplete|json_other)$/,
        value,
      ))
    ? value
    : "request_failed";
}
const stages = new Set<ProviderFailureDiagnostic["stage"]>([
  "upstream_request",
  "upstream_read",
  "stream_validation",
  "sdk_decode",
  "native_credential",
  "native_poll",
  "native_final_current",
  "local_admission",
  "aborted",
  "generation",
]);
const receiptTextStates = new Set([
  "match",
  "observed_empty",
  "receipt_empty",
  "observed_prefix",
  "different",
]);
/** Canonical order; also the closed set of call mismatch dimensions. */
export const RECEIPT_CALL_DIFFERENCES = [
  "count",
  "order",
  "id",
  "name",
  "arguments",
] as const;
/** The stream is capped at 4 MiB; each function_call exceeds 128 serialized bytes. */
const MAX_RECEIPT_CALLS = 32768;
const callCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= MAX_RECEIPT_CALLS;
const exactKeys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
/** Validate the whole closed receipt value; anything else is omitted whole. */
function safeReceiptDiagnostic(
  value: unknown,
): ReceiptMismatchDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  if (v.receipt === "absent")
    return exactKeys(v, ["receipt"]) ? { receipt: "absent" } : undefined;
  if (
    v.receipt !== "present" ||
    !exactKeys(v, [
      "receipt",
      "text",
      "calls",
      "observedCalls",
      "receiptCalls",
      "callDifferences",
    ]) ||
    typeof v.text !== "string" ||
    !receiptTextStates.has(v.text) ||
    (v.calls !== "match" && v.calls !== "mismatch") ||
    !callCount(v.observedCalls) ||
    !callCount(v.receiptCalls)
  )
    return undefined;
  const differences = v.callDifferences;
  if (v.calls === "match") {
    if (
      v.text === "match" ||
      differences !== undefined ||
      v.observedCalls !== v.receiptCalls
    )
      return undefined;
  } else {
    const canonical = Array.isArray(differences)
      ? RECEIPT_CALL_DIFFERENCES.filter((item) => differences.includes(item))
      : [];
    if (
      !Array.isArray(differences) ||
      !canonical.length ||
      canonical.length !== differences.length ||
      canonical.some((item, index) => differences[index] !== item) ||
      canonical.includes("count") !== (v.observedCalls !== v.receiptCalls)
    )
      return undefined;
  }
  return {
    receipt: "present",
    text: v.text as Extract<
      ReceiptMismatchDiagnostic,
      { receipt: "present" }
    >["text"],
    calls: v.calls,
    observedCalls: v.observedCalls,
    receiptCalls: v.receiptCalls,
    ...(v.calls === "mismatch"
      ? {
          callDifferences: [
            ...(differences as (typeof RECEIPT_CALL_DIFFERENCES)[number][]),
          ],
        }
      : {}),
  };
}
const receiptField = (value: unknown) => {
  const receipt = safeReceiptDiagnostic(value);
  return receipt ? { receipt } : {};
};
export const SDK_DROPPED_KINDS = [
  "response.output_item.added",
  "response.output_item.done",
  "response.output_text.delta",
] as const;
function safeDropped(value: unknown): ProviderFailureDiagnostic["dropped"] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > SDK_DROPPED_KINDS.length
  )
    return undefined;
  let previous = -1;
  const result: NonNullable<ProviderFailureDiagnostic["dropped"]> = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !exactKeys(item, ["kind", "count"])
    )
      return undefined;
    const index = SDK_DROPPED_KINDS.indexOf(item.kind);
    // Even the shortest invalid known-type event exceeds 32 serialized bytes
    // in the 4 MiB stream; count actual outcomes without saturation.
    if (
      index <= previous ||
      !Number.isSafeInteger(item.count) ||
      item.count < 1 ||
      item.count > 131072
    )
      return undefined;
    result.push({ kind: SDK_DROPPED_KINDS[index], count: item.count });
    previous = index;
  }
  return result;
}
/** Supported subset demonstrated by OpenAI's public Responses cookbook example.
 * Omit other formats whole; this is correlation, not authentication or a cause.
 */
function safeResponseCorrelation(
  value: unknown,
): ProviderFailureDiagnostic["responseCorrelation"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  return exactKeys(v, ["source", "id"]) &&
    v.source === "response.created" &&
    typeof v.id === "string" &&
    fullMatch(/^resp_[a-f0-9]{32}$/, v.id)
    ? { source: "response.created", id: v.id }
    : undefined;
}
/** Copy only the finite diagnostic contract, never an error/cause or arbitrary detail. */
export function safeFailureDiagnostic(
  value: unknown,
): ProviderFailureDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const v = value as ProviderFailureDiagnostic;
  if (!stages.has(v.stage)) return undefined;
  const dropped = safeDropped(v.dropped);
  const responseCorrelation = safeResponseCorrelation(v.responseCorrelation);
  return {
    ...(dropped ? { dropped } : {}),
    ...(responseCorrelation ? { responseCorrelation } : {}),
    category: safeFailureCategory(v.category),
    stage: v.stage,
    ...(Number.isSafeInteger(v.elapsedMs) &&
    v.elapsedMs! >= 0 &&
    v.elapsedMs! <= 86400000
      ? { elapsedMs: v.elapsedMs }
      : {}),
    ...(Number.isInteger(v.status) && v.status! >= 100 && v.status! <= 599
      ? { status: v.status }
      : {}),
    ...(typeof v.requestId === "string" &&
    fullMatch(/^[A-Za-z0-9_-]{1,128}$/, v.requestId)
      ? { requestId: v.requestId }
      : {}),
    ...(["incomplete_sdk_decoding", "sdk_text_lifecycle_failed"].includes(
      v.category,
    ) && v.stage === "sdk_decode"
      ? receiptField(v.receipt)
      : {}),
  };
}
