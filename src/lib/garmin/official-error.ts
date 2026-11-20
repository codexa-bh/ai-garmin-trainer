/**
 * Closed failure vocabulary for the official Personal API reader. Messages are
 * fixed text (never vendor bodies, headers, keys or tokens) and deliberately use
 * the words `historyFailureClass`/`classifyDetailError` already recognise, so the
 * existing sync failure policy classifies them without a second taxonomy.
 */
type OfficialFailure =
  | "key-rejected"
  | "token-rejected"
  | "rate-limited"
  | "network"
  | "service"
  | "timeout"
  | "protocol"
  | "not-found"
  | "too-large";

const MESSAGES: Record<OfficialFailure, string> = {
  "key-rejected":
    "Garmin authentication failed: the Personal API key was rejected or has expired.",
  "token-rejected":
    "Garmin authentication failed: the access token was rejected.",
  "rate-limited": "Garmin rate limit reached (HTTP 429); retry later.",
  network: "Garmin connection failed; authentication validity is inconclusive.",
  service:
    "Garmin service is unavailable; authentication validity is inconclusive.",
  timeout: "Garmin request timed out; no successful coverage recorded.",
  protocol: "Garmin protocol failure: the response was unrecognized.",
  "not-found": "Garmin resource not found.",
  "too-large": "Garmin protocol failure: the response exceeded its size bound.",
};

export class OfficialApiError extends Error {
  constructor(
    readonly kind: OfficialFailure,
    readonly status?: number,
    detail?: string,
  ) {
    super(
      `${MESSAGES[kind]}${status ? ` (HTTP ${status})` : ""}${detail ? ` ${detail}` : ""}`,
    );
  }
}

/** A malformed official reply the normalizers refuse; coverage must not advance. */
export function officialProtocol(detail: string): OfficialApiError {
  return new OfficialApiError("protocol", undefined, detail);
}
