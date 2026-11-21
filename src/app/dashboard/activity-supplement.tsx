"use client";
import type {
  ActivitySupplement,
  ActivitySupplementGroup,
  LapZoneEvidence,
  SupplementCoverage,
} from "@/lib/local-data/supplement-contracts";
import type { SplitHeartRate } from "@/lib/local-data/split-heart-rate";
import { SNOW_ACTIVITY_SPORTS } from "@/lib/garmin/extra-types";
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
      label: "Cadence",
      value: finite(supplement.listCadence.avgSpm)
        ? `${n(supplement.listCadence.avgSpm, 1)} steps/min`
        : "Unavailable",
      available: finite(supplement.listCadence.avgSpm),
    },
    {
      label: "Stride length",
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

type ZoneBucket = LapZoneEvidence["buckets"][number];

const bucketName = (bucket: ZoneBucket) =>
  bucket.kind === "below"
    ? "Below zone 1"
    : bucket.kind === "above"
      ? "Above zone 5"
      : `Zone ${bucket.zone ?? bucket.bucket}`;

const bucketRange = (bucket: ZoneBucket) =>
  finite(bucket.lowerBpm) || finite(bucket.upperBpm)
    ? ` (${finite(bucket.lowerBpm) ? n(bucket.lowerBpm) : "…"}–${finite(bucket.upperBpm) ? n(bucket.upperBpm) : "max"} bpm)`
    : "";

/** Exact times, in bucket order; used for tooltip and screen readers. */
function zoneText(buckets: ZoneBucket[]): string {
  return buckets
    .map(
      (bucket) =>
        `${bucketName(bucket)}${bucketRange(bucket)}: ${durationDetailLabel(bucket.seconds)}`,
    )
    .join(" · ");
}

/**
 * Presentation-only proportional bar with a native, keyboard-reachable Times
 * disclosure. It knows nothing about where the buckets came from; the caller
 * supplies the label and the provenance line.
 */
function ZoneBarCell({
  buckets,
  label,
  provenance,
}: {
  buckets: ZoneBucket[];
  label: string;
  provenance: string;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
  const text = zoneText(buckets);
  return (
    <div
      className="lap-zone-cell"
      role="group"
      aria-label={`${label}: ${text}`}
    >
      <div className="lap-zone-bar" title={text} aria-hidden="true">
        {total > 0
          ? buckets.map((bucket) =>
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
          {buckets.map((bucket) => (
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
          <li className="lap-zone-method">{provenance}</li>
        </ul>
      </details>
    </div>
  );
}

/** One compact proportional bar per lap; bucket times are exact in the text. */
export function LapZoneCell({ lap }: { lap: LapZoneEvidence | undefined }) {
  if (!lap || !lap.buckets.length) return null;
  const provenance = `Recorded per lap${
    lap.calcMethod
      ? ` · ${lap.calcMethod.toLowerCase().replace(/_/g, " ")}`
      : ""
  }${finite(lap.sourceMaxHeartRate) ? ` · max HR ${n(lap.sourceMaxHeartRate)} bpm` : ""}${
    finite(lap.sourceRestingHeartRate)
      ? ` · resting HR ${n(lap.sourceRestingHeartRate)} bpm`
      : ""
  }`;
  return (
    <ZoneBarCell
      buckets={lap.buckets}
      label="Lap HR zones"
      provenance={provenance}
    />
  );
}

const HR_REASON_TEXT: Record<
  NonNullable<SplitHeartRate["unavailableReason"]>,
  string
> = {
  "invalid-window": "No measured run window",
  "no-heart-rate-samples": "No HR samples",
  "insufficient-samples": "Too few HR samples",
  "significant-gap": "HR gaps too long",
  "insufficient-support": "HR coverage too low",
};
const ZONE_REASON_TEXT: Record<
  NonNullable<SplitHeartRate["zones"]["unavailableReason"]>,
  string
> = {
  "missing-zone-boundaries": "Zone limits unavailable",
  "conflicting-zone-boundaries": "Zone limits inconsistent",
  "heart-rate-unavailable": "Unavailable",
};

/** Derived Avg HR cell; unavailable is a dash, never a zero. */
function RunAvgHeartRate({
  heartRate,
}: {
  heartRate: SplitHeartRate | undefined;
}) {
  if (!finite(heartRate?.avgHeartRate)) return <>—</>;
  return <>{n(heartRate.avgHeartRate)}</>;
}

/** Derived zone cell: bar/Times when supported, else the specific reason. */
function RunZoneCell({ heartRate }: { heartRate: SplitHeartRate | undefined }) {
  const buckets = heartRate?.zones.buckets;
  if (heartRate && buckets?.length)
    return (
      <ZoneBarCell
        buckets={buckets}
        label="Run HR zones"
        provenance="Derived from HR samples in this run · zone limits from this activity file"
      />
    );
  const reason =
    heartRate?.unavailableReason !== null && heartRate?.unavailableReason
      ? HR_REASON_TEXT[heartRate.unavailableReason]
      : heartRate?.zones.unavailableReason
        ? ZONE_REASON_TEXT[heartRate.zones.unavailableReason]
        : "Unavailable";
  return <span className="snow-hr-unavailable">{reason}</span>;
}

/** Only runs and lifts appear in the compact summary; other stored types stay trainer-accessible. */
const SUMMARY_PARTS = [
  { splitType: "SKI_RUN_SPLIT", label: "Runs" },
  { splitType: "SKI_LIFT_SPLIT", label: "Lifts" },
] as const;

const distance = (meters: number | null) =>
  finite(meters)
    ? meters >= 1000
      ? `${n(meters / 1000, 1)} km`
      : `${n(meters)} m`
    : "—";

/** Whole minutes, carrying into hours; sub-minute totals keep seconds. */
function compactDuration(seconds: number | null) {
  if (!finite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

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

/** Freshness warning for preserved runs when the latest individual-run read is not a populated one. */
function preservedRunsWarning(coverage: SupplementCoverage) {
  const cause =
    coverage.status === "unavailable" && coverage.reason === "unsupported-sport"
      ? "Individual measured runs are not supported for this sport."
      : coverage.status === "empty"
        ? "Garmin returned no individual split data."
        : coverage.status === "unavailable"
          ? "Individual measured runs are unavailable from the source."
          : coverage.status === "failed"
            ? "The latest individual-run read failed."
            : "Individual runs have not been imported (coverage unknown).";
  return `${cause} Showing preserved runs; a complete fresh set is not confirmed.`;
}

const isSnowSport = (sport: string | null | undefined) =>
  SNOW_ACTIVITY_SPORTS.some((snowSport) => snowSport === sport);

/**
 * Lap details are redundant only for a normalized snow sport whose individual
 * runs are actually stored and shown (not totals, relevance or coverage), so
 * preserved rows qualify even when the latest read failed. Everything else,
 * including snow without runs, keeps its lap table.
 */
export function hidesRedundantSnowLaps(
  supplement: ActivitySupplement | undefined,
  sport: string | null | undefined,
) {
  return isSnowSport(sport) && (supplement?.snowRuns.entries.length ?? 0) > 0;
}

/**
 * Snow activities only, and only the parts with stored rows. One source-labelled
 * line carries the stored Garmin per-type Runs and Lifts totals (never sums of
 * the displayed run rows); the run table shows individual measured runs with
 * HR derived from stored samples. Absent parts render nothing, and the
 * coverage disclosure owns "none/unknown".
 */
export function SnowSection({
  supplement,
  sport,
}: {
  supplement: ActivitySupplement;
  sport: string | null | undefined;
}) {
  const parts = SUMMARY_PARTS.flatMap(({ splitType, label }) => {
    const row = supplement.snowTotals.find(
      (total) => total.splitType === splitType,
    );
    return row ? [{ label, row }] : [];
  });
  const { snowRuns } = supplement;
  const runCoverage = supplement.coverage.snow_run_lift_splits;
  const hasRuns = snowRuns.entries.length > 0;
  if (!isSnowSport(sport) || (!parts.length && !hasRuns)) return null;
  return (
    <section className="snow-section" aria-label="Run and lift summary">
      {parts.length ? (
        <p className="snow-summary-line">
          <span className="snow-summary-source">Garmin totals</span>
          {parts.map(({ label, row }, index) => (
            <span className="snow-summary-part" key={label}>
              <strong>{label}</strong>{" "}
              {[
                finite(row.count) ? n(row.count) : "—",
                compactDuration(row.durationSec),
                distance(row.distanceMeters),
              ].join(" · ")}
              {index < parts.length - 1 ? (
                <span className="snow-summary-sep" aria-hidden="true">
                  |
                </span>
              ) : null}
            </span>
          ))}
        </p>
      ) : null}
      {hasRuns ? (
        <div className="snow-run-display">
          {runCoverage.status !== "populated" ? (
            <p className="helper-text" role="status">
              {preservedRunsWarning(runCoverage)}
            </p>
          ) : null}
          <p className="snow-hr-note">
            Avg HR and HR zones are derived from HR samples during each run;
            they may differ slightly from Garmin per-lap totals.
          </p>
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
                  <th scope="col">Descent</th>
                  <th scope="col">Avg speed</th>
                  <th scope="col">Max speed</th>
                  <th scope="col">Avg HR (bpm)</th>
                  <th scope="col" className="lap-zone-column">
                    HR zones
                  </th>
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
                    <td>
                      <RunAvgHeartRate heartRate={entry.heartRate} />
                    </td>
                    <td className="lap-zone-column">
                      <RunZoneCell heartRate={entry.heartRate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
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
