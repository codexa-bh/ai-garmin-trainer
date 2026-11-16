import type { GarminDiscoveryState } from "./discovery-policy";
import { historyDateAllowed, type GarminHistoryState } from "./history-policy";
import {
  automaticFloor,
  historyScope,
  reconcileToAutomatic,
  recoveryReason,
  type HistoricalRecovery,
} from "./scope-policy";

// "discover" is the explicit visible action that continues date-limited
// progress into automatic discovery; it is recorded as a history operation.
export type SyncIntent = "latest" | "history" | "discover";
export const LATEST_CHECKPOINT = "garmin_latest_v1";
export const SYNC_CHECKPOINT = "garmin_sync_v1";
export type SyncStopReason =
  | "cancelled"
  | "attempt-limit"
  | "operation-deadline"
  | "batch-limit"
  | "request-timeout"
  | "detail-failure"
  | "no-progress"
  | "required-work-remaining"
  | "auth"
  | "rate-limit"
  | "network"
  | "protocol"
  | "connector";
export type SyncOperation = {
  version: 1;
  intent: "latest" | "history" | "legacy";
  outcome: GarminHistoryState["outcome"];
  updatedAt: string;
  stopReason: SyncStopReason | null;
  detailsAttempted: number;
  detailsProcessed: number;
  detailsFailed: number;
  detailsRemaining: number;
  activitiesProcessed?: number;
  healthDaysRefreshed?: number;
};

/** Absent legacy state is unknown, never evidence of detail exhaustion. */
export function syncOperation(raw: string | null): SyncOperation | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as SyncOperation;
  if (
    !value ||
    value.version !== 1 ||
    !["latest", "history", "legacy"].includes(value.intent) ||
    !["running", "settled", "budget-limited", "cancelled", "failed"].includes(
      value.outcome,
    ) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    ![
      value.detailsAttempted,
      value.detailsProcessed,
      value.detailsFailed,
      value.detailsRemaining,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    value.detailsProcessed + value.detailsFailed > value.detailsAttempted ||
    [value.activitiesProcessed, value.healthDaysRefreshed].some(
      (count) =>
        count !== undefined && (!Number.isSafeInteger(count) || count < 0),
    ) ||
    (value.outcome === "settled" &&
      (value.detailsRemaining > 0 || value.stopReason !== null)) ||
    (value.stopReason !== null &&
      ![
        "cancelled",
        "attempt-limit",
        "operation-deadline",
        "batch-limit",
        "request-timeout",
        "detail-failure",
        "no-progress",
        "required-work-remaining",
        "auth",
        "rate-limit",
        "network",
        "protocol",
        "connector",
      ].includes(value.stopReason))
  )
    throw new Error(
      "Unsupported sync operation checkpoint; preserve it for recovery.",
    );
  return value;
}
export type LatestSyncState = {
  version: 1;
  outcome: GarminHistoryState["outcome"];
  updatedAt: string;
  activitiesProcessed: number;
  healthDaysRefreshed: number;
};
export type HistoricalAction = {
  state: "available" | "complete" | "blocked" | "active";
  action: "start" | "continue" | "discover" | null;
  next: {
    family: "health" | "activities" | "body" | "repair" | "hint";
    date: string;
    page?: number;
  } | null;
  limit: string | null;
  /** Automatic discovery found a full empty year before this date. */
  noDataBefore: string | null;
  /** Scope of saved progress; differs from `limit` only for discover/blocked. */
  savedLimit: string | null;
  recovery: HistoricalRecovery | null;
  remoteLowerBound: null;
  interrupted: boolean;
  reason: string;
};

/** Closed server/client admission: explicit intents never cross over. */
export function historicalIntentAdmitted(
  historical: HistoricalAction | undefined,
  intent: SyncIntent | undefined,
): boolean {
  if (intent === "latest") return true;
  if (intent === "discover") return historical?.action === "discover";
  if (intent === "history")
    return (
      historical?.state === "available" && historical.action !== "discover"
    );
  // Bodyless legacy callers keep their bounds but never reset or reconcile
  // saved progress whose scope differs from the current configuration.
  // Same-scope failed state keeps the established bounded legacy behavior.
  return (
    historical?.action !== "discover" &&
    historical?.recovery !== "inconsistent" &&
    historical?.savedLimit === historical?.limit
  );
}
export type SyncState = {
  operation?: SyncOperation | null;
  operationInvalid?: boolean;
  detailsRemaining?: number;
  latest: LatestSyncState | null;
  historical: HistoricalAction;
};

/** Executable work only; unknown inception and detail availability are not backlog. */
export function nextHistoricalWork(
  history: GarminHistoryState,
  discovery: GarminDiscoveryState | null,
  repairs: string[],
): HistoricalAction["next"] {
  // A discovered empty year bounds automatic exploration like a limit.
  const limit = automaticFloor(history, discovery);
  const repair = [...history.unresolvedHealth, ...repairs]
    .filter((date) => historyDateAllowed(date, limit))
    .sort()[0];
  if (repair) return { family: "repair", date: repair };
  const positive = discovery?.positiveDates.find((date) =>
    historyDateAllowed(date, limit),
  );
  if (positive) return { family: "health", date: positive };
  if (historyDateAllowed(history.health.nextDate, limit))
    return { family: "health", date: history.health.nextDate };
  if (historyDateAllowed(history.activities.nextDate, limit))
    return {
      family: "activities",
      date: history.activities.windowEnd,
      page: history.activities.page,
    };
  if (historyDateAllowed(history.body.nextDate, limit))
    return { family: "body", date: history.body.nextDate };
  if (
    !discovery?.noDataBefore &&
    historyDateAllowed(discovery?.nextHintEnd ?? null, limit) &&
    discovery!.nextHintEnd! >= "0002-01-01"
  )
    return { family: "hint", date: discovery!.nextHintEnd! };
  return null;
}

export function historicalAction({
  history,
  discovery,
  repairs,
  exists,
  discoveryExists = exists,
  active,
  limit,
  invalid = false,
}: {
  history: GarminHistoryState;
  discovery: GarminDiscoveryState | null;
  repairs: string[];
  exists: boolean;
  discoveryExists?: boolean;
  active: boolean;
  limit: string | null;
  invalid?: boolean;
}): HistoricalAction {
  const scope = historyScope({
    history: exists ? history : null,
    discovery: discoveryExists ? discovery : null,
    limit,
    invalid,
  });
  const base = {
    limit,
    savedLimit: exists ? history.limit : limit,
    noDataBefore: discovery?.noDataBefore
      ? automaticFloor(history, discovery)
      : null,
    recovery: null,
    remoteLowerBound: null,
    interrupted: exists && history.outcome === "running" && !active,
  } as const;
  if (active)
    return {
      ...base,
      state: "active",
      action: null,
      next: null,
      reason: "A sync is active. Wait for settlement, then refresh summary.",
    };
  if (scope.kind === "blocked")
    return {
      ...base,
      savedLimit: scope.savedLimit,
      recovery: scope.recovery,
      state: "blocked",
      action: null,
      next: null,
      reason: recoveryReason(scope.recovery),
    };
  if (scope.kind === "reconcilable") {
    // Eligibility means executable work after the planned transition.
    const planned = reconcileToAutomatic(history, discovery);
    const next = nextHistoricalWork(
      planned.history,
      planned.discovery,
      repairs,
    );
    return next
      ? {
          ...base,
          state: "available",
          action: "discover",
          next,
          reason:
            "Saved progress stopped at a date limit. Automatic discovery can continue farther back; imported data will be kept.",
        }
      : {
          ...base,
          state: "complete",
          action: null,
          next: null,
          reason:
            "Saved progress reached the calendar floor. Remote earliest history remains unknown.",
        };
  }
  if (exists && history.outcome === "failed")
    return {
      ...base,
      state: "blocked",
      action: null,
      recovery:
        history.recoveryReason === "no-progress" ? "no-progress" : "failed",
      next: null,
      reason: recoveryReason(
        history.recoveryReason === "no-progress" ? "no-progress" : "failed",
      ),
    };
  const next = nextHistoricalWork(history, discovery, repairs);
  return next
    ? {
        ...base,
        state: "available",
        action: exists ? "continue" : "start",
        next,
        reason: base.interrupted
          ? "Previous historical import was interrupted; committed progress is retained."
          : "Older work is available within the selected exploration scope.",
      }
    : {
        ...base,
        state: "complete",
        action: null,
        next: null,
        reason: discovery?.noDataBefore
          ? `No older Garmin data found before ${automaticFloor(history, discovery)}.`
          : "Selected exploration range checked. Remote earliest history remains unknown.",
      };
}

export function latestSyncState(raw: string | null): LatestSyncState | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as LatestSyncState;
  if (
    !value ||
    value.version !== 1 ||
    !["running", "settled", "budget-limited", "cancelled", "failed"].includes(
      value.outcome,
    ) ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Number.isSafeInteger(value.activitiesProcessed) ||
    value.activitiesProcessed < 0 ||
    !Number.isSafeInteger(value.healthDaysRefreshed) ||
    value.healthDaysRefreshed < 0
  )
    throw new Error(
      "Unsupported latest refresh checkpoint; preserve it for recovery.",
    );
  return value;
}
