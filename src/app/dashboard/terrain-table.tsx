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

function qualityMessage(code: string): string | undefined {
  const messages: Record<string, string> = {
    mixed_timestamp_clocks: "Mixed timestamp clocks prevent reliable timing.",
    incomplete_time: "Some section timing is unavailable.",
    invalid_activity_id: "The activity reference is invalid.",
    unknown_activity: "The activity was not found in imported data.",
    unsupported_sport:
      "Terrain sections are supported for hikes and walks only.",
    point_limit_exceeded: "This activity exceeds the analysis sample limit.",
    missing_stream: "No usable activity stream is available.",
    insufficient_supported_elevation_distance:
      "There is not enough continuous elevation and distance support for sections.",
  };
  return messages[code];
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
  if (!analysis || analysis.sections.length === 0) return null;
  const notes = analysis.sections.map(dataNotes);
  const showNotes = notes.some((items) => items.length > 0);
  const codes = new Set([analysis.reason, ...analysis.quality]);
  const timing = codes.has("mixed_timestamp_clocks")
    ? qualityMessage("mixed_timestamp_clocks")
    : codes.has("incomplete_time")
      ? qualityMessage("incomplete_time")
      : undefined;
  const reason = analysis.reason ? qualityMessage(analysis.reason) : undefined;
  const quality = [...new Set([timing, reason])].filter(Boolean);
  const truncated =
    analysis.truncated ||
    analysis.returnedSections < analysis.sectionCount ||
    codes.has("section_rows_truncated");
  return (
    <section aria-label="Terrain sections">
      <h3>Terrain sections</h3>
      <p className="activity-dashboard-status">
        Approximate elevation, not surface or technical difficulty: smoothing
        hides short features and gaps are excluded. Movement times are
        estimates; pace uses elapsed time and HR is averaged per section.
        Missing data isn’t zero; selection highlights only aligned elevation.
        {analysis.status === "partial" ? " Partial coverage." : ""}
        {analysis.status === "unavailable" ? " Analysis unavailable." : ""}
        {quality.length ? ` ${quality.join(" ")}` : ""}
        {truncated
          ? ` Showing ${analysis.returnedSections} of ${analysis.sectionCount} sections; not all sections are shown.`
          : ""}
      </p>
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
    </section>
  );
}
