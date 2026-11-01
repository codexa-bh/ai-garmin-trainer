import { type RefObject } from "react";
import {
  type HealthDashboardLoadState,
  type HealthDashboardPayload,
} from "./contracts";
import { HealthDashboardView } from "./health-metrics";

export function HealthView({
  closeHealthDashboard,
  healthDashboardCloseRef,
  healthDashboardState,
  healthDashboardError,
  healthDashboardData,
  healthRangeEnd,
  healthRangeNotice,
  setHealthRangeEnd,
}: {
  closeHealthDashboard: () => void;
  healthDashboardCloseRef: RefObject<HTMLButtonElement | null>;
  healthDashboardState: HealthDashboardLoadState;
  healthDashboardError: string;
  healthDashboardData: HealthDashboardPayload | null;
  healthRangeEnd: string | null;
  healthRangeNotice: string;
  setHealthRangeEnd: (end: string) => void;
}) {
  return (
    <section
      className="health-dashboard-panel"
      aria-labelledby="health-dashboard-heading"
    >
      <div className="health-dashboard-header">
        <div>
          <p className="section-kicker">Health</p>
          <h1 id="health-dashboard-heading">Health</h1>
        </div>
        <button
          type="button"
          className="chrome-button"
          onClick={closeHealthDashboard}
          ref={healthDashboardCloseRef}
          aria-label="Back to chat"
        >
          Back to chat
        </button>
      </div>

      <div className="health-dashboard-content">
        {healthDashboardState === "loading" ? (
          <p className="helper-text" role="status" aria-live="polite">
            Loading health data…
          </p>
        ) : null}
        {healthDashboardState === "error" ? (
          <p className="health-dashboard-error" role="alert">
            {healthDashboardError}
          </p>
        ) : null}
        {healthDashboardState === "loaded" &&
        healthDashboardData &&
        healthDashboardData.days.length === 0 ? (
          <div className="health-empty-state">
            <h2>No health data yet</h2>
            <p>
              No daily health rows are available locally. Use the existing Sync
              view to import Garmin health data — this dashboard stays read-only
              and never starts a sync by itself.
            </p>
          </div>
        ) : null}
        {healthDashboardState === "loaded" &&
        healthDashboardData &&
        healthDashboardData.days.length > 0 ? (
          <HealthDashboardView
            days={healthDashboardData.days}
            rangeEnd={healthRangeEnd}
            onSelectRange={setHealthRangeEnd}
            notice={healthRangeNotice}
          />
        ) : null}
      </div>
    </section>
  );
}
