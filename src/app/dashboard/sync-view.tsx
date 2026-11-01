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
  syncFailureSummary,
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
  syncNow: () => Promise<void>;
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
          aria-labelledby="sync-action-heading"
        >
          <div className="card-title-row">
            <div>
              <p className="section-kicker">Current run</p>
              <h2 id="sync-action-heading">Run Garmin sync</h2>
            </div>
            <span className={`pill ${syncPillKind}`}>{syncPillLabel}</span>
          </div>
          <p>
            Uses the existing local read-only connector and normalized import
            pipeline.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="primary-action"
              onClick={() => runInBackground(syncNow())}
              disabled={isSyncing}
              aria-label="Sync now — import latest Garmin data"
            >
              {isSyncing ? "Sync already in progress" : "Sync now"}
            </button>
          </div>
          {isSyncing ? (
            <p className="helper-text" role="status" aria-live="polite">
              Sync already in progress. Keep this view open or navigate
              elsewhere; the current-run log will remain available here.
            </p>
          ) : null}
          {syncRun.failureSummary ? (
            <div className="sync-failure-summary" role="alert">
              <h3>Sync failed</h3>
              <p>{syncRun.failureSummary}</p>
            </div>
          ) : (
            <p className="helper-text" role="status" aria-live="polite">
              {syncRun.finalMessage}
            </p>
          )}
          {syncRun.recovery ? (
            <SyncLoginHelp recovery={syncRun.recovery} />
          ) : null}
          <pre
            ref={syncLogRef}
            className="sync-log status"
            aria-label="Current sync progress log"
            aria-live="polite"
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
              : "Current-run progress will appear here after Sync now starts."}
          </pre>
        </section>

        <section
          className="sync-action-card"
          aria-labelledby="sync-maintenance-heading"
        >
          <h2 id="sync-maintenance-heading">Garmin maintenance</h2>
          <p>
            Verification checks connector file presence, not authentication
            validity. Reads use the pinned local stdio connector. Configure
            connection in native Settings using Connect or Reconnect, then
            explicitly quit/reopen; this trainer page and AI have no credential
            access.
          </p>
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
