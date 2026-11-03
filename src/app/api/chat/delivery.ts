import { NextResponse } from "next/server";
import type {
  TrainerProgress,
  TrainerProgressCounters,
} from "@/lib/ai/trainer-progress";
import type {
  ChatGrounding,
  StoredChatMessage,
  ConversationContextObservation,
} from "@/lib/chat/contracts";
import { activeTranscriptContext } from "@/lib/chat/context";
import {
  CHAT_HISTORY_LIMIT,
  type PreparedChatTurn,
  type MemoryProposalResult,
  type ChatTurnAnswer,
} from "@/lib/chat/turn";
import { generateChatTurn, completeChatTurn } from "@/lib/chat/composition";
import {
  ConversationInterruptionError,
  conversationInterruption,
} from "@/lib/chat/conversation-replay";

const SAFE_CHAT_FAILURE_MESSAGE =
  "Trainer chat failed before a safe answer was persisted. Run npm run doctor to check local provider readiness, then retry.";

export function safeChatFailureMessage(error: unknown): string {
  if (
    error instanceof ConversationInterruptionError &&
    error.completedActions.length
  )
    return `Conversation context changed and the undelivered answer was interrupted. Completed actions before interruption: ${error.completedActions.join(", ")}. Those effects were not rolled back or replayed; inspect saved state before retrying.`;
  if (
    error instanceof Error &&
    error.message === "conversation_delivery_aborted"
  )
    return "The request ended before a complete assistant answer was committed. The user message is preserved; retry explicitly.";
  if (
    error instanceof Error &&
    error.message === "conversation_context_invalidated"
  )
    return "Conversation context changed during this answer. The undelivered answer was interrupted. Inspect any already saved plan documents before retrying; no save will be replayed automatically.";
  if (
    error instanceof Error &&
    error.message === "conversation_busy_retry_after_current_turn"
  )
    return "This conversation already has an active turn. Wait for it to finish or cancel it, then retry.";
  if (error instanceof Error && error.message === "conversation_text_limit")
    return "This message cannot be stored safely. Use nonempty valid text of at most 12000 UTF-16 units; nothing was silently truncated.";
  if (
    error instanceof Error &&
    /provider|api key|AI_PROVIDER/i.test(error.message)
  )
    return error.message;
  return SAFE_CHAT_FAILURE_MESSAGE;
}

function groundingForApi(
  grounding: ChatGrounding | null,
  includeDebugTrace: boolean,
): ChatGrounding | null {
  if (includeDebugTrace) return grounding;
  if (!grounding?.debugTrace) return grounding;
  const visibleGrounding = { ...grounding };
  delete visibleGrounding.debugTrace;
  return Object.keys(visibleGrounding).length ? visibleGrounding : null;
}

export function apiMessage(
  message: StoredChatMessage,
  includeDebugTrace = false,
) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    grounding: groundingForApi(message.grounding, includeDebugTrace),
    createdAt: message.createdAt.toISOString(),
  };
}

type ApiChatMessage = ReturnType<typeof apiMessage>;

type ChatStreamEvent =
  | { type: "start"; conversationId: string; userMessage: ApiChatMessage }
  | ({ type: "status" } & TrainerProgress)
  | { type: "delta"; textDelta: string }
  | { type: "metadata"; grounding: ChatGrounding | null }
  | {
      type: "done";
      assistantMessage: ApiChatMessage;
      conversationId: string;
      contextWindow: number;
      historyLimit: number;
      memoryProposal: MemoryProposalResult;
      conversationContext?: ConversationContextObservation;
      llmDebugTracesEnabled?: boolean;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

function streamJsonEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: ChatStreamEvent,
): void {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
}

function streamStatus(
  controller: ReadableStreamDefaultController<Uint8Array>,
  message: string,
  counters?: TrainerProgressCounters,
): void {
  streamJsonEvent(controller, {
    type: "status",
    message,
    ...(counters ? { counters } : {}),
  });
}

function visibleDeltas(text: string): string[] {
  const matches = text.match(/\S+\s*/g);
  return matches?.length ? matches : [text];
}

export function streamingResponse(
  input: PreparedChatTurn & {
    memoryProposal: MemoryProposalResult;
    requestSignal: AbortSignal;
    debugTraceEnabled: boolean;
  },
) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer: ChatTurnAnswer | undefined;
      try {
        input.assertCurrent?.();
        streamJsonEvent(controller, {
          type: "start",
          conversationId: input.conversationId,
          userMessage: apiMessage(input.userRecord, input.debugTraceEnabled),
        });
        streamStatus(
          controller,
          "Preparing local data, conversation, and trainer context…",
        );
        let latestCounters: TrainerProgressCounters | undefined;
        answer = await generateChatTurn(input, {
          debugTraceEnabled: input.debugTraceEnabled,
          onStatus: (message, counters) => {
            latestCounters = counters;
            streamStatus(controller, message, counters);
          },
        });
        input.assertCurrent?.();
        if (answer.kind === "generated") {
          latestCounters = answer.progressCounters;
          streamJsonEvent(controller, {
            type: "metadata",
            grounding: groundingForApi(answer.grounding, false),
          });
        }

        streamStatus(
          controller,
          "Formatting the completed response…",
          latestCounters,
        );
        for (const textDelta of visibleDeltas(answer.text)) {
          if (input.requestSignal.aborted) throw new Error("stream aborted");
          input.assertCurrent?.();
          streamJsonEvent(controller, { type: "delta", textDelta });
        }
        if (input.requestSignal.aborted) throw new Error("stream aborted");
        const { assistantRecord, messages } = await completeChatTurn(
          input,
          answer,
        );
        input.assertCurrent?.();
        streamJsonEvent(controller, {
          type: "done",
          assistantMessage: apiMessage(
            assistantRecord,
            input.debugTraceEnabled,
          ),
          conversationId: input.conversationId,
          contextWindow: activeTranscriptContext(messages).length,
          historyLimit: CHAT_HISTORY_LIMIT,
          memoryProposal: input.memoryProposal,
          ...(answer.kind === "generated" && answer.conversationContext
            ? { conversationContext: answer.conversationContext }
            : {}),
          llmDebugTracesEnabled: input.debugTraceEnabled,
        });
        controller.close();
      } catch (error) {
        const failure = conversationInterruption(
          error,
          answer?.kind === "generated" ? answer.toolSteps : [],
        );
        streamJsonEvent(controller, {
          type: "error",
          code: input.requestSignal.aborted ? "aborted" : "chat_failed",
          message:
            error instanceof Error && error.message === "stream aborted"
              ? "Chat stream stopped before a complete assistant answer was persisted."
              : safeChatFailureMessage(failure),
          retryable: true,
        });
        controller.close();
      } finally {
        input.abandon?.();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function jsonResponse(
  input: PreparedChatTurn,
  debugTraceEnabled: boolean,
  requestSignal?: AbortSignal,
) {
  let answer: ChatTurnAnswer | undefined;
  try {
    answer = await generateChatTurn(input, { debugTraceEnabled });
    input.assertCurrent?.();
    if (requestSignal?.aborted)
      throw new Error("conversation_delivery_aborted");
    const { assistantRecord, messages } = await completeChatTurn(
      input,
      answer,
      {
        failureDebugTraceEnabled: debugTraceEnabled,
      },
    );
    const messagesForContext =
      answer.kind === "previous-failure"
        ? messages
        : [...input.previousMessages, input.userRecord];
    input.assertCurrent?.();
    return NextResponse.json({
      conversationId: input.conversationId,
      messages: messages.map((message) =>
        apiMessage(message, debugTraceEnabled),
      ),
      assistant: apiMessage(assistantRecord, debugTraceEnabled),
      contextWindow: activeTranscriptContext(messagesForContext).length,
      historyLimit: CHAT_HISTORY_LIMIT,
      toolEvidence:
        answer.kind === "previous-failure"
          ? answer.grounding
          : answer.toolEvidence,
      toolSteps:
        answer.kind === "previous-failure"
          ? []
          : answer.toolSteps.map((step) => ({
              index: step.index,
              tool: step.tool,
              status: step.status,
              summary: step.summary,
              activityIds: step.activityIds,
              privacy: step.privacy,
              reason: step.reason,
              selection: step.selection,
            })),
      memoryProposal: { status: "none" },
      ...(answer.kind === "generated" && answer.conversationContext
        ? { conversationContext: answer.conversationContext }
        : {}),
      llmDebugTracesEnabled: debugTraceEnabled,
    });
  } catch (error) {
    throw conversationInterruption(
      error,
      answer?.kind === "generated" ? answer.toolSteps : [],
    );
  } finally {
    input.abandon?.();
  }
}
