import { describe, expect, it, vi } from "vitest";
import {
  characters,
  emptySummary,
  minimizeSummarySource,
  renderSummary,
  scalarText,
  summaryCap,
  validSummaryValue,
  validSummaryDiagnostic,
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
  it.each([
    ["id", "invalid.id", "item-id"],
    ["text", "", "item-text"],
    ["text", "x".repeat(1201), "item-text"],
    ["text", "\ud800", "unicode"],
    ["category", "invented", "category"],
    ["stance", "certain", "stance"],
    ["priority", 6, "priority"],
    ["priority", 0.5, "priority"],
  ])(
    "reports closed %s final-value diagnostics without retaining rejected values",
    (field, value, invariant) => {
      const raw = patch();
      Object.assign(raw.upsert[0], { [field]: value });
      const observed: unknown[] = [];
      expect(
        validateSummaryPatch(raw, batch(), inputs(), now, (code, detail) =>
          observed.push({ code, detail }),
        ),
      ).toBeNull();
      expect(observed).toEqual([
        {
          code: "value",
          detail: {
            invariant,
            itemIndex: 0,
            ...(field === "text" &&
            typeof value === "string" &&
            value.length === 1201
              ? { actual: 1201, limit: 1200 }
              : {}),
          },
        },
      ]);
      expect(
        validSummaryDiagnostic((observed[0] as { detail: unknown }).detail),
      ).toBe(true);
    },
  );
  it("refuses unknown/extra/unbounded diagnostic data at its boundary", () => {
    for (const detail of [
      null,
      {},
      { invariant: "private text" },
      { invariant: "item-text", raw: "private" },
      { invariant: "item-id", itemIndex: 256 },
      { invariant: "character-cap", actual: 2_000_001 },
      { invariant: "shape", actual: -1 },
    ])
      expect(validSummaryDiagnostic(detail)).toBe(false);
    expect(
      validSummaryDiagnostic({
        invariant: "character-cap",
        actual: 7000,
        limit: 6000,
      }),
    ).toBe(true);
  });
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
    "https://example.invalid/training",
    "~/training-notes; password; treatment; latitude; longitude",
  ])("accepts formerly matched source/output as untrusted data: %s", (text) => {
    const source = { ...batch().sources[0]!, user: text };
    expect(minimizeSummarySource(source)?.user).toBe(text);
    const candidate = patch();
    candidate.upsert[0]!.text = text;
    const result = validateSummaryPatch(candidate, batch(), inputs(), now)!;
    expect(result.value.items[0].text).toBe(text);
    expect(validSummaryValue(result.value, 6000)).toBe(true);
  });
  it("accepts formerly rejected fourth generated item without losing any item or coverage", () => {
    const raw = patch();
    raw.upsert = Array.from({ length: 4 }, (_, i) => ({
      ...raw.upsert[0],
      id: `fourth_${i}`,
      text:
        i === 3
          ? "Fake password sk-example-not-a-key https://example.invalid/training"
          : `Meaning ${i}`,
    }));
    const rejected = vi.fn();
    const result = validateSummaryPatch(raw, batch(), inputs(), now, rejected)!;
    expect(result.value.items).toHaveLength(4);
    expect(result.value.items[3].text).toBe(raw.upsert[3].text);
    expect(result.dispositions).toEqual([
      { eventSeq: 1, sourceId: "turn:1", reason: "represented" },
    ]);
    expect(rejected).not.toHaveBeenCalled();
  });
  it("does not export fresh assistant replies or unresolved/oversized option referents", () => {
    const source = {
      ...batch().sources[0]!,
      user: "Use the second option; weekday time is the reason.",
      referent: "Option one: long weekdays. Option two: short weekdays.",
    };
    expect(minimizeSummarySource(source)?.referent).toBe(source.referent);
    expect(minimizeSummarySource({ ...source, referent: null })).toBeNull();
    expect(
      minimizeSummarySource({ ...source, referent: "API key: fake" })?.referent,
    ).toBe("API key: fake");
    expect(
      minimizeSummarySource({ ...source, referent: "x".repeat(1201) }),
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
  it("distinguishes unchanged repeated meaning from explicit new-source lineage and reports only closed rejection codes", () => {
    const previous = validateSummaryPatch(
      patch(),
      batch(),
      inputs(),
      now,
    )!.value;
    const source = { ...batch().sources[0]!, sourceId: "new:1" };
    const next = { ...batch(), previous, sources: [source] };
    const admitted = [minimizeSummarySource(source)!];
    const repetition = {
      version: 1,
      keep: ["decision"],
      upsert: [],
      remove: [],
      coverage: [{ sourceId: "new:1", reason: "represented" }],
    };
    const refusals: string[] = [];
    expect(
      validateSummaryPatch(repetition, next, admitted, now, (code) => {
        refusals.push(code);
      }),
    ).toBeNull();
    expect(refusals).toEqual(["coverage_lineage"]);
    repetition.coverage[0]!.reason = "duplicate";
    const retained = validateSummaryPatch(repetition, next, admitted, now)!;
    expect(retained.value).toEqual(previous);
    expect(retained.dispositions[0]!.reason).toBe("duplicate");
    const reused = patch();
    reused.upsert[0]!.sourceIds = ["new:1"];
    reused.upsert[0]!.replaces = ["decision"];
    expect(
      validateSummaryPatch(reused, next, admitted, now, (code) => {
        refusals.push(code);
      }),
    ).toBeNull();
    expect(refusals).toEqual(["coverage_lineage", "upsert_shape"]);
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
  it("keeps unresolved options unendorsed without rewriting medical denials or excluding topic words", () => {
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
    ).toContain("not for a diagnosed condition");
    expect(
      minimizeSummarySource({
        ...source,
        user: "Not for a diagnosed condition; diagnosis is example-condition.",
      })?.user,
    ).toBe("Not for a diagnosed condition; diagnosis is example-condition.");
    for (const user of [
      "Do not save this.",
      "Don't remember this.",
      "Never store this.",
    ])
      expect(minimizeSummarySource({ ...source, user })).toBeNull();
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
