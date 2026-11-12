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
};
