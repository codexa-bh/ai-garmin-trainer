import { shiftDate } from "./history-policy";

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
  hint: {
    source: "get_weekly_steps";
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
      !Array.isArray(saved.positiveDates) ||
      saved.positiveDates.length > 364 ||
      !saved.positiveDates.every(discoveryDate) ||
      new Set(saved.positiveDates).size !== saved.positiveDates.length ||
      (hint !== null &&
        (!hint ||
          hint.source !== "get_weekly_steps" ||
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

/** Validate the reviewed curated wrapper, never arbitrary vendor metadata. */
export function weeklyStepsHint(
  payload: unknown,
  endDate: string,
  weeks: number,
): StepsHint {
  const invalid = () =>
    new Error(
      "Garmin weekly steps protocol failed; discovery remains unknown.",
    );
  if (
    !discoveryDate(endDate) ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 52
  )
    throw invalid();
  const startDate = shiftDate(endDate, -(weeks * 7 - 1));
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw invalid();
  const envelope = payload as Record<string, unknown>;
  if (
    envelope.end_date !== endDate ||
    envelope.weeks_requested !== weeks ||
    !Array.isArray(envelope.weekly_data) ||
    envelope.weeks_returned !== envelope.weekly_data.length ||
    envelope.weekly_data.length > weeks ||
    Object.keys(envelope).some(
      (key) =>
        ![
          "end_date",
          "weeks_requested",
          "weeks_returned",
          "weekly_data",
        ].includes(key),
    )
  )
    throw invalid();
  const seen = new Set<string>();
  const positiveDates: string[] = [];
  let weeksWithData = 0;
  for (const value of envelope.weekly_data) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalid();
    const row = value as Record<string, unknown>;
    if (
      !discoveryDate(row.week_start) ||
      row.week_start > endDate ||
      row.week_start < shiftDate(startDate, -6) ||
      seen.has(row.week_start) ||
      Object.keys(row).some(
        (key) =>
          ![
            "week_start",
            "days_with_data",
            "total_steps",
            "average_steps",
            "total_distance_meters",
            "average_distance_meters",
          ].includes(key),
      )
    )
      throw invalid();
    seen.add(row.week_start);
    for (const [key, number] of Object.entries(row)) {
      if (
        key !== "week_start" &&
        (typeof number !== "number" || !Number.isFinite(number) || number < 0)
      )
        throw invalid();
    }
    if (
      row.days_with_data !== undefined &&
      (!Number.isInteger(row.days_with_data) || Number(row.days_with_data) > 7)
    )
      throw invalid();
    // A positive aggregate is only a candidate, not daily or other-family coverage.
    if (Number(row.days_with_data ?? row.total_steps ?? 0) > 0) {
      weeksWithData += 1;
      for (let index = 0; index < 7; index += 1) {
        const date = shiftDate(row.week_start, index);
        if (date >= startDate && date <= endDate) positiveDates.push(date);
      }
    }
  }
  return {
    startDate,
    endDate,
    positiveDates: [...new Set(positiveDates)].sort().reverse(),
    weeksWithData,
  };
}
