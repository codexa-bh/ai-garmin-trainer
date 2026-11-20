export const DISCOVERY_CHECKPOINT = "garmin_discovery_v1";
export const DISCOVERY_LIMITS = {
  milliseconds: 1_800_000,
  operations: 480,
  dispatchIntervalMs: 1_000,
};
// Fixed safety-reducing envelope for explicitly authorized native/API evidence.
// Never an alternative permission grant or a configurable larger budget.
export const LIVE_SMOKE_LIMITS = { milliseconds: 180_000, operations: 150 };
export type StepsHint = {
  startDate: string;
  endDate: string;
  positiveDates: string[];
  weeksWithData: number;
};
export type GarminDiscoveryState = {
  version: 1;
  limit: string | null;
  nextHintEnd: string | null;
  positiveDates: string[];
  /**
   * Automatic scope only: a full 52-week steps read before this date was
   * empty, so older discovery stops here. Garmin activity/health history is
   * treated as starting at this date; it is not a remote account boundary.
   */
  noDataBefore?: string;
  /** Oldest day of a positive steps week seen by automatic discovery. */
  oldestPositive?: string;
  hint: {
    source: "get_weekly_steps" | "official_daily_summaries";
    startDate: string;
    endDate: string;
    weeksWithData: number;
    checkedAt: string;
  } | null;
  operation: {
    phase: "recent" | "discovery" | "backfill" | "supplements" | "settled";
    startedAt: string;
    updatedAt: string;
    attempts: number;
    batches: number;
    outcome: "running" | "settled" | "budget-limited" | "cancelled" | "failed";
    stopReason: string | null;
  } | null;
};
export class BatchEnd extends Error {}

export function discoveryDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01"
  )
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function nullableDate(value: unknown) {
  return value === null || discoveryDate(value);
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function counter(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
export function discoveryState(
  raw: string | null,
  limit: string | null,
  nextDate: string | null,
): GarminDiscoveryState {
  if (raw) {
    const saved = JSON.parse(raw) as GarminDiscoveryState;
    const hint = saved?.hint;
    const operation = saved?.operation;
    if (
      !saved ||
      saved.version !== 1 ||
      !nullableDate(saved.limit) ||
      !nullableDate(saved.nextHintEnd) ||
      (saved.noDataBefore !== undefined &&
        (saved.limit !== null || !discoveryDate(saved.noDataBefore))) ||
      (saved.oldestPositive !== undefined &&
        !discoveryDate(saved.oldestPositive)) ||
      !Array.isArray(saved.positiveDates) ||
      saved.positiveDates.length > 364 ||
      !saved.positiveDates.every(discoveryDate) ||
      new Set(saved.positiveDates).size !== saved.positiveDates.length ||
      (hint !== null &&
        (!hint ||
          !["get_weekly_steps", "official_daily_summaries"].includes(
            hint.source,
          ) ||
          !discoveryDate(hint.startDate) ||
          !discoveryDate(hint.endDate) ||
          hint.startDate > hint.endDate ||
          !counter(hint.weeksWithData) ||
          hint.weeksWithData > 52 ||
          !timestamp(hint.checkedAt))) ||
      (operation !== null &&
        (!operation ||
          ![
            "recent",
            "discovery",
            "backfill",
            "supplements",
            "settled",
          ].includes(operation.phase) ||
          ![
            "running",
            "settled",
            "budget-limited",
            "cancelled",
            "failed",
          ].includes(operation.outcome) ||
          !timestamp(operation.startedAt) ||
          !timestamp(operation.updatedAt) ||
          !counter(operation.attempts) ||
          !counter(operation.batches) ||
          (operation.stopReason !== null &&
            (typeof operation.stopReason !== "string" ||
              operation.stopReason.length > 256))))
    )
      throw new Error(
        "Garmin discovery checkpoint is unsupported; preserve it for recovery.",
      );
    if (saved.limit === limit) return saved;
  }
  return {
    version: 1,
    limit,
    nextHintEnd: nextDate,
    positiveDates: [],
    hint: null,
    operation: null,
  };
}
