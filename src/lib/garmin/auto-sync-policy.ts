import type { GarminHistoryState } from "./history-policy";
import { discoveryDate, type GarminDiscoveryState } from "./discovery-policy";
import type { SyncState } from "./sync-policy";

export const AUTO_SYNC_CHECKPOINT = "garmin_auto_sync_v1";
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;
export type AutoSyncAttempt = {
  version: 1;
  scope: string | null;
  lastSuccessAt: string;
  attemptedAt: string;
};

/** Additive admission metadata only. Unknown bytes are never repaired on read. */
export function autoSyncAttempt(raw: string | null): AutoSyncAttempt | null {
  if (raw === null) return null;
  const value = JSON.parse(raw) as AutoSyncAttempt;
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "attemptedAt,lastSuccessAt,scope,version" ||
    value.version !== 1 ||
    (value.scope !== null && !discoveryDate(value.scope)) ||
    ![value.lastSuccessAt, value.attemptedAt].every(
      (date) => typeof date === "string" && Number.isFinite(Date.parse(date)),
    )
  )
    throw new Error(
      "Unsupported auto-sync checkpoint; preserve it for recovery.",
    );
  return value;
}

/** Only validated, successfully exhausted current-scope history unlocks latest. */
export function dueAutoSync({
  history,
  discovery,
  sync,
  attempt,
  now,
}: {
  history: GarminHistoryState | null;
  discovery: GarminDiscoveryState | null;
  sync: SyncState;
  attempt: AutoSyncAttempt | null;
  now: number;
}): AutoSyncAttempt | null {
  if (
    !history ||
    history.outcome !== "settled" ||
    history.limit !== sync.historical.limit ||
    sync.historical.savedLimit !== history.limit ||
    sync.historical.state !== "complete" ||
    sync.historical.next !== null ||
    sync.historical.recovery !== null ||
    sync.operationInvalid ||
    sync.detailsRemaining !== 0 ||
    (discovery?.operation && discovery.operation.outcome !== "settled") ||
    (sync.operation && sync.operation.outcome !== "settled")
  )
    return null;
  // Running/failure timestamps cannot advance cadence. A legacy successful
  // history checkpoint is sufficient when no operation checkpoint exists.
  const lastSuccessAt =
    sync.operation?.updatedAt ??
    (sync.latest?.outcome === "settled" &&
    Date.parse(sync.latest.updatedAt) > Date.parse(history.updatedAt)
      ? sync.latest.updatedAt
      : history.updatedAt);
  const success = Date.parse(lastSuccessAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(success) ||
    now - success < AUTO_SYNC_INTERVAL_MS ||
    (!sync.operation &&
      sync.latest &&
      Date.parse(sync.latest.updatedAt) >= success &&
      sync.latest.outcome !== "settled") ||
    (attempt?.scope === history.limit &&
      attempt.lastSuccessAt === lastSuccessAt)
  )
    return null;
  return {
    version: 1,
    scope: history.limit,
    lastSuccessAt,
    attemptedAt: new Date(now).toISOString(),
  };
}
