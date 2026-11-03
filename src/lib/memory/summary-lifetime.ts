// Process-owned cancellation crosses the launcher/compiled Next bundle boundary.
// The launcher alone owns polling; passive status reads never create timers.
type SummaryLifetime = {
  stopping: boolean;
  active?: AbortController;
  running: boolean;
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
export function stopSummaryLifetime(): void {
  const lifetime = summaryLifetime();
  lifetime.stopping = true;
  lifetime.active?.abort();
}
