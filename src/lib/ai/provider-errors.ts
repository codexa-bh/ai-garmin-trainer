import { safeFailureDiagnostic } from "../diagnostics/provider-failure";
// Compatibility exports for existing adapter and debug consumers.
export {
  safeFailureDiagnostic,
  safeFailureCategory,
  RECEIPT_CALL_DIFFERENCES,
  SDK_DROPPED_KINDS,
} from "../diagnostics/provider-failure";

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
