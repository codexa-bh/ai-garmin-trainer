import type {
  TerrainAnalysis,
  TerrainSection,
} from "@/lib/analytics/terrain-sections";
import { finiteNumberLabel } from "./formatting";

function humanDuration(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "Unavailable";
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return (
    [
      hours ? `${hours}h` : null,
      minutes ? `${minutes}m` : null,
      remainder ? `${remainder}s` : null,
    ]
      .filter(Boolean)
      .join(" ") || "0s"
  );
}

function coveragePercent(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "unavailable";
  if (value >= 1 - 1e-9) return "100%";
  if (value > 0.99) return ">99%";
  return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function dataNotes(row: TerrainSection): string[] {
  const notes: string[] = [];
  if (!Number.isFinite(row.timeCoverage) || row.timeCoverage < 1 - 1e-9)
    notes.push(
      row.timeSupportSec > 0 ? "Timing incomplete" : "Timing unavailable",
    );
  if (row.averageHeartRate === null || !Number.isFinite(row.averageHeartRate))
    notes.push("Avg HR unavailable");
  else if (row.hrSupportSec < row.timeSupportSec - 1e-9)
    notes.push("HR coverage incomplete");
  return notes;
}

function qualityMessage(code: string): string {
  const messages: Record<string, string> = {
    excluded_gaps_invalid_or_short_support:
      "Some gaps, invalid samples or short stretches were excluded.",
    mixed_timestamp_clocks: "Mixed timestamp clocks prevent reliable timing.",
    incomplete_time: "Some section timing is unavailable.",
    section_rows_truncated:
      "Only part of the section list is shown; totals cover all supported sections.",
    invalid_activity_id: "The activity reference is invalid.",
    unknown_activity: "The activity was not found in imported data.",
    unsupported_sport:
      "Terrain sections are supported for hikes and walks only.",
    point_limit_exceeded: "This activity exceeds the analysis sample limit.",
    missing_stream: "No usable activity stream is available.",
    insufficient_supported_elevation_distance:
      "There is not enough continuous elevation and distance support for sections.",
  };
  return messages[code] ?? code.replaceAll("_", " ");
}

export function TerrainTable({
  analysis,
  selectedId,
  onSelect,
}: {
  analysis: TerrainAnalysis | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!analysis) return null;
  const notes = analysis.sections.map(dataNotes);
  const showNotes = notes.some((items) => items.length > 0);
  const quality = [analysis.reason, ...analysis.quality]
    .filter((code): code is string => Boolean(code))
    .map(qualityMessage);
  return (
    <section aria-label="Terrain sections">
      <h3>Terrain sections</h3>
      <p className="activity-dashboard-status">
        Approximate elevation profile, not surface or technical difficulty.{" "}
        {analysis.status === "partial"
          ? "Partial coverage."
          : analysis.status === "unavailable"
            ? "Analysis unavailable."
            : "Supported profile."}{" "}
        {quality.join(" ")}
      </p>
      <details>
        <summary>Method and quality</summary>
        <p>
          {analysis.method}: 25m recorded-distance anchors, isolated spike
          rejection and 3-anchor triangular altitude smoothing. Boundaries
          follow sustained grade/rolling trend changes, not fixed distance
          tiles. Sliding 100m grade and 300m rolling windows supply evidence;
          changed trends must persist at least 300m, then boundaries refine to
          nearby peaks, valleys or plateau edges. Every section is at least
          300m. Short fluctuations and tails are absorbed; disconnected runs
          below 300m are excluded, never bridged. Climb/descent enter at ±3%,
          stay at ±2%, with 6m vertical support for a change. Rolling needs at
          least 10m up/down relief and range, not small flat noise. Signed grade
          = net filtered elevation / recorded along-route distance; not ascent
          density or surveyed horizontal gradient. Steep bands count filtered
          25m edges at ≥10% uphill or downhill, not point maxima. Smoothing
          hides shorter features.
        </p>
        <p>
          Supported {finiteNumberLabel(analysis.supportedDistanceMeters, 0)}m of
          recorded positive distance changes{" "}
          {finiteNumberLabel(analysis.recordedPositiveDistanceMeters, 0)}m;{" "}
          {analysis.usableEdges}/{analysis.totalEdges} adjacent edges. Gaps,
          resets and unsupported short runs are excluded, never flat or pauses.
          Filtered ascent/descent totals{" "}
          {finiteNumberLabel(analysis.ascentMeters, 0)}m /{" "}
          {finiteNumberLabel(analysis.descentMeters, 0)}m precede row caps.
          Showing {analysis.returnedSections}/{analysis.sectionCount} sections
          {analysis.truncated ? " (truncated)" : ""}.
        </p>
        <p>
          Moving/stationary time is estimated from contiguous ≤0.3m/s for ≥30s,
          never measured pauses or their cause. Pace uses elapsed time. Avg HR
          is the section&apos;s average heart rate, weighted by time over
          intervals with usable HR at both endpoints, not the whole-activity
          average. Unavailable is not zero. Time coverage is the fraction of
          distance-split source edges with valid time, not a measured seconds
          denominator. Selection highlights elevation where chart coordinates
          align; no map linkage because route sampling/timing can differ.
        </p>
        {analysis.sections.length ? (
          <div>
            <h4>Per-section data coverage</h4>
            <ul aria-label="Per-section data coverage">
              {analysis.sections.map((row, i) => (
                <li key={row.id}>
                  Section {i + 1}: timing coverage{" "}
                  {coveragePercent(row.timeCoverage)};{" "}
                  {row.averageHeartRate !== null &&
                  Number.isFinite(row.averageHeartRate) &&
                  row.timeSupportSec > 0
                    ? `Avg HR covers ${humanDuration(row.hrSupportSec)} of ${humanDuration(row.timeSupportSec)} timed support (${coveragePercent(row.hrSupportSec / row.timeSupportSec)}).`
                    : "Avg HR unavailable."}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
      {analysis.sections.length ? (
        <div className="lap-table-wrap">
          <table className="lap-table terrain-table">
            <caption>Estimated elevation-profile sections</caption>
            <thead>
              <tr>
                {[
                  "Select",
                  "Kind",
                  "Distance interval (m)",
                  "Distance (m)",
                  "Ascent / descent (m)",
                  "Signed grade (%)",
                  "≥10% up / down (m)",
                  "Elapsed",
                  "Est. moving / stationary",
                  "Elapsed pace",
                  "Avg HR (bpm)",
                  ...(showNotes ? ["Data notes"] : []),
                ].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.sections.map((row, i) => (
                <tr key={row.id} data-selected={selectedId === row.id}>
                  <td>
                    <button
                      type="button"
                      aria-pressed={selectedId === row.id}
                      onClick={() => onSelect(row.id)}
                    >
                      Section {i + 1}
                    </button>
                  </td>
                  <td>{row.kind}</td>
                  <td>
                    {finiteNumberLabel(row.startDistanceMeters, 0)}–
                    {finiteNumberLabel(row.endDistanceMeters, 0)}
                  </td>
                  <td>{finiteNumberLabel(row.distanceMeters, 0)}</td>
                  <td>
                    {finiteNumberLabel(row.ascentMeters, 1)} /{" "}
                    {finiteNumberLabel(row.descentMeters, 1)}
                  </td>
                  <td>≈{finiteNumberLabel(row.meanGradePct, 1)}</td>
                  <td>
                    {finiteNumberLabel(row.steepUpMeters, 0)} /{" "}
                    {finiteNumberLabel(row.steepDownMeters, 0)}
                  </td>
                  <td>{humanDuration(row.elapsedSec)}</td>
                  <td>
                    {humanDuration(row.estimatedMovingSec)} /{" "}
                    {humanDuration(row.estimatedStationarySec)}
                  </td>
                  <td>
                    {row.elapsedPaceSecPerKm !== null &&
                    Number.isFinite(row.elapsedPaceSecPerKm) &&
                    row.elapsedPaceSecPerKm >= 0
                      ? `${humanDuration(row.elapsedPaceSecPerKm)}/km`
                      : "Unavailable"}
                  </td>
                  <td>{finiteNumberLabel(row.averageHeartRate, 0)}</td>
                  {showNotes ? <td>{notes[i].join("; ") || "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          No supported terrain sections. Missing evidence is not a flat route.
        </p>
      )}
    </section>
  );
}
