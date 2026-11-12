import type { WeeklyRecord, WeeklyStore } from "./contracts";
import type { WeeklyKpis } from "./kpi-contracts";
import { validWeek, validTimeZone } from "./calendar";
import { validateKpiAssessment, validateKpiSet } from "./kpis";

function validId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
  );
}

export type ReviewedKpiMapping = { source: WeeklyRecord; state: WeeklyKpis };
export type ReviewedKpiSourceMapping = {
  source: WeeklyRecord;
  expected: WeeklyKpis;
  newRevision: string;
  planRevisions: Record<string, string>;
};

/** Explicit maintenance only: finite reviewed mappings, never extraction,
 * startup, rescoring, or model invocation. The outer owner admits the target.
 */
export function backfillWeeklyKpis(
  store: WeeklyStore,
  mappings: ReviewedKpiMapping[],
  now: Date,
) {
  if (
    !mappings.length ||
    mappings.length > 52 ||
    new Set(mappings.map((m) => m.source.weekStart)).size !== mappings.length
  )
    throw new Error("invalid_backfill_manifest");
  return store.transaction(() => {
    let applied = 0;
    let reconciled = 0;
    for (const { source, state } of mappings) {
      if (
        !validWeek(source.weekStart) ||
        JSON.stringify(store.read(source.weekStart)) !== JSON.stringify(source)
      )
        throw new Error("backfill_source_changed");
      if (
        !validTimeZone(state.timeZone) ||
        state.timeZone !== source.timeZone ||
        !validId(state.revision) ||
        !Array.isArray(state.sets) ||
        !state.sets.length ||
        state.sets.length > 128 ||
        new Set(state.sets.map((s) => s.id)).size !== state.sets.length
      )
        throw new Error("invalid_backfill_state");
      if (
        !Array.isArray(state.assessments) ||
        new Set(state.assessments.map((a) => a.setId)).size !==
          state.assessments.length
      )
        throw new Error("invalid_backfill_assessments");
      const original = state.sets.find((s) => s.id === state.originalId);
      const latest = state.sets.find((s) => s.id === state.latestId);
      const reviewDefined = state.sets.find(
        (s) => s.id === state.reviewDefinedId,
      );
      if (
        (state.originalId !== null && original?.origin !== "planned") ||
        (state.latestId !== null &&
          (!latest || latest.origin === "review-defined")) ||
        (state.reviewDefinedId !== null &&
          reviewDefined?.origin !== "review-defined") ||
        (state.originalId === null) !== (state.latestId === null) ||
        state.sets.some((set) =>
          set.origin === "planned"
            ? set.id !== state.originalId
            : set.origin === "adaptation" && state.originalId === null,
        ) ||
        (!source.original && !source.review) ||
        (!source.original &&
          state.sets.some((s) => s.origin !== "review-defined"))
      )
        throw new Error("invalid_backfill_baselines");
      for (const set of state.sets) {
        validateKpiSet(set);
        if (!validId(set.id) || !Number.isFinite(Date.parse(set.savedAt)))
          throw new Error("invalid_backfill_revision");
        for (const item of set.items)
          for (const track of item.tracks)
            store.registerTrack(
              item.conceptId,
              track.key,
              JSON.stringify([track.kind, track.unit, track.meaning]),
            );
      }
      for (const assessment of state.assessments) {
        const set = state.sets.find((s) => s.id === assessment.setId);
        if (
          !set ||
          !validId(assessment.revision) ||
          !Number.isFinite(Date.parse(assessment.savedAt))
        )
          throw new Error("invalid_backfill_reference");
        validateKpiAssessment(
          assessment,
          set,
          source.weekStart,
          state.timeZone,
          now,
        );
      }
      const existing = store.readKpis(source.weekStart);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(state))
          throw new Error("backfill_existing_state_conflict");
        reconciled++;
      } else {
        store.saveKpis(source.weekStart, state);
        applied++;
      }
    }
    return { applied, reconciled, weeks: mappings.length };
  });
}

/** Separate existing-state maintenance: source bindings only, never replacement
 * values, identity remapping, rescoring or an overwrite mode on backfill. */
export function reconcileKpiSources(
  store: WeeklyStore,
  mappings: ReviewedKpiSourceMapping[],
) {
  if (
    !mappings.length ||
    mappings.length > 52 ||
    new Set(mappings.map((mapping) => mapping.source.weekStart)).size !==
      mappings.length
  )
    throw new Error("invalid_source_mapping_manifest");
  return store.transaction(() => {
    let applied = 0;
    let reconciled = 0;
    for (const { source, expected, newRevision, planRevisions } of mappings) {
      if (
        !validWeek(source.weekStart) ||
        JSON.stringify(store.read(source.weekStart)) !== JSON.stringify(source)
      )
        throw new Error("kpi_source_changed");
      if (
        !validId(newRevision) ||
        newRevision === expected.revision ||
        !Object.keys(planRevisions).length
      )
        throw new Error("invalid_source_mapping");
      const next = JSON.parse(JSON.stringify(expected)) as WeeklyKpis;
      for (const [id, revision] of Object.entries(planRevisions)) {
        const set = next.sets.find((value) => value.id === id);
        const document =
          set?.origin === "planned" ? source.original : source.latest;
        if (
          !set ||
          !document ||
          revision !== document.revision ||
          (set.planRevision != null && set.planRevision !== revision)
        )
          throw new Error("incompatible_kpi_source_binding");
        set.planRevision = revision;
      }
      next.revision = newRevision;
      const current = store.readKpis(source.weekStart);
      if (JSON.stringify(current) === JSON.stringify(next)) {
        reconciled++;
      } else {
        if (JSON.stringify(current) !== JSON.stringify(expected))
          throw new Error("kpi_structured_source_changed");
        store.saveKpis(source.weekStart, next);
        applied++;
      }
    }
    return { applied, reconciled, weeks: mappings.length };
  });
}

export type ReviewedKpiPointMapping = {
  /** Exact current narrative record and structured state, as reviewed. */
  source: WeeklyRecord;
  expected: WeeklyKpis;
  /** Reviewed per-measurement replacement and matching narrative text. */
  replacement: { record: WeeklyRecord; state: WeeklyKpis };
  newRevision: string;
};

function sameIdentity(before: WeeklyKpis, after: WeeklyKpis): boolean {
  const shape = (state: WeeklyKpis) =>
    JSON.stringify([
      state.timeZone,
      state.originalId,
      state.latestId,
      state.reviewDefinedId,
      state.sets.map((set) => [
        set.id,
        set.origin,
        set.savedAt,
        set.planRevision ?? null,
        set.items.map((item) => [
          item.id,
          item.conceptId,
          item.tracks.map((t) => [t.key, t.kind, t.unit, t.meaning]),
        ]),
      ]),
      state.assessments.map((a) => [a.setId, a.revision, a.savedAt, a.asOf]),
    ]);
  return shape(before) === shape(after);
}

function sameNarrativeIdentity(
  before: WeeklyRecord,
  after: WeeklyRecord,
): boolean {
  // Only document text may change; revisions, titles and bindings stay exact.
  const shape = (record: WeeklyRecord) =>
    JSON.stringify([
      record.weekStart,
      record.timeZone,
      ...(["original", "latest", "review"] as const).map((key) => {
        const document = record[key];
        return document
          ? { ...document, contentMarkdown: undefined }
          : document;
      }),
    ]);
  return shape(before) === shape(after);
}

/** Explicit maintenance only: replace reviewed legacy item-level point pools
 * with operator-approved per-measurement points and matching narrative text.
 * Never chooses weights, touches unlisted weeks or replays a changed source. */
export function mapKpiPoints(
  store: WeeklyStore,
  mappings: ReviewedKpiPointMapping[],
  now: Date,
) {
  if (
    !mappings.length ||
    mappings.length > 52 ||
    new Set(mappings.map((m) => m.source.weekStart)).size !== mappings.length
  )
    throw new Error("invalid_point_mapping_manifest");
  return store.transaction(() => {
    let applied = 0;
    let reconciled = 0;
    for (const { source, expected, replacement, newRevision } of mappings) {
      const { record, state } = replacement;
      const narrativeChanged =
        JSON.stringify(record) !== JSON.stringify(source);
      if (
        !validWeek(source.weekStart) ||
        !validId(newRevision) ||
        newRevision === expected.revision ||
        state.revision !== newRevision ||
        record.revision !==
          (narrativeChanged ? newRevision : source.revision) ||
        !sameIdentity(expected, state) ||
        !sameNarrativeIdentity(source, record)
      )
        throw new Error("invalid_point_mapping");
      const changedSets = state.sets.filter(
        (set, index) =>
          JSON.stringify(set) !== JSON.stringify(expected.sets[index]),
      );
      if (!changedSets.length) throw new Error("invalid_point_mapping");
      for (const set of changedSets) validateKpiSet(set);
      for (const assessment of state.assessments) {
        const set = state.sets.find((s) => s.id === assessment.setId)!;
        const before = expected.assessments.find(
          (a) => a.setId === assessment.setId,
        );
        if (
          changedSets.includes(set) ||
          JSON.stringify(before) !== JSON.stringify(assessment)
        )
          validateKpiAssessment(
            assessment,
            set,
            source.weekStart,
            state.timeZone,
            now,
          );
      }
      const currentRecord = store.read(source.weekStart);
      const currentState = store.readKpis(source.weekStart);
      if (
        JSON.stringify(currentRecord) === JSON.stringify(record) &&
        JSON.stringify(currentState) === JSON.stringify(state)
      ) {
        reconciled++;
        continue;
      }
      if (JSON.stringify(currentRecord) !== JSON.stringify(source))
        throw new Error("point_mapping_source_changed");
      if (JSON.stringify(currentState) !== JSON.stringify(expected))
        throw new Error("point_mapping_state_changed");
      if (narrativeChanged) store.save(record);
      store.saveKpis(source.weekStart, state);
      applied++;
    }
    return { applied, reconciled, weeks: mappings.length };
  });
}
