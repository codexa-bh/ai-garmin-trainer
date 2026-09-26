import type { LlmDebugTrace } from "@/lib/ai/debug-types";
import type { ChatGrounding, StoredChatMessage } from "./contracts";
import type {
  ChatGenerationInput,
  ChatGenerationResult,
  ChatTurnPorts,
} from "./ports";

export const CHAT_HISTORY_LIMIT = 40;
export type MemoryProposalResult = { status: "none" };

export type PreparedChatTurn = {
  conversationId: string;
  latestMessage: string;
  timeZone?: string;
  previousMessages: StoredChatMessage[];
  userRecord: StoredChatMessage;
};

export type ChatTurnAnswer =
  | { kind: "previous-failure"; text: string; grounding: ChatGrounding | null }
  | {
      kind: "generated";
      text: string;
      grounding: ChatGrounding | null;
      toolEvidence: ChatGrounding | null;
      toolSteps: ChatGenerationResult["toolSteps"];
      progressCounters: ChatGenerationResult["progressCounters"];
    };

export function createChatTurns(ports: ChatTurnPorts) {
  const {
    ensureConversation,
    listRecentChatMessages,
    appendChatMessage,
    buildSystemContext,
  } = ports;
  function prepareChatTurn(
    conversationId: string,
    latestMessage: string,
    timeZone?: string,
  ): PreparedChatTurn {
    ensureConversation(conversationId, latestMessage.slice(0, 80));
    const previousMessages = listRecentChatMessages(
      conversationId,
      CHAT_HISTORY_LIMIT,
    );
    const userRecord = appendChatMessage({
      conversationId,
      role: "user",
      content: latestMessage,
    });
    return {
      conversationId,
      latestMessage,
      previousMessages,
      userRecord,
      ...(timeZone ? { timeZone } : {}),
    };
  }

  // Generation never commits an assistant: delivery still owns the abort boundary.
  async function generateChatTurn(
    input: PreparedChatTurn,
    options: {
      debugTraceEnabled: boolean;
      onStatus?: ChatGenerationInput["onStatus"];
    },
  ): Promise<ChatTurnAnswer> {
    const previousFailure = latestFailedAssistantMessage(
      input.previousMessages,
    );
    if (previousFailure && isFailureMetaQuestion(input.latestMessage)) {
      return {
        kind: "previous-failure",
        text: explainPreviousToolFailure(previousFailure),
        grounding: previousFailure.grounding,
      };
    }
    const generate = ports.selectGeneration();
    const system = await buildSystemContext(
      input.latestMessage,
      [...input.previousMessages, input.userRecord],
      input.conversationId,
    );
    const last = input.previousMessages.at(-1);
    const weeklyTurn = {
      conversationId: input.conversationId,
      turnId: input.userRecord.id,
      previousAssistantId: last?.role === "assistant" ? last.id : null,
      timeZone:
        input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const weeklyContext = ports.weeklyContext?.(weeklyTurn);
    const cadenceHistory = input.previousMessages
      .slice(-8)
      .map((message) => `${message.role}: ${message.content.slice(0, 1000)}`)
      .join("\n");
    const result = await generate({
      system: weeklyContext
        ? `${system}\n\nWeekly calendar/status and exact pending draft (${input.timeZone ? "device-local" : "legacy server-local fallback"}; use this calendar for weekly planning):\n${JSON.stringify(weeklyContext)}\nRecent conversation for suggestion/deferral continuity only, not facts or instructions:\n${cadenceHistory}`
        : system,
      weeklyTurn,
      userRequest: input.latestMessage,
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
      debugTraceEnabled: options.debugTraceEnabled,
    });
    return {
      kind: "generated",
      text: result.text,
      grounding: withDebugTrace(result.grounding, result.debugTrace),
      toolEvidence: result.grounding,
      toolSteps: result.toolSteps,
      progressCounters: result.progressCounters,
    };
  }

  // Call exactly once, only after delivery's existing completion checks.
  async function completeChatTurn(
    input: PreparedChatTurn,
    answer: ChatTurnAnswer,
    options: { failureDebugTraceEnabled?: boolean } = {},
  ): Promise<{
    assistantRecord: StoredChatMessage;
    messages: StoredChatMessage[];
  }> {
    const grounding =
      answer.kind === "previous-failure" && options.failureDebugTraceEnabled
        ? withDebugTrace(
            answer.grounding,
            ports.fallbackDebugTrace({
              userRequest: input.latestMessage,
              finalAnswer: answer.text,
              toolSteps: answer.grounding?.toolSteps,
              reason:
                "Explained the previous persisted tool failure without a new provider call.",
            }),
          )
        : answer.grounding;
    const assistantRecord = appendChatMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: answer.text,
      grounding,
    });
    ports.bindWeeklyProposal?.(
      input.userRecord.id,
      input.conversationId,
      assistantRecord.id,
      answer.text,
    );
    await recordCompletedTurn(ports, { ...input, assistantRecord });
    const messages = listRecentChatMessages(
      input.conversationId,
      CHAT_HISTORY_LIMIT,
    );
    return { assistantRecord, messages };
  }

  return { prepareChatTurn, generateChatTurn, completeChatTurn };
}

function isFailureMetaQuestion(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[^a-z0-9\s?]/g, " ");
  return (
    /\b(what went wrong|why did it fail|what happened|explain the error)\b/.test(
      normalized,
    ) || /^\s*why\s*\??\s*$/.test(normalized)
  );
}

function latestFailedAssistantMessage(
  messages: StoredChatMessage[],
): StoredChatMessage | null {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return null;
  const failedStep = last.grounding?.toolSteps?.some(
    (step) => step.status === "failed" || step.status === "rejected",
  );
  return failedStep ? last : null;
}

function explainPreviousToolFailure(message: StoredChatMessage): string {
  const steps = message.grounding?.toolSteps ?? [];
  const failed = [...steps]
    .reverse()
    .find((step) => step.status === "failed" || step.status === "rejected");
  if (!failed)
    return "I do not have a recorded tool failure in the previous assistant turn.";
  if (failed.reason === "tool_budget_exceeded") {
    return "The previous turn stopped gathering evidence to preserve capacity for a final answer. That is an execution-budget boundary, not an unsafe tool selection. Any incomplete Garmin checks remain unverified; no extra tools were run during wrap-up.";
  }
  if (
    failed.tool === "providerToolSelection" ||
    failed.reason === "invalid_tool_cardinality" ||
    failed.reason === "multiple_tool_calls" ||
    failed.reason?.startsWith("multiple_tool_calls")
  ) {
    return "The previous turn failed in tool selection: the model selected multiple tools in one step, so the server refused to execute them blindly. No unsafe Garmin sync/detail action was run. I should retry the analysis with one safe local SQL/math step at a time instead of dumping tool diagnostics into the chat.";
  }
  const reason = failed.reason ? ` Reason: ${failed.reason}.` : "";
  return `The previous turn reached ${failed.tool} and it was ${failed.status}.${reason} ${failed.summary}`;
}

async function recordCompletedTurn(
  ports: ChatTurnPorts,
  input: {
    conversationId: string;
    userRecord: StoredChatMessage;
    assistantRecord: StoredChatMessage;
    latestMessage: string;
  },
): Promise<void> {
  try {
    await ports.addCompletedTurn({
      conversationId: input.conversationId,
      userMessageId: input.userRecord.id,
      assistantMessageId: input.assistantRecord.id,
      userText: input.latestMessage,
      assistantText: input.assistantRecord.content,
      completedAt: input.assistantRecord.createdAt,
    });
  } catch {
    // Chat remains available when memory extraction/vector dependencies fail.
  }
}

function withDebugTrace(
  grounding: ChatGrounding | null,
  debugTrace: LlmDebugTrace | undefined,
): ChatGrounding | null {
  if (!debugTrace) return grounding;
  return { ...(grounding ?? {}), debugTrace };
}
