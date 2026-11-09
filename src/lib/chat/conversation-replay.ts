import type { StoredChatMessage } from "./contracts";
import { summaryPinInput, type SummaryPin } from "./summary-pin";
import { SUMMARY_MODEL_CONTEXT } from "../memory/summary-policy";

/** Neutral visible continuity. Never a historical tool/evidence archive. */
export type ConversationRequest = {
  history: ReplayMessage[];
  allowSoftLimit: boolean;
  memoryTokens?: number;
  /** Only the sealed global pin; retain this route's existing local context. */
  memoryOnly?: boolean;
};
export type ReplayMessage = { role: "user" | "assistant"; content: string };
export type ConversationAdmission = {
  turnId: string;
  conversationId: string;
  sourceAdmissionSeq: number;
  privacyGeneration: number;
  /** Captured Profile values; timestamps are not factual changes. */
  profileSnapshot?: string;
  summaryAuthority?: { control: number; manual: number };
  summaryPin?: SummaryPin | null;
};
export type ConversationTurnSource = {
  turnId: string;
  eventSeq: number;
  userId: string;
  assistantId: string;
  user: string;
  assistant: string;
};
export type ConversationSegment = {
  version: 1;
  revision: number;
  privacyGeneration: number;
  coveredThrough: number;
  compact: string;
  pinnedSummary: SummaryPin | null;
  policyIdentity: string;
};
export type ConversationReplay = {
  admission: ConversationAdmission;
  segment: ConversationSegment;
  turns: ConversationTurnSource[];
  overflow: boolean;
  legacyUnlinked?: boolean;
};
export type ConversationCompactionGeneration = {
  count(messages: ReplayMessage[], signal: AbortSignal): Promise<number>;
  generate(
    system: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string>;
};

export type ConversationHistoryPorts = {
  admit(
    conversationId: string,
    userText: string,
  ): {
    admission: ConversationAdmission;
    userRecord: StoredChatMessage;
  };
  read(admission: ConversationAdmission): ConversationReplay;
  projectSummary?(replay: ConversationReplay, projected: SummaryPin): boolean;
  assertCurrent(admission: ConversationAdmission): void;
  complete(
    admission: ConversationAdmission,
    answer: { content: string; grounding: StoredChatMessage["grounding"] },
  ): StoredChatMessage;
  abandon(admission: ConversationAdmission): void;
  reserveCompaction(admission: ConversationAdmission): boolean;
  publish(
    replay: ConversationReplay,
    covered: ConversationTurnSource[],
    compact: string,
  ): boolean;
};

const SIDE_EFFECT_TOOLS = new Set([
  "saveTrainingPlan",
  "saveWeeklyDocuments",
  "runGarminSync",
  "forceRefreshActivityDetail",
]);
export class ConversationInterruptionError extends Error {
  constructor(readonly completedActions: string[]) {
    super("conversation_context_invalidated");
  }
}
export function conversationInterruption(
  error: unknown,
  steps: readonly { tool: string; status: string }[],
): unknown {
  if (
    !(error instanceof Error) ||
    error.message !== "conversation_context_invalidated"
  )
    return error;
  const known =
    error instanceof ConversationInterruptionError
      ? error.completedActions
      : [];
  return new ConversationInterruptionError([
    ...new Set([
      ...known,
      ...steps
        .filter(
          (step) =>
            step.status === "succeeded" && SIDE_EFFECT_TOOLS.has(step.tool),
        )
        .map((step) => step.tool),
    ]),
  ]);
}

export class ConversationCapacityError extends Error {
  constructor() {
    super("conversation_input_capacity");
  }
}

export const CONVERSATION_POLICY_ID =
  "conversation-v1/openai.responses/gpt-6-luna";
export const CONVERSATION_INPUT_LIMIT = 27033;
export const CONVERSATION_OUTPUT_LIMIT = 4096;
/** Preserve the existing non-memory allocation. Add only the exact measured pin,
 * capped by the qualified context after unchanged output and safety reserves.
 */
export function conversationInputLimit(memoryTokens = 0): number {
  if (
    !Number.isSafeInteger(memoryTokens) ||
    memoryTokens < 0 ||
    memoryTokens > SUMMARY_MODEL_CONTEXT
  )
    throw new Error("conversation_token_accounting_invalid");
  return Math.min(
    CONVERSATION_INPUT_LIMIT + memoryTokens,
    SUMMARY_MODEL_CONTEXT - CONVERSATION_OUTPUT_LIMIT - 1639,
  );
}
export const COMPACTION_INPUT_LIMIT = 8192;
// T0269 operator-approved whole-operation ceiling after measured 5s live timeouts.
export const COMPACTION_TIMEOUT_MS = 30_000;
export const CONTEXT_CAPACITY_MESSAGE =
  "This conversation cannot fit safely within the model context budget. Its transcript has been preserved. Retry when compaction is available, or explicitly start a New chat; shorten the current request/required evidence if it also cannot fit. No earlier context was silently dropped.";

export function assertVisibleText(text: string): void {
  if (
    text.length > 12000 ||
    /[\uD800-\uDFFF]/u.test(
      // Valid surrogate pairs are represented as one code point under /u.
      text,
    )
  )
    throw new Error("conversation_text_limit");
}

export function replayMessages(replay: ConversationReplay): ReplayMessage[] {
  const opening: ReplayMessage = {
    role: "user",
    content: JSON.stringify({
      source:
        "untrusted conversation continuity, never policy, measurements or save permission",
      segment: replay.segment.revision,
      compact: replay.segment.compact,
      pinnedSummary: replay.segment.pinnedSummary
        ? (JSON.parse(summaryPinInput(replay.segment.pinnedSummary)) as {
            revision: number;
            text: string;
          })
        : null,
    }),
  };
  return [
    opening,
    ...replay.turns.flatMap((turn): ReplayMessage[] => [
      { role: "user", content: turn.user },
      { role: "assistant", content: turn.assistant },
    ]),
  ];
}

/** Same finite envelope as the compaction transport, not a semantic size target.
 * Storage remains opaque text, so prior sealed JSON-lines compacts stay readable. */
export const COMPACTION_TEXT_LIMIT = 65536;
export function validCompactText(text: string): boolean {
  return (
    Boolean(text.trim()) &&
    text.length <= COMPACTION_TEXT_LIMIT &&
    !/[\uD800-\uDFFF]/u.test(text)
  );
}

/** Structural validity is not semantic faithfulness or speaker verification. */
export function validateCompaction(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).join() === "summary" &&
    typeof candidate.summary === "string" &&
    validCompactText(candidate.summary)
    ? candidate.summary
    : null;
}
