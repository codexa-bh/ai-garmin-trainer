import { describe, expect, it } from "vitest";
import {
  validateSummaryIncrement,
  validateSummaryReplacement,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";

const batch: SummaryBatch = {
  jobId: "authored",
  revision: 1,
  privacyGeneration: 1,
  controlGeneration: 1,
  manualRevision: 0,
  frontier: 0,
  upper: 1,
  cap: 1000,
  previous: {
    version: 2,
    text: "Mornings are preferred. Equipment is undecided. Old deadline: June.",
  },
  sources: [
    {
      eventSeq: 1,
      sourceId: "authored:1",
      admissionSeq: 1,
      version: 1,
      eligible: true,
      user: "New authored context",
      referent: null,
    },
  ],
};
const inputs = [{ sourceId: "authored:1", user: "New authored context" }];
const update = (
  edits: { before: string; after: string }[] = [],
  addition = "",
) => ({ action: "update", edits, addition });

describe("output-only incremental text policy", () => {
  it("preserves untouched state and adds unrelated durable meaning without rewriting", () => {
    const result = validateSummaryIncrement(
      update([], "Watercolor on Sundays for quiet practice."),
      batch,
      inputs,
    )!;
    expect(result.value.text).toBe(
      batch.previous.text + "\n\nWatercolor on Sundays for quiet practice.",
    );
    expect(result.dispositions).toEqual([
      { eventSeq: 1, sourceId: "authored:1", reason: "processed" },
    ]);
  });
  it("applies corrections and obsolete removal simultaneously, preserving uncertainty", () => {
    const result = validateSummaryIncrement(
      update([
        { before: " Old deadline: June.", after: "" },
        {
          before: "Mornings are preferred.",
          after: "Evenings now preferred because work shifted.",
        },
      ]),
      batch,
      inputs,
    )!;
    expect(result.value.text).toBe(
      "Evenings now preferred because work shifted. Equipment is undecided.",
    );
  });
  it("distinguishes unchanged processing from uncertainty without a fallback or fake learning claim", () => {
    const unchanged = validateSummaryIncrement(
      { action: "unchanged", edits: [], addition: "" },
      batch,
      inputs,
    )!;
    expect(unchanged.value).toEqual(batch.previous);
    expect(unchanged.dispositions[0].reason).toBe("processed");
    expect(
      validateSummaryIncrement(
        { action: "uncertain", edits: [], addition: "" },
        batch,
        inputs,
      ),
    ).toBeNull();
  });
  it.each([
    { summary: "Only the latest topic" },
    { action: "update", edits: [], addition: "", extra: true },
    { action: "unknown", edits: [], addition: "New" },
    { action: {}, edits: [], addition: "" },
    { action: "unchanged", edits: [], addition: "But changed" },
    {
      action: "unchanged",
      edits: [{ before: "Mornings", after: "Evenings" }],
      addition: "",
    },
    update(),
    update([{ before: "", after: "New" }]),
    update([{ before: "absent", after: "New" }]),
    update([{ before: "Mornings", after: "Mornings" }]),
    update([{ before: "Mornings", after: "New", extra: true } as never]),
    update([
      { before: "Mornings", after: "New" },
      { before: "Mornings are", after: "Other" },
    ]),
    update([
      { before: "Mornings", after: "Evenings" },
      { before: "Evenings", after: "Nights" },
    ]),
    update([], "\ud800"),
    update([{ before: "Mornings", after: "\udfff" }]),
  ])(
    "refuses malformed, stale, overlapping, cascading, no-op or invalid Unicode output: %#",
    (raw) => {
      expect(validateSummaryIncrement(raw, batch, inputs)).toBeNull();
    },
  );
  it("rejects ambiguous repeated matches including overlapping occurrences", () => {
    for (const text of ["same same", "aaaa"])
      expect(
        validateSummaryIncrement(
          update([{ before: text === "aaaa" ? "aa" : "same", after: "new" }]),
          { ...batch, previous: { version: 2, text } },
          inputs,
        ),
      ).toBeNull();
  });
  it("rejects malformed scalar fields even when a split-surrogate edit would form valid final text", () => {
    const emoji = { ...batch, previous: { version: 2 as const, text: "😀" } };
    expect(
      validateSummaryIncrement(
        update([{ before: "\ud83d", after: "\ud83e" }]),
        emoji,
        inputs,
      ),
    ).toBeNull();
  });
  it("does not treat size or arbitrary prose as invalidity", () => {
    const addition = "😀".repeat(20001);
    expect(
      validateSummaryIncrement(update([], addition), batch, inputs)?.value.text,
    ).toBe(batch.previous.text + "\n\n" + addition);
  });
  it("keeps initial, import, rebuild and manual rewrite on their independent replacement contract", () => {
    for (const special of [
      { ...batch, previous: { version: 2 as const, text: "" } },
      { ...batch, import: { id: "import", position: 0 } },
      { ...batch, rebuild: { id: "rebuild", position: 0, upperCompletion: 1 } },
      { ...batch, manualRewrite: true as const },
    ]) {
      expect(
        validateSummaryIncrement(update([], "New"), special, inputs),
      ).toBeNull();
      expect(
        validateSummaryReplacement(
          {
            summary: "Complete replacement",
            ...("manualRewrite" in special ? {} : { exclude: [] }),
          },
          special,
          inputs,
        )?.value.text,
      ).toBe("Complete replacement");
    }
  });
  it("states the semantic limit: code cannot identify an intentionally overbroad but valid edit", () => {
    const result = validateSummaryIncrement(
      update([
        { before: batch.previous.text, after: "Lossy authored replacement" },
      ]),
      batch,
      inputs,
    );
    expect(result?.value.text).toBe("Lossy authored replacement");
    // This is not a semantic-loss detector. The guarantee covers untouched spans.
  });
});
