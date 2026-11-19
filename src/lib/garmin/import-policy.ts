import { SyncPause, historyFailureClass } from "./history-policy";

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function compactError(error: unknown): string {
  if (
    error instanceof SyncPause ||
    ["auth", "rate-limit"].includes(historyFailureClass(error))
  )
    throw error;
  return (
    error instanceof Error ? error.message : "Garmin connector fetch failed"
  ).slice(0, 500);
}

export function classifyDetailError(error: unknown): {
  errorClass: string;
  message: string;
  retryable: boolean;
} {
  const message =
    error instanceof Error ? error.message : "detail backfill failed";
  const normalized = message.toLowerCase();
  // Transport/protective messages are not stable source absence. In particular
  // "service is unavailable" must remain eligible for explicit recovery.
  const failureClass = historyFailureClass(error);
  const stableUnsupported =
    !["auth", "rate-limit", "network", "timeout"].includes(failureClass) &&
    /not found|unsupported|no fit/.test(normalized);
  const auth = failureClass === "auth";
  const timeout = /timeout|timed out|rate|429/.test(normalized);
  return {
    errorClass: auth
      ? "auth"
      : timeout
        ? "timeout"
        : stableUnsupported
          ? "unsupported"
          : "connector",
    message: message.slice(0, 1000),
    retryable: !stableUnsupported,
  };
}
