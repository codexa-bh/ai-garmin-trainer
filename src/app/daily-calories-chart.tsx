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

type CalorieDay = {
  key: string;
  label: string;
  resting: number | null;
  active: number | null;
  recordedTotal: number | null;
};

const finite = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const kcal = (value: number | null) =>
  value === null
    ? "Unavailable"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 20 })} kcal`;

/** Daily source presentation only. Totals are never inferred from components. */
export function DailyCaloriesChart({ days }: { days: CalorieDay[] }) {
  const readoutId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const data = days.map((day) => {
    const resting = finite(day.resting);
    const active = finite(day.active);
    const recordedTotal = finite(day.recordedTotal);
    const complete = resting !== null && active !== null;
    const sum = complete ? resting + active : null;
    const context = !complete
      ? "Breakdown incomplete; no stack shown."
      : recordedTotal !== null && sum !== recordedTotal
        ? `Component sum ${kcal(sum)}; differs from recorded total.`
        : "";
    return {
      ...day,
      resting,
      active,
      recordedTotal,
      // Omit both segments of an incomplete date: null is never semantic zero.
      stackResting: complete ? resting : null,
      stackActive: complete ? active : null,
      complete,
      context,
      shortLabel: new Date(`${day.key}T00:00:00Z`).toLocaleDateString(
        undefined,
        { month: "short", day: "numeric", timeZone: "UTC" },
      ),
      valueLabel: `Resting: ${kcal(resting)} · Active: ${kcal(active)} · Recorded total: ${kcal(recordedTotal)}${context ? ` · ${context}` : ""}`,
    };
  });
  const selected = data.find((day) => day.key === activeKey) ?? data.at(-1);
  const hasStack = data.some((day) => day.complete);
  const breakdown = (day: (typeof data)[number]) => (
    <>
      <span>{day.label}</span>
      <dl className="health-calories-breakdown">
        <div>
          <dt>Resting</dt>
          <dd>{kcal(day.resting)}</dd>
        </div>
        <div>
          <dt>Active</dt>
          <dd>{kcal(day.active)}</dd>
        </div>
        <div>
          <dt>Recorded total</dt>
          <dd>{kcal(day.recordedTotal)}</dd>
        </div>
      </dl>
      {day.context ? (
        <span className="health-calories-context">{day.context}</span>
      ) : null}
    </>
  );

  return (
    <section
      className="health-rollup-chart health-calories-chart"
      role="group"
      aria-label="Calories daily chart"
    >
      <div className="health-rollup-heading">
        <strong>Calories</strong>
        <span>Daily source values · kcal</span>
      </div>
      <div className="health-calories-legend" aria-label="Calorie components">
        <span>
          <i className="health-calories-resting" aria-hidden="true" />
          Resting
        </span>
        <span>
          <i className="health-calories-active" aria-hidden="true" />
          Active
        </span>
      </div>
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
                  Intl.NumberFormat(undefined, { notation: "compact" }).format(
                    value,
                  )
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
                  const day = payload?.[0]?.payload as
                    (typeof data)[number] | undefined;
                  return active && day ? (
                    <div className="health-rollup-tooltip">
                      {breakdown(day)}
                    </div>
                  ) : null;
                }}
              />
              <Bar
                dataKey="stackResting"
                stackId="calories"
                name="Resting"
                fill="#49d6c8"
                maxBarSize={32}
                isAnimationActive={false}
              />
              <Bar
                dataKey="stackActive"
                stackId="calories"
                name="Active"
                fill="#b6a3ff"
                maxBarSize={32}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p>No complete calorie breakdowns for these dates.</p>
      )}
      <div className="health-rollup-readout" id={readoutId} aria-live="polite">
        {selected ? breakdown(selected) : "No dates available."}
      </div>
      <ul className="health-rollup-values" aria-label="Calories daily values">
        {data.map((day) => (
          <li key={day.key}>
            <button
              type="button"
              className="health-rollup-value"
              data-source-date={day.key}
              data-chart-state={day.complete ? "available" : "unavailable"}
              aria-label={`${day.label}: ${day.valueLabel}`}
              aria-describedby={readoutId}
              aria-pressed={selected?.key === day.key}
              title={`${day.label}: ${day.valueLabel}`}
              onPointerEnter={() => setActiveKey(day.key)}
              onFocus={() => setActiveKey(day.key)}
              onClick={() => setActiveKey(day.key)}
            >
              <span>{day.shortLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
