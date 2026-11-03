import type { StoredChatMessage } from "./contracts";
import { unsafeMemoryReason } from "../memory/filters";

/** Neutral visible continuity. Never a historical tool/evidence archive. */
export type ConversationRequest = {
  history: ReplayMessage[];
  allowSoftLimit: boolean;
};
export type ReplayMessage = { role: "user" | "assistant"; content: string };
export type ConversationAdmission = {
  turnId: string;
  conversationId: string;
  sourceAdmissionSeq: number;
  privacyGeneration: number;
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
  // Explicit absent-producer seam, not a requirement to construct global memory.
  pinnedSummary: null;
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
export const COMPACTION_INPUT_LIMIT = 8192;
export const COMPACTION_OUTPUT_LIMIT = 2048;
export const COMPACTION_TIMEOUT_MS = 5000;
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
      pinnedSummary: replay.segment.pinnedSummary,
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

export function unsafeCompactionSource(text: string): boolean {
  // A generic, explicit denial of medical causation (M09) is not a diagnosis.
  // Remove only that generic denial for screening; other sensitive clauses and
  // named/positive diagnostic statements still fail closed. The visible source
  // remains unchanged, and compact output has no such screening exception.
  const screened = text.replace(
    /\bnot (?:for|because of|due to) (?:a |any )?(?:diagnosed|medical) condition\b/gi,
    "",
  );
  return Boolean(unsafeMemoryReason(screened)) || /\bsk-[a-z0-9-]+/i.test(text);
}

/** Closed, source-bound output; structural validity is not semantic faithfulness. */
export function validateCompaction(
  value: unknown,
  sources: ConversationTurnSource[],
  previous: string,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join() !== "items,version" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.items) ||
    !candidate.items.length ||
    candidate.items.length > 32
  )
    return null;
  const allowed = new Set(sources.map((source) => source.turnId));
  if (previous) allowed.add("previous-compaction");
  const covered = new Set<string>();
  const lines: string[] = [];
  for (const raw of candidate.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (
      Object.keys(item).sort().join() !== "sourceTurnIds,speaker,text" ||
      !["user", "assistant"].includes(String(item.speaker)) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.length > 1200 ||
      /[\uD800-\uDFFF]/u.test(item.text) ||
      !Array.isArray(item.sourceTurnIds) ||
      !item.sourceTurnIds.length ||
      item.sourceTurnIds.length > 32
    )
      return null;
    // Same-chat compaction is not permission to persist credentials/medical/raw evidence.
    if (
      unsafeMemoryReason(item.text) ||
      /(?:sk-[a-z0-9-]+|api[_ -]?key|password|diagnos|treatment|raw[_ -]?(?:fit|payload)|gps|latitude|longitude|ignore (?:all|previous) (?:rules|instructions))/i.test(
        item.text,
      )
    )
      return null;
    for (const id of item.sourceTurnIds) {
      if (typeof id !== "string" || !allowed.has(id)) return null;
      covered.add(id);
    }
    lines.push(
      JSON.stringify({
        speaker: item.speaker,
        text: item.text,
        sourceTurnIds: item.sourceTurnIds,
      }),
    );
  }
  if ([...allowed].some((id) => !covered.has(id))) return null;
  const text = lines.join("\n");
  return text.length <= 6000 ? text : null;
}
