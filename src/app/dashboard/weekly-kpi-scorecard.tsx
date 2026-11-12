import { Fragment } from "react";
import type { KpiRead, KpiTrack } from "@/lib/weekly/kpi-contracts";
import { latestKpiScore } from "@/lib/weekly/kpis";

export function kpiNumber(value: number): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        value,
      )
    : "Unknown";
}
export function kpiValue(
  value: number | boolean | null | undefined,
  unit: string,
): string {
  if (value === null || value === undefined) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (!Number.isFinite(value)) return "Unknown";
  if (["min", "minutes", "s", "sec", "seconds"].includes(unit) && value >= 0) {
    const inMinutes = ["min", "minutes"].includes(unit);
    const centiseconds = Math.round(value * (inMinutes ? 6000 : 100));
    if (Number.isSafeInteger(centiseconds)) {
      const hours = Math.floor(centiseconds / 360000);
      const minutes = Math.floor((centiseconds % 360000) / 6000);
      const seconds = (centiseconds % 6000) / 100;
      return (
        [
          hours ? `${hours} h` : "",
          minutes ? `${minutes} min` : "",
          seconds ? `${kpiNumber(seconds)} s` : "",
        ]
          .filter(Boolean)
          .join(" ") || (inMinutes ? "0 min" : "0 s")
      );
    }
  }
  return `${kpiNumber(value)} ${unit}`;
}
export function kpiTrackLabel(track: KpiTrack, tracks: KpiTrack[]): string {
  return tracks.filter((value) => value.unit === track.unit).length > 1
    ? track.key.replaceAll("-", " ").replaceAll("_", " ")
    : track.unit;
}
export function kpiTarget(track: KpiTrack): string {
  if (!track.target) return "—";
  const { comparator, value, upper } = track.target;
  const prefix = { "at-least": "≥ ", "at-most": "≤ ", equal: "", range: "" }[
    comparator
  ];
  return `${prefix}${kpiValue(value, track.unit)}${upper === undefined ? "" : ` – ${kpiValue(upper, track.unit)}`}`;
}
export function kpiCutoff(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "Cutoff unavailable";
}

function kpiPoints(
  awarded: number | null | undefined,
  available: number,
): string {
  return `${awarded == null ? "—" : kpiNumber(awarded)} / ${kpiNumber(available)}`;
}

export function WeeklyKpiScorecard({
  kpis,
  loadSet,
}: {
  kpis: KpiRead | null;
  loadSet: (id: string) => void;
}) {
  const score = latestKpiScore(kpis);
  const { set, assessment } = score;
  const conditionOnly =
    set?.items.filter(
      (item) => !item.tracks.some((track) => track.kind === "numeric"),
    ) ?? [];
  return (
    <section className="weekly-kpis" aria-label="Saved weekly KPIs">
      <h2>Weekly KPIs</h2>
      {kpis?.complete === false ? (
        <p role="status">
          Latest-plan KPIs need a complete read.{" "}
          {kpis.latestPlanSetId ? (
            <button
              className="chrome-button"
              onClick={() => loadSet(kpis.latestPlanSetId!)}
            >
              Load latest KPIs
            </button>
          ) : null}
        </p>
      ) : !set ? (
        <p>No KPIs saved for this plan.</p>
      ) : (
        <>
          <p className="training-plan-meta">
            {assessment
              ? `As of ${kpiCutoff(assessment.asOf)}`
              : "Not assessed — not a zero."}
            {score.provisional ? " · Provisional" : ""}
          </p>
          {conditionOnly.length ? (
            <p>
              {conditionOnly
                .filter((item) => item.availablePoints !== null)
                .map((item) => (
                  <span key={item.id}>
                    {item.label}:{" "}
                    {kpiPoints(
                      assessment?.items.find(
                        (result) => result.itemId === item.id,
                      )?.awardedPoints,
                      item.availablePoints!,
                    )}{" "}
                    conditional points.{" "}
                  </span>
                ))}
            </p>
          ) : null}
          <div className="weekly-kpi-table-scroll">
            <table className="weekly-kpi-table">
              <thead>
                <tr>
                  <th scope="col">KPI</th>
                  <th scope="col">Target</th>
                  <th scope="col">Actual</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                {[false, true].map((monitoring) => (
                  <Fragment key={monitoring ? "monitoring" : "scored"}>
                    {set.items
                      .filter(
                        (item) =>
                          (item.availablePoints === null) === monitoring,
                      )
                      .flatMap((item) => {
                        const result = assessment?.items.find(
                          (value) => value.itemId === item.id,
                        );
                        const tracks = item.tracks.filter(
                          (track) => track.kind === "numeric",
                        );
                        return tracks.map((track, index) => (
                          <tr key={`${item.id}/${track.key}`}>
                            <th scope="row">
                              {tracks.length > 1
                                ? `${item.label} · ${kpiTrackLabel(track, tracks)}`
                                : item.label}
                              {item.availablePoints === null ? (
                                <small>Monitoring</small>
                              ) : null}
                            </th>
                            <td>{kpiTarget(track)}</td>
                            <td>
                              <div>
                                {kpiValue(
                                  result?.actuals.find(
                                    (value) => value.trackKey === track.key,
                                  )?.value,
                                  track.unit,
                                )}
                              </div>
                              {index === 0 && result ? (
                                <details className="weekly-kpi-qualification">
                                  <summary>
                                    {result.status === "supported"
                                      ? "Evidence"
                                      : result.status === "provisional"
                                        ? "Provisional"
                                        : "Unavailable"}
                                  </summary>
                                  <p>
                                    {result.evidence.origin}
                                    {result.evidence.references.length
                                      ? ` · ${result.evidence.references.join(", ")}`
                                      : ""}
                                  </p>
                                  {result.evidence.qualification ? (
                                    <p>{result.evidence.qualification}</p>
                                  ) : null}
                                  {result.evidence.limitations ? (
                                    <p>{result.evidence.limitations}</p>
                                  ) : null}
                                  {result.explanation ? (
                                    <p>{result.explanation}</p>
                                  ) : null}
                                </details>
                              ) : null}
                            </td>
                            {item.availablePoints === null || index === 0 ? (
                              <td
                                rowSpan={
                                  item.availablePoints === null
                                    ? 1
                                    : tracks.length
                                }
                              >
                                {item.availablePoints === null
                                  ? "—"
                                  : kpiPoints(
                                      result?.awardedPoints,
                                      item.availablePoints,
                                    )}
                                {item.availablePoints !== null &&
                                tracks.length > 1 ? (
                                  <small>Shared</small>
                                ) : null}
                              </td>
                            ) : null}
                          </tr>
                        ));
                      })}
                    {!monitoring &&
                      assessment?.extras.map((extra, index) => (
                        <tr key={`extra-${index}`}>
                          <th scope="row">{extra.label}</th>
                          <td colSpan={2}>{extra.explanation}</td>
                          <td>+{kpiNumber(extra.points)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td colSpan={3}>
                    {score.total === null
                      ? score.reason
                      : `${kpiNumber(score.total)} / ${kpiNumber(score.available!)} points · ${kpiNumber(score.percentage!)}%`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
