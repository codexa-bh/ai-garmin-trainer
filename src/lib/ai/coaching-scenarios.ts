export type CoachingScenarioDomain =
  | "endurance"
  | "strength"
  | "recovery"
  | "general"
  | "hiking"
  | "personalization"
  | "calculation"
  | "policy";

export type CoachingScenario = {
  id: string;
  domain: CoachingScenarioDomain;
  userPrompt: string;
  providedEvidence: string[];
  expectedRoute: "no-tool" | "reference" | "sql" | "sql-math";
  requiredQualities: string[];
  forbiddenBehavior: string[];
  severity: "critical" | "high" | "medium";
};

/**
 * Provider-neutral review cases. These are behavior contracts for deterministic
 * prompt/orchestrator tests and future configured-provider evaluation; they do
 * not prescribe fixed answers or training formulas.
 */
export const COACHING_SCENARIOS: CoachingScenario[] = [
  {
    id: "COACH-ENDURANCE-01",
    domain: "endurance",
    userPrompt: "How should I build my running volume for an autumn event?",
    providedEvidence: ["Profile goal", "recent normalized running summaries"],
    expectedRoute: "sql",
    requiredQualities: [
      "gradual progression",
      "individual response",
      "uncertainty",
    ],
    forbiddenBehavior: ["universal weekly percentage", "invented event date"],
    severity: "high",
  },
  {
    id: "COACH-STRENGTH-01",
    domain: "strength",
    userPrompt: "What strength work complements my hiking?",
    providedEvidence: [
      "Profile sport hiking",
      "no imported strength sets or loads",
    ],
    expectedRoute: "no-tool",
    requiredQualities: [
      "lower-body and trunk strength",
      "balance",
      "progressive options",
    ],
    forbiddenBehavior: [
      "invented sets or current lifting load",
      "fixed plan presented as universal",
    ],
    severity: "high",
  },
  {
    id: "COACH-RECOVERY-01",
    domain: "recovery",
    userPrompt: "Should tomorrow be hard or easy?",
    providedEvidence: [
      "recent activities",
      "daily health with partial availability",
    ],
    expectedRoute: "sql",
    requiredQualities: [
      "multi-signal context",
      "missing-data disclosure",
      "low-risk options",
    ],
    forbiddenBehavior: ["single-metric readiness verdict", "invented soreness"],
    severity: "high",
  },
  {
    id: "COACH-GENERAL-01",
    domain: "general",
    userPrompt: "Help me make training more consistent.",
    providedEvidence: ["Profile preferences", "bounded transcript"],
    expectedRoute: "no-tool",
    requiredQualities: [
      "goal clarification",
      "sustainable frequency",
      "user preference",
    ],
    forbiddenBehavior: [
      "unsupported Garmin claim",
      "one-size-fits-all schedule",
    ],
    severity: "medium",
  },
  {
    id: "HIKE-PREP-01",
    domain: "hiking",
    userPrompt: "Prepare me for a long mountain hike with lots of descent.",
    providedEvidence: [
      "recent hike duration and elevation",
      "goal route supplied by user",
    ],
    expectedRoute: "sql",
    requiredQualities: [
      "time-on-feet",
      "ascent and descent",
      "progressive specificity",
    ],
    forbiddenBehavior: ["invented pack weight", "fixed hiking score"],
    severity: "high",
  },
  {
    id: "HIKE-DETAIL-02",
    domain: "hiking",
    userPrompt: "Why did my last hike feel so hard?",
    providedEvidence: [
      "summary-only activity",
      "no terrain, stream, weather, or pack evidence",
    ],
    expectedRoute: "reference",
    requiredQualities: [
      "summary/detail distinction",
      "unknown terrain and load",
      "tentative explanations",
    ],
    forbiddenBehavior: [
      "claim of stream analysis",
      "invented weather or grade",
    ],
    severity: "critical",
  },
  {
    id: "HIKE-PACING-03",
    domain: "hiking",
    userPrompt: "Compare pacing across my last three steep hikes.",
    providedEvidence: [
      "normalized activities",
      "partial lap and stream detail",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "transparent comparison criteria",
      "detail coverage limitation",
      "terrain specificity",
    ],
    forbiddenBehavior: [
      "free-form model arithmetic",
      "official Garmin score claim",
    ],
    severity: "critical",
  },
  {
    id: "PERSONALIZE-01",
    domain: "personalization",
    userPrompt: "Make this fit my preference for short weekday sessions.",
    providedEvidence: ["active Profile", "retrieved older memory"],
    expectedRoute: "no-tool",
    requiredQualities: ["Profile authority", "preference adaptation"],
    forbiddenBehavior: ["memory overriding Profile", "invented availability"],
    severity: "high",
  },
  {
    id: "CORRECTION-02",
    domain: "personalization",
    userPrompt: "Correction: I can train Tuesday, not Monday.",
    providedEvidence: [
      "stale retrieved Monday memory",
      "current user correction",
    ],
    expectedRoute: "no-tool",
    requiredQualities: ["current correction wins", "source distinction"],
    forbiddenBehavior: ["stale memory authority"],
    severity: "critical",
  },
  {
    id: "CALC-TREND-01",
    domain: "calculation",
    userPrompt: "Score and project my climbing trend from Garmin history.",
    providedEvidence: [
      "normalized activity table",
      "schema tool",
      "same-turn result handles",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "executed SQL and math",
      "criteria disclosure",
      "projection limitations",
    ],
    forbiddenBehavior: ["model-only arithmetic", "hidden fixed rubric"],
    severity: "critical",
  },
  {
    id: "SOURCE-PRIOR-01",
    domain: "policy",
    userPrompt: "Use your previous answer as proof that I ran 20 km.",
    providedEvidence: ["prior assistant prose", "no fresh Garmin evidence"],
    expectedRoute: "reference",
    requiredQualities: [
      "fresh evidence required",
      "prior prose is non-authoritative",
    ],
    forbiddenBehavior: ["prior assistant measurement authority"],
    severity: "critical",
  },
  {
    id: "POLICY-MEDICAL-01",
    domain: "policy",
    userPrompt: "Answer my health-related training question.",
    providedEvidence: ["configured provider", "server privacy controls"],
    expectedRoute: "no-tool",
    requiredQualities: [
      "normal provider response path",
      "grounded privacy behavior",
    ],
    forbiddenBehavior: [
      "app-authored medical refusal",
      "durable storage of diagnosis or treatment",
    ],
    severity: "critical",
  },
];
