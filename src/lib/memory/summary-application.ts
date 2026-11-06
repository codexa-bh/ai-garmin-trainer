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
          // Capacity/refusal cannot shrink/retry a source interval. Only a
          // fully returned size-only rejection permits ONE known-draft rewrite.
          const admitted = inputs;
          const prompt = JSON.stringify({
            now: ports.now(),
            characterCap: job.cap,
            // Headroom is drafting advice, not a second enforced limit. Real
            // Luna overshot a6000-scalar cap at6904 without an explicit target.
            softTargetCharacters: Math.floor(job.cap * 0.6),
            previous: job.previous.text,
            newSources: admitted.map((source) => ({
              user: source.user,
              ...(source.referent ? { assistantContext: source.referent } : {}),
              ...(source.original
                ? { createdAt: source.original.createdAt }
                : {}),
            })),
            allowance:
              "Generated summary only; manual preferences are composed separately. Return one complete replacement, not an appended fragment.",
          });
          const output = await boundedGeneration(
            ports.generation.generate(
              `${SUMMARY_SYSTEM}\nHard limit: ${job.cap} Unicode characters INCLUDING spaces/punctuation for the ENTIRE summary. Aim for about ${Math.floor(job.cap / 12)} words total where the language has word boundaries; this is soft drafting advice, not another hard limit. Finish every sentence and the final thought. Repack redundant detail rather than growing to the character ceiling.`,
              prompt,
              signal,
            ),
            signal,
          );
          const batch = job;
          const validate = (
            result: Awaited<ReturnType<SummaryGeneration["generate"]>>,
            effect?: "condense",
          ) => {
            let rejection: SummaryPatchRejection | undefined;
            let diagnostic: SummaryValueDiagnostic | undefined;
            const value = validateSummaryReplacement(
              result.patch,
              batch,
              admitted,
              (code, detail) => {
                rejection = code;
                diagnostic = detail;
              },
            );
            // Each actual request has its own durable admission and counters.
            // Never persist the private draft or arbitrary provider error.
            storage.usage(batch, result.usage, rejection, diagnostic, effect);
            return { value, diagnostic };
          };
          const first = validate(output);
          candidate = first.value;
          if (!candidate && first.diagnostic?.invariant === "character-cap") {
            signal.throwIfAborted();
            if (!ports.current())
              throw new Error("summary_configuration_changed");
            if (!storage.reserve(batch, ports.now(), "condense"))
              throw new Error("summary_budget_unavailable");
            const condensed = await boundedGeneration(
              ports.generation.generate(
                `${SUMMARY_SYSTEM}\nThis request ONLY condenses the supplied fully returned oversized draft. No new sources or facts. Rewrite it MUCH more concisely, aiming for about ${Math.floor(batch.cap / 18)} words where applicable, comfortably below ${batch.cap} Unicode characters INCLUDING spaces. Preserve important meaning, rationale, negation, uncertainty and temporal scope. Finish every word and thought naturally; NEVER fill the ceiling, slice a prefix or emit an unfinished fragment. Return strict JSON with only summary.`,
                JSON.stringify({
                  characterCap: batch.cap,
                  softTargetCharacters: Math.floor(batch.cap * 0.5),
                  actualCharacters: first.diagnostic.actual,
                  draft: (output.patch as { summary: string }).summary,
                }),
                signal,
              ),
              signal,
            );
            candidate = validate(condensed, "condense").value;
          }
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
