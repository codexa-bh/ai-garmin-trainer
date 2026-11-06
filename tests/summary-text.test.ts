import { describe, expect, it } from "vitest";
import {
  emptySummary,
  validateSummaryReplacement,
  validSummaryValue,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";

function batch(previous = emptySummary()): SummaryBatch {
  return {
    jobId: "authored",
    revision: 0,
    privacyGeneration: 0,
    controlGeneration: 0,
    manualRevision: 0,
    frontier: 0,
    upper: 20,
    cap: 1000,
    previous,
    sources: Array.from({ length: 20 }, (_, n) => ({
      eventSeq: n + 1,
      sourceId: `turn-${n}:1`,
      admissionSeq: n + 1,
      version: 1,
      eligible: true,
      user: `Authored statement ${n}`,
      referent: null,
    })),
  };
}
describe("one complete bounded generated summary", () => {
  it("replaces the full previous draft; application owns processing, not model item fates", () => {
    const first = batch();
    const a = validateSummaryReplacement(
      {
        summary: "Short weekdays because of caregiving; overlong plans failed.",
      },
      first,
      first.sources.map((s) => ({ sourceId: s.sourceId, user: s.user! })),
    )!;
    expect(a.value).toEqual({
      version: 2,
      text: "Short weekdays because of caregiving; overlong plans failed.",
    });
    expect(a.dispositions).toHaveLength(20);
    expect(a.dispositions.every((d) => d.reason === "processed")).toBe(true);
    const next = batch(a.value);
    const b = validateSummaryReplacement(
      {
        summary:
          "Current mornings; short weekdays due to caregiving. Bag not chosen.",
      },
      next,
      [],
    )!;
    expect(b.value.text).not.toContain("overlong");
    expect(Object.keys(b).sort()).toEqual(["dispositions", "value"]);
  });
  it("rejects ledger shapes, extra fields, malformed text and broken scalars without clipping", () => {
    for (const value of [
      { version: 1, keep: [], upsert: [], remove: [], coverage: [] },
      { summary: "ok", extra: 1 },
      { summary: 42 },
      { summary: "bad\ud800" },
    ])
      expect(validateSummaryReplacement(value, batch(), [])).toBeNull();
    expect(validSummaryValue({ version: 1, items: [], text: "" })).toBe(false);
    expect(validSummaryValue({ version: 2, text: "ok", items: [] })).toBe(
      false,
    );
  });
  it("counts Unicode scalars, permits underfull/empty output and never pads or cuts negation", () => {
    expect(validSummaryValue({ version: 2, text: "😀".repeat(1000) })).toBe(
      true,
    );
    expect(validSummaryValue({ version: 2, text: "😀".repeat(1001) })).toBe(
      true,
    );
    expect(
      validateSummaryReplacement({ summary: "" }, batch(), [])!.value,
    ).toEqual(emptySummary());
    expect(
      validateSummaryReplacement(
        { summary: "Do not infer endorsement." },
        batch(),
        [],
      )!.value.text,
    ).toBe("Do not infer endorsement.");
  });
});
