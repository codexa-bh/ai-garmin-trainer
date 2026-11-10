import type { KpiRead, KpiTrack } from "@/lib/weekly/kpi-contracts";

export function kpiTarget(track: KpiTrack): string {
  if (!track.target) return "No target · context only";
  const value =
    typeof track.target.value === "boolean"
      ? track.target.value
        ? "Yes"
        : "No"
      : track.target.value;
  const comparator = {
    "at-least": "At least",
    "at-most": "At most",
    equal: "Exactly",
    range: "Range",
  }[track.target.comparator];
  return `${comparator} ${value}${track.target.upper === undefined ? "" : `–${track.target.upper}`} ${track.unit}`;
}
export function kpiValue(
  value: number | boolean | null | undefined,
  unit: string,
): string {
  return value === null || value === undefined
    ? "Unknown"
    : `${typeof value === "boolean" ? (value ? "Yes" : "No") : value} ${unit}`;
}
function kpiBaseline(kpis: KpiRead, id: string): string {
  const origin =
    kpis.availableSets.find((set) => set.id === id)?.origin ??
    kpis.sets.find((set) => set.id === id)?.origin;
  return origin === "review-defined"
    ? "Review-defined · provisional basis, not prior agreement"
    : id === kpis.originalId
      ? "Original commitment"
      : "Adapted commitment";
}
export function WeeklyKpiScorecard({
  kpis,
  loadSet,
  discuss,
}: {
  kpis: KpiRead | null;
  loadSet: (id: string) => void;
  discuss: () => void;
}) {
  return (
    <section className="weekly-kpis" aria-label="Saved weekly KPIs">
      <h2>Weekly KPIs</h2>
      <p>
        Saved commitments and assessments, not live evaluation. Manage or
        correct them in chat.
      </p>
      {!kpis?.sets.length && kpis?.complete !== false ? (
        <p>
          No structured KPIs saved. Discuss relevant commitments with your
          trainer; nothing is assigned automatically.
        </p>
      ) : null}
      {kpis?.complete === false ? (
        <p role="status">
          This comparison is too large. Select an individual saved baseline
          below; incomplete previews cannot authorize changes.
        </p>
      ) : null}
      {kpis?.availableSets.length ? (
        <label>
          Saved baseline{" "}
          <select
            value={kpis.sets.length === 1 ? kpis.sets[0].id : ""}
            onChange={(event) => {
              if (event.target.value) loadSet(event.target.value);
            }}
          >
            <option value="" disabled>
              Original / latest / review-defined
            </option>
            {kpis.availableSets.map((set) => (
              <option key={set.id} value={set.id}>
                {kpiBaseline(kpis, set.id)} · {set.savedAt}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {kpis?.sets.map((set) => {
        const assessment = kpis.assessments.find((a) => a.setId === set.id);
        return (
          <article key={set.id} className="weekly-kpi-baseline">
            <h3>
              {kpiBaseline(kpis, set.id)}
              {set.id === kpis.latestId && set.id !== kpis.originalId
                ? " · latest"
                : ""}
            </h3>
            {assessment ? (
              <p>
                Assessment: {assessment.status} · as of {assessment.asOf}.{" "}
                {assessment.totalPoints === null
                  ? "No overall score recorded."
                  : `Recorded total: ${assessment.totalPoints} points.`}
              </p>
            ) : (
              <p>Not assessed. This is not a zero or a missed commitment.</p>
            )}
            <ul className="weekly-kpi-items">
              {set.items.map((item) => {
                const result = assessment?.items.find(
                  (r) => r.itemId === item.id,
                );
                return (
                  <li key={item.id}>
                    <h4>{item.label}</h4>
                    <p>
                      {item.availablePoints === null
                        ? "Monitoring / context · no point allocation"
                        : `${item.availablePoints} available points (one allocation for this item)`}
                      {result?.awardedPoints === null ||
                      result?.awardedPoints === undefined
                        ? " · No awarded points recorded"
                        : ` · ${result.awardedPoints} awarded`}
                    </p>
                    <dl className="weekly-kpi-tracks">
                      {item.tracks.map((track) => (
                        <div key={track.key}>
                          <dt>{track.meaning}</dt>
                          <dd>
                            Target: {kpiTarget(track)}
                            <br />
                            Recorded actual:{" "}
                            {kpiValue(
                              result?.actuals.find(
                                (a) => a.trackKey === track.key,
                              )?.value,
                              track.unit,
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <details>
                      <summary>
                        Definition, scoring and evidence
                        {result ? ` · ${result.status}` : " · unassessed"}
                      </summary>
                      <p>{item.definition}</p>
                      <p>Selection / exclusions: {item.selection}</p>
                      <p>Evidence required: {item.evidenceRequired}</p>
                      <p>
                        Scoring: {item.scoring || "No scoring rubric recorded"}
                      </p>
                      {result ? (
                        <>
                          <p>{result.explanation}</p>
                          <p>
                            Evidence origin: {result.evidence.origin} ·{" "}
                            {result.evidence.qualification}
                          </p>
                          <p>
                            References:{" "}
                            {result.evidence.references.join("; ") ||
                              "None recorded"}
                          </p>
                          <p>
                            Limitations:{" "}
                            {result.evidence.limitations ||
                              "None recorded; not fresh verification"}
                          </p>
                        </>
                      ) : null}
                    </details>
                  </li>
                );
              })}
            </ul>
            {assessment?.extras.length ? (
              <section aria-label="Explained additional credit">
                <h4>Explained additional credit</h4>
                {assessment.extras.map((extra, index) => (
                  <p key={index}>
                    {extra.label}: {extra.points} points · {extra.explanation} ·{" "}
                    {extra.evidence.origin}: {extra.evidence.qualification}.
                    Limits: {extra.evidence.limitations || "None recorded"}
                  </p>
                ))}
              </section>
            ) : null}
            <details>
              <summary>Source and revision</summary>
              <p>
                Saved {set.savedAt} · basis {set.id} · {kpis.timeZone}
              </p>
              <p>{set.provenance}</p>
              {assessment ? (
                <p>
                  Assessment saved {assessment.savedAt}.{" "}
                  {assessment.explanation}
                </p>
              ) : null}
              <p>
                Assessment revision: {assessment?.revision ?? "Not assessed"}.
                Saved values do not establish fresh Garmin verification.
              </p>
            </details>
          </article>
        );
      })}
      <button type="button" className="chrome-button" onClick={discuss}>
        Discuss / assess KPIs in chat
      </button>
    </section>
  );
}
