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
    const turnContext = {
      currentDate: ports.currentDate?.(),
      previousFailures: previousFailure?.grounding?.toolSteps
        ?.filter((step) => step.status !== "succeeded")
        .map(({ tool, status, reason, summary }) => ({
          tool,
          status,
          reason,
          summary,
        })),
    };
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
      turnContext,
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
