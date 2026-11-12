import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { useWeeklyFeature } from "./use-weekly";
import { latestKpiMeasurement, latestKpiScore } from "@/lib/weekly/kpis";
import {
  kpiCutoff,
  kpiNumber,
  kpiTarget,
  kpiTrackLabel,
  kpiValue,
} from "./weekly-kpi-scorecard";

export function WeeklyKpiProgress({
  weekly,
  run,
  openWeek,
}: {
  weekly: ReturnType<typeof useWeeklyFeature>;
  run: (work: Promise<unknown>) => void;
  openWeek: (week: string) => void;
}) {
  const [detailWeek, setDetailWeek] = useState("");
  const weeks = weekly.progress?.weeks ?? [];
  const scores = weeks.map(({ weekStart, kpis }) => ({
    weekStart,
    ...latestKpiScore(kpis),
  }));
  const saved = scores.filter((point) => point.set);
  const detail = saved.find((point) => point.weekStart === detailWeek);
  const latest = weekly.progress?.latestPlan;
  const latestSet = latestKpiScore(latest ?? null).set;
  const groups =
    latestSet?.items
      .map((item) => ({
        item,
        tracks: item.tracks.filter((track) => track.kind === "numeric"),
      }))
      .filter(({ tracks }) => tracks.length) ?? [];
  const options = groups.flatMap(({ item, tracks }) =>
    tracks.map((track) => ({
      key: `${item.conceptId}/${track.key}`,
      item,
      track,
      label: kpiTrackLabel(track, tracks),
    })),
  );
  const selected = options.find((value) => value.key === weekly.progressTrack);
  const measurementsForKpi = options.filter(
    (value) => value.item.conceptId === selected?.item.conceptId,
  );
  const measurements = selected
    ? weeks.map(({ weekStart, kpis }) => {
        const point = latestKpiMeasurement(
          kpis,
          selected.item.conceptId,
          selected.track,
        );
        return {
          weekStart,
          point,
          actual:
            typeof point?.value === "number" && Number.isFinite(point.value)
              ? point.value
              : null,
          target:
            typeof point?.track.target?.value === "number"
              ? point.track.target.value
              : null,
        };
      })
    : [];
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
        <div className="weekly-progress-chart" aria-hidden="true">
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
        </div>
      ) : (
        <p>No saved achievement scores in this range.</p>
      )}
      {saved.length ? (
        <div className="weekly-progress-detail">
          <label>
            Week details
            <select
              value={detail ? detailWeek : ""}
              onChange={(event) => setDetailWeek(event.target.value)}
            >
              <option value="">Choose a saved week</option>
              {saved.map((point) => (
                <option key={point.weekStart} value={point.weekStart}>
                  {point.weekStart} ·{" "}
                  {point.percentage === null
                    ? point.reason
                    : `${kpiNumber(point.percentage)}%`}
                </option>
              ))}
            </select>
          </label>
          {detail ? (
            <div>
              <p>
                {detail.total === null
                  ? detail.reason
                  : `${kpiNumber(detail.total)} / ${kpiNumber(detail.available!)} points · ${kpiNumber(detail.percentage!)}%`}
                {detail.provisional ? " · Provisional" : ""}
                {detail.assessment
                  ? ` · As of ${kpiCutoff(detail.assessment.asOf)}`
                  : ""}
              </p>
              {detail.assessment ? (
                <p>{detail.assessment.explanation}</p>
              ) : null}
              <button
                type="button"
                className="chrome-button"
                onClick={() => openWeek(detail.weekStart)}
              >
                Open weekly report
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <details className="weekly-individual-kpis">
        <summary>Individual KPIs</summary>
        {!options.length ? (
          <p>
            {latest?.complete === false
              ? "Latest-plan KPIs are unavailable; reload to retry."
              : latestSet?.items.length
                ? "No numeric measurements in the latest established plan."
                : "No KPIs in the latest established plan."}
          </p>
        ) : (
          <>
            <p className="training-plan-meta">
              Choices from the latest established plan · {latest?.weekStart}
            </p>
            <div className="weekly-progress-controls">
              <label>
                Individual KPI
                <select
                  value={selected?.item.conceptId ?? ""}
                  onChange={(event) =>
                    weekly.setProgressTrack(
                      options.find(
                        (value) => value.item.conceptId === event.target.value,
                      )?.key ?? "",
                    )
                  }
                >
                  <option value="">Choose a KPI</option>
                  {groups.map(({ item }) => (
                    <option key={item.conceptId} value={item.conceptId}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {measurementsForKpi.length > 1 ? (
                <label>
                  Measurement
                  <select
                    value={selected?.key ?? ""}
                    onChange={(event) =>
                      weekly.setProgressTrack(event.target.value)
                    }
                  >
                    {measurementsForKpi.map((value) => (
                      <option key={value.key} value={value.key}>
                        {value.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {selected ? (
              <>
                {selected.track.kind === "numeric" ? (
                  <div className="weekly-progress-chart" aria-hidden="true">
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
                            kpiValue(Number(value), selected.track.unit)
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
                  </div>
                ) : null}
                <p className="training-plan-meta">
                  Dashed: target. Solid: recorded actual ({selected.track.unit}
                  ).
                </p>
                <p>{selected.track.meaning}</p>
                <details>
                  <summary>Saved measurement values</summary>
                  <div className="weekly-kpi-table-scroll">
                    <table className="weekly-kpi-table">
                      <thead>
                        <tr>
                          <th scope="col">Week</th>
                          <th scope="col">Target</th>
                          <th scope="col">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {measurements
                          .filter((value) => value.point)
                          .map(({ weekStart, point }) => (
                            <tr key={weekStart}>
                              <th scope="row">{weekStart}</th>
                              <td>{kpiTarget(point!.track)}</td>
                              <td>
                                {kpiValue(point!.value, point!.track.unit)}
                                <small>
                                  {point!.result?.status ?? "Not assessed"}
                                  {point!.assessment
                                    ? ` · ${kpiCutoff(point!.assessment.asOf)}`
                                    : ""}
                                </small>
                                {point!.result ? (
                                  <details>
                                    <summary>Evidence</summary>
                                    <p>
                                      {point!.result.evidence.qualification}
                                    </p>
                                    <p>{point!.result.evidence.limitations}</p>
                                  </details>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : null}
          </>
        )}
      </details>
    </section>
  );
}
