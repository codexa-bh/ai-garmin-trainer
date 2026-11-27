// The launcher and Next route share one process but have separate bundles.
// Passive imports/reads never install timers or acquire Garmin capabilities.
export function autoSyncLifetime(): { stopping: boolean } {
  const owner = process as typeof process & {
    __trainerAutoSyncLifetimeV1?: { stopping: boolean };
  };
  return (owner.__trainerAutoSyncLifetimeV1 ??= { stopping: false });
}

/** One owned elapsed-time reevaluation; missed hours are never queued/replayed. */
export function createAutoSyncSchedule(
  tick: (signal: AbortSignal) => Promise<void>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  let stopped = false;
  const run = async () => {
    if (stopped || active) return;
    clearTimeout(timer);
    active = new AbortController();
    try {
      await tick(active.signal);
    } catch {
      // Durable settlement/admission owns recovery, not transport retries.
    } finally {
      active = undefined;
      if (!stopped)
        timer = setTimeout(() => {
          run().catch(() => undefined);
        }, 30_000);
    }
  };
  return {
    run,
    stop() {
      stopped = true;
      autoSyncLifetime().stopping = true;
      clearTimeout(timer);
      active?.abort();
    },
  };
}
