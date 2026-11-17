import type { ProviderFailureDiagnostic } from "./debug-types";

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
