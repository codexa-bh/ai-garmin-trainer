import type { GarminReader } from "./import-ports";
import type { SnowSplitEvidence } from "./extra-types";
import { historyFailureClass, shiftDate, SyncPause } from "./history-policy";

type Candidate = { garminId: string; startedAt: number };
type SnowBackfillStore = {
  storedSnowActivities(from: string, to: string): Candidate[];
  settled(group: string, ids: string[]): Set<string>;
  readCheckpoint(): string | null;
  commit(work: () => void, checkpoint: string): void;
  upsertSnowSplits(id: string, evidence: SnowSplitEvidence): void;
};
const CONTRACT = "snow-run-lift-backfill-v1";

/** Split-only maintenance: reader/admission/lease/request control stay with existing owners. */
export async function runSnowBackfill(input: {
  store: SnowBackfillStore;
  reader: Pick<GarminReader, "activityPage" | "activityDetail" | "close">;
  startDate: string;
  endDate: string;
  target: string;
  schemaVersion: number;
  cancelled?: () => boolean;
}) {
  const { store, reader } = input;
  const counts = {
    selected: 0,
    skipped: 0,
    processed: 0,
    failed: 0,
    listReads: 0,
    fitReads: 0,
  };
  const result = (
    status: "completed" | "stopped" | "refused",
    reason: string | null,
  ) => ({ status, reason, counts });
  try {
    const validDate = (s: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      s >= "2000-01-01" &&
      shiftDate(s, 0) === s;
    if (
      !validDate(input.startDate) ||
      !validDate(input.endDate) ||
      input.startDate > input.endDate
    )
      return result("refused", "invalid-bounds");
    const candidates = store.storedSnowActivities(
      input.startDate,
      input.endDate,
    );
    counts.selected = candidates.length;
    // Private operational checkpoint only, never analytical or printed. Exact
    // canonical selection comparison avoids a new hashing capability/adapter.
    const selection = JSON.stringify(candidates);
    const binding = {
      contract: CONTRACT,
      target: input.target,
      schemaVersion: input.schemaVersion,
      startDate: input.startDate,
      endDate: input.endDate,
      selection,
    };
    const raw = store.readCheckpoint();
    if (raw !== null) {
      let saved: unknown;
      try {
        saved = JSON.parse(raw);
      } catch {
        return result("refused", "checkpoint-corrupt");
      }
      if (
        !saved ||
        typeof saved !== "object" ||
        Object.keys(binding).some(
          (key) =>
            (saved as Record<string, unknown>)[key] !==
            binding[key as keyof typeof binding],
        )
      )
        return result("refused", "checkpoint-mismatch");
    }
    const checkpoint = JSON.stringify(binding);
    store.commit(() => undefined, checkpoint);
    const settled = store.settled(
      "snow_run_lift_splits",
      candidates.map((c) => c.garminId),
    );
    const checkedDays = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      if (input.cancelled?.()) return result("stopped", "cancelled");
      if (settled.has(candidate.garminId)) {
        counts.skipped++;
        continue;
      }
      const day = new Date(candidate.startedAt).toISOString().slice(0, 10);
      let listed = checkedDays.get(day);
      if (!listed) {
        listed = new Set<string>();
        // UTC/local date padding and finite pagination as in T0352. Listing is
        // account/target admission only; none of its facts are persisted.
        for (let page = 0; page < 20; page++) {
          const reply = await reader.activityPage(
            shiftDate(day, -1),
            shiftDate(day, 1),
            page,
          );
          counts.listReads++;
          for (const item of reply.activities) listed.add(item.garminId);
          if (!reply.hasMore) break;
          if (page === 19)
            return result("refused", "activity-window-too-large");
        }
        checkedDays.set(day, listed);
      }
      // Stronger than a majority heuristic: every subject must reappear before
      // its file read/write. Missing/deleted subjects need explicit reconciliation.
      if (!listed.has(candidate.garminId))
        return result("refused", "account-or-target-mismatch");
      try {
        counts.fitReads++;
        const reply = await reader.activityDetail(candidate.garminId);
        const evidence: SnowSplitEvidence = reply.recognized
          ? (reply.fitExtras?.snowSplits ?? {
              rows: [],
              status: "failed",
              reason: "missing-split-evidence",
            })
          : {
              rows: [],
              status: reply.fitFailure ? "failed" : "unavailable",
              reason: reply.fitFailure ?? "no-original-file",
            };
        store.commit(
          () => store.upsertSnowSplits(candidate.garminId, evidence),
          checkpoint,
        );
        if (evidence.status === "failed") {
          counts.failed++;
          return result("stopped", "incomplete-evidence");
        } else counts.processed++;
      } catch (error) {
        if (
          error instanceof SyncPause ||
          ["auth", "rate-limit"].includes(historyFailureClass(error))
        )
          throw error;
        counts.failed++;
        store.commit(
          () =>
            store.upsertSnowSplits(candidate.garminId, {
              rows: [],
              status: "failed",
              reason: "read-or-store-failed",
            }),
          checkpoint,
        );
        // Preserve original failing subject and stop, no implicit retry storm.
        return result("stopped", "read-or-store-failed");
      }
    }
    return result(
      counts.failed ? "stopped" : "completed",
      counts.failed ? "incomplete-evidence" : null,
    );
  } catch (error) {
    return result(
      "stopped",
      error instanceof SyncPause ? error.reason : historyFailureClass(error),
    );
  } finally {
    reader.close();
  }
}
