import {
  minimizeSummarySource,
  SUMMARY_SYSTEM,
  validateSummaryReplacement,
  type SummaryStorage,
  type SummaryCandidate,
  type MinimizedSource,
  type SummaryPatchRejection,
  type SummaryValueDiagnostic,
} from "./summary-policy";

export type SummaryGeneration = {
  generate(
    system: string,
    prompt: string,
    signal: AbortSignal,
    format?: "replacement" | "incremental",
  ): Promise<{
    patch: unknown;
    usage: {
      input: number | null;
      output: number | null;
      cached: number | null;
    };
  }>;
};
function boundedGeneration<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("summary_interrupted"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
const ENGINE_FAILURES = new Set([
  "summary_interrupted",
  "summary_configuration_changed",
  "summary_missing_key",
  "summary_budget_unavailable",
  "summary_invalid_output",
  "summary_publication_conflict",
  "summary_input_capacity",
  "summary_impossible_capacity",
  "summary_invalid_unicode",
  "summary_transport_unsupported",
  "summary_invalid_generation_input",
  "summary_model_unselected",
]);
export function createSummaryEngine(ports: {
  storage: SummaryStorage;
  generation: SummaryGeneration | null;
  now(): number;
  identity(): string;
  current(): boolean;
  jitter(): number;
  holdLease?(
    job: NonNullable<ReturnType<SummaryStorage["admit"]>>,
    signal: AbortSignal,
  ): () => void;
}) {
  let running = false;
  return {
    async tick(signal: AbortSignal): Promise<void> {
      if (running || signal.aborted || !ports.current()) return;
      running = true;
      const { storage } = ports;
      let job: ReturnType<SummaryStorage["admit"]> = null;
      let releaseLease: (() => void) | undefined;
      try {
        job = storage.admit(ports.now(), ports.identity());
        if (!job) return;
        releaseLease = ports.holdLease?.(job, signal);
        if (signal.aborted || !ports.current())
          throw new Error("summary_interrupted");
        const inputs: MinimizedSource[] = job.sources.flatMap((source) => {
          const safe = minimizeSummarySource(source);
          return safe ? [safe] : [];
        });
        let candidate: SummaryCandidate | null;
        if (!inputs.length) {
          // No-save/unresolved/Off/deleted events retain explicit dispositions.
          candidate = validateSummaryReplacement(
            { summary: job.previous.text },
            job,
            [],
          );
        } else {
          if (!ports.generation) throw new Error("summary_missing_key");
          if (!storage.reserve(job, ports.now()))
            throw new Error("summary_budget_unavailable");
          // Capacity/refusal cannot shrink/retry a source interval. The size
          // target guides this single draft, never another inference effect.
          const admitted = inputs;
          const prompt = JSON.stringify({
            now: ports.now(),
            targetCharacters: job.cap,
            previous: job.previous.text,
            currentProfile: job.profile ?? null,
            newSources: admitted.map((source) => ({
              user: source.user,
              ...(source.referent ? { assistantContext: source.referent } : {}),
              ...(source.contextLimitation
                ? { contextLimitation: source.contextLimitation }
                : {}),
              createdAt: source.createdAt ?? null,
              ...(source.referent
                ? {
                    assistantContextCreatedAt: source.referentCreatedAt ?? null,
                  }
                : {}),
            })),
            allowance:
              "Generated summary only; manual preferences are composed separately. Return one complete consolidated replacement preserving useful supported prior meaning and new learning. Identical text means no useful change; if unable to safely revise, refuse rather than erase prior state.",
          });
          const output = await boundedGeneration(
            ports.generation.generate(
              SUMMARY_SYSTEM,
              prompt,
              signal,
              "replacement",
            ),
            signal,
          );
          let rejection: SummaryPatchRejection | undefined;
          let diagnostic: SummaryValueDiagnostic | undefined;
          candidate = validateSummaryReplacement(
            output.patch,
            job,
            admitted,
            (code, detail) => {
              rejection = code;
              diagnostic = detail;
            },
          );
          // Account only for the actual request. Never persist the private draft
          // or arbitrary provider error, or manufacture a secondary effect.
          storage.usage(job, output.usage, rejection, diagnostic);
        }
        if (!candidate) throw new Error("summary_invalid_output");
        signal.throwIfAborted();
        if (!ports.current()) throw new Error("summary_configuration_changed");
        if (!storage.publish(job, candidate, ports.now()))
          throw new Error("summary_publication_conflict");
      } catch (error) {
        if (job) {
          const reason = signal.aborted
            ? "summary_interrupted"
            : error instanceof Error && ENGINE_FAILURES.has(error.message)
              ? error.message
              : "summary_provider_failure";
          // Only evidence-backed transient transport failures receive a later attempt.
          const transient =
            !signal.aborted &&
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            [500, 502, 503, 504].includes(Number(error.statusCode));
          storage.fail(
            job,
            reason,
            ports.now(),
            transient
              ? 60000 + Math.min(15000, Math.max(0, ports.jitter()))
              : reason === "summary_publication_conflict"
                ? 300000
                : undefined,
          );
        }
      } finally {
        releaseLease?.();
        running = false;
      }
    },
  };
}
