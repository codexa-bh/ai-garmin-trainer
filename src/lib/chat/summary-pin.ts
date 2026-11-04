import {
  renderSummary,
  type SummaryGenerationStamp,
  type SummaryValue,
} from "../memory/summary-policy";
import type { ConversationCompactionGeneration } from "./conversation-replay";

/** Frozen at creation/adoption, then narrowed once using the qualified counter. */
export type SummaryPin = {
  version: 1;
  stamp: SummaryGenerationStamp;
  value: SummaryValue;
  omitted: number;
  tokens: number | null;
};

export function summaryPinInput(pin: SummaryPin): string {
  return JSON.stringify({
    revision: pin.stamp.revision,
    text: pin.value.text,
  });
}

/** No character/token ratio. Drop whole low-priority items, never negation/lineage. */
export async function projectSummaryPin(
  pin: SummaryPin,
  generation: ConversationCompactionGeneration,
  signal: AbortSignal,
): Promise<SummaryPin> {
  if (pin.tokens !== null) return pin;
  const ordered = [...pin.value.items].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  const candidate = (size: number): SummaryPin => {
    const items = ordered.slice(0, size);
    return {
      ...pin,
      value: { version: 1, items, text: renderSummary(items) },
      omitted: pin.omitted + ordered.length - size,
    };
  };
  const count = (value: SummaryPin) =>
    generation.count(
      [{ role: "user", content: summaryPinInput(value) }],
      signal,
    );
  // At most ten bounded accounting calls for <=256 items. Binary narrowing is
  // conservative even if tokenizer boundaries are not monotonic: only a measured
  // candidate may be published, and maximal packing is not a correctness claim.
  let result = candidate(ordered.length);
  let tokens = await count(result);
  if (!Number.isSafeInteger(tokens) || tokens < 0)
    throw new Error("conversation_token_accounting_invalid");
  if (tokens <= 2048) return { ...result, tokens };
  let low = 0;
  let high = ordered.length - 1;
  result = candidate(0);
  tokens = await count(result);
  if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > 2048)
    throw new Error("conversation_token_accounting_invalid");
  while (low <= high) {
    signal.throwIfAborted();
    const middle = Math.floor((low + high) / 2);
    const next = candidate(middle);
    const measured = await count(next);
    if (!Number.isSafeInteger(measured) || measured < 0)
      throw new Error("conversation_token_accounting_invalid");
    if (measured <= 2048) {
      result = next;
      tokens = measured;
      low = middle + 1;
    } else high = middle - 1;
  }
  return { ...result, tokens };
}
