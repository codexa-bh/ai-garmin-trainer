import type { Dispatch, SetStateAction } from "react";
import { type RefObject, type UIEvent } from "react";
import {
  averageSpeedLabel,
  distanceLabel,
  durationLabel,
  finiteChartAverage,
  finiteHeartRateAverage,
  finiteNumberUnitLabel,
  gradeReadoutLabel,
  HeartRateZoneTimeChart,
  metersLabel,
  MiniLineChart,
  paceLabel,
  primaryBenefitLabel,
  RouteMap,
  speedKmhLabel,
  weightedIntensityMinutes,
} from "./activity-charts";
import {
  type ActivityDashboardPayload,
  type ActivityListItem,
} from "./contracts";
import { numberLabel, finiteNumberLabel } from "./formatting";

export function ActivityView({
  activitySelectorCollapsed,
  closeActivityDashboard,
  activityDashboardCloseRef,
  setActivitySelectorCollapsed,
  activitySearchQuery,
  setActivitySearchQuery,
  activityListMessage,
  handleActivityListScroll,
  activityListState,
  activities,
  selectedActivityId,
  runInBackground,
  selectActivityDashboard,
  isActivityListLoadingMore,
  activityListNextOffset,
  activityListTotalApprox,
  activityDashboardState,
  activityDashboard,
}: {
  activitySelectorCollapsed: boolean;
  closeActivityDashboard: () => void;
  activityDashboardCloseRef: RefObject<HTMLButtonElement | null>;
  setActivitySelectorCollapsed: Dispatch<SetStateAction<boolean>>;
  activitySearchQuery: string;
  setActivitySearchQuery: Dispatch<SetStateAction<string>>;
  activityListMessage: string;
  handleActivityListScroll: (event: UIEvent<HTMLDivElement>) => void;
  activityListState: "error" | "idle" | "loading" | "loaded";
  activities: ActivityListItem[];
  selectedActivityId: string | null;
  runInBackground: (work: Promise<unknown>) => void;
  selectActivityDashboard: (garminId: string) => Promise<void>;
  isActivityListLoadingMore: boolean;
  activityListNextOffset: number | null;
  activityListTotalApprox: number | undefined;
  activityDashboardState: "error" | "idle" | "loading" | "loaded";
  activityDashboard: ActivityDashboardPayload | null;
}) {
  return (
    <section
      className={`activity-dashboard-panel ${activitySelectorCollapsed ? "activity-selector-collapsed" : ""}`}
      aria-label="Selected activity dashboard"
    >
      <div className="activity-dashboard-header">
        <div>
          <p className="section-kicker">Activity charts</p>
          <h1>Activity dashboard</h1>
        </div>
        <button
          type="button"
          className="chrome-button"
          onClick={closeActivityDashboard}
          ref={activityDashboardCloseRef}
          aria-label="Back to chat"
        >
          Back to chat
        </button>
      </div>
      <div className="activity-dashboard-selector">
        <div className="activity-selector-header">
          <div
            className="activity-selector-heading"
            hidden={activitySelectorCollapsed}
          >
            <p className="section-kicker">Activity selector</p>
            <h2>Search synced activities</h2>
          </div>
          <button
            type="button"
            className="activity-selector-toggle"
            onClick={() =>
              setActivitySelectorCollapsed((collapsed) => !collapsed)
            }
            aria-expanded={!activitySelectorCollapsed}
            aria-controls="activity-selector-body"
            aria-label={
              activitySelectorCollapsed
                ? "Expand activity selector"
                : "Collapse activity selector"
            }
            title={
              activitySelectorCollapsed
                ? "Expand activity selector"
                : "Collapse activity selector"
            }
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M10.5 3 5.5 8l5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {activitySelectorCollapsed ? (
          <span className="activity-selector-rail-label">Activities</span>
        ) : null}
        <div
          className="activity-selector-body"
          id="activity-selector-body"
          hidden={activitySelectorCollapsed}
        >
          <label className="activity-search-field">
            <span>Search activity name, sport, date, or Garmin ID</span>
            <input
              type="search"
              value={activitySearchQuery}
              onChange={(event) => setActivitySearchQuery(event.target.value)}
              placeholder="Search all synced activities"
            />
          </label>
          <p className="activity-dashboard-status">{activityListMessage}</p>
          <div
            className="activity-list"
            role="list"
            aria-label="Synced activities"
            onScroll={handleActivityListScroll}
          >
            {activityListState === "loading" ? (
              <p className="empty-chat">Loading synced activities…</p>
            ) : activities.length ? (
              <>
                {activities.map((activity) => (
                  <button
                    type="button"
                    role="listitem"
                    className={`activity-list-item ${selectedActivityId === activity.garminId ? "selected" : ""}`}
                    key={activity.garminId}
                    onClick={() =>
                      runInBackground(
                        selectActivityDashboard(activity.garminId),
                      )
                    }
                  >
                    <span>
                      <strong>{activity.label}</strong>
                      <small>
                        {activity.date} · {activity.sport}
                      </small>
                    </span>
                    <span>
                      {distanceLabel(activity.distanceMeters)} ·{" "}
                      {durationLabel(activity.durationSec)}
                    </span>
                  </button>
                ))}
                {isActivityListLoadingMore ? (
                  <p className="activity-dashboard-status">
                    Loading more activities…
                  </p>
                ) : null}
                {!isActivityListLoadingMore &&
                activityListNextOffset === null &&
                activityListTotalApprox !== undefined ? (
                  <p className="activity-dashboard-status">End of results</p>
                ) : null}
              </>
            ) : (
              <p className="empty-chat">{activityListMessage}</p>
            )}
          </div>
        </div>
      </div>
      <div className="selected-activity-detail">
        {activityDashboardState === "loading" ? (
          <p className="empty-chat">Loading selected activity details…</p>
        ) : activityDashboard ? (
          <>
            <div className="selected-activity-heading">
              <div>
                <h2>{activityDashboard.activity.label}</h2>
                <p>
                  {activityDashboard.activity.date} ·{" "}
                  {activityDashboard.activity.sport} · Garmin ID{" "}
                  {activityDashboard.activity.garminId}
                </p>
              </div>
              <span className="detail-status-pill">
                Detail: {activityDashboard.detail.status ?? "not requested"}
              </span>
            </div>
            <div
              className="activity-stat-grid"
              aria-label="Selected activity summary stats"
            >
              <span>
                <strong>Duration</strong>
                {durationLabel(activityDashboard.activity.durationSec)}
              </span>
              <span>
                <strong>Distance</strong>
                {distanceLabel(activityDashboard.activity.distanceMeters)}
              </span>
              <span>
                <strong>Elevation gain</strong>
                {metersLabel(activityDashboard.activity.elevationGainMeters)}
              </span>
              <span>
                <strong>Elevation loss</strong>
                {metersLabel(activityDashboard.activity.elevationLossMeters)}
              </span>
              <span>
                <strong>Calories</strong>
                {numberLabel(activityDashboard.activity.calories)}
              </span>
              <span>
                <strong>Avg HR</strong>
                {numberLabel(activityDashboard.activity.avgHeartRate)} bpm
              </span>
              <span>
                <strong>Max HR</strong>
                {numberLabel(activityDashboard.activity.maxHeartRate)} bpm
              </span>
              <span>
                <strong>Steps</strong>
                {numberLabel(activityDashboard.activity.steps)}
              </span>
            </div>
            <div className="activity-chart-grid">
              {activityDashboard.detail.hasHeartRate ? (
                <MiniLineChart
                  title="Heart rate"
                  unit="bpm"
                  points={activityDashboard.charts.points}
                  valueKey="heartRate"
                  domainStartSec={activityDashboard.charts.domainStartSec}
                  domainEndSec={activityDashboard.charts.domainEndSec}
                  averageValue={finiteHeartRateAverage(
                    activityDashboard.activity.avgHeartRate,
                  )}
                />
              ) : (
                <div className="activity-chart empty-state">
                  No heart-rate stream data available.
                </div>
              )}
              {activityDashboard.detail.hasElevation ? (
                <MiniLineChart
                  title="Elevation profile"
                  unit="m"
                  points={activityDashboard.charts.points}
                  valueKey="altitudeMeters"
                  domainStartSec={activityDashboard.charts.domainStartSec}
                  domainEndSec={activityDashboard.charts.domainEndSec}
                  readoutDetail={(point) => gradeReadoutLabel(point.gradePct)}
                />
              ) : (
                <div className="activity-chart empty-state">
                  No per-point altitude stream data available.
                </div>
              )}
              {activityDashboard.charts.speed?.status === "available" ? (
                <MiniLineChart
                  title="Speed"
                  unit="km/h"
                  points={activityDashboard.charts.points}
                  valueKey="speedKmh"
                  domainStartSec={activityDashboard.charts.domainStartSec}
                  domainEndSec={activityDashboard.charts.domainEndSec}
                  formatValue={speedKmhLabel}
                  averageValue={finiteChartAverage(
                    activityDashboard.charts.points.map(
                      (point) => point.speedKmh,
                    ),
                  )}
                />
              ) : (
                <div className="activity-chart empty-state">
                  <strong>Speed</strong>
                  <span>
                    {activityDashboard.charts.speed?.message ??
                      "Speed unavailable because normalized cumulative-distance stream samples are not available."}
                  </span>
                </div>
              )}
            </div>
            <div className="route-zone-grid">
              <RouteMap route={activityDashboard.route} />
              <HeartRateZoneTimeChart
                summary={activityDashboard.heartRateZones}
              />
            </div>
            <div
              className="activity-effort-widget-grid"
              aria-label="Selected activity effort widgets"
            >
              <section
                className="activity-effort-widget"
                aria-labelledby="activity-intensity-minutes-heading"
              >
                <div className="activity-effort-widget-heading">
                  <h3 id="activity-intensity-minutes-heading">
                    Intensity Minutes
                  </h3>
                  <span>Weighted total</span>
                </div>
                <dl className="activity-effort-list">
                  <div>
                    <dt>Total</dt>
                    <dd>
                      {finiteNumberUnitLabel(
                        weightedIntensityMinutes(
                          activityDashboard.activity.moderateIntensityMinutes,
                          activityDashboard.activity.vigorousIntensityMinutes,
                        ),
                        "min",
                        0,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Moderate</dt>
                    <dd>
                      {finiteNumberUnitLabel(
                        activityDashboard.activity.moderateIntensityMinutes,
                        "min",
                        0,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      Vigorous <span className="effort-weight-cue">x2</span>
                    </dt>
                    <dd>
                      {finiteNumberUnitLabel(
                        activityDashboard.activity.vigorousIntensityMinutes,
                        "min",
                        0,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
              <section
                className="activity-effort-widget"
                aria-labelledby="activity-training-effect-heading"
              >
                <div className="activity-effort-widget-heading">
                  <h3 id="activity-training-effect-heading">Training Effect</h3>
                  <span>Effort summary</span>
                </div>
                <dl className="activity-effort-list activity-effort-list-grid">
                  <div>
                    <dt>Aerobic</dt>
                    <dd>
                      {finiteNumberLabel(
                        activityDashboard.activity.trainingEffect,
                        1,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Anaerobic</dt>
                    <dd>
                      {finiteNumberLabel(
                        activityDashboard.activity.anaerobicTrainingEffect,
                        1,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Primary Benefit</dt>
                    <dd>
                      {primaryBenefitLabel(
                        activityDashboard.activity.trainingEffectLabel,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Exercise Load</dt>
                    <dd>
                      {finiteNumberLabel(
                        activityDashboard.activity.trainingLoad,
                        0,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
            {activityDashboard.laps.length ? (
              <div className="lap-table-wrap">
                <table className="lap-table">
                  <caption>Lap details</caption>
                  <thead>
                    <tr>
                      <th>Lap</th>
                      <th>Duration</th>
                      <th>Distance</th>
                      <th>Pace</th>
                      <th>Avg Speed</th>
                      <th>Avg HR</th>
                      <th>Elev +/−</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityDashboard.laps.map((lap) => (
                      <tr key={lap.lapNumber}>
                        <td>{lap.lapNumber}</td>
                        <td>{durationLabel(lap.durationSec)}</td>
                        <td>{distanceLabel(lap.distanceMeters)}</td>
                        <td>
                          {paceLabel(lap.durationSec, lap.distanceMeters)}
                        </td>
                        <td>{averageSpeedLabel(lap.avgSpeedMps)}</td>
                        <td>{numberLabel(lap.avgHeartRate)} bpm</td>
                        <td>
                          {metersLabel(lap.elevationGainMeters)} /{" "}
                          {metersLabel(lap.elevationLossMeters)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="activity-dashboard-status">
                No lap rows are available for this activity.
              </p>
            )}
          </>
        ) : activityDashboardState === "error" ? (
          <p className="empty-chat">
            Selected activity could not be loaded. Try another activity.
          </p>
        ) : (
          <p className="empty-chat">
            Select a synced activity to inspect charts and stats.
          </p>
        )}
      </div>
    </section>
  );
}
