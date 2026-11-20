"use client";
import { useId, useState, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  HealthSupplementDay,
  HealthSupplementGroup,
  HealthSupplements,
  SupplementCoverage,
  Vo2Point,
} from "@/lib/local-data/supplement-contracts";

export type SupplementSlot = { key: string; label: string };

const GROUP_LABEL: Record<HealthSupplementGroup, string> = {
  sleep: "Sleep detail",
  hrv: "HRV baseline",
  stress: "Stress breakdown",
  body_battery: "Body Battery",
  vo2_max: "VO2 max",
};
const COMPONENT_LABEL: Record<string, string> = {
  overall: "Overall",
  deep: "Deep",
  light: "Light",
  rem: "REM",
  total_duration: "Total duration",
  stress: "Stress",
  awake_count: "Awake count",
  restlessness: "Restlessness",
};
const COMPONENT_ORDER = Object.keys(COMPONENT_LABEL);

/** Closed source codes read as plain words; unknown codes get the same neutral form. */
function readableCode(code: string | null): string | null {
  if (!code) return null;
  const words = code
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

const number = (value: number, digits = 0) =>
  value.toLocaleString(undefined, { maximumFractionDigits: digits });
const minutes = (seconds: number) => `${number(seconds / 60, 1)} min`;

/** Truthful wording for a missing value given its group's source coverage. */
function gapLabel(coverage: SupplementCoverage | undefined): string {
  switch (coverage?.status) {
    case "populated":
      return "Not reported by Garmin";
    case "empty":
      return "Garmin returned none";
    case "unavailable":
      return "Source unavailable";
    case "failed":
      return "Read failed";
    default:
      return "Not imported (unknown)";
  }
}

export function supplementIndex(supplements: HealthSupplements | null) {
  return new Map<string, HealthSupplementDay>(
    (supplements?.days ?? []).map((day) => [day.date, day]),
  );
}

export function hrvBand(day: HealthSupplementDay | undefined) {
  const hrv = day?.hrv;
  return hrv && hrv.balancedLowMs !== null && hrv.balancedUpperMs !== null
    ? { low: hrv.balancedLowMs, high: hrv.balancedUpperMs }
    : null;
}

export function hrvDetail(day: HealthSupplementDay | undefined): string | null {
  const band = hrvBand(day);
  return band
    ? `Garmin baseline ${number(band.low)}–${number(band.high)} ms`
    : null;
}

export function sleepScoreDetail(
  day: HealthSupplementDay | undefined,
): string | null {
  const qualifier = readableCode(day?.sleep?.overallQualifier ?? null);
  return qualifier ? `Garmin: ${qualifier}` : null;
}

type CardState = "available" | "unavailable";

/** Shared card shell: heading, optional legend, plot, readout and keyboard value buttons. */
function DailyEvidenceCard({
  title,
  subtitle,
  legend,
  plot,
  emptyMessage,
  slots,
  shortLabel,
  state,
  summary,
  detail,
}: {
  title: string;
  subtitle: string;
  legend?: ReactNode;
  plot: ReactNode | null;
  emptyMessage: string;
  slots: SupplementSlot[];
  shortLabel: (slot: SupplementSlot) => string;
  state: (slot: SupplementSlot) => CardState;
  summary: (slot: SupplementSlot) => string;
  detail: (slot: SupplementSlot) => ReactNode;
}) {
  const readoutId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = slots.find((slot) => slot.key === activeKey) ?? slots.at(-1);
  return (
    <section
      className={`health-rollup-chart${plot ? "" : " empty-state"}`}
      role="group"
      aria-label={`${title} daily chart`}
    >
      <div className="health-rollup-heading">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {plot ? legend : null}
      {plot ? (
        <div className="health-rollup-plot" aria-hidden="true">
          {plot}
        </div>
      ) : (
        <p>{emptyMessage}</p>
      )}
      <div className="health-rollup-readout" id={readoutId} aria-live="polite">
        {active ? detail(active) : "No dates available."}
      </div>
      <ul className="health-rollup-values" aria-label={`${title} daily values`}>
        {slots.map((slot) => (
          <li key={slot.key}>
            <button
              type="button"
              className="health-rollup-value"
              data-source-date={slot.key}
              data-chart-state={state(slot)}
              aria-label={`${slot.label}: ${summary(slot).toLowerCase()}`}
              aria-describedby={readoutId}
              aria-pressed={active?.key === slot.key}
              title={`${slot.label}: ${summary(slot)}`}
              onPointerEnter={() => setActiveKey(slot.key)}
              onFocus={() => setActiveKey(slot.key)}
              onClick={() => setActiveKey(slot.key)}
            >
              <span>{shortLabel(slot)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const shortDate = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const axisProps = {
  tick: { fill: "#a3b3c8", fontSize: 10 },
  tickLine: false,
  axisLine: false,
} as const;

const compact = (value: number) =>
  Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

function Plot({
  data,
  children,
}: {
  data: Array<{ label: string; text: string }>;
  children: ReactNode;
}) {
  return (
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
        <XAxis dataKey="short" {...axisProps} minTickGap={18} tickMargin={10} />
        <YAxis
          width={62}
          domain={[0, (max: number) => Math.max(max, 1)]}
          tickFormatter={compact}
          {...axisProps}
          tickCount={4}
        />
        <Tooltip
          filterNull={false}
          isAnimationActive={false}
          cursor={{ fill: "rgba(160,180,210,0.06)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as
              { label: string; text: string } | undefined;
            return active && point ? (
              <div className="health-rollup-tooltip">
                <span>{point.label}</span>
                <strong>{point.text}</strong>
              </div>
            ) : null;
          }}
        />
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const STRESS_BUCKETS = [
  ["restSeconds", "Rest", "#49d6c8"],
  ["lowSeconds", "Low", "#7fb2ff"],
  ["mediumSeconds", "Medium", "#e3b866"],
  ["highSeconds", "High", "#ff8a8a"],
] as const;

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="health-calories-legend" aria-label="Legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

export function StressBreakdownCard({
  slots,
  index,
}: {
  slots: SupplementSlot[];
  index: Map<string, HealthSupplementDay>;
}) {
  const rows = slots.map((slot) => {
    const day = index.get(slot.key);
    const stress = day?.stress ?? null;
    // Stack only when every stress bucket is present; a gap is never a zero.
    const complete =
      stress !== null && STRESS_BUCKETS.every(([key]) => stress[key] !== null);
    return {
      slot,
      day,
      stress,
      complete,
      short: shortDate(slot.key),
      label: slot.label,
      ...Object.fromEntries(
        STRESS_BUCKETS.map(([key]) => [
          key,
          complete && stress ? stress[key]! / 60 : null,
        ]),
      ),
    };
  });
  const text = (row: (typeof rows)[number]) => {
    if (!row.stress) return gapLabel(row.day?.coverage.stress);
    const part = (label: string, value: number | null) =>
      `${label}: ${value === null ? "Not reported" : minutes(value)}`;
    return [
      ...STRESS_BUCKETS.map(([key, label]) => part(label, row.stress![key])),
      part("Activity (not stress)", row.stress.activitySeconds),
      part("Uncategorized", row.stress.uncategorizedSeconds),
    ].join(" · ");
  };
  const byKey = new Map(rows.map((row) => [row.slot.key, row]));
  const data = rows.map((row) => ({ ...row, text: text(row) }));
  return (
    <DailyEvidenceCard
      title="Stress breakdown"
      subtitle="Daily source durations · min"
      legend={<Legend items={STRESS_BUCKETS.map(([, l, c]) => [l, c])} />}
      plot={
        rows.some((row) => row.complete) ? (
          <Plot data={data}>
            {STRESS_BUCKETS.map(([key, label, color]) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="stress"
                name={label}
                fill={color}
                maxBarSize={32}
                isAnimationActive={false}
              />
            ))}
          </Plot>
        ) : null
      }
      emptyMessage="No complete stress breakdowns for these dates."
      slots={slots}
      shortLabel={(slot) => shortDate(slot.key)}
      state={(slot) =>
        byKey.get(slot.key)?.complete ? "available" : "unavailable"
      }
      summary={(slot) => text(byKey.get(slot.key)!)}
      detail={(slot) => (
        <>
          <span>{slot.label}</span>
          <span>{text(byKey.get(slot.key)!)}</span>
        </>
      )}
    />
  );
}

export function BodyBatteryCard({
  slots,
  index,
}: {
  slots: SupplementSlot[];
  index: Map<string, HealthSupplementDay>;
}) {
  const rows = slots.map((slot) => {
    const day = index.get(slot.key);
    const battery = day?.bodyBattery ?? null;
    const part = (label: string, value: number | null | undefined) =>
      `${label}: ${typeof value === "number" ? `${number(value)} points` : "Not reported"}`;
    const text = battery
      ? `${part("Charged", battery.charged)} · ${part("Drained", battery.drained)}`
      : gapLabel(day?.coverage.body_battery);
    return {
      slot,
      battery,
      short: shortDate(slot.key),
      label: slot.label,
      charged: battery?.charged ?? null,
      drained: battery?.drained ?? null,
      text,
    };
  });
  const byKey = new Map(rows.map((row) => [row.slot.key, row]));
  const has = (row: (typeof rows)[number]) =>
    row.charged !== null || row.drained !== null;
  return (
    <DailyEvidenceCard
      title="Body Battery charged and drained"
      subtitle="Daily source totals · points"
      legend={
        <Legend
          items={[
            ["Charged", "#49d6c8"],
            ["Drained", "#b6a3ff"],
          ]}
        />
      }
      plot={
        rows.some(has) ? (
          <Plot data={rows}>
            <Bar
              dataKey="charged"
              name="Charged"
              fill="#49d6c8"
              maxBarSize={18}
              isAnimationActive={false}
            />
            <Bar
              dataKey="drained"
              name="Drained"
              fill="#b6a3ff"
              maxBarSize={18}
              isAnimationActive={false}
            />
          </Plot>
        ) : null
      }
      emptyMessage="No charged or drained values for these dates."
      slots={slots}
      shortLabel={(slot) => shortDate(slot.key)}
      state={(slot) =>
        has(byKey.get(slot.key)!) ? "available" : "unavailable"
      }
      summary={(slot) => byKey.get(slot.key)!.text}
      detail={(slot) => (
        <>
          <span>{slot.label}</span>
          <span>{byKey.get(slot.key)!.text}</span>
        </>
      )}
    />
  );
}

const VO2_BRANCHES = [
  ["generic", "General", "#b6a3ff"],
  ["cycling", "Cycling", "#49d6c8"],
  ["rowing", "Rowing", "#e3b866"],
] as const;

const vo2Value = (point: Vo2Point) => point.vo2MaxPrecise ?? point.vo2Max;

export function Vo2Card({
  slots,
  readings,
}: {
  slots: SupplementSlot[];
  readings: Vo2Point[];
}) {
  const bySlot = new Map<string, Vo2Point[]>();
  for (const reading of readings)
    bySlot.set(reading.date, [...(bySlot.get(reading.date) ?? []), reading]);
  const text = (key: string) => {
    const points = bySlot.get(key) ?? [];
    // Fixed branch order, independent of storage order.
    const ordered = VO2_BRANCHES.flatMap(([branch]) =>
      points.filter((point) => point.branch === branch),
    );
    return ordered.length
      ? ordered
          .map((point) => {
            const value = vo2Value(point);
            const sport = readableCode(point.subSport ?? point.sport);
            return `${VO2_BRANCHES.find(([id]) => id === point.branch)?.[1]}: ${value === null ? "no value" : `${number(value, 1)} ml/kg/min`}${sport ? ` (${sport})` : ""}`;
          })
          .join(" · ")
      : "No reading stored for this date";
  };
  // Points only: each branch gets its own series and no line joins them.
  const data = slots.map((slot) => {
    const valueFor = (branch: Vo2Point["branch"]) => {
      const point = bySlot.get(slot.key)?.find((p) => p.branch === branch);
      return point ? vo2Value(point) : null;
    };
    return {
      short: shortDate(slot.key),
      label: slot.label,
      text: text(slot.key),
      generic: valueFor("generic"),
      cycling: valueFor("cycling"),
      rowing: valueFor("rowing"),
    };
  });
  const has = data.some(
    (row) =>
      row.generic !== null || row.cycling !== null || row.rowing !== null,
  );
  return (
    <DailyEvidenceCard
      title="VO2 max"
      subtitle="Dated readings only · ml/kg/min"
      legend={<Legend items={VO2_BRANCHES.map(([, l, c]) => [l, c])} />}
      plot={
        has ? (
          <Plot data={data}>
            {VO2_BRANCHES.map(([branch, label, color]) => (
              <Line
                key={branch}
                dataKey={branch}
                name={label}
                stroke="none"
                dot={{ r: 5, fill: color, stroke: "#171c2a", strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </Plot>
        ) : null
      }
      emptyMessage="No VO2 max readings are stored for these dates. That does not show none exist in other dates or in Garmin."
      slots={slots}
      shortLabel={(slot) => shortDate(slot.key)}
      state={(slot) => (bySlot.has(slot.key) ? "available" : "unavailable")}
      summary={(slot) => text(slot.key)}
      detail={(slot) => (
        <>
          <span>{slot.label}</span>
          <span>{text(slot.key)}</span>
        </>
      )}
    />
  );
}

/** Concise per-date sleep-score qualifiers; qualifier-only parts carry no number. */
export function SleepDetailDisclosure({
  slots,
  index,
}: {
  slots: SupplementSlot[];
  index: Map<string, HealthSupplementDay>;
}) {
  return (
    <details className="health-supplement-disclosure health-sleep-detail">
      <summary>Sleep score details by date (Garmin qualifiers)</summary>
      <ul>
        {slots.map((slot) => {
          const day = index.get(slot.key);
          const parts = [...(day?.sleep?.components ?? [])]
            .sort(
              (a, b) =>
                COMPONENT_ORDER.indexOf(a.component) -
                COMPONENT_ORDER.indexOf(b.component),
            )
            .map((part) => {
              const value = part.value === null ? null : number(part.value);
              const qualifier = readableCode(part.qualifier);
              return `${COMPONENT_LABEL[part.component] ?? readableCode(part.component)}: ${[value, qualifier].filter(Boolean).join(" · ") || "Not reported"}`;
            });
          return (
            <li key={slot.key} data-sleep-detail={slot.key}>
              <strong>{slot.label}</strong>
              <span>
                {parts.length
                  ? parts.join(" · ")
                  : gapLabel(day?.coverage.sleep)}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const STATUS_LABEL: Record<SupplementCoverage["status"], string> = {
  populated: "stored",
  empty: "none from Garmin",
  unavailable: "source unavailable",
  failed: "read failed",
  not_imported: "not imported",
};

/** Per-date, per-group coverage: absent rows read as unknown, never as empty or zero. */
export function SupplementCoverageDisclosure({
  slots,
  index,
}: {
  slots: SupplementSlot[];
  index: Map<string, HealthSupplementDay>;
}) {
  return (
    <details className="health-supplement-disclosure health-supplement-coverage">
      <summary>Additional Garmin evidence coverage by date</summary>
      <ul>
        {slots.map((slot) => {
          const day = index.get(slot.key);
          return (
            <li key={slot.key}>
              <strong>{slot.label}</strong>
              {(Object.keys(GROUP_LABEL) as HealthSupplementGroup[]).map(
                (group) => {
                  const coverage = day?.coverage[group];
                  return (
                    <span
                      key={group}
                      data-supplement-status={
                        coverage?.status ?? "not_imported"
                      }
                    >
                      {GROUP_LABEL[group]}:{" "}
                      {STATUS_LABEL[coverage?.status ?? "not_imported"]}
                    </span>
                  );
                },
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
