import type { GarminDiscoveryState } from "./discovery-policy";
import { shiftDate, type GarminHistoryState } from "./history-policy";

/** Closed reasons why saved historical scope cannot run as configured. */
export type HistoricalRecovery =
  "unsupported" | "inconsistent" | "scope-changed" | "failed" | "no-progress";

export type HistoryScope =
  | { kind: "none" | "same" }
  | { kind: "reconcilable"; savedLimit: string }
  | {
      kind: "blocked";
      recovery: HistoricalRecovery;
      savedLimit: string | null;
    };

const CALENDAR_FLOOR = "0001-01-01";

/**
 * Classify validated saved progress against the backend's current scope.
 * Only date-limited progress continuing into automatic discovery is
 * reconcilable; every other mismatch is explained, never repaired.
 */
export function historyScope({
  history,
  discovery,
  limit,
  invalid,
}: {
  history: GarminHistoryState | null;
  discovery: GarminDiscoveryState | null;
  limit: string | null;
  invalid: boolean;
}): HistoryScope {
  if (invalid)
    return { kind: "blocked", recovery: "unsupported", savedLimit: null };
  if (!history)
    return discovery
      ? { kind: "blocked", recovery: "inconsistent", savedLimit: null }
      : { kind: "none" };
  const savedLimit = history.limit;
  if (discovery && discovery.limit !== savedLimit)
    return { kind: "blocked", recovery: "inconsistent", savedLimit };
  if (savedLimit === limit) return { kind: "same" };
  if (savedLimit === null || limit !== null)
    return { kind: "blocked", recovery: "scope-changed", savedLimit };
  if (
    history.outcome === "failed" ||
    discovery?.operation?.outcome === "failed"
  )
    return {
      kind: "blocked",
      recovery:
        history.recoveryReason === "no-progress" ? "no-progress" : "failed",
      savedLimit,
    };
  // A null cursor under a finite limit is ambiguous, not remote exhaustion.
  const cursors = [
    history.health.nextDate,
    history.activities.nextDate,
    history.body.nextDate,
    ...(discovery ? [discovery.nextHintEnd] : []),
  ];
  if (
    history.version !== 1 ||
    (savedLimit !== CALENDAR_FLOOR && cursors.some((date) => date === null))
  )
    return { kind: "blocked", recovery: "inconsistent", savedLimit };
  return { kind: "reconcilable", savedLimit };
}

/**
 * Plan the explicit finite-limit -> automatic transition from validated saved
 * progress. Family cursors, counters, unresolved dates and imported coverage
 * are kept. Two boundary adjustments prevent gaps:
 * - an active activity window that the old limit clamped keeps that lower
 *   bound while paging (page numbers belong to the original query);
 * - a weekly-steps hint that already reached below the old limit dropped
 *   positives there, so the next hint restarts just below the old limit once.
 */
export function reconcileToAutomatic(
  history: GarminHistoryState,
  discovery: GarminDiscoveryState | null,
): { history: GarminHistoryState; discovery: GarminDiscoveryState | null } {
  const savedLimit = history.limit;
  if (savedLimit === null)
    throw new Error("Only date-limited history can expand to automatic scope.");
  const next: GarminHistoryState = structuredClone(history);
  next.limit = null;
  next.expandedFrom = savedLimit;
  const activities = next.activities;
  if (
    activities.nextDate !== null &&
    activities.nextDate >= savedLimit &&
    activities.page > 0 &&
    shiftDate(activities.windowEnd, -29) < savedLimit
  ) {
    activities.windowStart = savedLimit;
    next.version = 2;
  }
  if (!discovery) return { history: next, discovery: null };
  const plannedDiscovery: GarminDiscoveryState = structuredClone(discovery);
  plannedDiscovery.limit = null;
  const floorEnd = shiftDate(savedLimit, -1);
  if (
    plannedDiscovery.nextHintEnd !== null &&
    plannedDiscovery.nextHintEnd < floorEnd
  )
    plannedDiscovery.nextHintEnd = floorEnd;
  return { history: next, discovery: plannedDiscovery };
}

export function recoveryReason(recovery: HistoricalRecovery): string {
  switch (recovery) {
    case "unsupported":
      return "Saved history uses a format this build cannot read. Use a compatible build; checkpoints are preserved.";
    case "inconsistent":
      return "Saved history and discovery progress disagree. They are preserved; this build will not guess how to continue.";
    case "scope-changed":
      return "Saved history uses a different date limit than current settings. Only continuing a date limit into automatic discovery is supported; checkpoints are preserved.";
    case "no-progress":
      return "Historical import made no progress. Saved work is retained for recovery, not automatic retry.";
    case "failed":
      return "Historical import stopped after a failure. Resolve the connection or storage failure before recovering saved work.";
  }
}
