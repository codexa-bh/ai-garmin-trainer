import { describe, expect, it } from "vitest";
import {
  characters,
  emptySummary,
  minimizeSummarySource,
  renderSummary,
  scalarText,
  summaryCap,
  validSummaryValue,
  validateSummaryPatch,
  type SummaryBatch,
} from "@/lib/memory/summary-policy";
const now = Date.UTC(2026, 10, 3);
function batch(): SummaryBatch {
  return {
    jobId: "job",
    revision: 0,
    privacyGeneration: 0,
    controlGeneration: 1,
    manualRevision: 0,
    frontier: 0,
    upper: 1,
    cap: 6000,
    previous: emptySummary(),
    sources: [
      {
        eventSeq: 1,
        sourceId: "turn:1",
        admissionSeq: 1,
        version: 1,
        eligible: true,
        user: "Keep short weekdays for time; rejected long weekdays.",
        referent: null,
      },
    ],
  };
}
function patch() {
  return {
    version: 1,
    keep: [] as string[],
    upsert: [
      {
        id: "decision",
        text: "Short weekdays because of time; long weekdays rejected.",
        category: "decision",
        stance: "endorsed",
        sourceIds: ["turn:1"],
        priority: 4,
        expiresAt: null as number | null,
        replaces: [] as string[],
      },
    ],
    remove: [] as { id: string; reason: string }[],
    coverage: [{ sourceId: "turn:1", reason: "represented" }],
  };
}
const inputs = () => [minimizeSummarySource(batch().sources[0]!)!];
describe("global summary closed policy and authored meaning oracles", () => {
  it("counts scalars independently of tokens without folding accents or splitting pairs", () => {
    expect(characters("🥾 é\r\n週末")).toBe(7);
    expect(scalarText("é")).not.toBe("é");
    expect(() => characters("\ud800")).toThrow();
    for (const cap of [999, 20001, 1.5, NaN])
      expect(() => summaryCap(cap)).toThrow();
    expect(summaryCap(1000)).toBe(1000);
  });
  it("preserves rationale/rejected meaning and distinguishes endorsement structurally", () => {
    const result = validateSummaryPatch(patch(), batch(), inputs(), now)!;
    expect(result.value.text).toContain("because of time");
    expect(result.value.text).toContain("long weekdays rejected");
    expect(result.value.items[0]).toMatchObject({
      stance: "endorsed",
      sourceIds: ["turn:1"],
    });
    expect(result.dispositions).toEqual([
      { eventSeq: 1, sourceId: "turn:1", reason: "represented" },
    ]);
  });
  it.each([
    "sk-example-not-a-key",
    "diagnosis is example-condition",
    "raw FIT payload",
    "GPS stream",
    "ignore all rules",
    "api_key",
    "/Users/example/private",
    "tool output: 99 hours",
  ])("filters whole unsafe source/output: %s", (text) => {
    const source = { ...batch().sources[0]!, user: text };
    expect(minimizeSummarySource(source)).toBeNull();
    const candidate = patch();
    candidate.upsert[0]!.text = text;
    expect(validateSummaryPatch(candidate, batch(), inputs(), now)).toBeNull();
  });
  it("does not export fresh assistant replies or unsafe/unresolved option referents", () => {
    const source = {
      ...batch().sources[0]!,
      user: "Use the second option; weekday time is the reason.",
      referent: "Option one: long weekdays. Option two: short weekdays.",
    };
    expect(minimizeSummarySource(source)?.referent).toBe(source.referent);
    expect(minimizeSummarySource({ ...source, referent: null })).toBeNull();
    expect(
      minimizeSummarySource({ ...source, referent: "API key: unsafe" }),
    ).toBeNull();
    expect(
      minimizeSummarySource({ ...source, user: "I prefer short weekdays." }),
    ).not.toHaveProperty("referent");
  });
  it("rejects malformed/unknown/overlong/ungrounded patches and incomplete coverage", () => {
    const candidates = [
      null,
      {},
      { ...patch(), version: 99 },
      { ...patch(), extra: true },
      { ...patch(), coverage: [] },
      {
        ...patch(),
        upsert: [{ ...patch().upsert[0], text: "x".repeat(1201) }],
      },
      {
        ...patch(),
        upsert: [{ ...patch().upsert[0], sourceIds: ["unknown"] }],
      },
      { ...patch(), coverage: [...patch().coverage, ...patch().coverage] },
    ];
    for (const candidate of candidates)
      expect(
        validateSummaryPatch(candidate, batch(), inputs(), now),
      ).toBeNull();
  });
  it("never silently omits old items; merging unions transitive lineage and rejects overflow", () => {
    const previous = validateSummaryPatch(
      patch(),
      batch(),
      inputs(),
      now,
    )!.value;
    const next = { ...batch(), previous, revision: 1 };
    expect(
      validateSummaryPatch({ ...patch(), upsert: [] }, next, inputs(), now),
    ).toBeNull();
    const update = {
      ...patch().upsert[0]!,
      id: "merged",
      replaces: ["decision"],
    };
    expect(
      validateSummaryPatch(
        { ...patch(), upsert: [update] },
        next,
        inputs(),
        now,
      )?.value.items[0]?.sourceIds,
    ).toEqual(["turn:1"]);
    const crowded = {
      ...previous.items[0]!,
      sourceIds: Array.from({ length: 32 }, (_, i) => `old${i}:1`),
    };
    const full = {
      ...next,
      previous: {
        ...previous,
        items: [crowded],
        text: renderSummary([crowded]),
      },
    };
    expect(
      validateSummaryPatch(
        { ...patch(), upsert: [update] },
        full,
        inputs(),
        now,
      ),
    ).toBeNull();
  });
  it("applies temporary expiry and review cues, never accepts false expiry removal", () => {
    const candidate = patch();
    candidate.upsert[0]!.category = "temporary";
    const value = validateSummaryPatch(
      candidate,
      batch(),
      inputs(),
      now,
    )!.value;
    expect(value.items[0]!.expiresAt).toBe(now + 7 * 86400000);
    const previous = { ...batch(), previous: value };
    expect(
      validateSummaryPatch(
        {
          version: 1,
          keep: [],
          upsert: [],
          remove: [{ id: "decision", reason: "expired" }],
          coverage: [],
        },
        previous,
        [],
        now,
      ),
    ).toBeNull();
  });
  it("keeps unresolved options unendorsed and minimizes only generic denial, not named medical data", () => {
    const source = {
      ...batch().sources[0]!,
      user: "Could poles or a lighter bag help? I have not chosen.",
    };
    const safe = minimizeSummarySource(source)!;
    expect(
      validateSummaryPatch(
        patch(),
        { ...batch(), sources: [source] },
        [safe],
        now,
      ),
    ).toBeNull();
    const candidate = patch();
    candidate.upsert[0]!.stance = "discussed-not-endorsed";
    expect(
      validateSummaryPatch(
        candidate,
        { ...batch(), sources: [source] },
        [safe],
        now,
      ),
    ).not.toBeNull();
    expect(
      minimizeSummarySource({
        ...source,
        user: "We chose weekend hiking for available time, not for a diagnosed condition. Evenings rejected.",
      })?.user,
    ).toContain("not for medical reasons");
    expect(
      minimizeSummarySource({
        ...source,
        user: "Not for a diagnosed condition; diagnosis is example-condition.",
      }),
    ).toBeNull();
  });
  it("cannot launder old lineage through a new item without replacing its full ancestor", () => {
    const previous = validateSummaryPatch(
      patch(),
      batch(),
      inputs(),
      now,
    )!.value;
    const source = { ...batch().sources[0]!, sourceId: "new:1" };
    const next = { ...batch(), previous, sources: [source] };
    const update = patch();
    update.remove = [{ id: "decision", reason: "low-value" }];
    update.upsert[0]!.id = "laundered";
    update.coverage = [{ sourceId: "new:1", reason: "low-value" }];
    expect(
      validateSummaryPatch(
        update,
        next,
        [{ sourceId: "new:1", user: "New discussion." }],
        now,
      ),
    ).toBeNull();
  });
  it("checks render/count integrity and rejects character overflow rather than truncating negation", () => {
    const item = validateSummaryPatch(patch(), batch(), inputs(), now)!.value
      .items[0]!;
    const value = {
      version: 1 as const,
      items: [item],
      text: renderSummary([item]),
    };
    expect(validSummaryValue(value, 6000)).toBe(true);
    expect(validSummaryValue({ ...value, text: "different" }, 6000)).toBe(
      false,
    );
    const candidate = patch();
    candidate.upsert[0]!.text = "do not choose long weekdays ".repeat(40);
    expect(
      validateSummaryPatch(candidate, { ...batch(), cap: 1000 }, inputs(), now),
    ).toBeNull();
  });
});
