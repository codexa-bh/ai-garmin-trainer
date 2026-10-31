import { useState, type RefObject } from "react";
import { type ImportSummaryPayload, type SyncRunState } from "./contracts";
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
  const [copyFeedback, setCopyFeedback] = useState("");
  const [copying, setCopying] = useState(false);
  const command = "npm run garmin:auth";

  async function copyCommand() {
    setCopying(true);
    setCopyFeedback("");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(command);
      setCopyFeedback("Login command copied.");
    } catch {
      setCopyFeedback(
        "Could not copy automatically. Select the command above and copy it manually.",
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <section
      className="sync-login-help"
      aria-labelledby="sync-login-help-heading"
    >
      <h3 id="sync-login-help-heading">Optional login help</h3>
      <p>
        {syncFailureSummary(recovery)} This does not prove expired credentials.
        {recovery === "network" || recovery === "rate-limit"
          ? " Login is not an established remedy for this failure."
          : " Login may not resolve this failure."}
      </p>
      <p>
        Verify and reuse existing credentials first. Only if new authentication
        is genuinely needed, open Desktop Settings from the native app menu and
        explicitly start private Garmin sign-in in an unused token directory.
        Save the selected store for the next quit/reopen; this trainer page has
        no credential or native-auth access. Advanced private-terminal
        maintenance alternative, from an explicitly configured checkout:
      </p>
      <div className="sync-login-command">
        <code>{command}</code>
        <button
          type="button"
          onClick={() => {
            copyCommand().catch(() =>
              setCopyFeedback(
                "Could not copy automatically. Select the command above and copy it manually.",
              ),
            );
          }}
          disabled={copying}
          aria-label="Copy login command"
        >
          {copying ? "Copying…" : "Copy"}
        </button>
      </div>
      <p className="helper-text" role="status" aria-live="polite">
        {copyFeedback}
      </p>
      <p>
        The command refuses to overwrite existing credential artifacts. Before
        genuinely needed replacement, manually preserve existing artifacts
        outside the selected credential directory; never delete your only usable
        credentials. Keep passwords, MFA codes and auth output private. This
        trainer page never starts login automatically; only the local Desktop
        Settings action handles transient credentials, never AI chat.
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
