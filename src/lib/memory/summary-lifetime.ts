import { SUMMARY_DEBOUNCE_MS } from "./summary-policy";
import type { createSummaryDensify } from "./summary-densify";

// Process-owned cancellation crosses the launcher/compiled Next bundle boundary.
// The launcher alone owns polling; passive status reads never create timers.
type SummaryLifetime = {
  stopping: boolean;
  densify?: ReturnType<typeof createSummaryDensify>;
  active?: AbortController;
  running: boolean;
  inFlight?: Promise<void>;
  wake?: () => void;
};
export function summaryLifetime(): SummaryLifetime {
  const owner = process as typeof process & {
    __trainerSummaryLifetimeV1?: SummaryLifetime;
  };
  return (owner.__trainerSummaryLifetimeV1 ??= {
    stopping: false,
    running: false,
  });
}
// Installed only by the native launcher, never by passive reads or module import.
export function installSummaryWake(wake: () => void): void {
  const lifetime = summaryLifetime();
  if (!lifetime.stopping) lifetime.wake = wake;
}
export function notifySummaryActivity(): void {
  const lifetime = summaryLifetime();
  if (!lifetime.stopping) lifetime.wake?.();
}
/** Native launcher timer owner. A finite tick reports only actionable backlog.
 * Notifications never postpone an earlier wake; arrivals during a job coalesce.
 */
export function createSummarySchedule(tick: () => Promise<boolean>) {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = Infinity;
  let running = false;
  let pendingWake = false;
  const schedule = (delay: number) => {
    const next = performance.now() + delay;
    if (stopping || next >= due) return;
    clearTimeout(timer);
    due = next;
    timer = setTimeout(() => {
      run().catch(() => {
        /* run handles transport failure; no uncertain replay. */
      });
    }, delay);
  };
  const run = async () => {
    if (stopping) return;
    if (running) {
      pendingWake = true;
      return;
    }
    clearTimeout(timer);
    due = Infinity;
    running = true;
    pendingWake = false;
    let backlog = false;
    try {
      backlog = await tick();
    } catch {
      /* Persistent engine status, not timer retries, owns provider recovery. */
    } finally {
      running = false;
      schedule(backlog || pendingWake ? SUMMARY_DEBOUNCE_MS : 30000);
    }
  };
  installSummaryWake(() => {
    if (running) pendingWake = true;
    else schedule(SUMMARY_DEBOUNCE_MS);
  });
  return {
    run,
    stop() {
      stopping = true;
      clearTimeout(timer);
    },
  };
}

export function stopSummaryLifetime(): void {
  const lifetime = summaryLifetime();
  lifetime.stopping = true;
  lifetime.wake = undefined;
  lifetime.active?.abort();
}
