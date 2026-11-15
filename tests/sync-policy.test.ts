import { describe, expect, it } from "vitest";
import { historyState } from "../src/lib/garmin/history-policy";
import { discoveryState } from "../src/lib/garmin/discovery-policy";
import {
  historicalAction,
  historicalIntentAdmitted,
  nextHistoricalWork,
} from "../src/lib/garmin/sync-policy";
import {
  historyScope,
  reconcileToAutomatic,
} from "../src/lib/garmin/scope-policy";

describe("authoritative historical action", () => {
  function fixture() {
    const history = historyState(null, "2026-09-01", "2026-09-21");
    history.outcome = "settled";
    history.health.nextDate = "2026-08-31";
    history.body.nextDate = null;
    history.activities.nextDate = null;
    const discovery = discoveryState(null, history.limit, null);
    return {
      history,
      discovery,
      repairs: [] as string[],
      exists: true,
      active: false,
      limit: history.limit,
    };
  }
  it("does not infer backlog from history existence, unknown boundary or terminal outcome", () => {
    const input = fixture();
    for (const outcome of [
      "settled",
      "cancelled",
      "budget-limited",
      "running",
    ] as const) {
      input.history.outcome = outcome;
      expect(historicalAction(input)).toMatchObject({
        state: "complete",
        action: null,
        next: null,
        remoteLowerBound: null,
      });
    }
  });
  it.each(["health", "body", "activities"] as const)(
    "admits an eligible independent %s cursor only",
    (family) => {
      const input = fixture();
      input.history[family].nextDate = "2026-09-02";
      expect(historicalAction(input)).toMatchObject({
        state: "available",
        action: "continue",
        next: { family },
      });
      input.history[family].nextDate = "2026-08-31";
      expect(nextHistoricalWork(input.history, input.discovery, [])).toBeNull();
    },
  );
  it("includes only eligible unresolved, repair and positive-hint work", () => {
    const input = fixture();
    input.history.unresolvedHealth = ["2026-08-01"];
    expect(historicalAction(input).state).toBe("complete");
    input.repairs = ["2026-09-03"];
    expect(historicalAction(input).next).toEqual({
      family: "repair",
      date: "2026-09-03",
    });
    input.repairs = [];
    input.discovery.positiveDates = ["2026-09-04"];
    expect(historicalAction(input).next).toEqual({
      family: "health",
      date: "2026-09-04",
    });
    input.discovery.positiveDates = [];
    input.discovery.nextHintEnd = "2026-09-01";
    expect(historicalAction(input).next).toEqual({
      family: "hint",
      date: "2026-09-01",
    });
  });
  it("refuses active, failure/no-progress, unsupported or changed-scope replay", () => {
    const input = fixture();
    input.history.health.nextDate = "2026-09-02";
    expect(historicalAction({ ...input, active: true }).state).toBe("active");
    expect(historicalAction({ ...input, invalid: true }).state).toBe("blocked");
    // A null cursor under a finite limit is ambiguous, not exhaustion.
    expect(historicalAction({ ...input, limit: null })).toMatchObject({
      state: "blocked",
      recovery: "inconsistent",
    });
    expect(historicalAction({ ...input, limit: "2026-08-01" })).toMatchObject({
      state: "blocked",
      recovery: "scope-changed",
      action: null,
    });
    input.history.outcome = "failed";
    input.history.recoveryReason = "no-progress";
    expect(historicalAction(input)).toMatchObject({
      state: "blocked",
      action: null,
      reason: expect.stringContaining("no progress"),
    });
    input.history.outcome = "running";
    expect(historicalAction(input)).toMatchObject({
      state: "available",
      interrupted: true,
    });
  });
});

describe("finite limit to automatic discovery", () => {
  // The motivating settled pair: both checkpoints limited to 2024-06-01.
  function settledPair() {
    const history = historyState(null, "2024-06-01", "2026-11-15");
    history.outcome = "settled";
    for (const family of ["health", "body", "activities"] as const)
      history[family].nextDate = "2024-05-31";
    history.activities.windowEnd = "2024-05-31";
    history.health.checks = 40;
    const discovery = discoveryState(null, "2024-06-01", "2024-05-31");
    discovery.operation = {
      phase: "settled",
      startedAt: "2026-11-15T09:00:00Z",
      updatedAt: "2026-11-15T09:10:00Z",
      attempts: 9,
      batches: 2,
      outcome: "settled",
      stopReason: "Chosen exploration range checked; remote boundary unknown.",
    };
    return { history, discovery };
  }
  const input = (pair = settledPair()) => ({
    ...pair,
    repairs: [] as string[],
    exists: true,
    active: false,
    limit: null,
  });
  it("offers one explicit discover action with older executable work", () => {
    const action = historicalAction(input());
    expect(action).toMatchObject({
      state: "available",
      action: "discover",
      savedLimit: "2024-06-01",
      limit: null,
      recovery: null,
      remoteLowerBound: null,
      next: { family: "health", date: "2024-05-31" },
    });
    expect(action.reason).toContain("imported data will be kept");
  });
  it.each(["cancelled", "budget-limited", "running"] as const)(
    "offers discover for coherent %s limited progress, preserving interruption truth",
    (outcome) => {
      const pair = settledPair();
      pair.history.outcome = outcome;
      pair.discovery.operation!.outcome = outcome;
      expect(historicalAction(input(pair))).toMatchObject({
        state: "available",
        action: "discover",
        interrupted: outcome === "running",
      });
    },
  );
  it("admits only the matching closed intent", () => {
    const discover = historicalAction(input());
    expect(historicalIntentAdmitted(discover, "discover")).toBe(true);
    expect(historicalIntentAdmitted(discover, "history")).toBe(false);
    expect(historicalIntentAdmitted(discover, undefined)).toBe(false);
    expect(historicalIntentAdmitted(discover, "latest")).toBe(true);
    const same = historicalAction({ ...input(), limit: "2024-06-01" });
    expect(same.state).toBe("complete");
    expect(historicalIntentAdmitted(same, "discover")).toBe(false);
    expect(historicalIntentAdmitted(same, undefined)).toBe(true);
  });
  it("preserves progress, counters, unresolved work and provenance", () => {
    const { history, discovery } = settledPair();
    history.unresolvedHealth = ["2024-06-03"];
    // Legitimate unfinished work inside the old scope stays first.
    expect(historicalAction(input({ history, discovery })).next).toEqual({
      family: "repair",
      date: "2024-06-03",
    });
    const before = JSON.stringify([history, discovery]);
    const planned = reconcileToAutomatic(history, discovery);
    expect(JSON.stringify([history, discovery])).toBe(before);
    expect(planned.history).toMatchObject({
      version: 1,
      limit: null,
      expandedFrom: "2024-06-01",
      health: { nextDate: "2024-05-31", checks: 40 },
      unresolvedHealth: ["2024-06-03"],
      outcome: "settled",
    });
    expect(planned.discovery).toMatchObject({
      limit: null,
      nextHintEnd: "2024-05-31",
      operation: { attempts: 9 },
    });
    // Revalidates under the new scope instead of resetting.
    expect(
      historyState(JSON.stringify(planned.history), null, "2026-11-15"),
    ).toEqual(planned.history);
  });
  it("freezes a clamped activity window's lower bound while paging", () => {
    const { history, discovery } = settledPair();
    history.activities.nextDate = "2024-06-10";
    history.activities.windowEnd = "2024-06-10";
    history.activities.page = 2;
    const planned = reconcileToAutomatic(history, discovery).history;
    expect(planned.version).toBe(2);
    expect(planned.activities.windowStart).toBe("2024-06-01");
    // Prior v1-only builds refuse rather than re-page a widened window.
    expect(
      historyState(JSON.stringify(planned), null, "2026-11-15").activities
        .windowStart,
    ).toBe("2024-06-01");
    expect(() =>
      historyState(
        JSON.stringify({ ...planned, version: 1 }),
        null,
        "2026-11-15",
      ),
    ).toThrow("unsupported");
    // Page 0 (or an unclamped window) needs no frozen bound.
    history.activities.page = 0;
    expect(reconcileToAutomatic(history, discovery).history.version).toBe(1);
  });
  it("re-hints just below the old limit when a prior hint straddled it", () => {
    const { history, discovery } = settledPair();
    discovery.nextHintEnd = "2023-06-01";
    expect(
      reconcileToAutomatic(history, discovery).discovery!.nextHintEnd,
    ).toBe("2024-05-31");
    discovery.nextHintEnd = "2024-08-01";
    expect(
      reconcileToAutomatic(history, discovery).discovery!.nextHintEnd,
    ).toBe("2024-08-01");
  });
  it.each([
    [
      "failed outcome",
      (pair: ReturnType<typeof settledPair>) => {
        pair.history.outcome = "failed";
      },
      "failed",
    ],
    [
      "no-progress",
      (pair: ReturnType<typeof settledPair>) => {
        pair.history.outcome = "failed";
        pair.history.recoveryReason = "no-progress";
      },
      "no-progress",
    ],
    [
      "failed discovery operation",
      (pair: ReturnType<typeof settledPair>) => {
        pair.discovery.operation!.outcome = "failed";
      },
      "failed",
    ],
    [
      "differently limited pair",
      (pair: ReturnType<typeof settledPair>) => {
        pair.discovery.limit = "2024-01-01";
      },
      "inconsistent",
    ],
    [
      "null cursor of unknown meaning",
      (pair: ReturnType<typeof settledPair>) => {
        pair.history.body.nextDate = null;
      },
      "inconsistent",
    ],
  ] as const)(
    "refuses %s with a specific recovery",
    (_label, edit, recovery) => {
      const pair = settledPair();
      edit(pair);
      expect(historicalAction(input(pair))).toMatchObject({
        state: "blocked",
        action: null,
        recovery,
      });
    },
  );
  it("classifies one-sided, invalid and narrowing state without repair", () => {
    const { history, discovery } = settledPair();
    expect(
      historyScope({ history: null, discovery, limit: null, invalid: false }),
    ).toEqual({ kind: "blocked", recovery: "inconsistent", savedLimit: null });
    expect(
      historyScope({ history, discovery, limit: null, invalid: true }),
    ).toMatchObject({ kind: "blocked", recovery: "unsupported" });
    const automatic = reconcileToAutomatic(history, discovery);
    expect(
      historyScope({ ...automatic, limit: "2020-01-01", invalid: false }),
    ).toMatchObject({ kind: "blocked", recovery: "scope-changed" });
    // History without discovery progress is still a coherent pair.
    expect(
      historyScope({ history, discovery: null, limit: null, invalid: false }),
    ).toEqual({ kind: "reconcilable", savedLimit: "2024-06-01" });
  });
  it("does not claim work or inception when cursors reached the floor", () => {
    const history = historyState(null, "0001-01-01", "2026-11-15");
    history.outcome = "settled";
    for (const family of ["health", "body", "activities"] as const)
      history[family].nextDate = null;
    const action = historicalAction({ ...input(), history, discovery: null });
    expect(action).toMatchObject({ state: "complete", remoteLowerBound: null });
  });
});
