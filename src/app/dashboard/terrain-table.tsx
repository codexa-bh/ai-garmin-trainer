import type { TerrainAnalysis } from "@/lib/analytics/terrain-sections";
import { finiteNumberLabel } from "./formatting";

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
  return (
    <section aria-label="Terrain sections">
      <h3>Terrain sections</h3>
      <p className="activity-dashboard-status">
        Approximate elevation profile, not surface or technical difficulty.{" "}
        {analysis.status}:{" "}
        {analysis.reason ??
          (analysis.quality.join("; ") || "supported profile")}
        .
      </p>
      <details>
        <summary>Method and quality</summary>
        <p>
          {analysis.method}: 25m recorded-distance anchors, isolated spike
          rejection, 3-anchor triangular altitude smoothing, 100m classification
          tiles (short residuals disclosed). Climb/descent enter at ±3%, stay at
          ±2%. Signed grade = net filtered elevation / recorded along-route
          distance; not ascent density or surveyed horizontal gradient. Steep
          bands count filtered 25m edges at ≥10% uphill or downhill, not point
          maxima. Smoothing hides shorter features.
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
          never measured pauses or their cause. Pace uses elapsed time; HR is
          pairwise time-weighted only over available intervals. Unavailable is
          not zero. Time coverage is the fraction of distance-split source edges
          with valid time, not a measured seconds denominator. Selection
          highlights elevation where chart coordinates align; no map linkage
          because route sampling/timing can differ.
        </p>
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
                  "Elapsed (s)",
                  "Est. moving / stationary (s)",
                  "Elapsed pace (s/km)",
                  "HR (bpm)",
                  "Support / quality",
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
                  <td>{finiteNumberLabel(row.elapsedSec, 0)}</td>
                  <td>
                    {finiteNumberLabel(row.estimatedMovingSec, 0)} /{" "}
                    {finiteNumberLabel(row.estimatedStationarySec, 0)}
                  </td>
                  <td>{finiteNumberLabel(row.elapsedPaceSecPerKm, 0)}</td>
                  <td>{finiteNumberLabel(row.averageHeartRate, 0)}</td>
                  <td>
                    Time {finiteNumberLabel(row.timeCoverage * 100, 0)}%; HR{" "}
                    {finiteNumberLabel(row.hrSupportSec, 0)}s /{" "}
                    {finiteNumberLabel(row.timeSupportSec, 0)}s; {row.quality}
                  </td>
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
