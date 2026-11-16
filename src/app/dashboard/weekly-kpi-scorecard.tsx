import { Fragment } from "react";
import type {
  KpiRead,
  KpiTrack,
  KpiPointsProjection,
} from "@/lib/weekly/kpi-contracts";
import {
  kpiActual,
  kpiAwarded,
  kpiScoredUnits,
  latestKpiScore,
} from "@/lib/weekly/kpis";

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
          // Never skip a middle unit: "3 h 46 s" would read as 3 h 46 min.
          minutes || (hours && seconds) ? `${minutes} min` : "",
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
/** Compact provenance of one shared actual; never implies points changed. */
export function kpiActualStatus(
  point: NonNullable<ReturnType<typeof kpiActual>>,
): string {
  return point.source === "failed"
    ? "Measurement failed"
    : `${point.source === "measured" ? "Measured" : "Assessed"}${point.incomplete ? ", incomplete" : ""}${point.stale ? ", stale" : ""}`;
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

type KpiItem = NonNullable<
  ReturnType<typeof latestKpiScore>["set"]
>["items"][number];
type KpiRow =
  | {
      kind: "track";
      item: KpiItem;
      track: KpiTrack;
      tracks: KpiTrack[];
      available: number | null;
      evidence: boolean;
    }
  | { kind: "legacy"; item: KpiItem; available: number };

/** Scored rows (including unmapped legacy pools) precede monitoring rows,
 * each group in stored order; an item's evidence shows on its first row. */
function kpiRows(items: KpiItem[]): KpiRow[] {
  const rows = items.flatMap((item): KpiRow[] => {
    const units = kpiScoredUnits(item);
    const tracks = item.tracks.filter((track) => track.kind === "numeric");
    const legacy = units.find((unit) => unit.trackKey === null);
    const trackRows: KpiRow[] = tracks.map((track) => ({
      kind: "track",
      item,
      track,
      tracks,
      available:
        units.find((unit) => unit.trackKey === track.key)?.available ?? null,
      evidence: false,
    }));
    return legacy && tracks.length
      ? [...trackRows, { kind: "legacy", item, available: legacy.available }]
      : trackRows;
  });
  const scored = (row: KpiRow) =>
    row.kind === "legacy" ||
    row.available !== null ||
    kpiScoredUnits(row.item).some((unit) => unit.trackKey === null);
  const ordered = [
    ...rows.filter(scored),
    ...rows.filter((row) => !scored(row)),
  ];
  const shown = new Set<string>();
  return ordered.map((row) => {
    if (row.kind !== "track" || shown.has(row.item.id)) return row;
    shown.add(row.item.id);
    return { ...row, evidence: true };
  });
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
  const rows = set ? kpiRows(set.items) : [];
  const monitoringStart = rows.findIndex(
    (row) =>
      row.kind === "track" &&
      row.available === null &&
      !kpiScoredUnits(row.item).some((unit) => unit.trackKey === null),
  );
  const result = (item: KpiItem) =>
    assessment?.items.find((value) => value.itemId === item.id);
  const measuredAt =
    set?.items
      .flatMap((item) =>
        item.tracks.map((track) => kpiActual(kpis, item.conceptId, track)),
      )
      .filter((point) => point?.source === "measured")
      .map((point) => point!.asOf!)
      .sort()
      .at(-1) ?? null;
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
            {measuredAt ? `Actuals measured ${kpiCutoff(measuredAt)} · ` : ""}
            {score.automatic
              ? "Auto points"
              : assessment
                ? `${measuredAt ? "Points as of" : "As of"} ${kpiCutoff(assessment.asOf)}`
                : measuredAt
                  ? "Points not assessed"
                  : "Not assessed — not a zero."}
            {score.provisional ? " · Provisional" : ""}
          </p>
          {conditionOnly.length ? (
            <p>
              {conditionOnly.flatMap((item) =>
                kpiScoredUnits(item).map((unit) => (
                  <span key={item.id}>
                    {item.label}:{" "}
                    {kpiPoints(
                      kpiAwarded(item, result(item), unit.trackKey),
                      unit.available,
                    )}{" "}
                    conditional points.{" "}
                  </span>
                )),
              )}
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
                {rows.map((row, index) => (
                  <Fragment
                    key={
                      row.kind === "track"
                        ? `${row.item.id}/${row.track.key}`
                        : `${row.item.id}/legacy`
                    }
                  >
                    {monitoringStart === index ? (
                      <ExtraRows assessment={assessment} />
                    ) : null}
                    {row.kind === "legacy" ? (
                      <tr>
                        <th scope="row">{row.item.label} · combined points</th>
                        <td colSpan={2}>Saved before per-measurement points</td>
                        <td className="weekly-kpi-points">
                          {kpiPoints(
                            kpiAwarded(row.item, result(row.item), null),
                            row.available,
                          )}
                        </td>
                      </tr>
                    ) : (
                      <TrackRow
                        row={row}
                        result={result(row.item)}
                        actual={kpiActual(kpis, row.item.conceptId, row.track)}
                        points={score.tracks.find(
                          (point) =>
                            point.itemId === row.item.id &&
                            point.trackKey === row.track.key,
                        )}
                      />
                    )}
                  </Fragment>
                ))}
                {monitoringStart < 0 ? (
                  <ExtraRows assessment={assessment} />
                ) : null}
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

function ExtraRows({
  assessment,
}: {
  assessment: ReturnType<typeof latestKpiScore>["assessment"];
}) {
  return (
    <>
      {assessment?.extras.map((extra, index) => (
        <tr key={`extra-${index}`}>
          <th scope="row">{extra.label}</th>
          <td colSpan={2}>{extra.explanation}</td>
          <td className="weekly-kpi-points">+{kpiNumber(extra.points)}</td>
        </tr>
      ))}
    </>
  );
}

function TrackRow({
  row,
  result,
  actual,
  points,
}: {
  points: KpiPointsProjection["tracks"][number] | undefined;
  row: Extract<KpiRow, { kind: "track" }>;
  actual: ReturnType<typeof kpiActual>;
  result:
    | NonNullable<
        ReturnType<typeof latestKpiScore>["assessment"]
      >["items"][number]
    | undefined;
}) {
  const { item, track, tracks, available } = row;
  const legacyPool = kpiScoredUnits(item).some(
    (unit) => unit.trackKey === null,
  );
  const monitoring = available === null && !legacyPool;
  return (
    <tr>
      <th scope="row">
        {tracks.length > 1
          ? `${item.label} · ${kpiTrackLabel(track, tracks)}`
          : item.label}
        {monitoring ? <small>Monitoring</small> : null}
      </th>
      <td>{kpiTarget(track)}</td>
      <td>
        <div>
          {kpiValue(
            actual?.source === "measured"
              ? actual.value
              : result?.actuals.find((value) => value.trackKey === track.key)
                  ?.value,
            track.unit,
          )}
          {actual?.source === "measured" &&
          (actual.incomplete || actual.stale) ? (
            <small>{actual.stale ? "Stale" : "Incomplete"}</small>
          ) : null}
        </div>
        {row.evidence && result ? (
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
            {result.explanation ? <p>{result.explanation}</p> : null}
          </details>
        ) : null}
      </td>
      <td
        className="weekly-kpi-points"
        aria-label={
          points
            ? `${points.source} points${points.reason ? `; ${points.reason}` : ""}${points.asOf ? `; as of ${kpiCutoff(points.asOf)}` : ""}${points.qualificationAsOf ? `; qualification as of ${kpiCutoff(points.qualificationAsOf)}` : ""}`
            : undefined
        }
      >
        {available === null ? "—" : kpiPoints(points?.amount, available)}
        {points?.source === "automatic" ? (
          <small>
            Auto
            {points.status === "pending"
              ? " · Pending"
              : points.reason === "Measurement incomplete"
                ? " · Incomplete"
                : ""}
          </small>
        ) : null}
      </td>
    </tr>
  );
}
