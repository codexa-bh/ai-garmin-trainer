import { useId } from "react";
import { PROGRESS_PERIODS } from "@/lib/weekly/calendar";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import type { useWeeklyFeature } from "./use-weekly";
import { kpiActual, latestKpiScore } from "@/lib/weekly/kpis";
import {
  kpiCutoff,
  kpiNumber,
  kpiTarget,
  kpiTrackLabel,
  kpiValue,
  kpiActualStatus,
} from "./weekly-kpi-scorecard";

// Exact values stay chart-local and available on keyboard focus without another
// visible values panel or saved-week navigation. The SVG is the visual equivalent.
function ProgressChart({
  label,
  values,
  children,
}: {
  label: string;
  values: string[];
  children: ReactNode;
}) {
  const description = useId();
  return (
    <figure
      className="weekly-chart-block"
      tabIndex={0}
      aria-label={label}
      aria-describedby={description}
    >
      <figcaption>{label}</figcaption>
      <div className="weekly-progress-chart" aria-hidden="true">
        {children}
      </div>
      <ul id={description} className="visually-hidden">
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </figure>
  );
}

export function WeeklyKpiProgress({
  weekly,
  run,
}: {
  weekly: ReturnType<typeof useWeeklyFeature>;
  run: (work: Promise<unknown>) => void;
}) {
  const weeks = weekly.progress?.weeks ?? [];
  const scores = weeks.map(({ weekStart, kpis }) => ({
    weekStart,
    ...latestKpiScore(kpis),
  }));
  const latest = weekly.progress?.latestPlan;
  const latestSet = latestKpiScore(latest ?? null).set;
  const charts =
    latestSet?.items.flatMap((item) => {
      const tracks = item.tracks.filter((track) => track.kind === "numeric");
      return tracks.map((track) => ({
        item,
        track,
        label:
          tracks.length > 1
            ? `${item.label} · ${kpiTrackLabel(track, tracks)}${kpiTrackLabel(track, tracks) === track.unit ? "" : ` (${track.unit})`}`
            : `${item.label} (${track.unit})`,
      }));
    }) ?? [];
  return (
    <section aria-label="Saved KPI progress" className="weekly-kpi-progress">
      <h2>Weekly achievement</h2>
      <p>
        Saved points against each week’s latest plan — not fitness improvement.
        Gaps are not zero.
      </p>
      <div className="weekly-progress-controls">
        <label>
          Period
          <select
            value={weekly.progressPeriod}
            onChange={(event) => {
              const period = PROGRESS_PERIODS.find(
                (value) => value === event.currentTarget.value,
              );
              if (period) run(weekly.loadProgress(period));
            }}
          >
            <option value="1m">Last 1 month</option>
            <option value="2m">Last 2 months</option>
            <option value="3m">Last 3 months</option>
            <option value="6m">Last 6 months</option>
            <option value="12m">Last 12 months</option>
          </select>
        </label>
        {weekly.progress?.recipes?.length ? (
          <button
            type="button"
            className="chrome-button"
            aria-label="Refresh this and last week"
            title="Refresh this and last week"
            disabled={weekly.measuring === "busy"}
            aria-busy={weekly.measuring === "busy"}
            onClick={() => run(weekly.refreshMeasurements())}
          >
            {weekly.measuring === "busy" ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
        {weekly.measuring === "error" ? (
          <span role="status">Some measurements failed; last values kept.</span>
        ) : weekly.measuring === "no_plan" ? (
          <span role="status">No plan for this week</span>
        ) : null}
      </div>
      {weekly.state === "loading" || weekly.state === "idle" ? (
        <p role="status">Loading saved progress…</p>
      ) : weekly.state === "error" ? (
        <div role="alert">
          <p>Saved progress could not be loaded.</p>
          <button
            type="button"
            className="chrome-button"
            onClick={() => run(weekly.refresh())}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {scores.some((point) => point.percentage !== null) ? (
            <ProgressChart
              label="Weekly KPI achievement (%)"
              values={scores.map(
                (point) =>
                  `${point.weekStart}: ${point.percentage === null ? point.reason : `${kpiNumber(point.total!)} / ${kpiNumber(point.available!)} points, ${kpiNumber(point.percentage)}%`}${point.provisional ? ", provisional" : ""}${point.assessment ? `, as of ${kpiCutoff(point.assessment.asOf)}` : ""}`,
              )}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={scores}
                  margin={{ top: 12, right: 24, left: 4, bottom: 8 }}
                >
                  <CartesianGrid stroke="var(--line)" />
                  <XAxis
                    dataKey="weekStart"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <YAxis
                    unit="%"
                    tickFormatter={(value: number) => kpiNumber(value)}
                    domain={[0, (maximum: number) => Math.max(100, maximum)]}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => `${kpiNumber(Number(value))}%`}
                  />
                  <Line
                    type="linear"
                    dataKey="percentage"
                    name="Weekly KPI achievement"
                    stroke="#49d6c8"
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ProgressChart>
          ) : (
            <p>No saved achievement scores in this range.</p>
          )}
          <details className="weekly-individual-kpis" open>
            <summary>Individual KPIs</summary>
            {!charts.length ? (
              <p>
                {latest?.complete === false
                  ? "Latest-plan KPIs are unavailable."
                  : latestSet?.items.length
                    ? "No numeric measurements in the latest established plan."
                    : "No KPIs in the latest established plan."}
              </p>
            ) : (
              <>
                <p className="training-plan-meta">
                  Latest established plan · {latest?.weekStart}. Dashed: target.
                  Solid: recorded actual.
                </p>
                {charts.map(({ item, track, label }) => {
                  const measurements = weeks.map(({ weekStart, kpis }) => {
                    // Each week's own latest-set target, joined by exact meaning.
                    const set = latestKpiScore(kpis).set;
                    const weekTrack = set?.items
                      .find((value) => value.conceptId === item.conceptId)
                      ?.tracks.find(
                        (value) =>
                          value.key === track.key &&
                          value.kind === track.kind &&
                          value.unit === track.unit &&
                          value.meaning === track.meaning,
                      );
                    const point = weekTrack
                      ? kpiActual(kpis, item.conceptId, weekTrack)
                      : null;
                    return {
                      weekStart,
                      point,
                      weekTrack,
                      actual:
                        typeof point?.value === "number" &&
                        Number.isFinite(point.value)
                          ? point.value
                          : null,
                      target:
                        typeof weekTrack?.target?.value === "number"
                          ? weekTrack.target.value
                          : null,
                    };
                  });
                  return (
                    <ProgressChart
                      key={`${item.conceptId}/${track.key}`}
                      label={label}
                      values={measurements.map(
                        ({ weekStart, point, weekTrack }) =>
                          `${weekStart}: target ${weekTrack ? kpiTarget(weekTrack) : "unavailable"}; actual ${kpiValue(point?.value, track.unit)}; ${point ? kpiActualStatus(point) : "No actual"}${point?.asOf ? `; as of ${kpiCutoff(point.asOf)}` : ""}${point && "note" in point && point.note ? `; ${point.note}` : ""}`,
                      )}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={measurements}
                          margin={{ top: 12, right: 24, left: 4, bottom: 8 }}
                        >
                          <CartesianGrid stroke="var(--line)" />
                          <XAxis
                            dataKey="weekStart"
                            tickFormatter={(value: string) => value.slice(5)}
                            tick={{ fill: "var(--muted)", fontSize: 11 }}
                          />
                          <YAxis
                            domain={[0, "auto"]}
                            tick={{ fill: "var(--muted)", fontSize: 11 }}
                          />
                          <Tooltip
                            formatter={(value) =>
                              kpiValue(Number(value), track.unit)
                            }
                          />
                          <Line
                            type="linear"
                            dataKey="target"
                            name="Target"
                            stroke="#b6a3ff"
                            strokeDasharray="5 5"
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                          <Line
                            type="linear"
                            dataKey="actual"
                            name="Recorded actual"
                            stroke="#49d6c8"
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </ProgressChart>
                  );
                })}
              </>
            )}
          </details>
          {latest?.complete === false ? (
            <button
              type="button"
              className="chrome-button"
              onClick={() => run(weekly.refresh())}
            >
              Retry latest KPIs
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
