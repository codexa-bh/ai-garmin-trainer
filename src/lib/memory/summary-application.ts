import {
  emptySummary,
  minimizeSummarySource,
  SUMMARY_SYSTEM,
  validateSummaryPatch,
  type SummaryStorage,
  type SummaryCandidate,
  type MinimizedSource,
  type SummaryPatchRejection,
  type SummaryValueDiagnostic,
  characters,
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
          // Unsafe/Off/deleted events are dispositions, not a fabricated model answer.
          const items = job.previous.items.filter(
            (item) => item.expiresAt === null || item.expiresAt > ports.now(),
          );
          const previous = {
            ...emptySummary(),
            items,
            text: job.previous.text,
          };
          candidate = validateSummaryPatch(
            {
              version: 1,
              keep: items.map((item) => item.id),
              upsert: [],
              remove: job.previous.items
                .filter((item) => !items.includes(item))
                .map((item) => ({ id: item.id, reason: "expired" })),
              coverage: [],
            },
            { ...job, previous: { ...job.previous, text: previous.text } },
            [],
            ports.now(),
          );
        } else {
          if (!ports.generation) throw new Error("summary_missing_key");
          if (!storage.reserve(job, ports.now()))
            throw new Error("summary_budget_unavailable");
          // Exact serialized count can reject a multi-event batch before inference.
          // Reduce only its unconsumed suffix; never skip a single oversized event.
          for (;;) {
            try {
              const admitted = inputs.filter((input) =>
                job!.sources.some(
                  (source) => source.sourceId === input.sourceId,
                ),
              );
              const prompt = JSON.stringify({
                now: ports.now(),
                characterCap: job.cap,
                constraints: {
                  renderedCharacters: characters(job.previous.text),
                  renderFormat:
                    "[stance; category] text, joined with one newline between items",
                  renderedCharacterCap: job.cap,
                  maxItems: 256,
                  maxItemTextScalars: 1200,
                  maxTransitiveSourcesPerItem: 32,
                  idPattern: "^[a-zA-Z0-9_-]{1,80}$",
                  priorityMin: 0,
                  priorityMax: 5,
                  budgetRule:
                    "The cap includes ALL kept and upserted items plus stance/category framing and newlines. Repack related previous items using NEW ids and replaces, or explicitly remove lower-value items before adding. Never merge more than32 inherited/new/context sources into one item; split instead. Do not simply append until full, pad, truncate or discard important rationale. No retry is promised.",
                },
                previous: job.previous.items,
                requiredCoverageSourceIds: admitted.map(
                  (source) => source.sourceId,
                ),
                newSources: admitted,
              });
              const output = await boundedGeneration(
                ports.generation.generate(SUMMARY_SYSTEM, prompt, signal),
                signal,
              );
              let rejection: SummaryPatchRejection | undefined;
              let diagnostic: SummaryValueDiagnostic | undefined;
              candidate = validateSummaryPatch(
                output.patch,
                job,
                admitted,
                ports.now(),
                (code, detail) => {
                  rejection = code;
                  diagnostic = detail;
                },
              );
              // Record actual counters once and only a closed rejection category;
              // never retain the provider patch, source text or arbitrary errors.
              storage.usage(job, output.usage, rejection, diagnostic);
              break;
            } catch (error) {
              if (
                !(error instanceof Error) ||
                error.message !== "summary_input_capacity" ||
                job.sources.length === 1
              )
                throw error;
              job.sources = job.sources.slice(0, -1);
              job.upper = job.sources.at(-1)!.eventSeq;
            }
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
            : error instanceof Error && /^summary_[a-z_]+$/.test(error.message)
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
