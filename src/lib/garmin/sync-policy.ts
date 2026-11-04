import type { GarminDiscoveryState } from "./discovery-policy";
import { historyDateAllowed, type GarminHistoryState } from "./history-policy";

export type SyncIntent = "latest" | "history";
export const LATEST_CHECKPOINT = "garmin_latest_v1";
export type LatestSyncState = {
  version: 1;
  outcome: GarminHistoryState["outcome"];
  updatedAt: string;
  activitiesProcessed: number;
  healthDaysRefreshed: number;
};
export type HistoricalAction = {
  state: "available" | "complete" | "blocked" | "active";
  action: "start" | "continue" | null;
  next: {
    family: "health" | "activities" | "body" | "repair" | "hint";
    date: string;
    page?: number;
  } | null;
  limit: string | null;
  remoteLowerBound: null;
  interrupted: boolean;
  reason: string;
};
export type SyncState = {
  latest: LatestSyncState | null;
  historical: HistoricalAction;
};

/** Executable work only; unknown inception and detail availability are not backlog. */
export function nextHistoricalWork(
  history: GarminHistoryState,
  discovery: GarminDiscoveryState | null,
  repairs: string[],
): HistoricalAction["next"] {
  const limit = history.limit;
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
  active,
  limit,
  invalid = false,
}: {
  history: GarminHistoryState;
  discovery: GarminDiscoveryState | null;
  repairs: string[];
  exists: boolean;
  active: boolean;
  limit: string | null;
  invalid?: boolean;
}): HistoricalAction {
  const base = {
    limit,
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
  if (
    invalid ||
    history.limit !== limit ||
    (discovery && discovery.limit !== limit)
  )
    return {
      ...base,
      state: "blocked",
      action: null,
      next: null,
      reason:
        "Saved history or its selected limit needs recovery. Preserve checkpoints; do not reset or replay.",
    };
  if (exists && history.outcome === "failed")
    return {
      ...base,
      state: "blocked",
      action: null,
      next: null,
      reason:
        history.recoveryReason === "no-progress"
          ? "Historical import made no progress. Saved work is retained for recovery, not automatic retry."
          : "Historical import stopped after a failure. Resolve the connection or storage failure before recovering saved work.",
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
        reason:
          "Selected exploration range checked. Remote earliest history remains unknown.",
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
