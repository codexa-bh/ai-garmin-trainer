import type {
  SummaryGenerationStamp,
  SummaryValue,
} from "../memory/summary-policy";
import { SUMMARY_MODEL_CONTEXT } from "../memory/summary-policy";
import type { ConversationCompactionGeneration } from "./conversation-replay";

/** Frozen at explicit creation/adoption, measured once without silent clipping. */
export type SummaryPin = {
  version: 1;
  stamp: SummaryGenerationStamp;
  value: SummaryValue;
  omitted: number;
  tokens: number | null;
};

export function summaryPinInput(pin: SummaryPin): string {
  return JSON.stringify({ revision: pin.stamp.revision, text: pin.value.text });
}

/** The total serialized chat request owns capacity, not a second memory ceiling.
 * Already measured/sealed old projections stay byte-stable until explicit adoption.
 */
export async function projectSummaryPin(
  pin: SummaryPin,
  generation: ConversationCompactionGeneration,
  signal: AbortSignal,
): Promise<SummaryPin> {
  if (pin.tokens !== null) return pin;
  signal.throwIfAborted();
  const tokens = await new Promise<number>((resolve, reject) => {
    const abort = () =>
      reject(new Error("conversation_token_accounting_interrupted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return generation.count(
          [{ role: "user", content: summaryPinInput(pin) }],
          signal,
        );
      })
      .then(
        (count) => {
          signal.removeEventListener("abort", abort);
          resolve(count);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
  signal.throwIfAborted();
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    tokens > SUMMARY_MODEL_CONTEXT
  )
    throw new Error("conversation_token_accounting_invalid");
  return { ...pin, tokens };
}
