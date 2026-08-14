import { describe, expect, it } from "vitest";
import { COACHING_SCENARIOS } from "../src/lib/ai/coaching-scenarios";
import {
  buildFinalSynthesisInstructions,
  buildPlannerInstructions,
  TRAINER_INSTRUCTION_SECTIONS,
  TRAINER_SYSTEM_PROMPT,
} from "../src/lib/ai/trainer-instructions";
import { unsafeMemoryReason } from "../src/lib/memory/filters";

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
      "ground today/yesterday from server current-date context",
    );
    expect(planner).toContain("sleep, recovery, HRV, body battery");
    expect(planner).toContain(
      "do not spend the SQL budget on repeated searches",
    );
    expect(planner).toContain("the next analytical tool");
    expect(planner).toContain("same-turn SQL result");
    expect(planner).toContain("display conversions");
    expect(planner).toContain("one schema call, two SQL calls, one math call");
    expect(planner).toContain("bounded normalized lat/lon route slices");
    expect(synthesis).toContain("disclose the selected criteria or formula");
    expect(synthesis).toContain("Never infer terrain");
    expect(synthesis).toContain("bounded evidence");
    expect(synthesis).not.toContain("Tool budget");
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

  it("keeps diagnosis and treatment content out of durable memory", () => {
    expect(unsafeMemoryReason("My diagnosis changed after treatment")).toBe(
      "medical_or_sensitive_inference",
    );
    expect(unsafeMemoryReason("Remember my medication dosage")).toBe(
      "medical_or_sensitive_inference",
    );
  });
});
