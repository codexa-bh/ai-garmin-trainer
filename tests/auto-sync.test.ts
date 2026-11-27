import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoSyncAttempt,
  dueAutoSync,
} from "../src/lib/garmin/auto-sync-policy";
import { historyState } from "../src/lib/garmin/history-policy";
import {
  historicalAction,
  type SyncOperation,
} from "../src/lib/garmin/sync-policy";
import {
  autoSyncLifetime,
  createAutoSyncSchedule,
} from "../src/lib/garmin/auto-sync-lifetime";

const AUTO_SYNC_INTERVAL_MS = 3_600_000;
const success = "2026-11-20T12:00:00.000Z";
const start = Date.parse(success);
function completed() {
  const history = historyState(null, "2026-11-20", "2026-11-20");
  history.outcome = "settled";
  history.updatedAt = success;
  history.health.nextDate =
    history.body.nextDate =
    history.activities.nextDate =
      null;
  const operation: SyncOperation = {
    version: 1,
    intent: "history",
    outcome: "settled",
    updatedAt: success,
    stopReason: null,
    detailsAttempted: 0,
    detailsProcessed: 0,
    detailsFailed: 0,
    detailsRemaining: 0,
  };
  return {
    history,
    discovery: null,
    sync: {
      historical: historicalAction({
        history,
        discovery: null,
        repairs: [],
        exists: true,
        active: false,
        limit: history.limit,
      }),
      detailsRemaining: 0,
      operation,
      latest: null,
    },
    attempt: null,
    now: start + AUTO_SYNC_INTERVAL_MS,
  };
}

afterEach(() => vi.useRealTimers());
describe("hourly current-scope admission", () => {
  it("admits once at the elapsed boundary, not before or after clock rollback; reopen/wake does not replay missed hours", () => {
    const state = completed();
    expect(dueAutoSync({ ...state, now: state.now - 1 })).toBeNull();
    expect(dueAutoSync({ ...state, now: start - 1 })).toBeNull();
    const attempt = dueAutoSync(state)!;
    expect(attempt).toMatchObject({
      version: 1,
      scope: state.history.limit,
      lastSuccessAt: success,
    });
    expect(autoSyncAttempt(JSON.stringify(attempt))).toEqual(attempt);
    expect(
      dueAutoSync({
        ...state,
        attempt,
        now: state.now + 20 * AUTO_SYNC_INTERVAL_MS,
      }),
    ).toBeNull();
    expect(
      dueAutoSync({ ...state, now: state.now + 20 * AUTO_SYNC_INTERVAL_MS }),
    ).not.toBeNull();
  });
  it("reconstructs legacy successful history without inventing a timestamp and lets manual success postpone the hour", () => {
    const state = completed();
    expect(
      dueAutoSync({ ...state, sync: { ...state.sync, operation: null } }),
    ).not.toBeNull();
    state.sync.operation.updatedAt = new Date(state.now - 1000).toISOString();
    expect(dueAutoSync(state)).toBeNull();
    state.sync.operation.updatedAt = "invalid";
    expect(dueAutoSync(state)).toBeNull();
  });
  it.each(["running", "failed", "cancelled", "budget-limited"] as const)(
    "never unlocks %s history or retries its current operation",
    (outcome) => {
      const state = completed();
      state.history.outcome = outcome;
      expect(dueAutoSync(state)).toBeNull();
      state.history.outcome = "settled";
      state.sync.operation.outcome = outcome;
      expect(dueAutoSync(state)).toBeNull();
    },
  );
  it("refuses missing history, incompatible scope, recovery, unresolved work, unknown operation and live claim", () => {
    const state = completed();
    expect(dueAutoSync({ ...state, history: null })).toBeNull();
    expect(
      dueAutoSync({ ...state, sync: { ...state.sync, detailsRemaining: 1 } }),
    ).toBeNull();
    expect(
      dueAutoSync({
        ...state,
        sync: { ...state.sync, operationInvalid: true },
      }),
    ).toBeNull();
    for (const historical of [
      { ...state.sync.historical, state: "active" as const },
      { ...state.sync.historical, state: "available" as const },
      { ...state.sync.historical, limit: null },
      { ...state.sync.historical, recovery: "failed" as const },
    ])
      expect(
        dueAutoSync({ ...state, sync: { ...state.sync, historical } }),
      ).toBeNull();
  });
  it.each([
    "",
    "{}",
    "null",
    '{"version":99}',
    '{"version":1,"scope":null,"lastSuccessAt":"bad","attemptedAt":"bad"}',
    '{"version":1,"scope":"2026-02-30","lastSuccessAt":"2026-11-20T12:00:00Z","attemptedAt":"2026-11-20T13:00:00Z"}',
  ])("preserves/refuses unsupported attempt bytes %s", (raw) => {
    expect(() => autoSyncAttempt(raw)).toThrow();
    expect(autoSyncAttempt(null)).toBeNull();
  });
});

describe("owned timer lifetime", () => {
  it("coalesces concurrent ticks and a long operation; shutdown cancels and never reschedules", async () => {
    vi.useFakeTimers();
    autoSyncLifetime().stopping = false;
    let settle!: () => void;
    const signals: AbortSignal[] = [];
    const tick = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => {
        settle = resolve;
      });
    });
    const owner = createAutoSyncSchedule(tick);
    const first = owner.run();
    await owner.run();
    await vi.advanceTimersByTimeAsync(20 * AUTO_SYNC_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
    const signal = signals[0];
    owner.stop();
    expect(signal.aborted).toBe(true);
    expect(autoSyncLifetime().stopping).toBe(true);
    settle();
    await first;
    await vi.advanceTimersByTimeAsync(2 * AUTO_SYNC_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
  });
  it("reevaluates after readiness/wake without immediate transport-error retries", async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => {
      throw new Error("unavailable");
    });
    const owner = createAutoSyncSchedule(tick);
    await owner.run();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    owner.stop();
  });
});
