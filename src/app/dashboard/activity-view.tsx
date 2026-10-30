import { useState, type Dispatch, type SetStateAction } from "react";
import { TerrainTable } from "./terrain-table";
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

function isFiniteMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function activityPresentation(dashboard: ActivityDashboardPayload) {
  const { activity, charts, detail, route, heartRateZones, laps } = dashboard;
  const strength = activity.sport === "strength_training";
  const field = (label: string, value: string, available: boolean) => ({
    label,
    value,
    available,
  });
  const visibleFields = (fields: ReturnType<typeof field>[]) =>
    fields.filter((item) => !strength || item.available);
  const summary = visibleFields([
    field(
      "Duration",
      durationLabel(activity.durationSec),
      isFiniteMetric(activity.durationSec),
    ),
    field(
      "Distance",
      distanceLabel(activity.distanceMeters),
      isFiniteMetric(activity.distanceMeters) && activity.distanceMeters !== 0,
    ),
    field(
      "Elevation gain",
      metersLabel(activity.elevationGainMeters),
      isFiniteMetric(activity.elevationGainMeters),
    ),
    field(
      "Elevation loss",
      metersLabel(activity.elevationLossMeters),
      isFiniteMetric(activity.elevationLossMeters),
    ),
    field(
      "Calories",
      numberLabel(activity.calories),
      isFiniteMetric(activity.calories),
    ),
    field(
      "Avg HR",
      `${numberLabel(activity.avgHeartRate)} bpm`,
      isFiniteMetric(activity.avgHeartRate),
    ),
    field(
      "Max HR",
      `${numberLabel(activity.maxHeartRate)} bpm`,
      isFiniteMetric(activity.maxHeartRate),
    ),
    field("Steps", numberLabel(activity.steps), isFiniteMetric(activity.steps)),
  ]);
  const weightedTotal = weightedIntensityMinutes(
    activity.moderateIntensityMinutes,
    activity.vigorousIntensityMinutes,
  );
  const intensity = visibleFields([
    field(
      "Total",
      finiteNumberUnitLabel(weightedTotal, "min", 0),
      isFiniteMetric(weightedTotal),
    ),
    field(
      "Moderate",
      finiteNumberUnitLabel(activity.moderateIntensityMinutes, "min", 0),
      isFiniteMetric(activity.moderateIntensityMinutes),
    ),
    field(
      "Vigorous",
      finiteNumberUnitLabel(activity.vigorousIntensityMinutes, "min", 0),
      isFiniteMetric(activity.vigorousIntensityMinutes),
    ),
  ]);
  const benefit = primaryBenefitLabel(activity.trainingEffectLabel);
  const trainingEffect = visibleFields([
    field(
      "Aerobic",
      finiteNumberLabel(activity.trainingEffect, 1),
      isFiniteMetric(activity.trainingEffect),
    ),
    field(
      "Anaerobic",
      finiteNumberLabel(activity.anaerobicTrainingEffect, 1),
      isFiniteMetric(activity.anaerobicTrainingEffect),
    ),
    field(
      "Primary Benefit",
      benefit,
      (activity.trainingEffectLabel ?? "").split(/[_\s]+/).some(Boolean),
    ),
    field(
      "Exercise Load",
      finiteNumberLabel(activity.trainingLoad, 0),
      isFiniteMetric(activity.trainingLoad),
    ),
  ]);
  const chartable = (key: "heartRate" | "altitudeMeters" | "speedKmh") =>
    charts.points.filter((point) => isFiniteMetric(point[key])).length >= 2;
  const heartRate =
    !strength || (detail.hasHeartRate && chartable("heartRate"));
  const elevation =
    !strength || (detail.hasElevation && chartable("altitudeMeters"));
  const speed =
    !strength ||
    (charts.speed?.status === "available" &&
      chartable("speedKmh") &&
      charts.points.some(
        (point) => isFiniteMetric(point.speedKmh) && point.speedKmh !== 0,
      ));
  const showRoute =
    !strength ||
    (route.status === "available" &&
      route.bounds !== null &&
      route.points.length >= 2);
  const zones =
    !strength ||
    (heartRateZones.status === "available" &&
      heartRateZones.buckets.some(
        (bucket) =>
          isFiniteMetric(bucket.seconds) && isFiniteMetric(bucket.percent),
      ));

  // Pick one column set for every row; null cells stay blank, never shift left.
  const lapRows = laps.map((lap) => {
    const pace = paceLabel(lap.durationSec, lap.distanceMeters);
    const speedLabel = averageSpeedLabel(lap.avgSpeedMps);
    const gain = isFiniteMetric(lap.elevationGainMeters);
    const loss = isFiniteMetric(lap.elevationLossMeters);
    return {
      lapNumber: lap.lapNumber,
      cells: [
        !strength || isFiniteMetric(lap.durationSec)
          ? durationLabel(lap.durationSec)
          : null,
        !strength ||
        (isFiniteMetric(lap.distanceMeters) && lap.distanceMeters !== 0)
          ? distanceLabel(lap.distanceMeters)
          : null,
        !strength ||
        (isFiniteMetric(lap.durationSec) &&
          isFiniteMetric(lap.distanceMeters) &&
          pace !== "Unavailable")
          ? pace
          : null,
        !strength ||
        (isFiniteMetric(lap.avgSpeedMps) && speedLabel !== "Unavailable")
          ? speedLabel
          : null,
        !strength || isFiniteMetric(lap.avgHeartRate)
          ? `${numberLabel(lap.avgHeartRate)} bpm`
          : null,
        !strength
          ? `${metersLabel(lap.elevationGainMeters)} / ${metersLabel(lap.elevationLossMeters)}`
          : gain || loss
            ? `${gain ? metersLabel(lap.elevationGainMeters) : "—"} / ${loss ? metersLabel(lap.elevationLossMeters) : "—"}`
            : null,
      ],
    };
  });
  const lapColumns = [
    "Duration",
    "Distance",
    "Pace",
    "Avg Speed",
    "Avg HR",
    "Elev +/−",
  ]
    .map((label, index) => ({ label, index }))
    .filter(
      ({ index }) =>
        !strength ||
        (lapRows.some((row) => row.cells[index] !== null) &&
          (index !== 3 ||
            laps.some(
              (lap) => isFiniteMetric(lap.avgSpeedMps) && lap.avgSpeedMps > 0,
            ))),
    );
  const visibleLaps = lapRows.filter(
    (row) =>
      !strength || lapColumns.some(({ index }) => row.cells[index] !== null),
  );
  return {
    strength,
    summary,
    intensity,
    trainingEffect,
    heartRate,
    elevation,
    speed,
    showRoute,
    zones,
    lapColumns,
    visibleLaps,
  };
}

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
  const activityId = activityDashboard?.activity.garminId ?? null;
  const [selection, setSelection] = useState<{
    activityId: string | null;
    id: string | null;
  }>({ activityId, id: null });
  if (selection.activityId !== activityId)
    setSelection({ activityId, id: null });
  const selectedSection =
    selection.activityId === activityId
      ? activityDashboard?.terrainSections?.sections.find(
          (s) => s.id === selection.id,
        )
      : undefined;
  const derivedTime =
    activityDashboard?.charts.timeScaleStatus === "timestamp_derived";
  const aligned =
    !derivedTime ||
    activityDashboard?.charts.sourcePointCount ===
      activityDashboard?.terrainSections?.inputPoints;
  const interval =
    selectedSection && aligned
      ? {
          start: derivedTime
            ? selectedSection.startTimeSec
            : selectedSection.startStoredElapsedSec,
          end: derivedTime
            ? selectedSection.endTimeSec
            : selectedSection.endStoredElapsedSec,
        }
      : null;
  const presentation = activityDashboard
    ? activityPresentation(activityDashboard)
    : null;
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
        ) : activityDashboard && presentation ? (
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
            {presentation.summary.length ? (
              <div
                className="activity-stat-grid"
                aria-label="Selected activity summary stats"
              >
                {presentation.summary.map((item) => (
                  <span key={item.label}>
                    <strong>{item.label}</strong>
                    {item.value}
                  </span>
                ))}
              </div>
            ) : null}
            {presentation.heartRate ||
            presentation.elevation ||
            presentation.speed ? (
              <div className="activity-chart-grid">
                {presentation.heartRate ? (
                  activityDashboard.detail.hasHeartRate ? (
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
                  )
                ) : null}
                {presentation.elevation ? (
                  activityDashboard.detail.hasElevation ? (
                    <MiniLineChart
                      title="Elevation profile"
                      selectedInterval={
                        interval &&
                        interval.start !== null &&
                        interval.end !== null
                          ? { start: interval.start, end: interval.end }
                          : null
                      }
                      unit="m"
                      points={activityDashboard.charts.points}
                      valueKey="altitudeMeters"
                      domainStartSec={activityDashboard.charts.domainStartSec}
                      domainEndSec={activityDashboard.charts.domainEndSec}
                      readoutDetail={(point) =>
                        gradeReadoutLabel(point.gradePct)
                      }
                    />
                  ) : (
                    <div className="activity-chart empty-state">
                      No per-point altitude stream data available.
                    </div>
                  )
                ) : null}
                {presentation.speed ? (
                  activityDashboard.charts.speed?.status === "available" ? (
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
                  )
                ) : null}
              </div>
            ) : null}
            {presentation.showRoute || presentation.zones ? (
              <div
                className={`route-zone-grid ${presentation.strength ? "strength-detail-grid" : ""}`}
              >
                {presentation.showRoute ? (
                  <RouteMap route={activityDashboard.route} />
                ) : null}
                {presentation.zones ? (
                  <HeartRateZoneTimeChart
                    summary={activityDashboard.heartRateZones}
                  />
                ) : null}
              </div>
            ) : null}
            {presentation.intensity.length ||
            presentation.trainingEffect.length ? (
              <div
                className="activity-effort-widget-grid"
                aria-label="Selected activity effort widgets"
              >
                {presentation.intensity.length ? (
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
                      {presentation.intensity.map((item) => (
                        <div key={item.label}>
                          <dt>
                            {item.label}
                            {item.label === "Vigorous" ? (
                              <>
                                {" "}
                                <span className="effort-weight-cue">x2</span>
                              </>
                            ) : null}
                          </dt>
                          <dd>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}
                {presentation.trainingEffect.length ? (
                  <section
                    className={`activity-effort-widget ${presentation.strength ? "strength-detail-grid" : ""}`}
                    aria-labelledby="activity-training-effect-heading"
                  >
                    <div className="activity-effort-widget-heading">
                      <h3 id="activity-training-effect-heading">
                        Training Effect
                      </h3>
                      <span>Effort summary</span>
                    </div>
                    <dl className="activity-effort-list activity-effort-list-grid">
                      {presentation.trainingEffect.map((item) => (
                        <div key={item.label}>
                          <dt>{item.label}</dt>
                          <dd>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}
              </div>
            ) : null}
            <TerrainTable
              analysis={activityDashboard.terrainSections}
              selectedId={selectedSection?.id ?? null}
              onSelect={(id) =>
                setSelection({
                  activityId,
                  id: selection.id === id ? null : id,
                })
              }
            />
            {selectedSection && !aligned ? (
              <p role="status">
                Section selected; elevation highlight unavailable because
                timestamp/chart origins differ.
              </p>
            ) : null}
            {activityDashboard.laps.length >= 2 &&
            presentation.visibleLaps.length ? (
              <div className="lap-table-wrap">
                <table className="lap-table">
                  <caption>Lap details</caption>
                  <thead>
                    <tr>
                      <th scope="col">Lap</th>
                      {presentation.lapColumns.map(({ label }) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {presentation.visibleLaps.map((lap) => (
                      <tr key={lap.lapNumber}>
                        <td>{lap.lapNumber}</td>
                        {presentation.lapColumns.map(({ label, index }) => (
                          <td key={label}>{lap.cells[index] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
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
