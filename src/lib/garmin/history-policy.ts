import type { NormalizedDailyHealth } from "./types";

export const HISTORY_CHECKPOINT = "garmin_history_v1";
export const SYNC_LIMITS = {
  operations: 96,
  milliseconds: 180_000,
  operationMs: 30_000,
};
// Representation constraint only, never a discovered remote lower bound.
const CALENDAR_FLOOR = "0001-01-01";
export type HistoryFamily = {
  unit: "date" | "window";
  nextDate: string | null;
  checks: number;
  checksWithMetrics: number;
  oldestChecked: string | null;
  oldestImported: string | null;
};
export type GarminHistoryState = {
  version: 1;
  limit: string | null;
  remoteLowerBound: null;
  health: HistoryFamily;
  body: HistoryFamily;
  activities: HistoryFamily & {
    windowEnd: string;
    page: number;
    windowOldestImported: string | null;
  };
  unresolvedHealth: string[];
  repairAfter: string | null;
  outcome: "running" | "settled" | "budget-limited" | "cancelled" | "failed";
  operations: number;
  recoveryReason?: "no-progress";
  failureClass?:
    "auth" | "rate-limit" | "network" | "timeout" | "protocol" | "connector";
  updatedAt: string;
};
export type GarminReadControl = {
  admit(): void | Promise<void>;
  failed?(error: unknown): void;
  remainingMs(): number;
  cancelled(): boolean;
};
export function historyFailureClass(
  error: unknown,
): NonNullable<GarminHistoryState["failureClass"]> {
  const message = error instanceof Error ? error.message : "";
  // Protective vocabulary mentions credentials even for generic failures.
  // Do not reinterpret that safe message as authentication evidence.
  if (
    message.includes(
      "upstream details are withheld to protect credentials and local paths",
    )
  )
    return "connector";
  if (/rate.limit|429/i.test(message)) return "rate-limit";
  if (/network|connection|service is unavailable/i.test(message))
    return "network";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/auth|credential|token/i.test(message)) return "auth";
  if (/protocol|unrecognized|JSON/i.test(message)) return "protocol";
  return "connector";
}
export class UnrecognizedHealthReply extends Error {
  constructor(public readonly source: "stats" | "sleep" | "bodyBattery") {
    super(
      `Garmin daily health ${source} response was unrecognized; date remains unresolved.`,
    );
  }
}
export class SyncPause extends Error {
  constructor(public readonly reason: "budget-limited" | "cancelled") {
    super(
      reason === "cancelled"
        ? "Sync cancelled; committed data retained."
        : "Sync budget reached; continue explicitly to explore older history.",
    );
  }
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function historyWindowStart(end: string, limit: string | null): string {
  const proposed = shiftDate(end, -29);
  const floor = limit ?? CALENDAR_FLOOR;
  return proposed < floor ? floor : proposed;
}
function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < CALENDAR_FLOOR
  )
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function nullableDate(value: unknown): boolean {
  return value === null || validDate(value);
}
function validFamily(
  family: HistoryFamily,
  unit: HistoryFamily["unit"],
): boolean {
  return Boolean(
    family &&
    family.unit === unit &&
    nullableDate(family.nextDate) &&
    nullableDate(family.oldestChecked) &&
    nullableDate(family.oldestImported) &&
    Number.isSafeInteger(family.checks) &&
    family.checks >= 0 &&
    Number.isSafeInteger(family.checksWithMetrics) &&
    family.checksWithMetrics >= 0 &&
    family.checksWithMetrics <= family.checks,
  );
}
export function historyState(
  raw: string | null,
  limit: string | null,
  today: string,
): GarminHistoryState {
  if (raw) {
    const saved = JSON.parse(raw) as GarminHistoryState;
    // Corrupt/unknown state is a recovery error, not permission to reset it.
    if (
      !saved ||
      saved.version !== 1 ||
      saved.remoteLowerBound !== null ||
      !nullableDate(saved.limit) ||
      !validFamily(saved.health, "date") ||
      !validFamily(saved.body, "window") ||
      !validFamily(saved.activities, "window") ||
      !validDate(saved.activities.windowEnd) ||
      !nullableDate(saved.activities.windowOldestImported) ||
      !Number.isSafeInteger(saved.activities.page) ||
      saved.activities.page < 0 ||
      !Array.isArray(saved.unresolvedHealth) ||
      !saved.unresolvedHealth.every(validDate) ||
      !nullableDate(saved.repairAfter) ||
      !["running", "settled", "budget-limited", "cancelled", "failed"].includes(
        saved.outcome,
      ) ||
      !Number.isSafeInteger(saved.operations) ||
      saved.operations < 0 ||
      !Number.isFinite(Date.parse(saved.updatedAt)) ||
      (saved.recoveryReason !== undefined &&
        saved.recoveryReason !== "no-progress")
    )
      throw new Error(
        "Garmin history checkpoint is unsupported; preserve it for recovery.",
      );
    if (saved.limit === limit) return saved;
  }
  const candidate = shiftDate(today, -14);
  const nextDate = candidate >= CALENDAR_FLOOR ? candidate : null;
  const family = (unit: HistoryFamily["unit"]): HistoryFamily => ({
    unit,
    nextDate,
    checks: 0,
    checksWithMetrics: 0,
    oldestChecked: null,
    oldestImported: null,
  });
  return {
    version: 1,
    limit,
    remoteLowerBound: null,
    health: family("date"),
    body: family("window"),
    activities: {
      ...family("window"),
      windowEnd: nextDate ?? today,
      page: 0,
      windowOldestImported: null,
    },
    unresolvedHealth: [],
    repairAfter: null,
    outcome: "running",
    operations: 0,
    updatedAt: today,
  };
}
export function historyDateAllowed(
  date: string | null,
  limit: string | null,
): date is string {
  return Boolean(date && date >= (limit ?? CALENDAR_FLOOR));
}
export function checked(
  family: HistoryFamily,
  date: string,
  imported: boolean,
  importedDate = date,
): void {
  family.checks += 1;
  family.oldestChecked =
    !family.oldestChecked || date < family.oldestChecked
      ? date
      : family.oldestChecked;
  if (imported) {
    family.checksWithMetrics += 1;
    family.oldestImported =
      !family.oldestImported || importedDate < family.oldestImported
        ? importedDate
        : family.oldestImported;
  }
}
export function healthHasMetrics(day: NormalizedDailyHealth): boolean {
  return day.availability !== "missing";
}
