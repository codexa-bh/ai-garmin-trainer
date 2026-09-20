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
import { numberLabel } from "./formatting";
function formatSleepMinutes(value: number | null): string {
  if (value == null) return "Unavailable";
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
  if (availability === "complete") return "Complete daily health record";
  if (availability === "partial")
    return "Partial day — some metrics unavailable";
  return "Source-unavailable day — no metrics available";
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

function sleepStageEntries(day: HealthDashboardDay) {
  return SLEEP_STAGE_FIELDS.flatMap(([label, field]) => {
    const minutes = day[field];
    return typeof minutes === "number" && Number.isFinite(minutes)
      ? [{ label, minutes }]
      : [];
  });
}

function hasSleepStageRollup(rollups: HealthRollup[]): boolean {
  return SLEEP_STAGE_FIELDS.some(([, field]) =>
    hasFiniteRollupMetric(rollups, (rollup) => rollup[field]),
  );
}

function SleepWidget({ day }: { day: HealthDashboardDay }) {
  const stages = sleepStageEntries(day);
  const hasScore = typeof day.sleepScore === "number";
  const totalLabel =
    day.sleepMinutes == null
      ? "Unavailable"
      : formatSleepMinutes(day.sleepMinutes);
  return (
    <div
      className="health-widget health-sleep-widget"
      role="group"
      aria-label={`Sleep: ${totalLabel.toLowerCase()}`}
    >
      <p className="health-widget-label">Sleep</p>
      <p className="health-widget-value">
        {day.sleepMinutes == null ? (
          <span className="health-widget-unavailable">Unavailable</span>
        ) : (
          totalLabel
        )}
      </p>
      <div className="health-sleep-details" aria-label="Sleep source details">
        <span>
          Score{" "}
          <strong>
            {hasScore ? numberLabel(day.sleepScore) : "Unavailable"}
          </strong>
        </span>
        {stages.map((stage) => (
          <span key={stage.label}>
            {stage.label} <strong>{formatSleepMinutes(stage.minutes)}</strong>
          </span>
        ))}
      </div>
      {!hasScore || stages.length === 0 ? (
        <p className="health-widget-detail">{SLEEP_DETAIL_SOURCE_LIMITED}</p>
      ) : null}
    </div>
  );
}

function HealthWidget({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string | null;
  unit?: string;
  detail?: string | null;
}) {
  const hasValue = value !== null;
  const accessibleValue = hasValue
    ? unit
      ? `${value} ${unit}`
      : value
    : "unavailable";
  return (
    <div
      className="health-widget"
      role="group"
      aria-label={`${label}: ${accessibleValue}`}
    >
      <p className="health-widget-label">{label}</p>
      <p className="health-widget-value">
        {hasValue ? (
          <>
            {value}
            {unit ? <span className="health-widget-unit">{unit}</span> : null}
          </>
        ) : (
          <span className="health-widget-unavailable">Unavailable</span>
        )}
      </p>
      {detail ? <p className="health-widget-detail">{detail}</p> : null}
    </div>
  );
}

function CaloriesWidget({ day }: { day: HealthDashboardDay }) {
  const total = day.totalCalories ?? day.calories;
  const splitTotal =
    day.activeCalories !== null && day.restingCalories !== null
      ? day.activeCalories + day.restingCalories
      : null;
  const showSplit =
    splitTotal !== null &&
    splitTotal > 0 &&
    day.activeCalories !== null &&
    day.restingCalories !== null;
  return (
    <div
      className="health-widget health-calories-widget"
      role="group"
      aria-label="Calories source split"
    >
      <p className="health-widget-label">Calories</p>
      <div className="health-split-values">
        <span>
          Active <strong>{finiteNumberLabel(day.activeCalories)}</strong>
        </span>
        <span>
          Resting <strong>{finiteNumberLabel(day.restingCalories)}</strong>
        </span>
        <span>
          Total <strong>{finiteNumberLabel(total)}</strong>
        </span>
      </div>
      {showSplit ? (
        <div
          className="health-calorie-split"
          aria-label="Active and resting calorie split"
        >
          <span style={{ flexGrow: day.activeCalories ?? 0 }} />
          <span style={{ flexGrow: day.restingCalories ?? 0 }} />
        </div>
      ) : (
        <p className="health-widget-trend-note">
          Split unavailable from source.
        </p>
      )}
    </div>
  );
}

export function HealthDashboardView({
  days,
  selectedIndex,
  onSelectIndex,
}: {
  days: HealthDashboardDay[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const [mode, setMode] = useState<HealthDashboardMode>("daily");
  const clampedIndex = Math.min(Math.max(selectedIndex, 0), days.length - 1);
  const day = days[clampedIndex];
  const isNewest = clampedIndex <= 0;
  const isOldest = clampedIndex >= days.length - 1;
  const hrvValue =
    day.hrvMs != null ? numberLabel(day.hrvMs, 1) : (day.hrvStatus ?? null);
  const hrvDetail = day.hrvMs != null && day.hrvStatus ? day.hrvStatus : null;
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
            aria-selected={mode === item}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {mode === "daily" ? (
        <>
          <div className="health-day-browser" aria-label="Browse health days">
            <button
              type="button"
              className="chrome-button"
              onClick={() => onSelectIndex(clampedIndex + 1)}
              disabled={isOldest}
              aria-label="Previous day"
            >
              ← Previous day
            </button>
            <div className="health-day-label">
              <p className="section-kicker">Selected day</p>
              <h2>{formatCalendarDate(day.date)}</h2>
              <p className="health-day-availability">
                {healthAvailabilityLabel(day.availability)}
              </p>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={() => onSelectIndex(clampedIndex - 1)}
              disabled={isNewest}
              aria-label="Next day"
            >
              Next day →
            </button>
          </div>

          <div className="health-widget-layout">
            <div
              className="health-widget-rich-grid"
              aria-label="Rich daily health metrics"
            >
              <SleepWidget day={day} />
              <CaloriesWidget day={day} />
            </div>
            <div
              className="health-widget-compact-grid"
              aria-label="Compact daily health metrics"
            >
              <HealthWidget
                label="Resting HR"
                value={
                  day.restingHeartRate == null
                    ? null
                    : numberLabel(day.restingHeartRate)
                }
                unit="bpm"
              />
              <HealthWidget
                label="HRV"
                value={hrvValue}
                unit={day.hrvMs != null ? "ms" : undefined}
                detail={hrvDetail}
              />
              <HealthWidget
                label="Stress avg"
                value={
                  day.stressAvg == null ? null : numberLabel(day.stressAvg)
                }
                unit="avg"
              />
              <HealthWidget
                label="Steps"
                value={day.steps == null ? null : numberLabel(day.steps)}
                unit="steps"
              />
              <HealthWidget
                label="Intensity minutes"
                value={
                  day.intensityMinutes == null
                    ? null
                    : numberLabel(day.intensityMinutes)
                }
                unit="min"
                detail="Daily Garmin health source only"
              />
            </div>
          </div>
        </>
      ) : (
        <div className="health-rollup-view">
          <div className="health-rollup-summary">
            <div>
              <h2>
                {mode === "weekly"
                  ? "Weekly Health rollups"
                  : "Monthly Health rollups"}
              </h2>
              <p className="health-rollup-range">Showing {rollupRangeLabel}</p>
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
  );
}
