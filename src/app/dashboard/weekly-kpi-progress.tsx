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
import { kpiTarget, kpiValue } from "./weekly-kpi-scorecard";

export function WeeklyKpiProgress({
  weekly,
  run,
  openWeek,
}: {
  weekly: ReturnType<typeof useWeeklyFeature>;
  run: (work: Promise<unknown>) => void;
  openWeek: (week: string) => void;
}) {
  const options = new Map<
    string,
    { label: string; unit: string; kind: string }
  >();
  for (const week of weekly.progress?.weeks ?? [])
    for (const set of week.kpis.sets)
      for (const item of set.items)
        for (const track of item.tracks)
          options.set(`${item.conceptId}/${track.key}`, {
            label: `${item.label} · ${track.meaning}`,
            unit: track.unit,
            kind: track.kind,
          });
  const selected = options.has(weekly.progressTrack)
    ? weekly.progressTrack
    : (options.keys().next().value ?? "");
  const selectedTrack = options.get(selected);
  const data = (weekly.progress?.weeks ?? []).map(({ weekStart, kpis }) => {
    const setId =
      weekly.progressBaseline === "original"
        ? kpis.originalId
        : weekly.progressBaseline === "latest"
          ? kpis.latestId
          : kpis.reviewDefinedId;
    const set = kpis.sets.find((s) => s.id === setId);
    const item = set?.items.find((i) =>
      i.tracks.some((t) => `${i.conceptId}/${t.key}` === selected),
    );
    const track = item?.tracks.find(
      (t) => `${item.conceptId}/${t.key}` === selected,
    );
    const assessment = kpis.assessments.find((a) => a.setId === setId);
    const result = assessment?.items.find((i) => i.itemId === item?.id);
    const value = result?.actuals.find((a) => a.trackKey === track?.key)?.value;
    return {
      weekStart,
      kpis,
      set,
      item,
      track,
      assessment,
      result,
      value,
      target:
        typeof track?.target?.value === "number" ? track.target.value : null,
      upper: track?.target?.upper ?? null,
      actual:
        typeof value === "number" && Number.isFinite(value) ? value : null,
    };
  });
  return (
    <section aria-label="Saved KPI progress" className="weekly-kpi-progress">
      <h2>Saved weekly progress</h2>
      <p>
        Targets and recorded actuals in their own units. Gaps are not zero;
        above-target values do not award bonus points. Different rubrics and
        point denominators are not a fitness trend.
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
      {!options.size ? (
        <p>
          No saved measurement tracks in this range. Missing commitments remain
          gaps; establish them through chat.
        </p>
      ) : (
        <>
          <div className="weekly-progress-controls">
            <label>
              Measurement track
              <select
                value={selected}
                onChange={(event) =>
                  weekly.setProgressTrack(event.target.value)
                }
              >
                {[...options].map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label} ({value.unit})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Comparison basis
              <select
                value={weekly.progressBaseline}
                onChange={(event) =>
                  weekly.setProgressBaseline(
                    event.target.value as typeof weekly.progressBaseline,
                  )
                }
              >
                <option value="original">Original commitment</option>
                <option value="latest">Latest adaptation / original</option>
                <option value="review-defined">
                  Review-defined (provisional, not prior agreement)
                </option>
              </select>
            </label>
          </div>
          {selectedTrack?.kind === "numeric" ? (
            <div className="weekly-progress-chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{ top: 12, right: 24, left: 4, bottom: 8 }}
                >
                  <CartesianGrid stroke="var(--line)" />
                  <XAxis
                    dataKey="weekStart"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip />
                  <Line
                    type="linear"
                    dataKey="target"
                    name={`Target (${selectedTrack.unit})`}
                    stroke="#b6a3ff"
                    strokeDasharray="5 5"
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="upper"
                    name="Range upper bound"
                    stroke="#b6a3ff"
                    strokeDasharray="2 4"
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="actual"
                    name={`Recorded actual (${selectedTrack.unit})`}
                    stroke="#49d6c8"
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <p>
            Dashed: target / range upper bound. Solid: recorded actual. Target
            direction and evidence remain explicit below; connecting saved
            points is not a new assessment.
          </p>
        </>
      )}
      <ul className="weekly-progress-values">
        {data.map((point) => (
          <li key={point.weekStart}>
            <button
              type="button"
              className="chrome-button"
              onClick={() => openWeek(point.weekStart)}
            >
              {point.weekStart} · open week
            </button>
            <p>
              {!point.kpis.complete ? (
                "Incomplete comparison · open week and select a baseline"
              ) : !point.set ? (
                "No saved baseline · gap"
              ) : !point.track ? (
                "No selected measurement in this baseline · gap"
              ) : (
                <>
                  {point.item?.label} · Target: {kpiTarget(point.track)} ·
                  Recorded actual: {kpiValue(point.value, point.track.unit)} ·{" "}
                  {point.result?.status ?? "Not assessed"}
                  {point.assessment ? ` · as of ${point.assessment.asOf}` : ""}
                </>
              )}
            </p>
            {point.item ? (
              <p>
                {point.item.availablePoints === null
                  ? "Monitoring / context; no allocation"
                  : `${point.item.availablePoints} available points in this rubric`}{" "}
                ·{" "}
                {point.result?.awardedPoints === null ||
                point.result?.awardedPoints === undefined
                  ? "No awarded points recorded"
                  : `${point.result.awardedPoints} awarded`}{" "}
                · basis {point.set?.id}. {point.result?.evidence.qualification}{" "}
                {point.result?.evidence.limitations}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
