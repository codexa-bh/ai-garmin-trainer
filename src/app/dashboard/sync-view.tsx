import { type RefObject } from "react";
import { type ImportSummaryPayload, type SyncRunState } from "./contracts";
import { numberLabel } from "./formatting";
import {
  formatDetailCoverageSummary,
  formatHealthCoverageSummary,
} from "./sync-presentation";

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
          <p className="helper-text" role="status" aria-live="polite">
            {syncRun.finalMessage}
          </p>
          <pre
            ref={syncLogRef}
            className={`sync-log status ${syncPillKind}`}
            aria-label="Current sync progress log"
            aria-live="polite"
          >
            {syncRun.lines.length
              ? syncRun.lines.join("\n")
              : "Current-run progress will appear here after Sync now starts."}
          </pre>
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
