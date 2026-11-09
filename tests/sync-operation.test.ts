import { describe, expect, it } from "vitest";
import {
  syncOperation,
  type SyncOperation,
} from "../src/lib/garmin/sync-policy";

const operation: SyncOperation = {
  version: 1,
  intent: "latest",
  outcome: "budget-limited",
  updatedAt: "2026-11-09T12:00:00Z",
  stopReason: "attempt-limit",
  detailsAttempted: 3,
  detailsProcessed: 2,
  detailsFailed: 1,
  detailsRemaining: 7,
};

describe("additive operation checkpoint compatibility", () => {
  it("leaves legacy absence unknown and round-trips interrupted work without rewriting it", () => {
    expect(syncOperation(null)).toBeNull();
    expect(syncOperation(JSON.stringify(operation))).toEqual(operation);
    expect(
      syncOperation(
        JSON.stringify({ ...operation, outcome: "running", stopReason: null }),
      ),
    ).toMatchObject({ outcome: "running" });
  });
  it.each([
    { version: 99 },
    { detailsRemaining: -1 },
    { detailsProcessed: 4 },
    { detailsAttempted: 1.5 },
    { stopReason: "vendor text" },
    { outcome: "settled" },
    { updatedAt: "bad" },
  ])("refuses unsupported or contradictory state %j", (delta) => {
    expect(() =>
      syncOperation(JSON.stringify({ ...operation, ...delta })),
    ).toThrow("Unsupported sync operation");
  });
});
