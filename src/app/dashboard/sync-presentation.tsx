import {
  type DetailCoveragePayload,
  type HealthCoveragePayload,
  type SyncProgressEvent,
  type SyncRunState,
} from "./contracts";

// Match the existing redacted server vocabulary, never incidental auth/token words.
// Keep this client-only allowlist separate from error severity and rendered prose.
export function syncFailureRecovery(
  detail: string | undefined,
): SyncRunState["recovery"] {
  // Fixed official-reader vocabulary (official-error.ts / connection.ts) only;
  // an optional trailing " (HTTP nnn)" status is the sole variable part.
  const safeDetail = detail?.replace(/ \(HTTP \d{3}\)$/, "");
  switch (safeDetail) {
    case "Garmin rate limit reached (HTTP 429); retry later.":
    case "Garmin rate limit reached; retry later.":
      return "rate-limit";
    case "Garmin connection failed; authentication validity is inconclusive.":
    case "Garmin service is unavailable; authentication validity is inconclusive.":
    case "Garmin request timed out; no successful coverage recorded.":
      return "network";
    case "Garmin protocol failure: the response was unrecognized.":
    case "Garmin protocol failure: the response exceeded its size bound.":
    case "Garmin sync stopped after a connection or storage failure; committed data and unresolved history are retained.":
      return "connector";
    case "Garmin authentication failed: the Personal API key was rejected or has expired.":
    case "Garmin authentication failed: the access token was rejected.":
    case "Garmin authentication is not configured: add your Personal API key in native Settings, Save, then quit and reopen Trainer.":
      return "auth";
    default:
      return null;
  }
}

export function syncFailureSummary(recovery: SyncRunState["recovery"]): string {
  switch (recovery) {
    case "rate-limit":
      return "Garmin rate-limited the request. Retry later; the key is not shown to be invalid.";
    case "network":
      return "Garmin connection or service is unavailable. Check connectivity and retry later.";
    case "auth":
      return "Garmin did not accept the connection: the Personal API key is missing, rejected, expired or revoked.";
    case "connector":
      return "The Garmin request failed. The cause is not established.";
    default:
      return "The sync request failed. See the current-run error log for details.";
  }
}

export function syncHttpFailureRecovery(
  status: number,
  body: string,
): SyncRunState["recovery"] {
  if (status !== 409) return null;
  try {
    const payload = JSON.parse(body) as {
      status?: unknown;
      detail?: unknown;
    } | null;
    return payload?.status === "blocked" && typeof payload.detail === "string"
      ? syncFailureRecovery(payload.detail)
      : null;
  } catch {
    return null;
  }
}

function formatDetailProgress(event: SyncProgressEvent): string | null {
  const detailTotal = event.detailTotal ?? 0;
  if (detailTotal > 0) {
    return `activity details ${event.detailsProcessed ?? 0}/${detailTotal}`;
  }
  if (event.detailsRemaining !== undefined)
    return `activity details ${event.detailsProcessed ?? 0} completed, ${event.detailsAttempted ?? 0} attempted, ${event.detailsRemaining} remaining`;
  if (event.stage === "detail") return "checking activity details";
  return null;
}

export function formatSyncProgressLine(event: SyncProgressEvent): string {
  const activityCount =
    event.activitiesProcessed ?? event.activitiesImported ?? 0;
  const healthCount =
    event.healthDaysRefreshed ?? event.healthDaysImported ?? 0;
  const progressParts = [
    `processed activity records ${activityCount}`,
    `refreshed health dates ${healthCount}`,
  ];
  const detailProgress = formatDetailProgress(event);
  if (detailProgress) progressParts.push(detailProgress);
  return `${event.stage ?? "progress"}: ${event.message ?? "working"} (${progressParts.join(", ")})`;
}

export function formatSyncResultLine(event: SyncProgressEvent): string {
  const status = event.status ?? "unknown";
  const activityCount =
    event.activitiesProcessed ?? event.activitiesImported ?? 0;
  const healthCount =
    event.healthDaysRefreshed ?? event.healthDaysImported ?? 0;
  const detailsProcessed = event.detailsProcessed ?? 0;
  const parts = [
    `processed activity records ${activityCount}`,
    `refreshed health dates ${healthCount}`,
    `details processed ${detailsProcessed}`,
    `stored totals ${event.storedActivities ?? "unknown"} activities, ${event.storedHealthRows ?? "unknown"} health rows`,
  ];
  if (event.healthCoverage) {
    parts.push(
      `health coverage ${event.healthCoverage.completeDays} complete, ${event.healthCoverage.partialDays} partial, ${event.healthCoverage.missingDays} source-unavailable`,
    );
  }
  if (event.detailCoverage) {
    parts.push(
      `detail coverage ${event.detailCoverage.available} available, ${event.detailCoverage.partial} partial, ${event.detailCoverage.pending} pending`,
    );
  }
  if (status !== "completed" && event.detail) {
    parts.push(
      `${status === "failed" ? "failure detail" : "history status"} ${event.detail}`,
    );
  }
  if (event.sync?.historical.state === "blocked")
    parts.push("older history needs attention");
  else if (event.sync?.historical.action === "discover")
    parts.push("older history can continue with automatic discovery");
  const athlete =
    event.athleteBaseline?.availability ?? event.athleteAvailability;
  const body = event.bodyMetrics?.availability ?? event.bodyMetricsAvailability;
  if (athlete) parts.push(`athlete baseline ${athlete}`);
  if (body) parts.push(`body metrics ${body}`);
  return `Result: ${status} — ${parts.join("; ")}.`;
}

export function formatSyncOutcome(
  label: string,
  outcome: string | undefined,
): string {
  switch (outcome) {
    case "completed":
    case "settled":
      return `${label} finished.`;
    case "failed":
      return `${label} failed. Refresh import summary for status.`;
    case "cancelled":
      return `${label} cancelled. Saved progress is retained.`;
    case "budget-limited":
      return `${label} paused at its safety limit.`;
    case "running":
      return `${label} interrupted. Refresh import summary before continuing.`;
    default:
      return `${label} outcome unknown. Refresh import summary.`;
  }
}

// Final messages can also contain raw HTTP/transport diagnostics. Only the
// application-owned outcome vocabulary belongs in the primary status line.
export function formatSyncRunStatus(run: SyncRunState): string {
  const outcomes =
    run.kind === "completed"
      ? ["completed"]
      : run.kind === "paused"
        ? ["cancelled", "budget-limited"]
        : run.kind === "failed"
          ? ["failed"]
          : ["running"];
  for (const label of [
    "Latest refresh",
    "Historical import",
    "Older history discovery",
    "Sync",
  ]) {
    for (const outcome of outcomes) {
      const message = formatSyncOutcome(label, outcome);
      if (run.finalMessage === message) return message;
    }
  }
  if (run.kind === "paused")
    return "Sync paused. Refresh import summary to confirm settlement.";
  return formatSyncOutcome(
    "Sync",
    run.kind === "completed"
      ? "completed"
      : run.kind === "failed"
        ? "failed"
        : "running",
  );
}

export function formatSyncCounts(
  event: Omit<SyncProgressEvent, "intent">,
): string | undefined {
  const activities = event.activitiesProcessed ?? event.activitiesImported;
  const health = event.healthDaysRefreshed ?? event.healthDaysImported;
  return (
    [
      activities === undefined
        ? null
        : `${activities} activity records processed`,
      health === undefined ? null : `${health} health dates refreshed`,
      event.detailsRemaining === undefined
        ? null
        : `${event.detailsProcessed ?? 0} details completed · ${event.detailsAttempted ?? 0} attempted · ${event.detailsRemaining} remaining`,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}

export function formatSyncPhase(stage: string | undefined): string {
  switch (stage) {
    case "starting":
      return "Starting connector…";
    case "health":
      return "Checking daily health…";
    case "activities":
      return "Checking activity summaries…";
    case "body_metrics":
      return "Refreshing body metrics…";
    case "athlete":
      return "Refreshing athlete baseline…";
    case "detail":
      return "Fetching activity details…";
    default:
      return "Syncing…";
  }
}

export function formatSyncWork(event: {
  outcome?: string;
  status?: string;
  stopReason?: import("@/lib/garmin/sync-policy").SyncStopReason | null;
  detailsRemaining?: number;
}): string | undefined {
  const outcome = event.outcome ?? event.status;
  if (outcome === "settled" || outcome === "completed") return undefined;
  const reasons: Record<
    import("@/lib/garmin/sync-policy").SyncStopReason,
    string
  > = {
    cancelled: "Cancelled",
    "attempt-limit": "Cumulative attempt limit reached",
    "operation-deadline": "Operation time limit reached",
    "batch-limit": "Internal batch time limit reached",
    "request-timeout": "A read timed out",
    "detail-failure": "An activity detail failed",
    "no-progress": "No safe progress",
    "required-work-remaining": "Required work remains",
    auth: "Authentication could not be verified",
    "rate-limit": "Garmin rate-limited the request",
    network: "Connection unavailable",
    protocol: "Unrecognized connector response",
    connector: "Connector or storage failure",
  };
  const reason =
    outcome === "running"
      ? "Previous sync interrupted"
      : event.stopReason
        ? reasons[event.stopReason]
        : "Completion is unconfirmed";
  const next =
    outcome === "failed"
      ? "Resolve the failure, refresh summary, then explicitly retry."
      : "Refresh summary, then explicitly sync or continue saved history.";
  return `${reason}. Saved progress is retained. ${next}`;
}

export function formatSyncFinalMessage(event: SyncProgressEvent): string {
  return formatSyncOutcome(
    event.intent === "latest"
      ? "Latest refresh"
      : event.intent === "history"
        ? "Historical import"
        : event.intent === "discover"
          ? "Older history discovery"
          : "Sync",
    event.status,
  );
}

export function formatHealthCoverageSummary(
  coverage: HealthCoveragePayload | undefined,
  legacyHealthDays: number,
): string {
  if (!coverage) return `${legacyHealthDays} health calendar rows`;
  const unavailable =
    coverage.missingDays > 0
      ? `${coverage.missingDays} source-unavailable, often pre-watch/pre-device or Garmin returned no daily-health metrics; not estimated`
      : "0 source-unavailable";
  const intensity = coverage.metrics.intensityDays ?? 0;
  return `${coverage.totalRows} health calendar rows (${coverage.completeDays} complete, ${coverage.partialDays} partial, ${unavailable}; populated metrics: sleep ${coverage.metrics.sleepDays}, HRV ${coverage.metrics.hrvDays}, intensity ${intensity})`;
}

export function formatDetailCoverageSummary(
  coverage: DetailCoveragePayload | undefined,
  legacyDetailedActivities: number,
): string {
  if (!coverage)
    return `${legacyDetailedActivities} available/partial detailed activities`;
  return `${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable activity details`;
}

/** Short safe next step for blocked older history; never reset or login. */
export function historyRecoveryHint(
  recovery: import("@/lib/garmin/scope-policy").HistoricalRecovery,
  savedLimit: string | null,
): string {
  switch (recovery) {
    case "unsupported":
      return "Saved progress is from an unsupported format. Use a compatible app build; it is preserved.";
    case "inconsistent":
      return "Saved progress records disagree. They are preserved; this build will not guess how to continue.";
    case "scope-changed":
      return `Saved progress uses another date limit${savedLimit ? ` (${savedLimit})` : ""}. Only continuing into automatic discovery is supported; progress is preserved.`;
    case "failed":
      return "The last older-history run failed. Check the connection; saved work is preserved.";
    case "no-progress":
      return "The last older-history run made no progress. Saved work is preserved.";
  }
}
