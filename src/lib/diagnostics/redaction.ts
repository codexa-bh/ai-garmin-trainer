const KEY_VALUE_SECRET =
  /\b(OPENAI_API_KEY|DEEPSEEK_API_KEY|GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_ID|BETTER_AUTH_SECRET|GARMIN_PASSWORD|GARMIN_TOKEN|GARMIN_COOKIE|access_token|refresh_token|id_token|client_secret)\b\s*[:=]\s*["']?[^\s,"']+/gi;
const PROVIDER_KEY = /\b(sk-[A-Za-z0-9_-]{8,}|ds-[A-Za-z0-9_-]{8,})\b/g;
const GARMIN_TOKEN_JSON =
  /("(?:access_token|refresh_token|oauth_token|oauth_token_secret|session|cookie)"\s*:\s*")[^"]+(")/gi;
const PRECISE_COORDINATE =
  /\b(lat|latitude|lon|longitude|positionLat|positionLong|lat_deg|lon_deg)\b\s*[:=]\s*-?\d{1,3}\.\d{3,}/gi;
const PROMPT_BLOCK =
  /\b(prompt|messages?|conversation|rawPayload|raw_payload|fitBytes|connectorPayload)\b\s*[:=]\s*(["']).*?\2/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(KEY_VALUE_SECRET, "$1=<redacted>")
    .replace(PROVIDER_KEY, "<redacted-provider-key>")
    .replace(GARMIN_TOKEN_JSON, "$1<redacted>$2")
    .replace(PRECISE_COORDINATE, "$1=<redacted-coordinate>")
    .replace(PROMPT_BLOCK, "$1=<redacted-sensitive-text>");
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (
        /secret|token|password|cookie|key|prompt|raw|payload|lat|lon/i.test(key)
      ) {
        if (typeof item === "boolean" || item === null) return [key, item];
        if (typeof item === "number") return [key, "<redacted-coordinate>"];
        return [key, "<redacted>"];
      }
      return [key, redactDiagnosticValue(item)];
    }),
  );
}
