import type { GarminImportPorts } from "./import-ports";
import type { GarminSyncResult, ProgressReporter } from "./import-contracts";
import { isoDate } from "./import-policy";
import { createBaselineImports } from "./baseline-import";
import { createDetailImports } from "./detail-import";
import {
  HISTORY_CHECKPOINT,
  SYNC_LIMITS,
  SyncPause,
  checked,
  healthHasMetrics,
  historyDateAllowed,
  historyFailureClass,
  historyState,
  historyWindowStart,
  shiftDate,
} from "./history-policy";

export function createGarminImports({
  store,
  createReader,
  historyStartDate,
  clock,
}: GarminImportPorts) {
  const baseline = createBaselineImports(store, clock);
  const details = createDetailImports(store, createReader);
  let running = false;

  async function runGarminSync(
    onProgress: ProgressReporter = () => undefined,
    options: { cancelled?: () => boolean } = {},
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
    const control = {
      cancelled: options.cancelled ?? (() => false),
      remainingMs: () =>
        Math.max(0, SYNC_LIMITS.milliseconds - (clock().getTime() - started)),
      admit() {
        if (control.cancelled()) throw new SyncPause("cancelled");
        if (operations >= SYNC_LIMITS.operations || control.remainingMs() <= 0)
          throw new SyncPause("budget-limited");
        operations += 1;
      },
    };
    const client = createReader(control);
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
    const checkStop = () => {
      if (control.cancelled()) throw new SyncPause("cancelled");
      if (control.remainingMs() <= 0 || operations >= SYNC_LIMITS.operations)
        throw new SyncPause("budget-limited");
    };
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
        if (error instanceof SyncPause) throw error;
        if (!state.unresolvedHealth.includes(date))
          state.unresolvedHealth.push(date);
        state.failureClass = historyFailureClass(error);
        failure = `Some Garmin health reads failed (${state.failureClass}); unresolved dates are retained for bounded retry.`;
        save();
        // Authentication/rate limiting is not a source-empty result or a reason
        // to amplify requests. Other failures remain explicit unresolved work.
        if (
          state.failureClass === "auth" ||
          state.failureClass === "rate-limit"
        )
          throw error;
      }
    }
    running = true;
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
      const recentActivities = await client.activityPage(recentStart, today, 0);
      activitiesImported += store.upsertActivities(recentActivities.activities);
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
          store.listDailyHealthRepairCandidateDates(oneDay).includes(date) ||
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
      if (historyDateAllowed(state.activities.nextDate, limit)) {
        const end = state.activities.windowEnd;
        const start = historyWindowStart(end, limit);
        for (let count = 0; count < 2; count += 1) {
          checkStop();
          progress(
            "activities",
            `Checking a frozen activity history window, page ${state.activities.page}.`,
          );
          const refreshHead = count === 0 && state.activities.page > 0;
          const page = await client.activityPage(
            start,
            end,
            refreshHead ? 0 : state.activities.page,
          );
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
            if (!Number.isSafeInteger(next) || next <= state.activities.page)
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
              date >= startDate && date <= today && !handledHealth.has(date),
          )
          .sort();
      }
      // Move the SQL selection window too: rotating only a capped returned
      // prefix would starve candidates beyond the first 500/1000 rows.
      let repairs = repairCandidates(
        state.repairAfter ? shiftDate(state.repairAfter, 1) : range.startDate,
      );
      if (!repairs.length && state.repairAfter)
        repairs = repairCandidates(range.startDate);
      for (const date of repairs.slice(0, 2)) {
        await health(date, date < recentStart);
        state.repairAfter = date;
        save();
      }
      progress(
        "athlete",
        "Refreshing Garmin athlete baselines after bounded history work…",
      );
      athleteBaseline = await baseline.fetchAndStoreAthleteBaseline(client);
      for (const id of store.listActivityIdsNeedingEffortBackfill(1)) {
        checkStop();
        if (await details.fetchAndStoreActivityEffort(client, id))
          effortDetailsProcessed += 1;
      }
      for (const id of store.listActivityIdsNeedingDetail().slice(0, 1)) {
        checkStop();
        progress("detail", `Refreshing missing activity detail 1/1: ${id}…`);
        await details.fetchAndStoreActivityDetail(client, id, { force: false });
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
      if (failure) outcome = "failed";
    } catch (error) {
      outcome = error instanceof SyncPause ? error.reason : "failed";
      if (!(error instanceof SyncPause))
        state.failureClass = historyFailureClass(error);
      failure =
        error instanceof SyncPause
          ? error.message
          : "Garmin sync stopped after a connector or storage failure; committed data and unresolved history are retained.";
    } finally {
      client.close();
      running = false;
    }
    state.outcome = outcome;
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
      continuationAvailable: remaining,
      detail: `${failure ?? "Bounded sync invocation settled."} ${remaining ? "Continue explicitly for older or unresolved history." : "Chosen exploration limit checked; this does not prove remote history exhaustion."} Remote earliest-health boundary is unknown. ${operations}/${SYNC_LIMITS.operations} remote-operation attempts (not HTTP requests). Detail backlog is deferred to subsequent explicit sync or targeted maintenance.`,
    };
    progress(outcome === "failed" ? "failed" : "completed", result.detail);
    return result;
  }
  return {
    runGarminSync,
    isSyncRunning: () => running,
    backfillActivityDetail: details.backfillActivityDetail,
    backfillActivityEffortFields: details.backfillActivityEffortFields,
  };
}
