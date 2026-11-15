export type KpiTrack = {
  key: string;
  kind: "numeric" | "qualifying";
  unit: string;
  meaning: string;
  target: {
    comparator: "at-least" | "at-most" | "equal" | "range";
    value: number | boolean;
    upper?: number;
  } | null;
  /** Numeric tracks only; absent/null = monitoring, 0 = scored with no points. */
  availablePoints?: number | null;
};
type KpiItem = {
  id: string;
  conceptId: string;
  label: string;
  /** Legacy prose remains readable; omit duplication in new commitments. */
  definition?: string;
  selection?: string;
  evidenceRequired?: string;
  tracks: KpiTrack[];
  /** Legacy item-level pool, read-only; new writes allocate per track. */
  availablePoints?: number | null;
  /** Only a non-obvious agreed rubric, not a target/points restatement. */
  scoring?: string;
};
export type KpiSetInput = {
  origin: "planned" | "adaptation" | "review-defined";
  provenance?: string;
  items: Omit<KpiItem, "availablePoints">[];
};
export type KpiSet = Omit<KpiSetInput, "items"> & {
  /** Stored legacy pools remain readable, but are not new-write input fields. */
  items: KpiItem[];
  id: string;
  savedAt: string;
  /** Explicit narrative source, not an assessment revision or timestamp guess. */
  planRevision?: string | null;
};
export type KpiEvidence = {
  origin: "garmin" | "user-report" | "model-interpretation" | "recorded-source";
  references: string[];
  qualification?: string;
  limitations?: string;
};
export type KpiAssessmentInput = {
  setId: string;
  asOf: string;
  status: "supported" | "provisional" | "unavailable";
  items: {
    itemId: string;
    actuals: {
      trackKey: string;
      value: number | boolean | null;
      /** Present only for a scored track: awarded points, or null = unknown. */
      awardedPoints?: number | null;
    }[];
    explanation?: string;
    status: "supported" | "provisional" | "unavailable";
    evidence: KpiEvidence;
  }[];
  extras: {
    label: string;
    points: number;
    explanation: string;
    evidence: KpiEvidence;
  }[];
  totalPoints: number | null;
  explanation?: string;
};
export type KpiAssessment = Omit<KpiAssessmentInput, "items"> & {
  items: (KpiAssessmentInput["items"][number] & {
    /** Legacy item-level award for a saved legacy pool, read-only. */
    awardedPoints?: number | null;
  })[];
  revision: string;
  savedAt: string;
};
export type WeeklyKpis = {
  revision: string;
  timeZone: string;
  originalId: string | null;
  latestId: string | null;
  reviewDefinedId: string | null;
  sets: KpiSet[];
  assessments: KpiAssessment[];
};
export type KpiRead = {
  weekStart: string;
  revision: string | null;
  timeZone: string | null;
  originalId: string | null;
  latestId: string | null;
  reviewDefinedId: string | null;
  complete: boolean;
  /** Latest committed targets, or a source-matched legacy interpretation only. */
  latestPlanSetId?: string | null;
  sets: KpiSet[];
  assessments: KpiAssessment[];
  availableSets: { id: string; origin: KpiSet["origin"]; savedAt: string }[];
  narrowToSetIds?: string[];
  /** Stored measurement-only actuals; independent of reviewed points. */
  measured?: KpiWeekMeasurements | null;
};
export type KpiChange = {
  weekStart: string;
  commitment?: KpiSetInput;
  assessments?: KpiAssessmentInput[];
};
export type KpiProgress = {
  from: string;
  through: string;
  weeks: { weekStart: string; kpis: KpiRead }[];
  latestPlan: KpiRead | null;
  /** Current verified recipes for latest-plan concepts. */
  recipes?: KpiRecipe[];
};

/** A verified, reusable read-only measurement for one KPI concept. One row;
 * each named column is the value of one numeric track of that concept, so
 * related tracks share one selection. Optional missing_source > 0 marks the
 * source as incomplete. Targets and points are never part of a recipe. */
export type KpiRecipe = {
  conceptId: string;
  version: number;
  sql: string;
  tracks: { key: string; signature: string }[];
  savedAt: string;
};
export type KpiRecipeInput = {
  conceptId: string;
  sql: string;
  tracks: string[];
};
export type KpiMeasurementWindow = {
  weekStart: string;
  timeZone: string;
  /** Inclusive start, exclusive end and as-of cutoff (epoch ms). */
  startMs: number;
  endMs: number;
  asOfMs: number;
};
export type KpiRecipeOutcome =
  | {
      conceptId: string;
      status: "measured" | "incomplete";
      values: Record<string, number | null>;
    }
  | { conceptId: string; status: "failed"; reason: string };
export type KpiMeasurementRun = {
  /** Imported-data basis observed in the same read snapshot as the results. */
  basis: string;
  outcomes: KpiRecipeOutcome[];
};
/** Runs admitted recipes against one window; never throws for one recipe. */
export type KpiMeasurementExecution = {
  run(
    recipes: Pick<KpiRecipe, "conceptId" | "sql" | "tracks">[],
    window: KpiMeasurementWindow,
  ): Promise<KpiMeasurementRun>;
  /** Current basis, read synchronously for a conditional publication. */
  basis(window: KpiMeasurementWindow): string;
};
export type KpiConceptMeasurement = {
  success?: {
    recipeVersion: number;
    status: "measured" | "incomplete";
    values: Record<string, number | null>;
    /** Track signatures at measurement; a changed meaning is not reused. */
    signatures: Record<string, string>;
    measuredAt: string;
    asOf: string;
    basis: string;
  };
  /** Latest failed attempt; a retained success stays useful but stale. */
  failure?: { recipeVersion: number; reason: string; at: string };
};
export type KpiWeekMeasurements = {
  weekStart: string;
  timeZone: string;
  revision: string;
  concepts: Record<string, KpiConceptMeasurement>;
};
