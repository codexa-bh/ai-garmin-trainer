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
};
type KpiItem = {
  id: string;
  conceptId: string;
  label: string;
  definition: string;
  selection: string;
  evidenceRequired: string;
  tracks: KpiTrack[];
  availablePoints: number | null;
  scoring: string;
};
export type KpiSetInput = {
  origin: "planned" | "adaptation" | "review-defined";
  provenance: string;
  items: KpiItem[];
};
export type KpiSet = KpiSetInput & { id: string; savedAt: string };
export type KpiEvidence = {
  origin: "garmin" | "user-report" | "model-interpretation" | "recorded-source";
  references: string[];
  qualification: string;
  limitations: string;
};
export type KpiAssessmentInput = {
  setId: string;
  asOf: string;
  status: "supported" | "provisional" | "unavailable";
  items: {
    itemId: string;
    actuals: { trackKey: string; value: number | boolean | null }[];
    awardedPoints: number | null;
    explanation: string;
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
  explanation: string;
};
export type KpiAssessment = KpiAssessmentInput & {
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
};
