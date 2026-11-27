import { type Dispatch, type SetStateAction, type RefObject } from "react";
import {
  type ImportSummaryPayload,
  type SyncRunState,
  type Status,
} from "./contracts";
import { numberLabel } from "./formatting";
import { GarminSourceLabel } from "./garmin-source-label";
import {
  formatDetailCoverageSummary,
  formatHealthCoverageSummary,
  formatSyncCounts,
  formatSyncOutcome,
  formatSyncRunStatus,
  formatSyncWork,
  syncFailureSummary,
  historyRecoveryHint,
} from "./sync-presentation";

function SyncLoginHelp({
  recovery,
}: {
  recovery: NonNullable<SyncRunState["recovery"]>;
}) {
  return (
    <section
      className="sync-login-help"
      aria-labelledby="sync-login-help-heading"
    >
      <h3 id="sync-login-help-heading">Garmin connection help</h3>
      <p>
        {syncFailureSummary(recovery)}
        {recovery === "auth"
          ? " Create a new Personal API key in Garmin Connect if needed."
          : " A new key is not an established remedy for this failure."}
      </p>
      <p>
        Open Settings from the native app menu → Garmin connection to enter or
        replace your key privately. Save, then explicitly quit and reopen to use
        it; the running connection never switches in place.
      </p>
      <p>
        Keep your key in native Settings only, never chat. This trainer page
        cannot read or change it. Configured-provider chat and saved/offline
        history remain available without Garmin.
      </p>
    </section>
  );
}

export function SyncView({
  closeSyncView,
  syncCloseRef,
  syncPillKind,
  syncPillLabel,
  runInBackground,
  syncNow,
  summaryKnown,
  technicalOpen,
  setTechnicalOpen,
  cancelSync,
  isSyncing,
  syncRun,
  syncLogRef,
  importSummary,
  runAction,
  refreshSummary,
  detailGarminId,
  setDetailGarminId,
  backfillDetail,
  refreshDetailCoverage,
  status,
}: {
  closeSyncView: () => void;
  syncCloseRef: RefObject<HTMLButtonElement | null>;
  syncPillKind: "error" | "idle" | "ok" | "busy";
  syncPillLabel: string;
  runInBackground: (work: Promise<unknown>) => void;
  syncNow: (
    intent?: import("@/lib/garmin/sync-policy").SyncIntent,
  ) => Promise<void>;
  summaryKnown?: boolean;
  technicalOpen?: boolean;
  setTechnicalOpen?: (open: boolean) => void;
  cancelSync?: () => void;
  isSyncing: boolean;
  syncRun: SyncRunState;
  syncLogRef: RefObject<HTMLPreElement | null>;
  importSummary: ImportSummaryPayload | null;
  runAction: (label: string, request: () => Promise<Response>) => Promise<void>;
  refreshSummary: () => Promise<void>;
  detailGarminId: string;
  setDetailGarminId: Dispatch<SetStateAction<string>>;
  backfillDetail: () => Promise<void>;
  refreshDetailCoverage: () => Promise<void>;
  status: Status;
}) {
  const latest = importSummary?.sync?.latest;
  const history = importSummary?.sync?.historical;
  const active =
    isSyncing || (summaryKnown !== false && importSummary?.syncActive === true);
  const operation = importSummary?.sync?.operation;
  const backendRecovery: SyncRunState["recovery"] =
    operation?.outcome !== "failed"
      ? null
      : operation.stopReason === "auth" || operation.stopReason === "rate-limit"
        ? operation.stopReason
        : operation.stopReason === "network" ||
            operation.stopReason === "request-timeout"
          ? "network"
          : "connector";
  const recovery = syncRun.recovery ?? backendRecovery;
  const operationInvalid =
    summaryKnown !== false && importSummary?.sync?.operationInvalid;
  const workSummary = operationInvalid
    ? "Saved sync state needs recovery. Preserve it; do not reset or replay."
    : (syncRun.workSummary ??
      (summaryKnown !== false && operation
        ? formatSyncWork({
            ...operation,
            detailsRemaining:
              importSummary?.sync?.detailsRemaining ??
              operation.detailsRemaining,
          })
        : undefined));
  const currentMessage = active
    ? isSyncing
      ? (syncRun.phase ?? "Syncing…")
      : "Syncing…"
    : operationInvalid
      ? "Sync outcome unknown. Refresh import summary."
      : syncRun.kind !== "idle"
        ? formatSyncRunStatus(syncRun)
        : summaryKnown === false
          ? "Status unavailable. Refresh import summary before syncing."
          : operation
            ? formatSyncOutcome(
                operation.intent === "latest"
                  ? "Latest refresh"
                  : operation.intent === "history"
                    ? "Historical import"
                    : "Sync",
                operation.outcome,
              )
            : latest
              ? formatSyncOutcome("Latest refresh", latest.outcome)
              : "Ready to refresh recent data.";
  const countSummary =
    syncRun.kind === "idle"
      ? summaryKnown !== false && (operation || latest)
        ? formatSyncCounts(operation ?? latest!)
        : undefined
      : syncRun.countSummary;
  return (
    <section className="sync-view-panel" aria-labelledby="sync-view-heading">
      <div className="sync-view-header">
        <div>
          <p className="section-kicker">Garmin sync</p>
          <h1 id="sync-view-heading">Sync</h1>
          {importSummary &&
          (importSummary.activities > 0 ||
            importSummary.healthDays > 0 ||
            importSummary.athleteBaseline.source ||
            importSummary.bodyMetrics.source) ? (
            <GarminSourceLabel />
          ) : null}
        </div>
        <button
          type="button"
          className="chrome-button"
          onClick={closeSyncView}
          ref={syncCloseRef}
          aria-label="Back to chat"
        >
          Back to chat
        </button>
      </div>

      <div className="sync-view-content">
        <section
          className="sync-action-card"
          data-sync-kind={
            syncRun.kind !== "idle" || !operation
              ? syncRun.kind
              : operation.outcome === "settled"
                ? "completed"
                : operation.outcome === "failed"
                  ? "failed"
                  : operation.outcome === "running"
                    ? "running"
                    : "paused"
          }
          data-sync-running={active}
          aria-labelledby="sync-action-heading"
        >
          <div className="card-title-row">
            <div>
              <p className="section-kicker">Current run</p>
              <h2 id="sync-action-heading">Run Garmin sync</h2>
            </div>
            <span className={`pill ${active ? "busy" : syncPillKind}`}>
              {active ? "Syncing" : syncPillLabel}
            </span>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="primary-action"
              onClick={() => runInBackground(syncNow("latest"))}
              disabled={
                isSyncing ||
                importSummary?.syncActive ||
                importSummary?.sync?.operationInvalid ||
                summaryKnown === false
              }
              aria-label="Sync now — import latest Garmin data"
            >
              {active ? "Sync in progress" : "Sync latest"}
            </button>
            {summaryKnown !== false &&
            importSummary?.sync?.historical.state === "available" ? (
              <button
                type="button"
                disabled={
                  isSyncing ||
                  importSummary.syncActive ||
                  importSummary.sync?.operationInvalid
                }
                onClick={() =>
                  runInBackground(
                    syncNow(
                      importSummary.sync?.historical.action === "discover"
                        ? "discover"
                        : "history",
                    ),
                  )
                }
              >
                {importSummary.sync.historical.action === "start"
                  ? "Import older data"
                  : importSummary.sync.historical.action === "discover"
                    ? "Discover older history"
                    : "Continue historical import"}
              </button>
            ) : null}
            {active && cancelSync ? (
              <button type="button" onClick={cancelSync}>
                Cancel sync
              </button>
            ) : null}
          </div>
          {history?.action === "discover" && summaryKnown !== false ? (
            <p className="helper-text sync-history-scope">
              {history.interrupted
                ? "Older import interrupted; saved progress retained. "
                : ""}
              Saved progress stopped at {history.savedLimit}. Automatic
              discovery can continue farther back; imported data will be kept.
              Up to 30 minutes. Total history unknown.
            </p>
          ) : history?.state === "available" && summaryKnown !== false ? (
            <p className="helper-text">
              {history.interrupted
                ? "Older import interrupted; saved progress retained. "
                : ""}
              Older import:{" "}
              {history.limit ? `from ${history.limit}` : "automatic discovery"};
              up to 30 minutes. Total history unknown.
            </p>
          ) : null}
          {syncRun.failureSummary ? (
            <div className="sync-failure-summary" role="alert">
              <h3>Sync needs attention</h3>
              <p>{syncRun.failureSummary}</p>
            </div>
          ) : null}
          {active || !syncRun.failureSummary ? (
            <p
              className="sync-current-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {active ? (
                <span className="sync-busy-cue" aria-hidden="true" />
              ) : null}
              {currentMessage}
            </p>
          ) : null}
          {countSummary && (!active || isSyncing) ? (
            <p className="helper-text sync-counts">{countSummary}</p>
          ) : null}
          {!active && workSummary ? (
            <p className="sync-history-warning sync-work-status">
              {workSummary}
            </p>
          ) : null}
          {!active &&
          summaryKnown !== false &&
          (importSummary?.sync?.detailsRemaining ?? 0) > 0 ? (
            <p className="helper-text sync-pending-details">
              {importSummary?.sync?.detailsRemaining} known activity details
              remain.
              {!workSummary ? " Sync latest to fetch pending details." : ""}
            </p>
          ) : null}
          {history?.state === "blocked" ? (
            <>
              <p className="sync-history-status sync-history-warning">
                Older history needs attention.
              </p>
              {history.recovery ? (
                <p className="helper-text sync-history-recovery">
                  {historyRecoveryHint(history.recovery, history.savedLimit)}
                </p>
              ) : null}
            </>
          ) : history?.state === "complete" &&
            summaryKnown !== false &&
            history.noDataBefore ? (
            <>
              <p className="helper-text sync-history-status">
                Older history complete.
              </p>
              <p className="helper-text sync-history-boundary">
                No Garmin data found before {history.noDataBefore}.
              </p>
            </>
          ) : history?.state === "complete" && summaryKnown !== false ? (
            <p className="helper-text sync-history-status">
              Selected older range checked; remote earliest history unknown.
            </p>
          ) : null}
          {summaryKnown === false && !active && syncRun.kind !== "idle" ? (
            <p className="helper-text">
              Import status is unconfirmed. Refresh import summary before
              syncing.
            </p>
          ) : null}
          {!active && recovery ? <SyncLoginHelp recovery={recovery} /> : null}
          <details
            open={technicalOpen ?? false}
            onToggle={(event) => setTechnicalOpen?.(event.currentTarget.open)}
          >
            <summary>Technical details</summary>
            {history?.next ? (
              <p className="helper-text">
                Next saved work: {history.next.family} · {history.next.date}
                {history.next.page !== undefined
                  ? ` · page ${history.next.page}`
                  : ""}
              </p>
            ) : null}
            {history && history.savedLimit !== history.limit ? (
              <p className="helper-text">
                Saved scope: {history.savedLimit ?? "automatic discovery"};
                current scope: {history.limit ?? "automatic discovery"}
                {history.recovery ? `; recovery: ${history.recovery}` : ""}.
              </p>
            ) : null}
            {importSummary?.history ? (
              <p className="helper-text">
                Health dates checked: {importSummary.history.health.checks};
                with metrics: {importSummary.history.health.checksWithMetrics};
                unresolved: {importSummary.history.unresolvedHealth.length};
                next cursor: {importSummary.history.health.nextDate ?? "none"}.
              </p>
            ) : null}
            {importSummary?.discovery?.operation ? (
              <p className="helper-text">
                Historical phase: {importSummary.discovery.operation.phase};
                batches: {importSummary.discovery.operation.batches}; attempts:{" "}
                {importSummary.discovery.operation.attempts}.
              </p>
            ) : null}
            <pre
              ref={syncLogRef}
              className="sync-log status"
              aria-label="Current sync progress log"
            >
              {syncRun.lines.length
                ? syncRun.lines.map((entry, index) => (
                    <span
                      key={index}
                      className={`sync-log-entry ${entry.severity}`}
                    >
                      {entry.severity === "error" ? "ERROR: " : ""}
                      {entry.text}
                      {"\n"}
                    </span>
                  ))
                : "Current-run progress will appear here after an explicit Sync starts."}
            </pre>
          </details>
        </section>

        <section
          className="sync-action-card"
          aria-labelledby="sync-maintenance-heading"
        >
          <h2 id="sync-maintenance-heading">Garmin maintenance</h2>
          <p>
            Verify connection makes one explicit Garmin request with your saved
            key. It never runs automatically.
          </p>
          <div className="button-row">
            <button
              type="button"
              onClick={() =>
                runInBackground(
                  runAction("Verify connection", () => fetch("/api/sync")),
                )
              }
            >
              Verify connection
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => runInBackground(refreshSummary())}
            >
              Refresh import summary
            </button>
          </div>
          <div className="detail-tools">
            <label>
              Garmin activity ID
              <input
                aria-label="Garmin activity ID"
                placeholder="Garmin activity ID"
                value={detailGarminId}
                onChange={(event) => setDetailGarminId(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                onClick={() => runInBackground(backfillDetail())}
              >
                Force refresh detail
              </button>
              <button
                type="button"
                onClick={() => runInBackground(refreshDetailCoverage())}
              >
                Show detail coverage
              </button>
            </div>
          </div>
          <h3>Current operation</h3>
          {status.message === syncRun.finalMessage ||
          status.message ===
            syncRun.lines.map((entry) => entry.text).join("\n") ? (
            <p className="helper-text">Current-run feedback appears above.</p>
          ) : (
            <pre
              className={`status ${status.kind}`}
              aria-label="Garmin maintenance feedback"
              aria-live="polite"
              role={status.kind === "error" ? "alert" : "status"}
            >
              {status.message}
            </pre>
          )}
        </section>

        <section
          className="sync-metrics-card"
          aria-labelledby="sync-metrics-heading"
        >
          <div className="card-title-row">
            <div>
              <p className="section-kicker">Import summary</p>
              <h2 id="sync-metrics-heading">Local Garmin coverage</h2>
            </div>
          </div>
          {importSummary ? (
            <dl className="compact-facts sync-metrics-grid">
              <div>
                <dt>Stored activities</dt>
                <dd>{numberLabel(importSummary.activities)}</dd>
              </div>
              <div>
                <dt>Athlete baseline</dt>
                <dd>{importSummary.athleteBaseline.availability}</dd>
              </div>
              <div>
                <dt>Body metrics</dt>
                <dd>{importSummary.bodyMetrics.availability}</dd>
              </div>
              <div>
                <dt>Health coverage</dt>
                <dd>
                  {formatHealthCoverageSummary(
                    importSummary.healthCoverage,
                    importSummary.healthDays,
                  )}
                </dd>
              </div>
              <div>
                <dt>Detail coverage</dt>
                <dd>
                  {formatDetailCoverageSummary(
                    importSummary.detailCoverage,
                    importSummary.detailedActivities,
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p>
              Summary metrics are not available until the local summary loads.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
