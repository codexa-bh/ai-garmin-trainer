import type { GarminImportPorts } from "./import-ports";
import {
  BatchEnd,
  DISCOVERY_CHECKPOINT,
  DISCOVERY_LIMITS,
  LIVE_SMOKE_LIMITS,
  discoveryState,
} from "./discovery-policy";
import type { GarminSyncResult, ProgressReporter } from "./import-contracts";
import { isoDate } from "./import-policy";
import { createBaselineImports } from "./baseline-import";
import { createDetailImports } from "./detail-import";
import {
  HISTORY_CHECKPOINT,
  SYNC_LIMITS,
  SyncPause,
  UnrecognizedHealthReply,
  checked,
  healthHasMetrics,
  historyDateAllowed,
  historyFailureClass,
  historyState,
  historyWindowStart,
  shiftDate,
} from "./history-policy";

class NoHistoryProgress extends Error {
  constructor() {
    super(
      "Garmin history made no forward progress; unresolved work is retained for explicit recovery.",
    );
  }
}

export function createGarminImports({
  store,
  createReader,
  historyStartDate,
  clock,
  wait,
}: GarminImportPorts) {
  const baseline = createBaselineImports(store, clock);
  const details = createDetailImports(store, createReader);
  let running = false;

  async function runGarminSync(
    onProgress: ProgressReporter = () => undefined,
    options: {
      cancelled?: () => boolean;
      interactive?: boolean;
      finiteLiveSmoke?: boolean;
    } = {},
  ): Promise<GarminSyncResult> {
    if (running)
      throw new Error(
        "A Garmin sync is already running; refresh the durable summary before retrying.",
      );
    const limit = historyStartDate() || null;
    const started = clock().getTime();
    const today = isoDate(clock());
    const recentStart =
      limit && limit > shiftDate(today, -13) ? limit : shiftDate(today, -13);
    const state = historyState(
      store.getCheckpoint(HISTORY_CHECKPOINT),
      limit,
      today,
    );
    const interactive = Boolean(options.interactive);
    const operationLimits = interactive
      ? options.finiteLiveSmoke
        ? LIVE_SMOKE_LIMITS
        : DISCOVERY_LIMITS
      : SYNC_LIMITS;
    if (interactive && !wait)
      throw new Error("Interactive sync requires an owned pacing port.");
    const discovery = interactive
      ? discoveryState(
          store.getCheckpoint(DISCOVERY_CHECKPOINT),
          limit,
          state.health.nextDate,
        )
      : undefined;
    if (discovery)
      discovery.operation = {
        phase: "recent",
        startedAt: clock().toISOString(),
        updatedAt: clock().toISOString(),
        attempts: 0,
        batches: 0,
        outcome: "running",
        stopReason: null,
      };
    const localHealth = store.healthHistoryBounds?.();
    // Local metric evidence describes imported data only, not remote inception.
    if (
      localHealth?.oldestWithMetrics &&
      (!state.health.oldestImported ||
        localHealth.oldestWithMetrics < state.health.oldestImported)
    )
      state.health.oldestImported = localHealth.oldestWithMetrics;
    const syncRunId = store.recordSyncRun("running", {
      coverageStart: recentStart,
      coverageEnd: today,
    });
    let operations = 0;
    let batchOperations = 0;
    let batchStarted = started;
    let lastDispatch: number | null = null;
    let readFailure: unknown;
    const overallRemaining = () =>
      Math.max(0, operationLimits.milliseconds - (clock().getTime() - started));
    const checkStop = () => {
      if (control.cancelled()) throw new SyncPause("cancelled");
      if (readFailure) throw readFailure;
      if (overallRemaining() <= 0 || operations >= operationLimits.operations)
        throw new SyncPause("budget-limited");
      if (
        batchOperations >= SYNC_LIMITS.operations ||
        clock().getTime() - batchStarted >= SYNC_LIMITS.milliseconds
      ) {
        if (interactive) throw new BatchEnd();
        throw new SyncPause("budget-limited");
      }
    };
    const control = {
      cancelled: options.cancelled ?? (() => false),
      remainingMs: () =>
        Math.min(
          overallRemaining(),
          Math.max(
            0,
            SYNC_LIMITS.milliseconds - (clock().getTime() - batchStarted),
          ),
        ),
      failed: interactive
        ? (error: unknown) => {
            if (!(error instanceof BatchEnd)) readFailure ??= error;
          }
        : undefined,
      async admit() {
        checkStop();
        if (interactive && lastDispatch !== null) {
          const delay = Math.max(
            0,
            DISCOVERY_LIMITS.dispatchIntervalMs -
              (clock().getTime() - lastDispatch),
          );
          // Short owned waits keep cancellation responsive without detached work.
          for (
            let remaining = delay;
            remaining > 0;
            remaining -= Math.min(remaining, 100)
          ) {
            await wait!(Math.min(remaining, 100));
            checkStop();
          }
        }
        checkStop();
        lastDispatch = clock().getTime();
        operations += 1;
        batchOperations += 1;
      },
    };
    const rawClient = createReader(control);
    // Common profile/FTP data is immutable for this explicit operation, not a
    // global cache. In particular a FIT supplement must not refetch them.
    let profile: ReturnType<typeof rawClient.profile> | undefined;
    let ftp: ReturnType<typeof rawClient.cyclingFtp> | undefined;
    const client = interactive
      ? {
          ...rawClient,
          profile: () => (profile ??= rawClient.profile()),
          cyclingFtp: () => (ftp ??= rawClient.cyclingFtp()),
        }
      : rawClient;
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        client.close();
      }
    };
    let activitiesImported = 0;
    let healthDaysImported = 0;
    let detailsProcessed = 0;
    let effortDetailsProcessed = 0;
    let athleteBaseline = store.getGarminAthleteBaseline();
    let bodyMetrics = store.getGarminBodyMetrics();
    let outcome: typeof state.outcome = "settled";
    let failure: string | undefined;
    const save = () => {
      state.operations = operations;
      state.updatedAt = clock().toISOString();
      store.saveCheckpoint(HISTORY_CHECKPOINT, JSON.stringify(state));
      if (discovery?.operation) {
        discovery.operation.attempts = operations;
        discovery.operation.updatedAt = state.updatedAt;
        store.saveCheckpoint(DISCOVERY_CHECKPOINT, JSON.stringify(discovery));
      }
    };
    const progress = (
      stage: Parameters<ProgressReporter>[0]["stage"],
      message: string,
      date?: string,
    ) =>
      onProgress({
        stage,
        message,
        date,
        activitiesImported,
        healthDaysImported,
      });
    const handledHealth = new Set<string>();
    async function health(date: string, historical = false) {
      if (handledHealth.has(date)) return;
      checkStop();
      handledHealth.add(date);
      progress(
        "health",
        `Checking daily health ${date}; remote history boundary remains unknown.`,
        date,
      );
      try {
        const day = await client.dailyHealth(date);
        checkStop();
        healthDaysImported += store.upsertDailyHealth([day]);
        if (historical) checked(state.health, date, healthHasMetrics(day));
        if (
          healthHasMetrics(day) &&
          (!state.health.oldestImported || date < state.health.oldestImported)
        )
          state.health.oldestImported = date;
        state.unresolvedHealth = state.unresolvedHealth.filter(
          (value) => value !== date,
        );
        save();
      } catch (error) {
        if (error instanceof SyncPause || error instanceof BatchEnd) {
          handledHealth.delete(date);
          throw error;
        }
        if (!state.unresolvedHealth.includes(date))
          state.unresolvedHealth.push(date);
        state.failureClass = historyFailureClass(error);
        const source =
          error instanceof UnrecognizedHealthReply ? `, ${error.source}` : "";
        failure = `Some Garmin health reads failed (${state.failureClass}${source}); unresolved dates are retained for bounded retry.`;
        save();
        // Authentication/rate limiting is not a source-empty result or a reason
        // to amplify requests. Other failures remain explicit unresolved work.
        if (
          state.failureClass === "auth" ||
          state.failureClass === "rate-limit" ||
          interactive
        )
          throw error;
      }
    }
    running = true;
    try {
      state.outcome = "running";
      delete state.failureClass;
      try {
        save();
        progress(
          "starting",
          "Starting one bounded, explicit read-only Garmin sync…",
        );
        await client.start();
        // Make current health/activity/body facts available before old history or
        // detail supplements. Existing freshness policy selects older trailing days.
        for (const date of [today, shiftDate(today, -1)].filter(
          (date) => date >= recentStart,
        ))
          await health(date);
        const recentActivities = await client.activityPage(
          recentStart,
          today,
          0,
        );
        checkStop();
        activitiesImported += store.upsertActivities(
          recentActivities.activities,
        );
        progress(
          "body_metrics",
          "Refreshing recent Garmin body metrics from read-only tools…",
        );
        bodyMetrics = await baseline.fetchAndStoreBodyMetrics(
          client,
          recentStart,
          today,
        );
        progress(
          "body_metrics",
          `Body metrics ${bodyMetrics.availability}; weigh-ins ${bodyMetrics.weighInAvailability ?? "not attempted"}.`,
        );
        const trailing = store
          .listDailyHealthTrailingCandidateDates({
            startDate: recentStart,
            endDate: today,
          })
          .sort()
          .reverse()
          .slice(0, 14);
        for (const date of trailing) await health(date);
        async function healthBatch() {
          if (discovery?.operation) {
            discovery.operation.phase = "discovery";
            const end = discovery.nextHintEnd;
            if (
              client.weeklySteps &&
              !discovery.positiveDates.length &&
              historyDateAllowed(end, limit) &&
              end >= "0002-01-01"
            ) {
              const hint = await client.weeklySteps(end, 52);
              checkStop();
              discovery.hint = {
                source: "get_weekly_steps",
                startDate: hint.startDate,
                endDate: hint.endDate,
                weeksWithData: hint.weeksWithData,
                checkedAt: clock().toISOString(),
              };
              discovery.positiveDates = hint.positiveDates.filter((date) =>
                historyDateAllowed(date, limit),
              );
              discovery.nextHintEnd = shiftDate(hint.startDate, -1);
              save();
            }
            discovery.operation.phase = "backfill";
            for (const date of discovery.positiveDates.slice(0, 2)) {
              if (
                !handledHealth.has(date) &&
                store
                  .listDailyHealthMissingGapDates({
                    startDate: date,
                    endDate: date,
                  })
                  .includes(date)
              )
                await health(date, true);
              discovery.positiveDates = discovery.positiveDates.filter(
                (value) => value !== date,
              );
              save();
            }
          }
          for (
            let index = 0;
            index < 6 &&
            historyDateAllowed(state.health.nextDate, limit) &&
            state.unresolvedHealth.length < 32;
            index += 1
          ) {
            const date = state.health.nextDate;
            const oneDay = { startDate: date, endDate: date };
            const needsRead =
              state.unresolvedHealth.includes(date) ||
              store.listDailyHealthMissingGapDates(oneDay).includes(date) ||
              store
                .listDailyHealthRepairCandidateDates(oneDay)
                .includes(date) ||
              store
                .listDailyHealthIntensityRepairCandidateDates(oneDay)
                .includes(date);
            // Reconcile existing normalized/evidenced dates without treating the old
            // forward cursor as a reverse cursor or a remote lower-bound proof.
            if (needsRead) await health(date, true);
            // This is an exploration position, NOT a successful coverage boundary.
            // A failed date is separately durable and remains unresolved.
            state.health.nextDate =
              date === "0001-01-01" ? null : shiftDate(date, -1);
            save();
          }
        }
        async function activityBatch() {
          if (historyDateAllowed(state.activities.nextDate, limit)) {
            const end = state.activities.windowEnd;
            const start = historyWindowStart(end, limit);
            for (let count = 0; count < 2; count += 1) {
              checkStop();
              progress(
                "activities",
                `Checking a frozen activity history window, page ${state.activities.page}.`,
              );
              const refreshHead =
                count === 0 &&
                state.activities.page > 0 &&
                !refreshedWindows.has(end);
              refreshedWindows.add(end);
              const page = await client.activityPage(
                start,
                end,
                refreshHead ? 0 : state.activities.page,
              );
              checkStop();
              activitiesImported += store.upsertActivities(page.activities);
              for (const activity of page.activities) {
                const date = isoDate(activity.startedAt);
                if (
                  !state.activities.oldestImported ||
                  date < state.activities.oldestImported
                )
                  state.activities.oldestImported = date;
                if (
                  !state.activities.windowOldestImported ||
                  date < state.activities.windowOldestImported
                )
                  state.activities.windowOldestImported = date;
              }
              if (refreshHead && page.hasMore) {
                save();
                continue;
              }
              if (page.hasMore) {
                const next = page.nextPage ?? state.activities.page + 1;
                if (
                  !Number.isSafeInteger(next) ||
                  next <= state.activities.page
                )
                  throw new Error(
                    "Garmin activity paging protocol failed; cursor preserved.",
                  );
                state.activities.page = next;
              } else {
                checked(
                  state.activities,
                  start,
                  Boolean(state.activities.windowOldestImported),
                  state.activities.windowOldestImported ?? start,
                );
                state.activities.windowOldestImported = null;
                state.activities.nextDate =
                  start === "0001-01-01" ? null : shiftDate(start, -1);
                state.activities.windowEnd = state.activities.nextDate ?? start;
                state.activities.page = 0;
              }
              save();
              if (!page.hasMore) break;
            }
          }
        }
        async function bodyBatch() {
          if (historyDateAllowed(state.body.nextDate, limit)) {
            const end = state.body.nextDate;
            const start = historyWindowStart(end, limit);
            const olderBody = await baseline.fetchAndStoreBodyMetrics(
              client,
              start,
              end,
              true,
            );
            bodyMetrics = olderBody;
            checked(
              state.body,
              start,
              Boolean(olderBody.fetchedHistory?.count),
              olderBody.fetchedHistory?.oldest ?? start,
            );
            state.body.nextDate =
              start === "0001-01-01" ? null : shiftDate(start, -1);
            save();
          }
        }
        async function repairBatch() {
          const range = {
            startDate:
              limit ??
              [
                localHealth?.oldestStored,
                state.health.oldestChecked,
                ...state.unresolvedHealth,
              ]
                .filter((date): date is string => Boolean(date))
                .sort()[0] ??
              recentStart,
            endDate: today,
          };
          function repairCandidates(startDate: string) {
            const search = { ...range, startDate };
            return [
              ...new Set([
                ...state.unresolvedHealth,
                ...store.listDailyHealthMissingGapDates(search),
                ...store.listDailyHealthRepairCandidateDates(search),
                ...store.listDailyHealthIntensityRepairCandidateDates(search),
              ]),
            ]
              .filter(
                (date) =>
                  date >= startDate &&
                  date <= today &&
                  !handledHealth.has(date),
              )
              .sort();
          }
          // Move the SQL selection window too: rotating only a capped returned
          // prefix would starve candidates beyond the first 500/1000 rows.
          let repairs = repairCandidates(
            state.repairAfter
              ? shiftDate(state.repairAfter, 1)
              : range.startDate,
          );
          if (!repairs.length && state.repairAfter)
            repairs = repairCandidates(range.startDate);
          for (const date of repairs.slice(0, 2)) {
            await health(date, date < recentStart);
            state.repairAfter = date;
            save();
          }
        }
        async function historyBatch() {
          const families = [healthBatch, activityBatch, bodyBatch, repairBatch];
          const offset = (discovery?.operation?.batches ?? 0) % families.length;
          for (let index = 0; index < families.length; index += 1)
            await families[(index + offset) % families.length]();
        }
        async function supplements() {
          if (discovery?.operation) discovery.operation.phase = "supplements";
          progress(
            "athlete",
            "Refreshing Garmin athlete baselines once for this operation…",
          );
          athleteBaseline = await baseline.fetchAndStoreAthleteBaseline(client);
          for (const id of store.listActivityIdsNeedingEffortBackfill(1)) {
            checkStop();
            if (await details.fetchAndStoreActivityEffort(client, id))
              effortDetailsProcessed += 1;
          }
          for (const id of store.listActivityIdsNeedingDetail().slice(0, 1)) {
            checkStop();
            progress(
              "detail",
              `Refreshing missing activity detail 1/1: ${id}…`,
            );
            await details.fetchAndStoreActivityDetail(client, id, {
              force: false,
            });
            detailsProcessed += 1;
          }
          checkStop();
          const fit = await client.fitBaseline(
            store.listRecentActivities(1).map((activity) => activity.garminId),
          );
          if (fit)
            athleteBaseline = await baseline.fetchAndStoreAthleteBaseline(
              client,
              fit,
            );
          checkStop();
        }
        const refreshedWindows = new Set<string>();
        if (interactive) await supplements();
        do {
          const before = JSON.stringify([
            state.health.nextDate,
            state.activities.nextDate,
            state.activities.page,
            state.body.nextDate,
            discovery?.nextHintEnd,
            discovery?.positiveDates,
            state.repairAfter,
          ]);
          try {
            await historyBatch();
          } catch (error) {
            if (!(error instanceof BatchEnd)) throw error;
          }
          if (!interactive) break;
          discovery!.operation!.batches += 1;
          save();
          if (failure)
            throw new Error(
              "Garmin history failed; automatic admission stopped.",
            );
          if (
            !historyDateAllowed(state.health.nextDate, limit) &&
            !historyDateAllowed(state.activities.nextDate, limit) &&
            !historyDateAllowed(state.body.nextDate, limit) &&
            !state.unresolvedHealth.length &&
            !discovery!.positiveDates.length
          )
            break;
          const after = JSON.stringify([
            state.health.nextDate,
            state.activities.nextDate,
            state.activities.page,
            state.body.nextDate,
            discovery?.nextHintEnd,
            discovery?.positiveDates,
            state.repairAfter,
          ]);
          if (before === after) throw new NoHistoryProgress();
          progress(
            "health",
            `Historical batch ${discovery!.operation!.batches} committed; continuing within the same operation. Total history remains unknown.`,
          );
          batchOperations = 0;
          batchStarted = clock().getTime();
          checkStop();
        } while (interactive);
        if (!interactive) await supplements();
        if (failure) outcome = "failed";
      } catch (error) {
        outcome =
          error instanceof SyncPause
            ? error.reason
            : error instanceof BatchEnd
              ? "budget-limited"
              : "failed";
        if (!(error instanceof SyncPause) && !(error instanceof BatchEnd))
          state.failureClass = historyFailureClass(error);
        failure =
          error instanceof SyncPause || error instanceof BatchEnd
            ? control.cancelled()
              ? "Sync cancelled; committed data retained."
              : operations >= operationLimits.operations
                ? "Cumulative attempt limit reached; Resume explicitly to continue unknown history."
                : overallRemaining() <= 0
                  ? "Operation deadline reached; Resume explicitly to continue unknown history."
                  : "Internal batch deadline reached; committed progress retained. Refresh durable truth before Resume."
            : error instanceof NoHistoryProgress
              ? error.message
              : "Garmin sync stopped after a connector or storage failure; committed data and unresolved history are retained.";
      }
      state.outcome = outcome;
      if (discovery?.operation) {
        discovery.operation.phase = "settled";
        discovery.operation.outcome = outcome;
        discovery.operation.stopReason =
          failure ??
          "Chosen exploration range checked; remote boundary unknown.";
      }
      save();
      store.finishSyncRun(
        syncRunId,
        outcome === "failed" ? "failed" : "completed",
        failure,
      );
      const totals = store.dataCounts();
      const remaining =
        historyDateAllowed(state.health.nextDate, limit) ||
        historyDateAllowed(state.activities.nextDate, limit) ||
        historyDateAllowed(state.body.nextDate, limit) ||
        state.unresolvedHealth.length > 0;
      const result: GarminSyncResult = {
        status: outcome === "settled" ? "completed" : outcome,
        activitiesImported,
        healthDaysImported,
        activitiesProcessed: activitiesImported,
        healthDaysRefreshed: healthDaysImported,
        detailsProcessed,
        effortDetailsProcessed,
        storedActivities: totals.activities,
        storedHealthRows: totals.healthCoverage.totalRows,
        coverageStart: recentStart,
        coverageEnd: today,
        healthCoverage: totals.healthCoverage,
        detailCoverage: totals.detailCoverage,
        athleteBaseline,
        bodyMetrics,
        history: state,
        ...(discovery ? { discovery } : {}),
        continuationAvailable: remaining,
        detail: `${failure ?? "Bounded sync invocation settled."} ${remaining ? "Continue explicitly for older or unresolved history." : "Chosen exploration limit checked; this does not prove remote history exhaustion."} Remote earliest-health boundary is unknown. ${operations}/${operationLimits.operations} remote-operation attempts (not HTTP requests). Detail backlog is deferred to subsequent explicit sync or targeted maintenance.`,
      };
      close();
      progress(outcome === "failed" ? "failed" : "completed", result.detail);
      return result;
    } finally {
      try {
        close();
      } finally {
        running = false;
      }
    }
  }
  return {
    runGarminSync,
    isSyncRunning: () => running,
    backfillActivityDetail: details.backfillActivityDetail,
    backfillActivityEffortFields: details.backfillActivityEffortFields,
  };
}
