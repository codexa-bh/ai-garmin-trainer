import { describe, expect, it } from "vitest";
import { COACHING_SCENARIOS } from "../src/lib/ai/coaching-scenarios";
import {
  buildFinalSynthesisInstructions,
  buildPlannerInstructions,
  TRAINER_INSTRUCTION_SECTIONS,
  TRAINER_SYSTEM_PROMPT,
} from "../src/lib/ai/trainer-instructions";
import { unsafeMemoryReason } from "../src/lib/memory/filters";
import { trainerToolInputSchemas } from "../src/lib/ai/tool-contracts";

describe("canonical trainer instruction package", () => {
  it("composes bounded broad coaching and hiking-specialist base guidance", () => {
    expect(TRAINER_SYSTEM_PROMPT.length).toBeLessThan(9_000);
    expect(TRAINER_SYSTEM_PROMPT).toContain("endurance, strength, recovery");
    expect(TRAINER_SYSTEM_PROMPT).toContain("Hiking specialization");
    expect(TRAINER_SYSTEM_PROMPT).toContain("time-on-feet");
    expect(TRAINER_SYSTEM_PROMPT).toContain("ascent and descent");
    expect(TRAINER_SYSTEM_PROMPT).toContain("active Profile");
    expect(TRAINER_SYSTEM_PROMPT).toContain("prior assistant prose is never");
    expect(TRAINER_SYSTEM_PROMPT).toContain("normalized daily health");
    expect(TRAINER_SYSTEM_PROMPT).toContain("sleep score");
    expect(TRAINER_SYSTEM_PROMPT).toContain(
      "source-provided sleep stage/phase durations",
    );
    expect(TRAINER_SYSTEM_PROMPT).toContain("server current-date context");
    expect(TRAINER_SYSTEM_PROMPT).toContain(
      "Garmin evidence freshness separately",
    );
    expect(TRAINER_SYSTEM_PROMPT).toContain("do not claim you lack a clock");
    expect(TRAINER_SYSTEM_PROMPT).toContain(
      "Bounded normalized route coordinates may be used for route/GPS questions",
    );
    expect(TRAINER_SYSTEM_PROMPT).toContain("unrestricted GPS streams");
    expect(TRAINER_SYSTEM_PROMPT).not.toMatch(
      /give grounded, non-medical|do not diagnose|seek qualified care/i,
    );
    expect(Object.keys(TRAINER_INSTRUCTION_SECTIONS)).toEqual([
      "identity",
      "coaching",
      "hiking",
      "sources",
      "data",
      "privacy",
    ]);
  });

  it("scopes calculation and synthesis rules to their model-call responsibilities", () => {
    const planner = buildPlannerInstructions("base-contract", "no prior step");
    const synthesis = buildFinalSynthesisInstructions(
      "base-contract",
      "bounded evidence",
    );

    expect(planner).toContain("Every consequential derived value");
    expect(planner).toContain(
      "explicitly correction-eligible SQL/math failure",
    );
    expect(planner).toContain("A failed result publishes no output handle");
    expect(planner).toContain("do not replay an unchanged failed request");
    for (const instructions of [planner, synthesis]) {
      expect(instructions).toContain("at most 64 claims");
      expect(instructions).toContain("server Evidence step number");
      expect(instructions).toContain("displayed row 1 means rowIndex 0");
      expect(instructions).toContain(
        "never a rounded or display-converted value",
      );
    }
    expect(planner).toContain(
      "ground today/yesterday from server current-date context",
    );
    expect(planner).toContain("sleep, recovery, HRV, body battery");
    expect(planner).toContain(
      "do not spend the SQL budget on repeated searches",
    );
    expect(planner).toContain("the next analytical tool");
    expect(planner).toContain("same-turn SQL result");
    expect(planner).toContain("integer ratios (3/2, not 1.5)");
    expect(planner).toContain("do not reread unchanged documents");
    expect(planner).toContain("propose at most one complete draft");
    expect(planner).toContain(
      "Without successful math, leave derived points/total unavailable",
    );
    expect(planner).toContain("ISO UTC timestamp ending Z");
    expect(planner).toContain("display conversions");
    expect(planner).toContain("one targeted SQL query for a comparison");
    expect(planner).toContain("hard limit 30 combined provider/tool attempts");
    expect(planner).toContain(
      "Try to finish within 20 executions (a soft target, not a hard stop)",
    );
    expect(planner).toContain(
      "Per-tool successful schema, SQL, and math caps are 30",
    );
    expect(planner).toContain("Reuse sufficient current-turn evidence");
    expect(planner).toContain("Reserve 1 provider attempt");
    expect(planner).toContain("bounded normalized lat/lon route slices");
    expect(synthesis).toContain("disclose the selected criteria or formula");
    expect(synthesis).toContain("Never infer terrain");
    expect(synthesis).toContain("bounded evidence");
    expect(synthesis).not.toContain("Tool budget");
  });

  it("keeps General Plan age advisory and preserves explicit-write and complete-read safeguards", () => {
    const planner = buildPlannerInstructions("base", "none");
    expect(planner).toContain("more than 60 elapsed days");
    expect(planner).toContain("Exactly 60 days is within the review window");
    expect(planner).toContain("remains usable regardless of age");
    expect(planner).toContain("optional review");
    expect(planner).toContain("unavailable revision date cannot establish age");
    expect(planner).toContain("Review-only requests");
    expect(planner).toContain(
      "complete current Markdown in a separate model pass",
    );
    expect(planner).not.toContain("or it is stale");
    expect(
      COACHING_SCENARIOS.find(
        (scenario) => scenario.id === "PLAN-REVIEW-60-DAYS",
      ),
    ).toMatchObject({
      expectedRoute: "reference",
      forbiddenBehavior: expect.arrayContaining([
        "automatic save",
        "weekly commitment changes",
      ]),
    });
  });

  it("teaches fractional constants within the unchanged math tool schema", () => {
    const input = {
      inputResult: "week_facts",
      operation: "customFormula",
      outputName: "points",
    };
    expect(
      trainerToolInputSchemas.runMathAnalysis.safeParse({
        ...input,
        formula: "distance_meters * 1.5",
      }).success,
    ).toBe(false);
    expect(
      trainerToolInputSchemas.runMathAnalysis.safeParse({
        ...input,
        formula: "distance_meters * 3 / 2",
      }).success,
    ).toBe(true);
  });

  it("teaches safe SQL aliases without relaxing validation or terminal rejections", () => {
    const planner = buildPlannerInstructions("base-contract", "no prior step");
    expect(planner).toContain(
      "forbidden tokens are rejected even when used as aliases",
    );
    expect(planner).toContain("column, table, and CTE aliases");
    expect(planner).toContain(
      "activity_load or total_training_load instead of AS load",
    );
    expect(planner).toContain(
      "Do not try quoting a forbidden alias to evade validation",
    );
    expect(planner).toContain("terminal rejection behavior still apply");
    expect(
      buildFinalSynthesisInstructions("base-contract", "bounded evidence"),
    ).not.toContain("SQL naming:");
  });

  it("covers the provider-neutral coaching, hiking, source, and calculation scenarios", () => {
    const domains = new Set(
      COACHING_SCENARIOS.map((scenario) => scenario.domain),
    );
    expect(domains).toEqual(
      new Set([
        "endurance",
        "strength",
        "recovery",
        "general",
        "hiking",
        "personalization",
        "calculation",
        "policy",
      ]),
    );
    expect(
      COACHING_SCENARIOS.filter((scenario) => scenario.domain === "hiking")
        .length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      COACHING_SCENARIOS.some(
        (scenario) => scenario.expectedRoute === "sql-math",
      ),
    ).toBe(true);
    expect(
      COACHING_SCENARIOS.some((scenario) =>
        scenario.forbiddenBehavior.includes("app-authored medical refusal"),
      ),
    ).toBe(true);
  });

  it("distinguishes reported stops from measured pause/moving-time evidence in both generation paths", () => {
    for (const instructions of [
      buildPlannerInstructions(TRAINER_SYSTEM_PROMPT, "bounded evidence"),
      buildFinalSynthesisInstructions(
        TRAINER_SYSTEM_PROMPT,
        "bounded evidence",
      ),
    ]) {
      expect(instructions).toContain("do not establish exact pauses");
      expect(instructions).toContain(
        "do not present threshold-based estimates as measured stops",
      );
      expect(instructions).toContain("Attribute stops/terrain to user reports");
    }
    expect(
      COACHING_SCENARIOS.find((s) => s.id === "HIKE-STOPS-04"),
    ).toMatchObject({
      expectedRoute: "sql-math",
      severity: "critical",
      forbiddenBehavior: expect.arrayContaining([
        "failed math output used as evidence",
      ]),
    });
  });

  it("routes missing source grade to calculated SQL evidence without inventing terrain", () => {
    for (const instructions of [
      buildPlannerInstructions(TRAINER_SYSTEM_PROMPT, "bounded evidence"),
      buildFinalSynthesisInstructions(
        TRAINER_SYSTEM_PROMPT,
        "bounded evidence",
      ),
    ]) {
      expect(instructions).toContain("activity_calculated_grade(activity_id)");
      expect(instructions).toContain("valid/total section counts");
      expect(instructions).toContain("not instantaneous measured gradient");
      expect(instructions).toContain("terrain, surface or technicality");
      expect(instructions).toContain("unavailable, not flat zero");
    }
    expect(
      COACHING_SCENARIOS.find((scenario) => scenario.id === "HIKE-GRADE-05"),
    ).toMatchObject({
      expectedRoute: "sql",
      severity: "critical",
      forbiddenBehavior: expect.arrayContaining([
        "ascent per km presented as local gradient",
        "invented terrain or technicality",
      ]),
    });
  });

  it("carries transparent original-commitment scoring and no-save policy into both generation paths", () => {
    for (const instructions of [
      buildPlannerInstructions(TRAINER_SYSTEM_PROMPT, "bounded evidence"),
      buildFinalSynthesisInstructions(
        TRAINER_SYSTEM_PROMPT,
        "bounded evidence",
      ),
    ]) {
      for (const rule of [
        "model-selected KPI/target/unit/evidence/points/scoring-rule table",
        "full achievement=100",
        "no fixed app rubric",
        "original.revision baseline",
        "context, not denominator",
        "may exceed 100",
        "no double-counting",
        "cycling km are not hiking km",
        "Show unmet KPIs even above 100",
        "provisional recorded-commitment assumptions",
        "not prior agreement/latest-added rubric",
        "Never infer targets from results",
        "no completion score",
        "target-week guarded SQL/math",
        "exact successful current-turn cells",
        "attribute plan/user constants",
        "Separate activity/daily calories",
        "missing is not zero",
        "No silent weight redistribution/unfinished-week proration",
        "no unsupported definitive total",
        "incomplete for missing evidence",
        "NOT save consent",
        "immediately preceding pending",
        "one document-save attempt/turn",
        "current correction overrides stale Profile",
      ])
        expect(instructions).toContain(rule);
      expect(instructions).not.toContain(
        "No fixed score or invented completions",
      );
    }
    const weekly = COACHING_SCENARIOS.filter((s) => s.id.startsWith("WEEKLY-"));
    expect(weekly.map((s) => s.id)).toEqual([
      "WEEKLY-RUBRIC-01",
      "WEEKLY-ORIGINAL-02",
      "WEEKLY-EXTRAS-03",
      "WEEKLY-LEGACY-04",
      "WEEKLY-PARTIAL-05",
      "WEEKLY-NO-PLAN-06",
    ]);
    expect(weekly.every((s) => s.severity === "critical")).toBe(true);
    expect(weekly.flatMap((s) => s.forbiddenBehavior)).toEqual(
      expect.arrayContaining([
        "hidden fixed rubric",
        "implicit save",
        "model-only Garmin arithmetic",
        "one-for-one cycling/hiking kilometres",
        "unknown coerced to measured zero",
        "target reverse-engineered from actuals",
        "fabricated numeric completion",
      ]),
    );
  });

  it("keeps diagnosis and treatment content out of durable memory", () => {
    expect(unsafeMemoryReason("My diagnosis changed after treatment")).toBe(
      "medical_or_sensitive_inference",
    );
    expect(unsafeMemoryReason("Remember my medication dosage")).toBe(
      "medical_or_sensitive_inference",
    );
  });
});
