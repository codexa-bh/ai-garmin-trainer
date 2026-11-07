import { type Dispatch, type SetStateAction, type RefObject } from "react";
import {
  type ImportSummaryPayload,
  type SyncRunState,
  type Status,
} from "./contracts";
import { numberLabel } from "./formatting";
import {
  formatDetailCoverageSummary,
  formatHealthCoverageSummary,
  formatSyncCounts,
  formatSyncOutcome,
  formatSyncRunStatus,
  syncFailureSummary,
} from "./sync-presentation";

function SyncLoginHelp({
  recovery,
}: {
  recovery: NonNullable<SyncRunState["recovery"]>;
}) {
  if (recovery === "dependency" || recovery === "startup")
    return (
      <section
        className="sync-login-help"
        aria-labelledby="sync-dependency-heading"
      >
        <h3 id="sync-dependency-heading">Garmin action setup</h3>
        <p>{syncFailureSummary(recovery)}</p>
        <p>
          See README → Installation → Garmin access for setup. Check the
          executable path in native Settings → Troubleshooting / technical
          controls; manage uvx and compatible Python separately, then explicitly
          retry this action. Sign-in is not a tooling fix. Saved data remains
          available.
        </p>
      </section>
    );
  return (
    <section
      className="sync-login-help"
      aria-labelledby="sync-login-help-heading"
    >
      <h3 id="sync-login-help-heading">Garmin connection help</h3>
      <p>
        {syncFailureSummary(recovery)} This does not prove expired credentials.
        {recovery === "network" || recovery === "rate-limit"
          ? " Login is not an established remedy for this failure."
          : " Login may not resolve this failure."}
      </p>
      <p>
        Open Settings from the native app menu → Connect Garmin or Reconnect
        Garmin when new authentication is needed. The app manages private
        storage and preserves existing connections. Save, then explicitly quit
        and reopen to activate the new connection; the running account never
        switches in place.
      </p>
      <p>
        Keep passwords and MFA codes in native Settings only, never chat. This
        trainer page cannot start login or access native credentials.
        Configured-provider chat and saved/offline history remain available
        without Garmin; fresh Garmin data requires a working connection.
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
  const currentMessage = active
    ? "Syncing…"
    : syncRun.kind !== "idle"
      ? formatSyncRunStatus(syncRun)
      : summaryKnown === false
        ? "Status unavailable. Refresh import summary before syncing."
        : latest
          ? formatSyncOutcome("Latest refresh", latest.outcome)
          : "Ready to refresh recent data.";
  const countSummary =
    syncRun.kind === "idle"
      ? summaryKnown !== false && latest
        ? formatSyncCounts(latest)
        : undefined
      : syncRun.countSummary;
  return (
    <section className="sync-view-panel" aria-labelledby="sync-view-heading">
      <div className="sync-view-header">
        <div>
          <p className="section-kicker">Garmin sync</p>
          <h1 id="sync-view-heading">Sync</h1>
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
          data-sync-kind={syncRun.kind}
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
                isSyncing || importSummary?.syncActive || summaryKnown === false
              }
              aria-label="Sync now — import latest Garmin data"
            >
              {active ? "Sync in progress" : "Sync latest"}
            </button>
            {summaryKnown !== false &&
            importSummary?.sync?.historical.state === "available" ? (
              <button
                type="button"
                disabled={isSyncing || importSummary.syncActive}
                onClick={() => runInBackground(syncNow("history"))}
              >
                {importSummary.sync.historical.action === "start"
                  ? "Import older data"
                  : "Continue historical import"}
              </button>
            ) : null}
            {isSyncing && cancelSync ? (
              <button type="button" onClick={cancelSync}>
                Cancel sync
              </button>
            ) : null}
          </div>
          {history?.state === "available" && summaryKnown !== false ? (
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
          {history?.state === "blocked" ? (
            <p className="sync-history-status sync-history-warning">
              Older history needs attention.
            </p>
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
          {!active && syncRun.recovery ? (
            <SyncLoginHelp recovery={syncRun.recovery} />
          ) : null}
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
          <p>Verify connector checks file presence, not sign-in validity.</p>
          <div className="button-row">
            <button
              type="button"
              onClick={() =>
                runInBackground(
                  runAction("Verify connector", () => fetch("/api/sync")),
                )
              }
            >
              Verify connector
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
