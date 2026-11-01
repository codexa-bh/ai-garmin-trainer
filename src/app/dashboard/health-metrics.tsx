"use client";
import { finiteNumberLabel } from "./formatting";
import { useState } from "react";
import { HealthRollupChart } from "../health-rollup-chart";
import {
  SLEEP_DETAIL_SOURCE_LIMITED,
  SLEEP_STAGE_FIELDS,
  type HealthDashboardDay,
  type HealthDashboardMode,
} from "./contracts";
import { dailyHealthRange, shiftHealthDate } from "./health-daily-range";
function formatSleepMinutes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
  return `${minutes} m`;
}

function formatSleepRollupMinutesPerDay(value: number): string {
  if (!Number.isFinite(value)) return "Unavailable";
  const roundedMinutes = Math.round(value);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  const duration =
    hours > 0
      ? minutes > 0
        ? `${hours} h ${minutes} m`
        : `${hours} h`
      : `${minutes} m`;
  return `${duration}/day`;
}

function formatCalendarDate(dateValue: string): string {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function healthAvailabilityLabel(
  availability: "complete" | "partial" | "missing",
): string {
  if (availability === "complete") return "Recorded coverage";
  if (availability === "partial") return "Partial source coverage";
  return "Source marked missing";
}

function sumNumbers(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return present.reduce((total, value) => total + value, 0);
}

function averageNumbers(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return present.reduce((total, value) => total + value, 0) / present.length;
}

function periodKey(
  date: string,
  mode: Exclude<HealthDashboardMode, "daily">,
): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  if (mode === "monthly") return date.slice(0, 7);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 1 - day);
  return parsed.toISOString().slice(0, 10);
}

function periodLabel(
  key: string,
  mode: Exclude<HealthDashboardMode, "daily">,
): string {
  if (mode === "monthly") {
    const parsed = new Date(`${key}-01T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
      ? key
      : parsed.toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
  }
  return `Week of ${formatCalendarDate(key)}`;
}

const HEALTH_ROLLUP_WINDOW_SIZE = 8;

type HealthRollup = {
  key: string;
  label: string;
  dayCount: number;
  sleepMinutes: number | null;
  sleepScore: number | null;
  sleepDeepMinutes: number | null;
  sleepLightMinutes: number | null;
  sleepRemMinutes: number | null;
  sleepAwakeMinutes: number | null;
  sleepNapMinutes: number | null;
  steps: number | null;
  activeCalories: number | null;
  restingCalories: number | null;
  totalCalories: number | null;
  intensityMinutes: number | null;
  restingHeartRate: number | null;
  hrvMs: number | null;
  stressAvg: number | null;
};

function healthRollups(
  days: HealthDashboardDay[],
  mode: Exclude<HealthDashboardMode, "daily">,
): HealthRollup[] {
  const grouped = new Map<string, HealthDashboardDay[]>();
  for (const day of days.slice().reverse()) {
    const key = periodKey(day.date, mode);
    grouped.set(key, [...(grouped.get(key) ?? []), day]);
  }
  return Array.from(grouped.entries()).map(([key, rows]) => ({
    key,
    label: periodLabel(key, mode),
    dayCount: rows.length,
    sleepMinutes: averageNumbers(rows.map((day) => day.sleepMinutes)),
    sleepScore: averageNumbers(rows.map((day) => day.sleepScore)),
    sleepDeepMinutes: averageNumbers(rows.map((day) => day.sleepDeepMinutes)),
    sleepLightMinutes: averageNumbers(rows.map((day) => day.sleepLightMinutes)),
    sleepRemMinutes: averageNumbers(rows.map((day) => day.sleepRemMinutes)),
    sleepAwakeMinutes: averageNumbers(rows.map((day) => day.sleepAwakeMinutes)),
    sleepNapMinutes: averageNumbers(rows.map((day) => day.sleepNapMinutes)),
    steps: sumNumbers(rows.map((day) => day.steps)),
    activeCalories: sumNumbers(rows.map((day) => day.activeCalories)),
    restingCalories: sumNumbers(rows.map((day) => day.restingCalories)),
    totalCalories: sumNumbers(
      rows.map((day) => day.totalCalories ?? day.calories),
    ),
    intensityMinutes: sumNumbers(rows.map((day) => day.intensityMinutes)),
    restingHeartRate: averageNumbers(rows.map((day) => day.restingHeartRate)),
    hrvMs: averageNumbers(rows.map((day) => day.hrvMs)),
    stressAvg: averageNumbers(rows.map((day) => day.stressAvg)),
  }));
}

function hasFiniteRollupMetric(
  rollups: HealthRollup[],
  metric: (rollup: HealthRollup) => number | null,
) {
  return rollups.some((rollup) => {
    const value = metric(rollup);
    return typeof value === "number" && Number.isFinite(value);
  });
}

function hasSleepStageRollup(rollups: HealthRollup[]): boolean {
  return SLEEP_STAGE_FIELDS.some(([, field]) =>
    hasFiniteRollupMetric(rollups, (rollup) => rollup[field]),
  );
}

const DAILY_METRICS: Array<{
  title: string;
  unit: string;
  kind?: "line" | "bar";
  value: (day: HealthDashboardDay) => number | null;
  format?: (value: number) => string;
}> = [
  {
    title: "Sleep duration",
    unit: "min",
    kind: "line",
    value: (day) => day.sleepMinutes,
    format: formatSleepMinutes,
  },
  {
    title: "Sleep score",
    unit: "score",
    kind: "line",
    value: (day) => day.sleepScore,
    format: finiteNumberLabel,
  },
  { title: "Steps", unit: "steps", value: (day) => day.steps },
  {
    title: "Total calories",
    unit: "kcal",
    value: (day) => day.totalCalories ?? day.calories,
  },
  {
    title: "Resting HR",
    unit: "bpm",
    kind: "line",
    value: (day) => day.restingHeartRate,
  },
  { title: "HRV", unit: "ms", kind: "line", value: (day) => day.hrvMs },
  {
    title: "Stress avg",
    unit: "score",
    kind: "line",
    value: (day) => day.stressAvg,
    format: finiteNumberLabel,
  },
  {
    title: "Intensity minutes",
    unit: "min",
    value: (day) => day.intensityMinutes,
  },
  ...SLEEP_STAGE_FIELDS.map(([label, field]) => ({
    title: `${label} sleep`,
    unit: "min",
    kind: "line" as const,
    value: (day: HealthDashboardDay) => day[field],
    format: formatSleepMinutes,
  })),
  {
    title: "Active calories",
    unit: "kcal",
    value: (day) => day.activeCalories,
  },
  {
    title: "Resting calories",
    unit: "kcal",
    value: (day) => day.restingCalories,
  },
];

function DailyComparison({
  days,
  rangeEnd,
  onSelectRange,
  notice,
}: {
  days: HealthDashboardDay[];
  rangeEnd: string | null;
  onSelectRange: (end: string) => void;
  notice: string;
}) {
  const range = dailyHealthRange(
    days,
    rangeEnd,
    new Date().toISOString().slice(0, 10),
  );
  if (!range)
    return (
      <p className="health-empty-state">
        No eligible Daily records at or before today (UTC). Weekly and Monthly
        retain their imported rows.
      </p>
    );
  const label = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  const rangeLabel = `${label(range.start)} – ${label(range.end)}`;
  const slots = range.slots.map((slot) => ({
    ...slot,
    key: slot.date,
    label: label(slot.date),
  }));
  return (
    <>
      <div
        className="health-daily-browser"
        aria-label="Browse seven-day comparisons"
      >
        <div>
          <p className="section-kicker">Seven individual calendar days</p>
          <h2 id="health-daily-range">{rangeLabel}</h2>
        </div>
        <div className="health-daily-actions">
          <button
            type="button"
            className="chrome-button"
            disabled={!range.canPrevious}
            onClick={() => onSelectRange(shiftHealthDate(range.end, -7))}
          >
            ← Previous 7 days
          </button>
          <button
            type="button"
            className="chrome-button"
            disabled={!range.canNext}
            onClick={() => onSelectRange(shiftHealthDate(range.end, 7))}
          >
            Next 7 days →
          </button>
          <button
            type="button"
            className="chrome-button"
            disabled={range.end === range.latest}
            onClick={() => onSelectRange(range.latest)}
          >
            Latest 7 days
          </button>
        </div>
      </div>
      <p className="helper-text" role="status" aria-live="polite">
        {notice ? `${notice} ` : ""}Showing {rangeLabel}.
      </p>
      {range.slots.every((slot) => !slot.record) ? (
        <p>No imported records in this range. Date gaps are not zero values.</p>
      ) : null}
      <p id="health-daily-help" className="helper-text">
        Seven daily source values, not weekly aggregates. Gaps are unavailable,
        not zero. Point to or focus a date below each chart for exact values.
        Recorded coverage does not imply full metric availability or finality.
        {slots.some((slot) => slot.isCurrentDay)
          ? " Today · in progress, not final (UTC)."
          : ""}
      </p>
      <div
        className="health-daily-comparison"
        aria-describedby="health-daily-help"
      >
        <div className="health-rollup-grid">
          {DAILY_METRICS.map((metric) => (
            <HealthRollupChart
              key={metric.title}
              rollups={slots}
              presentation="daily"
              title={metric.title}
              unit={metric.unit}
              kind={metric.kind}
              metric={(slot) =>
                slot.record ? metric.value(slot.record) : null
              }
              formatValue={metric.format}
              pointDetail={
                metric.title === "HRV"
                  ? (slot) => slot.record?.hrvStatus ?? null
                  : undefined
              }
              emptyMessage="No recorded values for these dates."
            />
          ))}
        </div>
        <details className="health-daily-coverage">
          <summary>Source coverage and HRV status by date</summary>
          <ul>
            {slots.map((slot) => (
              <li
                key={slot.date}
                data-coverage={
                  slot.record?.availability ??
                  (slot.outsideLoaded ? "outside" : "missing-record")
                }
              >
                <time dateTime={slot.date}>{slot.label}</time>
                <span>
                  {slot.record
                    ? healthAvailabilityLabel(slot.record.availability)
                    : slot.outsideLoaded
                      ? "Outside loaded history"
                      : "No imported record"}
                </span>
                {slot.isCurrentDay ? (
                  <span>Today · in progress, not final</span>
                ) : null}
                {slot.record?.hrvStatus ? (
                  <span>HRV status: {slot.record.hrvStatus}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <p className="helper-text">
        Sleep stages and recorded duration are independent.{" "}
        {SLEEP_DETAIL_SOURCE_LIMITED} Intensity minutes: Daily Garmin health
        source only. Loaded history is bounded; older archive may exist.
      </p>
    </>
  );
}

export function HealthDashboardView({
  days,
  rangeEnd,
  onSelectRange,
  notice,
}: {
  days: HealthDashboardDay[];
  rangeEnd: string | null;
  onSelectRange: (end: string) => void;
  notice: string;
}) {
  const [mode, setMode] = useState<HealthDashboardMode>("daily");
  const [rollupPage, setRollupPage] = useState(0);
  const rollupMode = mode === "daily" ? null : mode;
  const allRollups = rollupMode ? healthRollups(days, rollupMode) : [];
  const maxRollupPage = Math.max(
    0,
    Math.ceil(allRollups.length / HEALTH_ROLLUP_WINDOW_SIZE) - 1,
  );
  const clampedRollupPage = Math.min(rollupPage, maxRollupPage);
  const rollupWindowEnd =
    allRollups.length - clampedRollupPage * HEALTH_ROLLUP_WINDOW_SIZE;
  const rollupWindowStart = Math.max(
    0,
    rollupWindowEnd - HEALTH_ROLLUP_WINDOW_SIZE,
  );
  const rollups = rollupMode
    ? allRollups.slice(rollupWindowStart, rollupWindowEnd)
    : [];
  const hasAnySleepStageRollup = hasSleepStageRollup(rollups);
  const canBrowseOlder =
    rollupMode !== null && clampedRollupPage < maxRollupPage;
  const canBrowseNewer = rollupMode !== null && clampedRollupPage > 0;
  const rollupRangeLabel =
    rollups.length === 0
      ? "No available periods"
      : rollups.length === 1
        ? rollups[0].label
        : `${rollups[0].label} – ${rollups[rollups.length - 1].label}`;

  if (rollupPage !== clampedRollupPage) setRollupPage(clampedRollupPage);

  return (
    <div className="health-dashboard-body">
      <div
        className="health-mode-controls"
        role="tablist"
        aria-label="Health time range"
      >
        {(["daily", "weekly", "monthly"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`chrome-button ${mode === item ? "active" : ""}`}
            onClick={() => {
              if (item !== mode) setRollupPage(0);
              setMode(item);
            }}
            role="tab"
            id={`health-tab-${item}`}
            aria-controls="health-time-panel"
            tabIndex={mode === item ? 0 : -1}
            aria-selected={mode === item}
            onKeyDown={(event) => {
              const modes = ["daily", "weekly", "monthly"] as const;
              const offset =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (!offset && event.key !== "Home" && event.key !== "End")
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (modes.indexOf(item) + offset + 3) % 3;
              setMode(modes[next]);
              setRollupPage(0);
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              tabs?.[next].focus();
            }}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      <div
        id="health-time-panel"
        role="tabpanel"
        aria-labelledby={`health-tab-${mode}`}
      >
        {mode === "daily" ? (
          <DailyComparison
            days={days}
            rangeEnd={rangeEnd}
            onSelectRange={onSelectRange}
            notice={notice}
          />
        ) : (
          <div className="health-rollup-view">
            <div className="health-rollup-summary">
              <div>
                <h2>
                  {mode === "weekly"
                    ? "Weekly Health rollups"
                    : "Monthly Health rollups"}
                </h2>
                <p className="health-rollup-range">
                  Showing {rollupRangeLabel}
                </p>
              </div>
              <div
                className="health-rollup-browser"
                aria-label={`${mode} rollup period browser`}
              >
                <button
                  type="button"
                  className="chrome-button"
                  onClick={() => setRollupPage(clampedRollupPage + 1)}
                  disabled={!canBrowseOlder}
                >
                  ← Older periods
                </button>
                <button
                  type="button"
                  className="chrome-button"
                  onClick={() => setRollupPage(clampedRollupPage - 1)}
                  disabled={!canBrowseNewer}
                >
                  Newer periods →
                </button>
              </div>
            </div>
            <div className="health-rollup-grid">
              <HealthRollupChart
                rollups={rollups}
                title="Sleep duration daily avg"
                kind="line"
                unit="min"
                metric={(rollup) => rollup.sleepMinutes}
                formatValue={formatSleepRollupMinutesPerDay}
              />
              <HealthRollupChart
                rollups={rollups}
                title="Sleep score avg"
                kind="line"
                unit="avg"
                metric={(rollup) => rollup.sleepScore}
                emptyMessage="Source sleep scores are unavailable for these periods."
              />
              {hasAnySleepStageRollup ? (
                SLEEP_STAGE_FIELDS.map(([label, field]) => (
                  <HealthRollupChart
                    key={field}
                    rollups={rollups}
                    title={`${label} sleep daily avg`}
                    kind="line"
                    unit="min"
                    metric={(rollup) => rollup[field]}
                    formatValue={formatSleepRollupMinutesPerDay}
                  />
                ))
              ) : (
                <div className="health-rollup-chart empty-state">
                  <strong>Sleep stages</strong>
                  <p>
                    Source sleep-stage durations are unavailable for these
                    periods.
                  </p>
                </div>
              )}
              <HealthRollupChart
                rollups={rollups}
                title="Steps"
                unit="steps"
                metric={(rollup) => rollup.steps}
              />
              <HealthRollupChart
                rollups={rollups}
                title="Total calories"
                unit="kcal"
                metric={(rollup) => rollup.totalCalories}
              />
              <HealthRollupChart
                rollups={rollups}
                title="Intensity minutes"
                unit="min"
                metric={(rollup) => rollup.intensityMinutes}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
