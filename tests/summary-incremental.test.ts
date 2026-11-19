import { describe, expect, it } from "vitest";
import {
  validateSummaryReplacement,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";

// The old patch-output validator is unreachable. Keep replacement-mode coverage
// through the validator used by production generation.
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
describe("complete replacement modes", () => {
  it("keeps initial, import, rebuild and manual rewrite on their replacement contract", () => {
    for (const special of [
      { ...batch, previous: { version: 2 as const, text: "" } },
      { ...batch, import: { id: "import", position: 0 } },
      { ...batch, rebuild: { id: "rebuild", position: 0, upperCompletion: 1 } },
      { ...batch, manualRewrite: true as const },
    ]) {
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
});
