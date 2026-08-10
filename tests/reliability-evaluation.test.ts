import { describe, expect, it } from "vitest";
import {
  evaluateDeterministicReliability,
  RELIABILITY_FIXTURES,
  summarizeReliability,
} from "../src/lib/ai/reliability-fixtures";

describe("provider-neutral reliability fixture gate", () => {
  it("covers critical privacy, prompt-injection, memory, and calculation gates", () => {
    const ids = RELIABILITY_FIXTURES.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "PRIV-01",
        "PRIV-02",
        "TOOL-03",
        "MEM-MED-01",
        "CALC-01",
      ]),
    );
    expect(
      RELIABILITY_FIXTURES.filter((item) => item.severity === "critical")
        .length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("enforces zero critical/high failures in the deterministic source-beta gate", () => {
    const results = evaluateDeterministicReliability();
    const summary = summarizeReliability(results);
    expect(summary.passed).toBe(true);
    expect(summary.criticalFailures).toBe(0);
    expect(summary.highFailures).toBe(0);
  });
});
