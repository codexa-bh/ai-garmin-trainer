import { useId } from "react";
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
import { latestKpiMeasurement, latestKpiScore } from "@/lib/weekly/kpis";
import {
  kpiCutoff,
  kpiNumber,
  kpiTarget,
  kpiTrackLabel,
  kpiValue,
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
      <form
        className="weekly-progress-controls"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run(
            weekly.loadProgress(
              String(form.get("from")),
              String(form.get("through")),
            ),
          );
        }}
      >
        <label>
          From Monday
          <input
            type="date"
            name="from"
            required
            defaultValue={weekly.progressRange?.from}
          />
        </label>
        <label>
          Through Monday
          <input
            type="date"
            name="through"
            required
            defaultValue={weekly.progressRange?.through}
          />
        </label>
        <button type="submit" className="chrome-button">
          Load range (up to 12 weeks)
        </button>
      </form>
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
              <Tooltip formatter={(value) => `${kpiNumber(Number(value))}%`} />
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
                const point = latestKpiMeasurement(kpis, item.conceptId, track);
                return {
                  weekStart,
                  point,
                  actual:
                    typeof point?.value === "number" &&
                    Number.isFinite(point.value)
                      ? point.value
                      : null,
                  target:
                    typeof point?.track.target?.value === "number"
                      ? point.track.target.value
                      : null,
                };
              });
              return (
                <ProgressChart
                  key={`${item.conceptId}/${track.key}`}
                  label={label}
                  values={measurements.map(
                    ({ weekStart, point }) =>
                      `${weekStart}: target ${point ? kpiTarget(point.track) : "unavailable"}; actual ${kpiValue(point?.value, track.unit)}; ${point?.result?.status ?? "Not assessed"}${point?.assessment ? `; as of ${kpiCutoff(point.assessment.asOf)}` : ""}${point?.result?.evidence.qualification ? `; ${point.result.evidence.qualification}` : ""}${point?.result?.evidence.limitations ? `; ${point.result.evidence.limitations}` : ""}`,
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
    </section>
  );
}
