import { validWeek, weekInterval, weeklyCalendar } from "./calendar";
import type { WeeklyRecord, WeeklyTurn } from "./contracts";
import type {
  KpiAssessmentInput,
  KpiChange,
  KpiEvidence,
  KpiRead,
  KpiSetInput,
  KpiSet,
  WeeklyKpis,
} from "./kpi-contracts";

function requireValid(
  condition: unknown,
  reason = "invalid_kpi_content",
): asserts condition {
  if (!condition) throw new Error(reason);
}
function text(value: unknown, max = 800, empty = false): value is string {
  return (
    typeof value === "string" &&
    (empty || value.trim().length > 0) &&
    value.length <= max
  );
}
function optionalText(value: unknown, empty = false): boolean {
  return value === undefined || text(value, 800, empty);
}
function id(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
  );
}
function points(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}
function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}
function evidence(value: KpiEvidence) {
  requireValid(
    value &&
      [
        "garmin",
        "user-report",
        "model-interpretation",
        "recorded-source",
      ].includes(value.origin),
  );
  requireValid(
    Array.isArray(value.references) &&
      value.references.length <= 8 &&
      value.references.every((v) => text(v, 160)),
  );
  requireValid(
    optionalText(value.qualification) && optionalText(value.limitations, true),
  );
}
export function validateKpiSet(set: KpiSetInput) {
  requireValid(
    set &&
      ["planned", "adaptation", "review-defined"].includes(set.origin) &&
      optionalText(set.provenance),
  );
  requireValid(
    Array.isArray(set.items) && set.items.length > 0 && set.items.length <= 12,
  );
  requireValid(
    unique(set.items.map((i) => i.id)) &&
      unique(set.items.map((i) => i.conceptId)),
  );
  for (const item of set.items) {
    requireValid(
      id(item.id) &&
        id(item.conceptId) &&
        text(item.label, 160) &&
        optionalText(item.definition) &&
        optionalText(item.selection) &&
        optionalText(item.evidenceRequired) &&
        optionalText(
          item.scoring,
          !item.tracks?.some(
            (track) => typeof track.availablePoints === "number",
          ),
        ),
    );
    requireValid(item.availablePoints == null, "kpi_item_pool_unsupported");
    requireValid(
      Array.isArray(item.tracks) &&
        item.tracks.length > 0 &&
        item.tracks.length <= 3 &&
        unique(item.tracks.map((t) => t.key)),
    );
    for (const track of item.tracks) {
      requireValid(
        id(track.key) &&
          ["numeric", "qualifying"].includes(track.kind) &&
          text(track.unit, 80) &&
          text(track.meaning, 240) &&
          (track.availablePoints === undefined ||
            points(track.availablePoints)),
      );
      requireValid(
        track.availablePoints == null || track.kind === "numeric",
        "kpi_qualifying_points_unsupported",
      );
      if (track.target !== null) {
        const target = track.target;
        requireValid(
          target &&
            ["at-least", "at-most", "equal", "range"].includes(
              target.comparator,
            ),
        );
        if (track.kind === "qualifying")
          requireValid(
            target.comparator === "equal" &&
              typeof target.value === "boolean" &&
              target.upper === undefined,
          );
        else {
          requireValid(
            typeof target.value === "number" && Number.isFinite(target.value),
          );
          requireValid(
            target.comparator === "range"
              ? typeof target.upper === "number" &&
                  Number.isFinite(target.upper) &&
                  target.upper >= target.value
              : target.upper === undefined,
          );
        }
      }
    }
  }
  requireValid(JSON.stringify(set).length <= 24000, "kpi_set_too_large");
}
export function validateKpiAssessment(
  assessment: KpiAssessmentInput,
  set: KpiSetInput,
  weekStart: string,
  timeZone: string,
  now: Date,
) {
  const cutoff = Date.parse(assessment.asOf);
  requireValid(
    Number.isFinite(cutoff) &&
      cutoff <= now.getTime() &&
      cutoff >= Date.parse(weekInterval(weekStart, timeZone).from),
    "invalid_assessment_cutoff",
  );
  requireValid(
    ["supported", "provisional", "unavailable"].includes(assessment.status) &&
      points(assessment.totalPoints) &&
      optionalText(assessment.explanation),
  );
  requireValid(
    Array.isArray(assessment.items) &&
      assessment.items.length === set.items.length &&
      unique(assessment.items.map((i) => i.itemId)),
  );
  for (const result of assessment.items) {
    const item = set.items.find((i) => i.id === result.itemId);
    requireValid(item, "unknown_kpi_item");
    const scored = kpiScoredUnits(item);
    requireValid(
      scored.every((unit) => unit.trackKey !== null),
      "kpi_legacy_pool_requires_mapping",
    );
    requireValid(result.awardedPoints == null, "kpi_item_award_unsupported");
    requireValid(
      optionalText(result.explanation) &&
        ["supported", "provisional", "unavailable"].includes(result.status),
    );
    requireValid(
      Array.isArray(result.actuals) &&
        result.actuals.length === item.tracks.length &&
        unique(result.actuals.map((a) => a.trackKey)),
    );
    for (const actual of result.actuals) {
      const track = item.tracks.find((t) => t.key === actual.trackKey);
      requireValid(track, "unknown_kpi_track");
      requireValid(
        actual.value === null ||
          (track.kind === "qualifying"
            ? typeof actual.value === "boolean"
            : typeof actual.value === "number" &&
              Number.isFinite(actual.value)),
        "incompatible_kpi_actual",
      );
      const isScored = scored.some((unit) => unit.trackKey === track.key);
      requireValid(
        isScored
          ? actual.awardedPoints !== undefined && points(actual.awardedPoints)
          : actual.awardedPoints === undefined,
        "invalid_kpi_track_award",
      );
    }
    evidence(result.evidence);
  }
  requireValid(
    Array.isArray(assessment.extras) && assessment.extras.length <= 8,
  );
  for (const extra of assessment.extras) {
    requireValid(
      text(extra.label, 160) &&
        typeof extra.points === "number" &&
        points(extra.points) &&
        text(extra.explanation),
    );
    evidence(extra.evidence);
  }
  requireValid(
    JSON.stringify(assessment).length <= 24000,
    "kpi_assessment_too_large",
  );
}

// Bounded complete objects, never an editable preview. Archive identities remain
// discoverable, while a single-set read always fits the declared evidence limit.
export function projectKpis(
  weekStart: string,
  state: WeeklyKpis | null,
  setId?: string,
  record?: WeeklyRecord | null,
): KpiRead {
  const selected = setId
    ? [setId]
    : [state?.originalId, state?.latestId, state?.reviewDefinedId];
  if (setId && !state?.sets.some((s) => s.id === setId))
    throw new Error("kpi_set_unavailable");
  const result: KpiRead = {
    weekStart,
    revision: state?.revision ?? null,
    timeZone: state?.timeZone ?? null,
    originalId: state?.originalId ?? null,
    latestId: state?.latestId ?? null,
    reviewDefinedId: state?.reviewDefinedId ?? null,
    complete: true,
    latestPlanSetId:
      state?.latestId ??
      (record?.latest &&
      state?.sets.some(
        (set) =>
          set.id === state.reviewDefinedId &&
          set.planRevision === record.latest?.revision,
      )
        ? (state?.reviewDefinedId ?? null)
        : null),
    sets: state?.sets.filter((s) => selected.includes(s.id)) ?? [],
    assessments:
      state?.assessments.filter((a) => selected.includes(a.setId)) ?? [],
    availableSets:
      state?.sets
        .filter((set) => !setId || set.id === setId)
        .map(({ id, origin, savedAt }) => ({ id, origin, savedAt })) ?? [],
  };
  if (JSON.stringify(result).length > 60000)
    return {
      ...result,
      complete: false,
      sets: [],
      assessments: [],
      narrowToSetIds: [
        ...new Set(selected.filter((v): v is string => Boolean(v))),
      ],
    };
  return result;
}
export function applyKpiChange(
  change: KpiChange,
  current: WeeklyKpis | null,
  record: WeeklyRecord | null,
  turn: WeeklyTurn,
  reads: KpiRead[],
  now: Date,
  newId: () => string,
  registerTrack: (concept: string, key: string, signature: string) => void,
): WeeklyKpis {
  requireValid(validWeek(change.weekStart), "invalid_week");
  const latest = reads.filter((s) => s.weekStart === change.weekStart).at(-1);
  const snapshots = reads.filter(
    (s) =>
      s.weekStart === change.weekStart &&
      s.complete &&
      s.revision === latest?.revision,
  );
  requireValid(
    latest?.complete &&
      snapshots.length &&
      latest.revision === (current?.revision ?? null),
    "prior_complete_kpi_read_required",
  );
  requireValid(
    !current || current.timeZone === turn.timeZone,
    "kpi_calendar_changed",
  );
  requireValid(
    !record || record.timeZone === turn.timeZone,
    "kpi_calendar_changed",
  );
  const state: WeeklyKpis = current
    ? (JSON.parse(JSON.stringify(current)) as WeeklyKpis)
    : {
        revision: newId(),
        timeZone: turn.timeZone,
        originalId: null,
        latestId: null,
        reviewDefinedId: null,
        sets: [],
        assessments: [],
      };
  const hasRead = (setId: string | null) =>
    !setId || snapshots.some((s) => s.sets.some((v) => v.id === setId));
  let newSetId: string | null = null;
  requireValid(
    Boolean(change.commitment) || Boolean(change.assessments?.length),
    "empty_kpi_change",
  );
  if (change.commitment) {
    const commitment = change.commitment;
    validateKpiSet(commitment);
    requireValid(
      hasRead(state.latestId) && hasRead(state.originalId),
      "prior_complete_kpi_baseline_required",
    );
    if (commitment.origin === "review-defined")
      requireValid(
        record?.original && !state.originalId,
        "review_defined_requires_legacy_plan",
      );
    else {
      const calendar = weeklyCalendar(now, turn.timeZone);
      requireValid(
        [calendar.weekStart, calendar.upcoming].includes(change.weekStart),
        "historical_or_distant_plan_read_only",
      );
      requireValid(
        commitment.origin === (state.originalId ? "adaptation" : "planned"),
        "invalid_kpi_origin",
      );
    }
    requireValid(state.sets.length < 128, "kpi_revision_limit");
    for (const item of commitment.items)
      for (const track of item.tracks)
        registerTrack(
          item.conceptId,
          track.key,
          JSON.stringify([track.kind, track.unit, track.meaning]),
        );
    newSetId = newId();
    state.sets.push({
      ...commitment,
      id: newSetId,
      savedAt: now.toISOString(),
      planRevision: record?.latest?.revision ?? null,
    });
    if (commitment.origin === "review-defined")
      state.reviewDefinedId = newSetId;
    else {
      state.originalId ??= newSetId;
      state.latestId = newSetId;
    }
  }
  requireValid(
    !change.assessments ||
      (change.assessments.length <= 3 &&
        unique(change.assessments.map((a) => a.setId))),
    "invalid_assessment_bundle",
  );
  for (const input of change.assessments ?? []) {
    const setId = input.setId === "new" ? newSetId : input.setId;
    const set = state.sets.find((s) => s.id === setId);
    requireValid(set, "unknown_kpi_set");
    requireValid(
      setId === newSetId || hasRead(set.id),
      "prior_complete_kpi_baseline_required",
    );
    validateKpiAssessment(input, set, change.weekStart, state.timeZone, now);
    state.assessments = state.assessments.filter((a) => a.setId !== set.id);
    state.assessments.push({
      ...input,
      setId: set.id,
      revision: newId(),
      savedAt: now.toISOString(),
    });
  }
  state.revision = newId();
  return state;
}

type KpiItem = KpiSet["items"][number];
type KpiItemResult = KpiAssessmentInput["items"][number];

/**
 * Independently scored units of one item. A track's own allocation is the
 * current model. Read-only legacy item pools stay readable: with exactly one
 * numeric track the pool is that track's allocation; otherwise (several
 * numeric tracks or condition-only) it remains one unmapped legacy item-level
 * unit (trackKey null), counted once and never split or duplicated.
 */
export function kpiScoredUnits(
  item: KpiItem,
): { trackKey: string | null; available: number }[] {
  const numeric = item.tracks.filter((track) => track.kind === "numeric");
  if (typeof item.availablePoints === "number")
    return [
      {
        trackKey: numeric.length === 1 ? numeric[0].key : null,
        available: item.availablePoints,
      },
    ];
  return numeric.flatMap((track) =>
    typeof track.availablePoints === "number"
      ? [{ trackKey: track.key, available: track.availablePoints }]
      : [],
  );
}

/** Saved award for one scored unit; undefined when none was recorded. */
export function kpiAwarded(
  item: KpiItem,
  result: KpiItemResult | undefined,
  trackKey: string | null,
): number | null | undefined {
  const actual = result?.actuals.find((value) => value.trackKey === trackKey);
  if (actual && actual.awardedPoints !== undefined) return actual.awardedPoints;
  return typeof item.availablePoints === "number"
    ? result?.awardedPoints
    : undefined;
}

/** One read-only score meaning for report and Progress; never rescoring. */
export function latestKpiScore(kpis: KpiRead | null) {
  const id =
    kpis?.latestPlanSetId !== undefined ? kpis.latestPlanSetId : kpis?.latestId;
  const sets = kpis?.sets.filter((value) => value.id === id) ?? [];
  const set: KpiSet | undefined = sets.length === 1 ? sets[0] : undefined;
  const assessments =
    kpis?.assessments.filter((value) => value.setId === id) ?? [];
  const assessment = assessments.length === 1 ? assessments[0] : undefined;
  const available =
    set?.items.reduce(
      (sum, item) =>
        sum +
        kpiScoredUnits(item).reduce((total, unit) => total + unit.available, 0),
      0,
    ) ?? null;
  const structurallyComplete = set?.items.every((item) => {
    const result = assessment?.items.find((value) => value.itemId === item.id);
    return (
      result &&
      assessment?.items.length === set.items.length &&
      result.actuals.length === item.tracks.length &&
      item.tracks.every((track) =>
        result.actuals.some((value) => value.trackKey === track.key),
      ) &&
      kpiScoredUnits(item).every((unit) => {
        const awarded = kpiAwarded(item, result, unit.trackKey);
        return (
          Number.isFinite(unit.available) &&
          unit.available >= 0 &&
          result.status !== "unavailable" &&
          typeof awarded === "number" &&
          Number.isFinite(awarded)
        );
      })
    );
  });
  const reason =
    kpis?.complete === false
      ? "Incomplete KPI read"
      : !set
        ? "No latest-plan KPIs"
        : !assessment
          ? "Not assessed"
          : !structurallyComplete ||
              assessment.status === "unavailable" ||
              assessment.totalPoints === null ||
              assessment.totalPoints < 0 ||
              !Number.isFinite(assessment.totalPoints)
            ? "Overall score unavailable"
            : !available || !Number.isFinite(available) || available < 0
              ? "No available-point denominator"
              : null;
  const total = reason === null ? assessment!.totalPoints! : null;
  const arithmetic = total === null ? null : (total / available!) * 100;
  const percentage =
    arithmetic !== null && Number.isFinite(arithmetic) ? arithmetic : null;
  return {
    set,
    assessment,
    available,
    total,
    percentage,
    provisional:
      set?.origin === "review-defined" || assessment?.status === "provisional",
    reason:
      arithmetic !== null && percentage === null
        ? "Percentage unavailable"
        : reason,
  };
}

/** Exact stable identity, never renderer fuzzy matching or cross-revision mixing. */
export function latestKpiMeasurement(
  kpis: KpiRead,
  conceptId: string,
  selected: KpiSet["items"][number]["tracks"][number],
) {
  const { set, assessment } = latestKpiScore(kpis);
  if (!kpis.complete) return null;
  const items =
    set?.items.filter((value) => value.conceptId === conceptId) ?? [];
  const item = items.length === 1 ? items[0] : undefined;
  const tracks =
    item?.tracks.filter(
      (value) =>
        value.key === selected.key &&
        value.kind === selected.kind &&
        value.unit === selected.unit &&
        value.meaning === selected.meaning,
    ) ?? [];
  const track = tracks.length === 1 ? tracks[0] : undefined;
  if (!item || !track) return null;
  const result = assessment?.items.find((value) => value.itemId === item.id);
  return {
    item,
    track,
    assessment,
    result,
    value:
      result?.actuals.find((value) => value.trackKey === track.key)?.value ??
      null,
  };
}
