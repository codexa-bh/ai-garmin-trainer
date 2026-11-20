import type { GarminReader } from "./import-ports";
import type {
  ActivityListExtras,
  DailyExtras,
  ExtraCoverage,
  ExtraDataGroup,
  FitActivityExtras,
} from "./extra-types";
import {
  SyncPause,
  historyFailureClass,
  shiftDate,
  type GarminReadControl,
} from "./history-policy";

/**
 * Explicit, resumable maintenance backfill of the additional Garmin evidence
 * over stored history. Fresh official reads only; it shares the reader and
 * normalizers with foreground Sync, writes only extras/coverage plus its own
 * checkpoint, never creates days/activities and never touches sync/finality
 * state. Every invocation is separately authorized by its caller.
 */
const EXTRA_BACKFILL_CONTRACT = "garmin-extra-backfill-v1";
const DAILY_BLOCK_DAYS = 31;
const ACTIVITY_WINDOW_DAYS = 90;
const MAX_LIST_PAGES_PER_WINDOW = 20;
const MAX_CONSECUTIVE_FAILURES = 3;
const DAILY_GROUPS: ExtraDataGroup[] = [
  "sleep",
  "hrv",
  "body_battery",
  "stress",
  "vo2_max",
];
const LIST_GROUPS: ExtraDataGroup[] = [
  "activity_body_battery",
  "running_dynamics",
  "snowboard_splits",
];

type Phase = "daily" | "activities" | "details" | "done";
type Checkpoint = {
  contract: typeof EXTRA_BACKFILL_CONTRACT;
  schemaVersion: number;
  target: string;
  startDate: string;
  endDate: string;
  pass: number;
  phase: Phase;
  /** Next date (daily/activities) or last processed `startedAt|garminId` (details). */
  cursor: string;
};

export type ExtraBackfillReader = Pick<
  GarminReader,
  "planDailyHealth" | "dailyHealthEvidence" | "activityPage" | "activityDetail"
> & { close(): void };

export type ExtraBackfillStorePort = {
  readCheckpoint(): string | null;
  commit(work: () => void, checkpoint: string): void;
  upsertDailyExtras(days: DailyExtras[]): number;
  upsertActivityListExtras(items: ActivityListExtras[]): number;
  upsertFitActivityExtras(
    garminId: string,
    extras: FitActivityExtras,
  ): { lapsMatched: boolean };
  recordExtraCoverage(entries: ExtraCoverage[]): void;
  storedDates(from: string, to: string): string[];
  storedSteps(from: string, to: string): Map<string, number>;
  storedActivities(
    from: string,
    to: string,
  ): Array<{ garminId: string; startedAt: number }>;
  settled(group: string, subjectIds: string[]): Set<string>;
};

export type ExtraBackfillInput = {
  startDate: string;
  endDate: string;
  /** Opaque identity of the selected target (never key material). */
  target: string;
  schemaVersion: number;
  cancelled?: () => boolean;
};

export type ExtraBackfillResult = {
  status: "completed" | "stopped" | "refused";
  reason: string | null;
  pass: number;
  phase: Phase;
  counts: {
    datesRead: number;
    dailyBlocksFailed: number;
    listWindows: number;
    listWindowsFailed: number;
    localNotInSource: number;
    sourceNotLocal: number;
    detailsRead: number;
    detailsFailed: number;
    lapsMismatched: number;
  };
};

class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    shiftDate(value, 0) === value &&
    value >= "2000-01-01"
  );
}
function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** Auth, rate limiting, cancellation and budget end the invocation. */
function fatal(error: unknown): boolean {
  return (
    error instanceof SyncPause ||
    ["auth", "rate-limit"].includes(historyFailureClass(error))
  );
}
function stopReason(error: unknown): string {
  if (error instanceof SyncPause) return error.reason;
  return historyFailureClass(error);
}

function parseCheckpoint(raw: string | null): Checkpoint | null | "corrupt" {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Checkpoint;
    if (
      value?.contract !== EXTRA_BACKFILL_CONTRACT ||
      !Number.isSafeInteger(value.schemaVersion) ||
      typeof value.target !== "string" ||
      !validDate(value.startDate) ||
      !validDate(value.endDate) ||
      !Number.isSafeInteger(value.pass) ||
      value.pass < 1 ||
      !["daily", "activities", "details", "done"].includes(value.phase) ||
      typeof value.cursor !== "string"
    )
      return "corrupt";
    return value;
  } catch {
    return "corrupt";
  }
}

/**
 * Serial, paced, finite request admission for one maintenance invocation:
 * a hard request and wall-clock budget plus a minimum spacing between
 * requests. Exhaustion is a resumable stop, never a retry loop.
 */
export function createBackfillControl(options: {
  maxRequests: number;
  maxMs: number;
  intervalMs: number;
  clock: () => number;
  wait: (milliseconds: number) => Promise<void>;
  cancelled: () => boolean;
}): GarminReadControl & { requests(): number } {
  const started = options.clock();
  let requests = 0;
  let last: number | null = null;
  const remaining = () =>
    Math.max(0, options.maxMs - (options.clock() - started));
  return {
    requests: () => requests,
    cancelled: options.cancelled,
    remainingMs: () => Math.min(30_000, remaining()),
    async admit() {
      if (options.cancelled()) throw new SyncPause("cancelled");
      if (requests >= options.maxRequests || remaining() <= 0)
        throw new SyncPause("budget-limited");
      if (last !== null) {
        let delay = options.intervalMs - (options.clock() - last);
        while (delay > 0) {
          await options.wait(Math.min(delay, 100));
          if (options.cancelled()) throw new SyncPause("cancelled");
          delay = options.intervalMs - (options.clock() - last);
        }
      }
      last = options.clock();
      requests += 1;
    },
  };
}

export function createExtraBackfill(deps: {
  store: ExtraBackfillStorePort;
  reader: ExtraBackfillReader;
}) {
  const { store, reader } = deps;

  async function run(input: ExtraBackfillInput): Promise<ExtraBackfillResult> {
    const counts: ExtraBackfillResult["counts"] = {
      datesRead: 0,
      dailyBlocksFailed: 0,
      listWindows: 0,
      listWindowsFailed: 0,
      localNotInSource: 0,
      sourceNotLocal: 0,
      detailsRead: 0,
      detailsFailed: 0,
      lapsMismatched: 0,
    };
    const refused = (reason: string): ExtraBackfillResult => ({
      status: "refused",
      reason,
      pass: 0,
      phase: "daily",
      counts,
    });
    if (
      !validDate(input.startDate) ||
      !validDate(input.endDate) ||
      input.startDate > input.endDate
    )
      return refused("invalid-bounds");
    const saved = parseCheckpoint(store.readCheckpoint());
    if (saved === "corrupt") return refused("checkpoint-corrupt");
    let state: Checkpoint;
    if (saved && saved.phase !== "done") {
      // An unfinished operation resumes only under its exact original binding.
      if (
        saved.schemaVersion !== input.schemaVersion ||
        saved.target !== input.target ||
        saved.startDate !== input.startDate ||
        saved.endDate !== input.endDate
      )
        return refused("checkpoint-mismatch");
      state = saved;
    } else {
      if (saved && saved.target !== input.target)
        return refused("checkpoint-mismatch");
      state = {
        contract: EXTRA_BACKFILL_CONTRACT,
        schemaVersion: input.schemaVersion,
        target: input.target,
        startDate: input.startDate,
        endDate: input.endDate,
        pass: (saved?.pass ?? 0) + 1,
        phase: "daily",
        cursor: input.startDate,
      };
    }
    const checkStop = () => {
      if (input.cancelled?.()) throw new SyncPause("cancelled");
    };
    const save = (next: Partial<Checkpoint>, work: () => void = () => {}) => {
      const candidate = { ...state, ...next };
      store.commit(work, JSON.stringify(candidate));
      state = candidate;
    };
    let consecutiveFailures = 0;
    const failure = (error: unknown) => {
      if (fatal(error)) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES)
        throw new Refusal("repeated-failures");
    };

    async function dailyPhase() {
      while (state.phase === "daily") {
        checkStop();
        const start = String(state.cursor);
        if (start > state.endDate) {
          save({ phase: "activities", cursor: state.startDate });
          return;
        }
        const end = minDate(
          shiftDate(start, DAILY_BLOCK_DAYS - 1),
          state.endDate,
        );
        const next = shiftDate(end, 1);
        // Only stored days, and only those not already settled for every group.
        const stored = store.storedDates(start, end);
        const pending = stored.filter((date) =>
          DAILY_GROUPS.some((group) => !store.settled(group, [date]).has(date)),
        );
        if (!pending.length) {
          save({ cursor: next });
          continue;
        }
        const steps = store.storedSteps(start, end);
        reader.planDailyHealth?.(pending);
        const days: DailyExtras[] = [];
        try {
          let compared = 0;
          let matched = 0;
          for (const date of pending) {
            checkStop();
            const evidence = await reader.dailyHealthEvidence!(date);
            const local = steps.get(date);
            if (local !== undefined && evidence.day.steps !== null) {
              compared += 1;
              if (evidence.day.steps === local) matched += 1;
            }
            if (evidence.extras) days.push(evidence.extras);
          }
          // Account guard: stored step history must recognisably match.
          if (compared >= 3 && matched === 0)
            throw new Refusal("account-or-target-mismatch");
        } catch (error) {
          if (error instanceof Refusal) throw error;
          failure(error);
          counts.dailyBlocksFailed += 1;
          save({ cursor: next }, () =>
            store.recordExtraCoverage(
              pending.flatMap((date) =>
                DAILY_GROUPS.map((group) => ({
                  group,
                  subjectType: "date" as const,
                  subjectId: date,
                  status: "failed" as const,
                  reason: stopReason(error),
                })),
              ),
            ),
          );
          continue;
        }
        consecutiveFailures = 0;
        counts.datesRead += days.length;
        save({ cursor: next }, () => store.upsertDailyExtras(days));
      }
    }

    async function activityPhase() {
      while (state.phase === "activities") {
        checkStop();
        const start = String(state.cursor);
        if (start > state.endDate) {
          save({ phase: "details", cursor: "" });
          return;
        }
        const end = minDate(
          shiftDate(start, ACTIVITY_WINDOW_DAYS - 1),
          state.endDate,
        );
        const next = shiftDate(end, 1);
        const stored = store.storedActivities(start, end);
        const pending = stored.filter((activity) =>
          LIST_GROUPS.some(
            (group) =>
              !store.settled(group, [activity.garminId]).has(activity.garminId),
          ),
        );
        if (!pending.length) {
          save({ cursor: next });
          continue;
        }
        const extras: ActivityListExtras[] = [];
        const seen = new Set<string>();
        // Garmin lists by local start date; stored dates are UTC. One day of
        // padding on each side keeps edge activities inside some window.
        const listStart = shiftDate(start, -1);
        const listEnd = shiftDate(end, 1);
        try {
          for (
            let page = 0, more = true;
            more && page < MAX_LIST_PAGES_PER_WINDOW;
            page += 1
          ) {
            checkStop();
            const reply = await reader.activityPage(listStart, listEnd, page);
            for (const item of reply.extras ?? [])
              if (!seen.has(item.garminId)) {
                seen.add(item.garminId);
                extras.push(item);
              }
            more = reply.hasMore;
            if (more && page + 1 >= MAX_LIST_PAGES_PER_WINDOW)
              throw new Refusal("activity-window-too-large");
          }
        } catch (error) {
          if (error instanceof Refusal) throw error;
          failure(error);
          counts.listWindowsFailed += 1;
          save({ cursor: next }, () =>
            store.recordExtraCoverage(
              pending.flatMap((activity) =>
                LIST_GROUPS.map((group) => ({
                  group,
                  subjectType: "activity" as const,
                  subjectId: activity.garminId,
                  status: "failed" as const,
                  reason: stopReason(error),
                })),
              ),
            ),
          );
          continue;
        }
        consecutiveFailures = 0;
        counts.listWindows += 1;
        // Account guard: stored activities must recognisably reappear in the
        // fresh list (deleted-on-Garmin activities may be missing, not most).
        const found = stored.filter((activity) => seen.has(activity.garminId));
        if (
          found.length === 0 ||
          (stored.length >= 3 && found.length * 2 < stored.length)
        )
          throw new Refusal("account-or-target-mismatch");
        const local = new Set(
          store
            .storedActivities(listStart, listEnd)
            .map((activity) => activity.garminId),
        );
        counts.localNotInSource += pending.filter(
          (activity) => !seen.has(activity.garminId),
        ).length;
        counts.sourceNotLocal += extras.filter(
          (item) => !local.has(item.garminId),
        ).length;
        // Extras never create activities; unknown IDs are ignored by storage.
        save({ cursor: next }, () =>
          store.upsertActivityListExtras(
            extras.filter((item) => local.has(item.garminId)),
          ),
        );
      }
    }

    async function detailPhase() {
      const stored = store
        .storedActivities(state.startDate, state.endDate)
        .map((activity) => ({
          ...activity,
          key: `${String(activity.startedAt).padStart(16, "0")}|${activity.garminId}`,
        }));
      while (state.phase === "details") {
        checkStop();
        // A stable key cursor: activities synced between invocations neither
        // shift nor skip remaining work.
        const current = stored.find((activity) => activity.key > state.cursor);
        if (!current) {
          save({ phase: "done", cursor: "" });
          return;
        }
        const { garminId, key } = current;
        if (store.settled("lap_hr_zones", [garminId]).has(garminId)) {
          save({ cursor: key });
          continue;
        }
        try {
          const fetched = await reader.activityDetail(garminId);
          consecutiveFailures = 0;
          counts.detailsRead += 1;
          save({ cursor: key }, () => {
            if (fetched.recognized && fetched.fitExtras) {
              const { lapsMatched } = store.upsertFitActivityExtras(
                garminId,
                fetched.fitExtras,
              );
              if (!lapsMatched) counts.lapsMismatched += 1;
            } else
              store.recordExtraCoverage([
                {
                  group: "lap_hr_zones",
                  subjectType: "activity",
                  subjectId: garminId,
                  status: "unavailable",
                  reason: "no-original-file",
                },
              ]);
          });
        } catch (error) {
          failure(error);
          counts.detailsFailed += 1;
          save({ cursor: key }, () =>
            store.recordExtraCoverage([
              {
                group: "lap_hr_zones",
                subjectType: "activity",
                subjectId: garminId,
                status: "failed",
                reason: stopReason(error),
              },
            ]),
          );
        }
      }
    }

    try {
      if (!saved || saved.phase === "done") save({});
      await dailyPhase();
      await activityPhase();
      await detailPhase();
      return {
        status: "completed",
        reason: null,
        pass: state.pass,
        phase: state.phase,
        counts,
      };
    } catch (error) {
      return {
        status: error instanceof Refusal ? "refused" : "stopped",
        reason: error instanceof Refusal ? error.reason : stopReason(error),
        pass: state.pass,
        phase: state.phase,
        counts,
      };
    } finally {
      reader.close();
    }
  }
  return { run };
}
