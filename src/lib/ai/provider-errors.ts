import type {
  ProviderFailureDiagnostic,
  ReceiptMismatchDiagnostic,
} from "./debug-types";

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
/**
 * The validated stream is capped at 4 MiB and every function_call needs well
 * over 128 serialized bytes, so no admissible receipt has more calls.
 */
const MAX_RECEIPT_CALLS = 32768;
const callCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= MAX_RECEIPT_CALLS;
const exactKeys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
/** Validate the whole closed receipt value; anything else is omitted whole. */
export function safeReceiptDiagnostic(
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
    // A diagnostic exists only for a failed comparison.
    if (
      v.text === "match" ||
      differences !== undefined ||
      v.observedCalls !== v.receiptCalls
    )
      return undefined;
  } else {
    // Exactly the canonical subsequence of known dimensions: no duplicates,
    // unknown values or unstable ordering.
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
    observedCalls: v.observedCalls as number,
    receiptCalls: v.receiptCalls as number,
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
/** Copy only the finite diagnostic contract, never an error/cause or arbitrary detail. */
export function safeFailureDiagnostic(
  value: unknown,
): ProviderFailureDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as ProviderFailureDiagnostic;
  if (!stages.has(v.stage)) return undefined;
  return {
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
    ...(v.category === "incomplete_sdk_decoding" && v.stage === "sdk_decode"
      ? receiptField(v.receipt)
      : {}),
  };
}
export function providerFailureDiagnostic(
  provider: string | undefined,
  error: unknown,
) {
  return provider === "chatgpt" && error && typeof error === "object"
    ? safeFailureDiagnostic((error as { failure?: unknown }).failure)
    : undefined;
}

/** Do not persist upstream OpenRouter error text, headers, or response bodies. */
export function providerFailureMessage(
  provider: string | undefined,
  error: unknown,
): string {
  if (provider === "chatgpt") {
    const category = providerFailureDiagnostic(provider, error)?.category;
    return `ChatGPT plan request unavailable${category ? ` (${category})` : ""}. Check the connection or model in native Settings; no paid fallback.`;
  }
  if (provider !== "openrouter")
    return error instanceof Error ? error.message : "provider_exception";

  // SDK retries may wrap the final HTTP error. Inspect only a bounded status chain.
  let current = error;
  let status: unknown;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object") break;
    const candidate = current as { statusCode?: unknown; lastError?: unknown };
    status = candidate.statusCode;
    if (typeof status === "number") break;
    current = candidate.lastError;
  }
  if (status === 401 || status === 403)
    return "OpenRouter provider authentication/permission failed. Check the API key and account routing/privacy settings.";
  if (status === 429)
    return "OpenRouter provider rate limit reached. Retry later; no alternate model was selected.";
  if (status === 400 || status === 404 || status === 422)
    return "OpenRouter provider rejected the model or chat/tool request. Check OPENROUTER_MODEL and tool support; no alternate model was selected.";
  return "OpenRouter provider unavailable or returned an invalid response. Retry later and check model availability; no alternate model was selected.";
}
