import {
  type AthleteBaselinePayload,
  type BodyMetricsPayload,
  type DetailCoveragePayload,
  type HealthCoveragePayload,
  type SyncProgressEvent,
  type SyncRunState,
} from "./contracts";
import { dateLabel } from "./formatting";

// Match the existing redacted server vocabulary, never incidental auth/token words.
// Keep this client-only allowlist separate from error severity and rendered prose.
export function syncFailureRecovery(
  detail: string | undefined,
): SyncRunState["recovery"] {
  const safeDetail = detail?.replace(
    /^Garmin MCP exited with code (?:-?\d+|null)\. /,
    "",
  );
  switch (safeDetail) {
    case "Garmin service rate-limited the request; retry later, not reauthentication.":
      return "rate-limit";
    case "Garmin connection or service is unavailable; authentication validity is inconclusive.":
      return "network";
    case "Garmin connector request failed; upstream details are withheld to protect credentials and local paths.":
      return "connector";
    case "Garmin authentication could not be verified; check the configured store and perform a separate live verification before requesting reauthentication.":
    case "Set a literal GARMIN_MCP_TOKEN_DIR in .env.local; no alternate location is searched.":
    case "Configured token location must be a directory, not a symlink.":
    case "Expected Garmin token file must be a regular file, not a symlink.":
    case "Expected Garmin token file is empty; repair the selected store before live verification.":
    case "Configured Garmin token directory or expected file is missing; repair this location, then perform a separate live verification.":
    case "Configured Garmin auth state is inaccessible; check file types and private permissions. No token contents were read.":
      return "auth";
    default:
      return null;
  }
}

export function syncFailureSummary(recovery: SyncRunState["recovery"]): string {
  switch (recovery) {
    case "rate-limit":
      return "Garmin rate-limited the request. Retry later, not reauthentication.";
    case "network":
      return "Garmin connection or service is unavailable. Check connectivity and retry later.";
    case "auth":
      return "Garmin authentication could not be verified. Check the selected credential store first.";
    case "connector":
      return "The Garmin connector failed. The cause is not established.";
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
  if (event.stage === "detail") return "activity details up to date";
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
  const status = event.status ?? "completed";
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
    parts.push(`failure detail ${event.detail}`);
  }
  return `Result: ${status} — ${parts.join("; ")}.`;
}

export function formatSyncFinalMessage(event: SyncProgressEvent): string {
  if (event.status !== "completed") {
    return `Sync failed. ${event.detail ?? "See the current-run log for details."}`;
  }
  const healthCoverage = event.healthCoverage
    ? ` Health coverage: ${event.healthCoverage.completeDays} complete, ${event.healthCoverage.partialDays} partial, ${event.healthCoverage.missingDays} source-unavailable; not estimated.`
    : "";
  const athleteAvailability =
    event.athleteBaseline?.availability ?? event.athleteAvailability;
  const bodyAvailability =
    event.bodyMetrics?.availability ?? event.bodyMetricsAvailability;
  const profileStatus = [
    athleteAvailability ? `athlete baseline ${athleteAvailability}` : null,
    bodyAvailability ? `body metrics ${bodyAvailability}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return `Sync complete. Summary refreshed for ${event.storedActivities ?? "unknown"} stored activities and ${event.storedHealthRows ?? "unknown"} health rows.${healthCoverage}${profileStatus ? ` ${profileStatus}.` : ""}`;
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

export function formatAthleteBaselineSummary(
  baseline: AthleteBaselinePayload,
): string {
  const maxHr = baseline.values.configuredMaxHeartRateBpm
    ? `configured max HR ${baseline.values.configuredMaxHeartRateBpm} bpm from Garmin FIT zones target`
    : "configured max HR unavailable from the pinned connector";
  const zones = baseline.values.heartRateZones.boundaries.length
    ? "HR zones available"
    : "HR-zone boundaries unavailable";
  return `Athlete baseline ${baseline.availability}; ${maxHr}; ${zones}; last attempt ${dateLabel(baseline.lastAttemptAt)}.`;
}

export function formatBodyMetricsSummary(metrics: BodyMetricsPayload): string {
  const weight =
    metrics.values.weightKg !== null
      ? `current weight imported (${metrics.values.weightKg} kg${metrics.currentWeightSource === "weigh_in" ? ", source: weigh-in" : metrics.currentWeightSource === "profile" ? ", source: profile" : ""})`
      : "current weight unavailable";
  const height =
    metrics.values.heightCm !== null
      ? `height imported (${metrics.values.heightCm} cm)`
      : "height unavailable";
  const history =
    metrics.history.availability === "available"
      ? `weight history ${metrics.history.count} rows (${metrics.history.rangeStart ?? "unknown"} to ${metrics.history.rangeEnd ?? "unknown"}${metrics.history.source ? `, source: ${metrics.history.source}` : ""})`
      : `weight history ${metrics.history.availability}`;
  const weighIns =
    metrics.weighInAvailability === "failed" ? " weigh-in refresh failed" : "";
  return `Body metrics ${metrics.availability}; ${weight}; ${height}; ${history};${weighIns} last attempt ${dateLabel(metrics.lastAttemptAt)}.`;
}
