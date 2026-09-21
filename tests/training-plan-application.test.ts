import { describe, expect, it } from "vitest";
import {
  createTrainingPlan,
  type TrainingPlanStore,
} from "../src/lib/training-plan/application";
import type { TrainingPlan } from "../src/lib/training-plan/contracts";
import { applyPlanEdits } from "../src/lib/training-plan/edits";
import {
  normalizeTrainingPlanTitle,
  planStatus,
} from "../src/lib/training-plan/policy";
import {
  completeTrainingPlanSchema,
  hasSensitivePlanText,
  sameTrainingPlan,
} from "../src/lib/training-plan/snapshot";

const now = new Date("2026-09-21T10:00:00Z");
const original: TrainingPlan = {
  title: "Original",
  contentMarkdown: "Alpha\nBeta\nTail café 🥾",
  revisedAt: "2026-09-01T10:00:00.000Z",
};
function fixture(initial: TrainingPlan | null = original) {
  let plan = initial;
  const journal: string[] = [];
  const store: TrainingPlanStore = {
    read() {
      journal.push("read");
      return plan;
    },
    persist(input) {
      journal.push("persist");
      plan = {
        title: input.title,
        contentMarkdown: input.contentMarkdown,
        revisedAt: new Date(input.nowMs).toISOString(),
      };
    },
  };
  const app = createTrainingPlan(store, () => {
    journal.push("clock");
    return now;
  });
  return {
    app,
    store,
    journal,
    change: (next: TrainingPlan | null) => {
      plan = next;
    },
  };
}

describe("feature-owned Training Plan rules", () => {
  it("preserves strict stale threshold, invalid time and null rules", () => {
    const threshold = Date.parse(original.revisedAt) + 14 * 86400000;
    expect(planStatus(original, threshold).stale).toBe(false);
    expect(planStatus(original, threshold + 1).stale).toBe(true);
    expect(
      planStatus({ ...original, revisedAt: "invalid" }, threshold).stale,
    ).toBe(true);
    expect(planStatus(null, threshold)).toEqual({
      plan: null,
      stale: true,
      staleAfterDays: 14,
    });
    expect(planStatus(original, 0).stale).toBe(false);
  });
  it("preserves title fallback, whitespace folding and truncation", () => {
    for (const value of [null, undefined, "", " \n "])
      expect(normalizeTrainingPlanTitle(value)).toBe("Training Plan");
    expect(normalizeTrainingPlanTitle("  My\n  Plan\t ")).toBe("My Plan");
    expect(normalizeTrainingPlanTitle("x".repeat(121))).toHaveLength(120);
  });
  it("compares title, revision and content, with null symmetry", () => {
    expect(sameTrainingPlan(null, null)).toBe(true);
    expect(sameTrainingPlan(original, null)).toBe(false);
    expect(sameTrainingPlan(null, original)).toBe(false);
    expect(sameTrainingPlan(original, { ...original })).toBe(true);
    for (const key of ["title", "contentMarkdown", "revisedAt"] as const)
      expect(
        sameTrainingPlan(original, { ...original, [key]: "changed" }),
      ).toBe(false);
  });
  it("applies sorted edits against original text rather than prior output", () => {
    expect(
      applyPlanEdits("Alpha Beta", [
        { oldText: "Beta", newText: "Gamma" },
        { oldText: "Alpha", newText: "Beta" },
      ]),
    ).toBe("Beta Gamma");
    expect(applyPlanEdits("abc", [])).toBe("abc");
  });
  it.each([
    ["abc", [{ oldText: "missing", newText: "x" }]],
    ["abc abc", [{ oldText: "abc", newText: "x" }]],
    [
      "abc",
      [
        { oldText: "ab", newText: "x" },
        { oldText: "bc", newText: "y" },
      ],
    ],
    [
      "abc",
      [
        { oldText: "a", newText: "x" },
        { oldText: "a", newText: "y" },
      ],
    ],
  ])("rejects missing/duplicate/overlapping matches in %s", (text, edits) => {
    expect(applyPlanEdits(text, edits)).toBeNull();
  });
  it.each([
    "/Users/person/private",
    "MY_API_KEY=secret",
    "refresh_token: hidden",
    "ACCESS_TOKEN=hidden",
    "tokens will be saved to:",
  ])("refuses sensitive document evidence: %s", (contentMarkdown) => {
    expect(hasSensitivePlanText({ ...original, contentMarkdown })).toBe(true);
    expect(() =>
      fixture({ ...original, contentMarkdown }).app.readComplete(),
    ).toThrow("private_plan_content");
  });
  it("validates complete snapshot bounds/shape without redacting", () => {
    const status = planStatus(original, now.getTime());
    expect(completeTrainingPlanSchema.parse(status)).toEqual(status);
    for (const patch of [
      { revisedAt: "invalid" },
      { title: "" },
      { title: "x".repeat(121) },
      { contentMarkdown: "" },
      { contentMarkdown: "x".repeat(32001) },
    ]) {
      expect(
        completeTrainingPlanSchema.safeParse({
          ...status,
          plan: { ...original, ...patch },
        }).success,
      ).toBe(false);
    }
    expect(
      completeTrainingPlanSchema.safeParse({ ...status, extra: true }).success,
    ).toBe(false);
  });
});

describe("synchronous use cases with supplied ports", () => {
  it("manual save intentionally bypasses complete-read guard and normalizes before write/read", () => {
    const { app, journal } = fixture();
    expect(
      app.saveManual({
        title: "  New\n title  ",
        contentMarkdown: "  hello\n  ",
      }),
    ).toEqual({
      title: "New title",
      contentMarkdown: "hello",
      revisedAt: now.toISOString(),
    });
    expect(journal).toEqual(["clock", "persist", "read"]);
  });
  it("preserves explicit revision time and normalization error codes without touching store", () => {
    const { app, journal } = fixture();
    expect(() => app.saveManual({ contentMarkdown: " " })).toThrow(
      "training_plan_content_required",
    );
    expect(() =>
      app.saveManual({ contentMarkdown: "x".repeat(32001) }),
    ).toThrow("training_plan_content_too_large");
    expect(journal).toEqual([]);
    expect(
      app.saveManual({ contentMarkdown: "x", now: new Date(0) }).revisedAt,
    ).toBe("1970-01-01T00:00:00.000Z");
    expect(journal).toEqual(["persist", "read"]);
  });
  it("propagates write failure and missing saved row without retries", () => {
    const { app, store, journal } = fixture(null);
    store.persist = () => {
      throw new Error("write failed");
    };
    expect(() => app.saveManual({ contentMarkdown: "x" })).toThrow(
      "write failed",
    );
    expect(journal).toEqual(["clock"]);
    store.persist = () => {
      journal.push("persist");
    };
    expect(() => app.saveManual({ contentMarkdown: "x" })).toThrow(
      "training_plan_save_failed",
    );
    expect(journal).toEqual(["clock", "clock", "persist", "read"]);
  });
  it("guarded edit returns synchronously and preserves title/untouched text with read-compare-write-read order", () => {
    const { app, journal } = fixture();
    const result = app.saveGuarded(
      { edits: [{ oldText: "Beta", newText: "Updated" }] },
      planStatus(original, 0),
    );
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual({
      ok: true,
      plan: {
        ...original,
        contentMarkdown: "Alpha\nUpdated\nTail café 🥾",
        revisedAt: now.toISOString(),
      },
    });
    expect(journal).toEqual(["clock", "read", "clock", "persist", "read"]);
  });
  it("requires existing complete snapshot but allows creation without one", () => {
    const current = fixture();
    expect(current.app.saveGuarded({ contentMarkdown: "x" })).toEqual({
      ok: false,
      reason: "complete_plan_read_required",
    });
    expect(current.journal).toEqual(["clock", "read"]);
    const empty = fixture(null);
    expect(empty.app.saveGuarded({ contentMarkdown: "x" })).toMatchObject({
      ok: true,
      plan: { title: "Training Plan" },
    });
  });
  it("rejects every changed snapshot field and sensitive snapshots before writes", () => {
    for (const key of ["title", "contentMarkdown", "revisedAt"] as const) {
      const { app, journal } = fixture();
      const snapshot = planStatus({ ...original, [key]: "different" }, 0);
      expect(app.saveGuarded({ contentMarkdown: "x" }, snapshot)).toEqual({
        ok: false,
        reason: "training_plan_changed_read_again",
      });
      expect(journal).toEqual(["clock", "read"]);
    }
    const { app } = fixture();
    expect(
      app.saveGuarded(
        { contentMarkdown: "x" },
        planStatus({ ...original, title: "/Users/private" }, 0),
      ),
    ).toEqual({ ok: false, reason: "complete_plan_read_required" });
    expect(
      fixture(null).app.saveGuarded(
        { contentMarkdown: "x" },
        planStatus(original, 0),
      ),
    ).toEqual({ ok: false, reason: "training_plan_changed_read_again" });
  });
  it("rejects edit and length failures with no write; preserves allowed empty edit list", () => {
    const { app, journal } = fixture();
    const snapshot = planStatus(original, 0);
    expect(
      app.saveGuarded(
        { edits: [{ oldText: "missing", newText: "x" }] },
        snapshot,
      ),
    ).toEqual({ ok: false, reason: "plan_edit_not_unique_or_overlapping" });
    for (const contentMarkdown of [undefined, "  ", "x".repeat(32001)])
      expect(app.saveGuarded({ contentMarkdown }, snapshot)).toEqual({
        ok: false,
        reason: "invalid_plan_content_length",
      });
    expect(journal).not.toContain("persist");
    expect(app.saveGuarded({ edits: [] }, snapshot)).toMatchObject({
      ok: true,
      plan: { contentMarkdown: original.contentMarkdown },
    });
  });
});
