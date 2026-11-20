"use client";

import { useId, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Period = { key: string; label: string };

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

/** Library-specific presentation only; aggregation and paging remain dashboard-owned. */
export function HealthRollupChart<T extends Period>({
  rollups,
  metric,
  title,
  unit,
  formatValue,
  kind = "bar",
  emptyMessage = "Unavailable for these periods.",
  presentation = "rollup",
  pointDetail,
  readoutDetail,
  band,
  bandLabel,
}: {
  rollups: T[];
  metric: (rollup: T) => number | null;
  title: string;
  unit: string;
  formatValue?: (value: number) => string;
  kind?: "line" | "bar";
  emptyMessage?: string;
  presentation?: "rollup" | "daily";
  pointDetail?: (period: T) => string | null;
  /** Extra context for the readout, tooltip and accessible name only, not the compact button. */
  readoutDetail?: (period: T) => string | null;
  /** Optional source-provided range drawn behind a line; null leaves a gap, never a guess. */
  band?: (period: T) => { low: number; high: number } | null;
  bandLabel?: string;
}) {
  const readoutId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const labelForValue = (value: number) =>
    formatValue?.(value) ??
    `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
  const data = rollups.map((period) => {
    const raw = metric(period);
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const range = band?.(period) ?? null;
    return {
      ...period,
      value,
      band: range ? [range.low, range.high] : null,
      shortLabel: compactPeriod(period.key),
      valueLabel: [
        value === null ? "Unavailable" : labelForValue(value),
        pointDetail?.(period),
      ]
        .filter(Boolean)
        .join(" · "),
      fullLabel: [
        value === null ? "Unavailable" : labelForValue(value),
        pointDetail?.(period),
        readoutDetail?.(period),
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
  const hasValues = data.some((point) => point.value !== null);
  const hasBand = data.some((point) => point.band !== null);
  const active = data.find((point) => point.key === activeKey) ?? data.at(-1);
  const color = kind === "line" ? "#b6a3ff" : "#49d6c8";
  const axisLabel = (value: number) =>
    formatValue
      ? formatValue(value).replace("/day", "").replaceAll(" ", "\u00a0")
      : Intl.NumberFormat(undefined, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value);

  return (
    <section
      className={`health-rollup-chart${hasValues ? "" : " empty-state"}`}
      role="group"
      aria-label={`${title} ${presentation === "daily" ? "daily" : "rollup"} chart`}
    >
      <div className="health-rollup-heading">
        <strong>{title}</strong>
        <span>
          {presentation === "daily"
            ? "Daily source values"
            : kind === "line"
              ? "Period average"
              : "Period total"}{" "}
          · {unit}
        </span>
      </div>
      {hasValues && hasBand && bandLabel ? (
        <p className="health-rollup-band-key">
          <i aria-hidden="true" /> {bandLabel}
        </p>
      ) : null}
      {hasValues ? (
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
                tickFormatter={axisLabel}
                tick={{ fill: "#a3b3c8", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickCount={4}
              />
              <Tooltip
                filterNull={false}
                isAnimationActive={false}
                cursor={{
                  stroke: "#a3b3c8",
                  strokeDasharray: "3 4",
                  fill: "rgba(160,180,210,0.06)",
                }}
                content={({ active: visible, payload }) => {
                  const point = payload?.[0]?.payload as
                    (typeof data)[number] | undefined;
                  return visible && point ? (
                    <div className="health-rollup-tooltip">
                      <span>{point.label}</span>
                      <strong>{point.fullLabel}</strong>
                    </div>
                  ) : null;
                }}
              />
              {hasBand ? (
                <Area
                  dataKey="band"
                  type="linear"
                  stroke="none"
                  fill="#49d6c8"
                  fillOpacity={0.16}
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={false}
                />
              ) : null}
              {kind === "line" ? (
                <Line
                  dataKey="value"
                  type="linear"
                  stroke={color}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: color, stroke: "#171c2a", strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Bar
                  dataKey="value"
                  fill={color}
                  radius={[5, 5, 0, 0]}
                  maxBarSize={32}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p>{emptyMessage}</p>
      )}
      <p className="health-rollup-readout" id={readoutId} aria-live="polite">
        {active
          ? `${active.label}: ${active.fullLabel}`
          : presentation === "daily"
            ? "No dates available."
            : "No periods available."}
      </p>
      <ul
        className="health-rollup-values"
        aria-label={`${title} ${presentation === "daily" ? "daily" : "period"} values`}
      >
        {data.map((point) => (
          <li key={point.key}>
            <button
              type="button"
              className="health-rollup-value"
              data-source-date={
                presentation === "daily" ? point.key : undefined
              }
              data-chart-state={
                point.value === null ? "unavailable" : "available"
              }
              aria-label={`${point.label}: ${point.fullLabel.toLowerCase()}`}
              aria-describedby={readoutId}
              title={`${point.label}: ${point.fullLabel}`}
              onPointerEnter={() => setActiveKey(point.key)}
              onFocus={() => setActiveKey(point.key)}
              onClick={() => setActiveKey(point.key)}
            >
              <span>{point.shortLabel}</span>
              <strong>{point.valueLabel}</strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
