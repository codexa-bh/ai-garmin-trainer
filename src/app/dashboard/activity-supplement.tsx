"use client";
import type {
  ActivitySupplement,
  ActivitySupplementGroup,
  LapZoneEvidence,
  SupplementCoverage,
} from "@/lib/local-data/supplement-contracts";
import { durationDetailLabel } from "./activity-charts";

const GROUP_LABEL: Record<ActivitySupplementGroup, string> = {
  activity_body_battery: "Body Battery",
  running_dynamics: "Cadence and stride",
  lap_hr_zones: "Lap HR zones",
  snowboard_splits: "Run and lift totals",
  snow_run_lift_splits: "Individual runs and lifts",
};

const STATUS_WORDS: Record<SupplementCoverage["status"], string> = {
  populated: "stored",
  empty: "Garmin returned none",
  unavailable: "source unavailable",
  failed: "read failed",
  not_imported: "not imported (unknown)",
};

function statusWords(coverage: SupplementCoverage | undefined) {
  return STATUS_WORDS[coverage?.status ?? "not_imported"];
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
const n = (value: number, digits = 0) =>
  value.toLocaleString(undefined, { maximumFractionDigits: digits });

/**
 * Summary fields for the existing stat grid. Each is available only when stored;
 * the unit and the source of every value stay in the label, never merged.
 */
export function supplementSummary(supplement: ActivitySupplement | undefined) {
  if (!supplement) return [];
  const fields: Array<{ label: string; value: string; available: boolean }> = [
    {
      label: "Body Battery change",
      value: finite(supplement.bodyBatteryDelta)
        ? `${supplement.bodyBatteryDelta > 0 ? "+" : supplement.bodyBatteryDelta < 0 ? "−" : ""}${n(Math.abs(supplement.bodyBatteryDelta))} points`
        : "Unavailable",
      available: finite(supplement.bodyBatteryDelta),
    },
    {
      label: "Cadence (Garmin list)",
      value: finite(supplement.listCadence.avgSpm)
        ? `${n(supplement.listCadence.avgSpm, 1)} steps/min`
        : "Unavailable",
      available: finite(supplement.listCadence.avgSpm),
    },
    {
      label: "Max cadence (Garmin list)",
      value: finite(supplement.listCadence.maxSpm)
        ? `${n(supplement.listCadence.maxSpm, 1)} steps/min`
        : "Unavailable",
      available: finite(supplement.listCadence.maxSpm),
    },
    {
      label: "Stride length (Garmin list)",
      value: finite(supplement.listCadence.strideLengthCm)
        ? `${n(supplement.listCadence.strideLengthCm, 1)} cm`
        : "Unavailable",
      available: finite(supplement.listCadence.strideLengthCm),
    },
    {
      label: "Cadence (FIT file)",
      value: finite(supplement.fitCadence.avgCpm)
        ? `${n(supplement.fitCadence.avgCpm, 1)} cycles/min`
        : "Unavailable",
      available: finite(supplement.fitCadence.avgCpm),
    },
    {
      label: "Step length (FIT file)",
      value: finite(supplement.fitCadence.stepLengthM)
        ? `${n(supplement.fitCadence.stepLengthM, 2)} m`
        : "Unavailable",
      available: finite(supplement.fitCadence.stepLengthM),
    },
  ];
  return fields;
}

const ZONE_COLORS = [
  "#5b6578",
  "#7fb2ff",
  "#49d6c8",
  "#e3b866",
  "#ff9c5c",
  "#ff6b6b",
  "#c05cff",
];

const bucketName = (bucket: LapZoneEvidence["buckets"][number]) =>
  bucket.kind === "below"
    ? "Below zone 1"
    : bucket.kind === "above"
      ? "Above zone 5"
      : `Zone ${bucket.zone ?? bucket.bucket}`;

const bucketRange = (bucket: LapZoneEvidence["buckets"][number]) =>
  finite(bucket.lowerBpm) || finite(bucket.upperBpm)
    ? ` (${finite(bucket.lowerBpm) ? n(bucket.lowerBpm) : "…"}–${finite(bucket.upperBpm) ? n(bucket.upperBpm) : "max"} bpm)`
    : "";

/** Exact recorded times, in source bucket order; used for tooltip and screen readers. */
function lapZoneText(lap: LapZoneEvidence): string {
  return lap.buckets
    .map(
      (bucket) =>
        `${bucketName(bucket)}${bucketRange(bucket)}: ${durationDetailLabel(bucket.seconds)}`,
    )
    .join(" · ");
}

/** One compact proportional bar per lap; bucket times are exact in the text. */
export function LapZoneCell({ lap }: { lap: LapZoneEvidence | undefined }) {
  if (!lap || !lap.buckets.length) return null;
  const total = lap.buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
  const text = lapZoneText(lap);
  return (
    <div
      className="lap-zone-cell"
      role="group"
      aria-label={`Lap HR zones: ${text}`}
    >
      <div className="lap-zone-bar" title={text} aria-hidden="true">
        {total > 0
          ? lap.buckets.map((bucket) =>
              bucket.seconds > 0 ? (
                <span
                  key={bucket.bucket}
                  style={{
                    flexGrow: bucket.seconds,
                    background:
                      ZONE_COLORS[
                        Math.min(bucket.bucket, ZONE_COLORS.length - 1)
                      ],
                  }}
                />
              ) : null,
            )
          : null}
      </div>
      <details className="lap-zone-detail">
        <summary>{total > 0 ? "Times" : "All zero"}</summary>
        <ul>
          {lap.buckets.map((bucket) => (
            <li key={bucket.bucket}>
              <i
                aria-hidden="true"
                style={{
                  background:
                    ZONE_COLORS[
                      Math.min(bucket.bucket, ZONE_COLORS.length - 1)
                    ],
                }}
              />
              {bucketName(bucket)}
              {bucketRange(bucket)}: {durationDetailLabel(bucket.seconds)}
            </li>
          ))}
          <li className="lap-zone-method">
            Recorded per lap
            {lap.calcMethod
              ? ` · ${lap.calcMethod.toLowerCase().replace(/_/g, " ")}`
              : ""}
            {finite(lap.sourceMaxHeartRate)
              ? ` · max HR ${n(lap.sourceMaxHeartRate)} bpm`
              : ""}
            {finite(lap.sourceRestingHeartRate)
              ? ` · resting HR ${n(lap.sourceRestingHeartRate)} bpm`
              : ""}
          </li>
        </ul>
      </details>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  SKI_RUN_SPLIT: "Runs",
  SKI_LIFT_SPLIT: "Lifts",
  ASCENT_SPLIT: "Ascents",
  DESCENT_SPLIT: "Descents",
  TRANSITION: "Transitions",
};
const TYPE_ORDER = Object.keys(TYPE_LABEL);

const distance = (meters: number | null) =>
  finite(meters)
    ? meters >= 1000
      ? `${n(meters / 1000, 2)} km`
      : `${n(meters)} m`
    : "—";

/** Round once before decomposition, retaining tenths and carrying into minutes/hours. */
function runTimer(seconds: number | null) {
  if (!finite(seconds) || seconds < 0) return "—";
  const tenths = Math.round(seconds * 10);
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const rest = n((tenths % 600) / 10, 1);
  return hours
    ? `${hours}h ${minutes}m ${rest}s`
    : minutes
      ? `${minutes}m ${rest}s`
      : `${rest}s`;
}

function runCoverageWords(coverage: SupplementCoverage) {
  if (
    coverage.status === "unavailable" &&
    coverage.reason === "unsupported-sport"
  )
    return "Individual measured runs are not supported for this sport.";
  switch (coverage.status) {
    case "populated":
      return "No individual measured runs; stored splits may contain lifts only.";
    case "empty":
      return "Garmin returned no individual split data.";
    case "unavailable":
      return "Individual measured runs are unavailable from the source.";
    case "failed":
      return "The latest individual-run read failed.";
    default:
      return "Individual runs have not been imported (coverage unknown).";
  }
}

/** Existing per-type aggregates stay separate from the individual run-only table. */
export function SnowSection({
  supplement,
}: {
  supplement: ActivitySupplement;
}) {
  const totals = [...supplement.snowTotals].sort(
    (a, b) => TYPE_ORDER.indexOf(a.splitType) - TYPE_ORDER.indexOf(b.splitType),
  );
  const { snowRuns } = supplement;
  const runCoverage = supplement.coverage.snow_run_lift_splits;
  const totalCoverage = supplement.coverage.snowboard_splits;
  if (
    !totals.length &&
    !snowRuns.total &&
    !snowRuns.relevant &&
    runCoverage.status === "not_imported" &&
    totalCoverage.status === "not_imported"
  )
    return null;
  return (
    <section className="snow-section" aria-label="Run and lift summary">
      <div className="activity-effort-widget-heading">
        <h3>Runs and lifts</h3>
        <span>Garmin per-type totals</span>
      </div>
      {totals.length ? (
        <div className="snow-totals-wrap">
          <table className="snow-totals">
            <caption>Totals over the whole activity</caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Count</th>
                <th scope="col">Total time</th>
                <th scope="col">Total distance</th>
                <th scope="col">Longest single split</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.splitType}>
                  <th scope="row">
                    {TYPE_LABEL[row.splitType] ?? row.splitType}
                  </th>
                  <td>{finite(row.count) ? n(row.count) : "—"}</td>
                  <td>
                    {finite(row.durationSec)
                      ? durationDetailLabel(row.durationSec)
                      : "—"}
                  </td>
                  <td>{distance(row.distanceMeters)}</td>
                  <td>{distance(row.bestSplitDistanceMeters)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="helper-text">
          Per-type totals: {statusWords(totalCoverage)}.
        </p>
      )}
      <div className="snow-run-display">
        {snowRuns.total > 0 && runCoverage.status !== "populated" ? (
          <p className="helper-text" role="status">
            {runCoverageWords(runCoverage)} Showing preserved runs; a complete
            fresh set is not confirmed.
          </p>
        ) : null}
        {snowRuns.total > 0 ? (
          <div
            className="snow-totals-wrap snow-runs-wrap"
            role="region"
            aria-label="Snow runs table"
            tabIndex={0}
          >
            <table className="snow-totals snow-runs">
              <caption>
                Snow runs
                {snowRuns.truncated
                  ? ` — showing the first ${snowRuns.returned} of ${snowRuns.total}`
                  : ""}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Timer duration</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Ascent</th>
                  <th scope="col">Descent</th>
                  <th scope="col">Avg speed</th>
                  <th scope="col">Max speed</th>
                </tr>
              </thead>
              <tbody>
                {snowRuns.entries.map((entry, index) => (
                  <tr key={entry.splitKey}>
                    <th scope="row">{index + 1}</th>
                    <td>{runTimer(entry.timerSeconds)}</td>
                    <td>
                      {finite(entry.distanceMeters)
                        ? `${n(entry.distanceMeters / 1000, 3)} km`
                        : "—"}
                    </td>
                    <td>
                      {finite(entry.ascentMeters)
                        ? `${n(entry.ascentMeters, 1)} m`
                        : "—"}
                    </td>
                    <td>
                      {finite(entry.descentMeters)
                        ? `${n(entry.descentMeters, 1)} m`
                        : "—"}
                    </td>
                    <td>
                      {finite(entry.avgSpeedMps)
                        ? `${n(entry.avgSpeedMps * 3.6, 1)} km/h`
                        : "—"}
                    </td>
                    <td>
                      {finite(entry.maxSpeedMps)
                        ? `${n(entry.maxSpeedMps * 3.6, 1)} km/h`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            <h3>Snow runs</h3>
            <p className="helper-text">{runCoverageWords(runCoverage)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Per-group coverage for the selected activity. Absent rows read as unknown, not empty. */
export function ActivitySupplementCoverage({
  supplement,
}: {
  supplement: ActivitySupplement;
}) {
  return (
    <details className="health-supplement-disclosure activity-supplement-coverage">
      <summary>Additional Garmin evidence coverage</summary>
      <ul>
        {(Object.keys(GROUP_LABEL) as ActivitySupplementGroup[]).map(
          (group) => (
            <li
              key={group}
              data-supplement-status={supplement.coverage[group].status}
            >
              {GROUP_LABEL[group]}: {statusWords(supplement.coverage[group])}
            </li>
          ),
        )}
      </ul>
    </details>
  );
}
