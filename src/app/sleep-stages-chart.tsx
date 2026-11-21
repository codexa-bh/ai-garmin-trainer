"use client";

import { useId, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type SleepStagePoint = {
  key: string;
  label: string;
  rem: number | null;
  deep: number | null;
  light: number | null;
  /** Source-recorded total; independent of the stage values and never a segment. */
  recordedDuration: number | null;
};

const finite = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// Recharts stacks the first Bar at the bottom: REM, then Deep, then Light.
const STAGES = [
  { field: "rem", label: "REM", color: "#b6a3ff", className: "rem" },
  { field: "deep", label: "Deep", color: "#5b8def", className: "deep" },
  { field: "light", label: "Light", color: "#49d6c8", className: "light" },
] as const;

function compactPeriod(key: string) {
  const monthly = key.length === 7;
  const date = new Date(`${key}${monthly ? "-01" : ""}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? key
    : date.toLocaleDateString(undefined, {
        month: "short",
        ...(monthly ? { year: "2-digit" } : { day: "numeric" }),
        timeZone: "UTC",
      });
}

/**
 * Sleep-stage composition presentation for Daily dates or rollup periods.
 * Aggregation stays with the dashboard; this component never infers a value.
 */
export function SleepStagesChart({
  points,
  presentation,
  formatDuration,
}: {
  points: SleepStagePoint[];
  presentation: "daily" | "rollup";
  formatDuration: (minutes: number) => string;
}) {
  const readoutId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const show = (value: number | null) =>
    value === null ? "Unavailable" : formatDuration(value);
  const data = points.map((point) => {
    const rem = finite(point.rem);
    const deep = finite(point.deep);
    const light = finite(point.light);
    const recordedDuration = finite(point.recordedDuration);
    const complete = rem !== null && deep !== null && light !== null;
    const sum = complete ? rem + deep + light : null;
    const context = !complete
      ? "Stage breakdown incomplete; no stack shown."
      : recordedDuration !== null &&
          Math.abs((sum ?? 0) - recordedDuration) > 1e-6
        ? `Stage sum ${show(sum)}; differs from recorded duration.`
        : "";
    return {
      ...point,
      rem,
      deep,
      light,
      recordedDuration,
      // Omit all three segments of an incomplete point: null is never zero.
      stackRem: complete ? rem : null,
      stackDeep: complete ? deep : null,
      stackLight: complete ? light : null,
      complete,
      context,
      shortLabel: compactPeriod(point.key),
      valueLabel: `REM: ${show(rem)} · Deep: ${show(deep)} · Light: ${show(light)} · Recorded duration: ${show(recordedDuration)}${context ? ` · ${context}` : ""}`,
    };
  });
  const selected = data.find((point) => point.key === activeKey) ?? data.at(-1);
  const hasStack = data.some((point) => point.complete);
  const hasAnyValue = data.some(
    (point) =>
      point.rem !== null ||
      point.deep !== null ||
      point.light !== null ||
      point.recordedDuration !== null,
  );
  const rollup = presentation === "rollup";
  const breakdown = (point: (typeof data)[number]) => (
    <>
      <span>{point.label}</span>
      <dl className="health-sleep-breakdown">
        {[...STAGES].reverse().map((stage) => (
          <div key={stage.field}>
            <dt>{stage.label}</dt>
            <dd>{show(point[stage.field])}</dd>
          </div>
        ))}
        <div>
          <dt>Recorded duration</dt>
          <dd>{show(point.recordedDuration)}</dd>
        </div>
      </dl>
      {point.context ? (
        <span className="health-sleep-context">{point.context}</span>
      ) : null}
    </>
  );

  return (
    <section
      className={`health-rollup-chart health-sleep-chart${hasAnyValue ? "" : " empty-state"}`}
      role="group"
      aria-label={`Sleep stages ${rollup ? "rollup" : "daily"} chart`}
    >
      <div className="health-rollup-heading">
        <strong>Sleep stages</strong>
        <span>
          {rollup
            ? "Daily average per period · each stage averaged over its available days"
            : "Daily source values"}
        </span>
      </div>
      {hasAnyValue ? (
        <div
          className="health-sleep-legend"
          aria-label="Sleep stages, top to bottom"
        >
          {STAGES.slice()
            .reverse()
            .map((stage) => (
              <span key={stage.field}>
                <i
                  className={`health-sleep-${stage.className}`}
                  aria-hidden="true"
                />
                {stage.label}
              </span>
            ))}
        </div>
      ) : null}
      {hasStack ? (
        <div className="health-rollup-plot" aria-hidden="true">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 400, height: 200 }}
          >
            <ComposedChart
              data={data}
              margin={{ top: 12, right: 14, bottom: 0, left: 0 }}
              accessibilityLayer={false}
            >
              <CartesianGrid
                vertical={false}
                stroke="rgba(160,180,210,0.13)"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="shortLabel"
                tick={{ fill: "#a3b3c8", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={18}
                tickMargin={10}
              />
              <YAxis
                width={62}
                domain={[0, (max: number) => Math.max(max, 1)]}
                tickFormatter={(value: number) =>
                  `${Math.round(value / 6) / 10} h`
                }
                tick={{ fill: "#a3b3c8", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickCount={4}
              />
              <Tooltip
                filterNull={false}
                isAnimationActive={false}
                cursor={{ fill: "rgba(160,180,210,0.06)" }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as
                    (typeof data)[number] | undefined;
                  return active && point ? (
                    <div className="health-rollup-tooltip">
                      {breakdown(point)}
                    </div>
                  ) : null;
                }}
              />
              {STAGES.map((stage) => (
                <Bar
                  key={stage.field}
                  dataKey={`stack${stage.field[0].toUpperCase()}${stage.field.slice(1)}`}
                  stackId="sleep"
                  name={stage.label}
                  fill={stage.color}
                  maxBarSize={32}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : hasAnyValue ? (
        <p>
          No complete stage breakdowns for these {rollup ? "periods" : "dates"}.
        </p>
      ) : (
        <p>
          Source sleep-stage durations are unavailable for these{" "}
          {rollup ? "periods" : "dates"}.
        </p>
      )}
      <div className="health-rollup-readout" id={readoutId} aria-live="polite">
        {selected
          ? breakdown(selected)
          : rollup
            ? "No periods available."
            : "No dates available."}
      </div>
      <ul
        className="health-rollup-values"
        aria-label={`Sleep stages ${rollup ? "period" : "daily"} values`}
      >
        {data.map((point) => (
          <li key={point.key}>
            <button
              type="button"
              className="health-rollup-value"
              data-source-date={rollup ? undefined : point.key}
              data-chart-state={point.complete ? "available" : "unavailable"}
              aria-label={`${point.label}: ${point.valueLabel}`}
              aria-describedby={readoutId}
              aria-pressed={selected?.key === point.key}
              title={`${point.label}: ${point.valueLabel}`}
              onPointerEnter={() => setActiveKey(point.key)}
              onFocus={() => setActiveKey(point.key)}
              onClick={() => setActiveKey(point.key)}
            >
              <span>{point.shortLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
