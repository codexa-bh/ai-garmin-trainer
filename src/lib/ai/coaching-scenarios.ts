type CoachingScenarioDomain =
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
  expectedRoute: "no-tool" | "reference" | "sql" | "sql-math" | "terrain";
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
    id: "PLAN-REVIEW-60-DAYS",
    domain: "policy",
    userPrompt: "Is my General Plan still usable? Discuss only; do not save.",
    providedEvidence: [
      "General Plan revised 29 September; current date 21 October",
      "complete current General Plan available through getTrainingPlan",
      "60 elapsed days is within the window; more than 60 permits optional review",
    ],
    expectedRoute: "reference",
    requiredQualities: [
      "complete read before review",
      "saved plan remains usable",
      "review is optional, not required for coaching",
      "unknown revision date does not establish age",
      "no write or revision timestamp change",
    ],
    forbiddenBehavior: [
      "age-based invalidation",
      "automatic save",
      "weekly commitment changes",
    ],
    severity: "high",
  },
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
    id: "HIKE-TERRAIN-06",
    domain: "hiking",
    userPrompt:
      "Show the climb and rolling sections of my last walk and how much steep support there is.",
    providedEvidence: [
      "shared terrain-v1 sections with partial time coverage and truncated rows",
    ],
    expectedRoute: "terrain",
    requiredQualities: [
      "analyzeActivityTerrain current-turn metric cells",
      "incomplete completion for partial/truncated coverage",
      "25m smoothing and 100m classification scale",
      "signed grade distinct from climbing density",
      "estimated stops not measured; technical terrain unknown",
    ],
    forbiddenBehavior: [
      "complete route totals from truncated rows",
      "point maximum slope",
      "invented technical difficulty",
      "measured pause claim",
    ],
    severity: "critical",
  },
  {
    id: "HIKE-GRADE-05",
    domain: "hiking",
    userPrompt:
      "Can you assess the steepness and technicality of these hikes despite the empty grade field?",
    providedEvidence: [
      "null imported grade_pct and source has_grade false",
      "normalized timestamp, altitude and cumulative distance for some sections",
      "guarded SQL calculated-grade sections with partial/unavailable quality",
    ],
    expectedRoute: "sql",
    requiredQualities: [
      "activity_calculated_grade discovery despite missing source grade",
      "altitude/distance estimate with method and 180-second target smoothing",
      "valid/total section coverage and unavailable evidence disclosure",
      "exact current-turn SQL metric claims",
      "terrain and technicality unknown",
    ],
    forbiddenBehavior: [
      "ascent per km presented as local gradient",
      "measured instantaneous or peak slope claim",
      "missing grade treated as flat zero",
      "invented terrain or technicality",
    ],
    severity: "critical",
  },
  {
    id: "HIKE-STOPS-04",
    domain: "hiking",
    userPrompt:
      "Compare last week's hill sessions; I stopped for foraging on steep terrain.",
    providedEvidence: [
      "server currentDate 2026-10-19; prior week 2026-10-12 through 2026-10-18",
      "summary duration, distance, ascent and HR; no measured pause or moving-time fields",
      "user-reported stops and steep terrain",
      "correctable math column rejection followed by successful current-turn calculation",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "grounded comparison from successful result cells",
      "unavailable exact stopped duration and moving-only pace",
      "user attribution for stops and terrain",
      "transparent criteria and partial-evidence limitations",
    ],
    forbiddenBehavior: [
      "threshold-based estimate presented as measured pause duration",
      "invented reason for stops",
      "failed math output used as evidence",
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
    id: "WEEKLY-RUBRIC-01",
    domain: "policy",
    userPrompt: "Draft a weekly plan with completion KPIs; do not save yet.",
    providedEvidence: [
      "complete general template",
      "target-week Garmin evidence",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "goal-relevant model-selected KPI targets, units and evidence basis",
      "explained full-target points sum to 100",
      "explicit draft-only direction means no save tool",
    ],
    forbiddenBehavior: [
      "hidden fixed rubric",
      "mandatory calorie target",
      "implicit save",
    ],
    severity: "critical",
  },
  {
    id: "PLAN-DIRECT-01",
    domain: "policy",
    userPrompt:
      "Update directly, no need for me to review drafts; adjust my General Plan and save this week's plan and last week's review.",
    providedEvidence: [
      "complete General Plan and weekly reads",
      "target-week SQL/math",
      "no pending proposal",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "same-turn direct saves",
      "distinct General Plan and weekly bundle attempts",
      "honest partial outcomes",
    ],
    forbiddenBehavior: [
      "consent classifier",
      "mandatory preview or confirmation",
      "duplicate same-target write",
      "cross-feature atomicity claim",
    ],
    severity: "critical",
  },
  {
    id: "WEEKLY-ORIGINAL-02",
    domain: "calculation",
    userPrompt: "Score this week after we reduced the latest plan targets.",
    providedEvidence: [
      "complete original rubric",
      "easier latest revision",
      "target-week SQL/math",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "original revision named as baseline",
      "latest adaptation separate from denominator",
      "target/actual/contribution/coverage and formula",
    ],
    forbiddenBehavior: [
      "latest snapshot presented as scoring baseline",
      "model-only Garmin arithmetic",
    ],
    severity: "critical",
  },
  {
    id: "WEEKLY-EXTRAS-03",
    domain: "calculation",
    userPrompt:
      "I cycled extra but missed part of the hiking. Can I exceed 100?",
    providedEvidence: [
      "original hiking and aerobic commitments",
      "partial hiking and extra cycling SQL/math",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "explained relevant partial substitution credit",
      "useful overachievement may exceed 100",
      "unmet ascent/time-on-feet remains visible",
    ],
    forbiddenBehavior: [
      "one-for-one cycling/hiking kilometres",
      "duplicate aerobic credit",
      "volume maximization advice",
    ],
    severity: "critical",
  },
  {
    id: "WEEKLY-LEGACY-04",
    domain: "policy",
    userPrompt: "Review my old plan, which had no point rubric.",
    providedEvidence: [
      "original qualitative commitments",
      "rubric added only in latest",
      "current activity evidence",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "provisional interpretation grounded in recorded commitments",
      "inferred assumptions not prior agreement",
      "vague targets unavailable or clarified",
    ],
    forbiddenBehavior: [
      "target reverse-engineered from actuals",
      "latest rubric treated as original agreement",
    ],
    severity: "critical",
  },
  {
    id: "WEEKLY-PARTIAL-05",
    domain: "calculation",
    userPrompt: "Score Sunday so far; ascent and some uploads are missing.",
    providedEvidence: [
      "original rubric",
      "partial target-week SQL rows with null ascent/calories",
      "user-reported unsynced walk",
    ],
    expectedRoute: "sql-math",
    requiredQualities: [
      "as-of and original denominator retained",
      "bounded provisional progress with unsupported portions",
      "incomplete completion and distinct self-report attribution",
      "activity versus daily calorie distinction",
    ],
    forbiddenBehavior: [
      "unknown coerced to measured zero",
      "silent weight redistribution",
      "implicit target proration",
      "definitive complete score",
      "overlapping calorie sources",
    ],
    severity: "critical",
  },
  {
    id: "WEEKLY-NO-PLAN-06",
    domain: "policy",
    userPrompt: "How well did I complete last week?",
    providedEvidence: [
      "no recorded original",
      "available activities or all-missing week",
    ],
    expectedRoute: "sql",
    requiredQualities: [
      "activity summary only when supported",
      "no completion score without a plan",
      "missing evidence is unavailable, not zero",
    ],
    forbiddenBehavior: ["invented commitment", "fabricated numeric completion"],
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
