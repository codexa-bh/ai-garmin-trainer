import { describe, expect, it } from "vitest";
import { historyState } from "../src/lib/garmin/history-policy";
import { discoveryState } from "../src/lib/garmin/discovery-policy";
import {
  historicalAction,
  nextHistoricalWork,
} from "../src/lib/garmin/sync-policy";

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
    expect(historicalAction({ ...input, limit: null }).state).toBe("blocked");
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
