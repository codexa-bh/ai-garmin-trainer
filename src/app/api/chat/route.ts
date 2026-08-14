import { UIMessage } from "ai";
import { NextResponse } from "next/server";
import {
  buildTrainerContext,
  formatActiveChatTranscript,
  TRAINER_SYSTEM_PROMPT,
} from "@/lib/ai/context";
import {
  fallbackLlmDebugTrace,
  type LlmDebugTrace,
} from "@/lib/ai/debug-trace";
import { orchestrateTrainerChat } from "@/lib/ai/orchestrator";
import { selectedModel } from "@/lib/ai/providers";
import { isLlmDebugTraceEnabled } from "@/lib/env";
import {
  appendChatMessage,
  clearConversationHistory,
  dataCounts,
  ensureConversation,
  getGarminAthleteBaseline,
  getGarminBodyMetrics,
  getTrainerProfile,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentChatMessages,
  listRecentDailyHealth,
  trainingPlanStatus,
  safeConversationId,
  type ChatGrounding,
  type StoredChatMessage,
} from "@/lib/db/repository";
import { trainerMemoryStore } from "@/lib/memory/sqlite-adapter";
import { LOCAL_MEMORY_USER_ID, type RetrievedMemory } from "@/lib/memory/types";

const CHAT_HISTORY_LIMIT = 40;
const ACTIVE_TRANSCRIPT_CHAR_BUDGET = 6000;

type MemoryProposalResult = { status: "none" };

function messageText(message: UIMessage): string {
  return String(
    message.parts
      ?.map((part) => (part.type === "text" ? part.text : ""))
      .join(" ") ?? "",
  ).trim();
}

function latestRequestMessage(body: {
  message?: string;
  messages?: UIMessage[];
}): string {
  if (typeof body.message === "string") return body.message.trim();
  return body.messages?.map(messageText).filter(Boolean).at(-1) ?? "";
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

function withDebugTrace(
  grounding: ChatGrounding | null,
  debugTrace: LlmDebugTrace | undefined,
): ChatGrounding | null {
  if (!debugTrace) return grounding;
  return { ...(grounding ?? {}), debugTrace };
}

function apiMessage(message: StoredChatMessage, includeDebugTrace = false) {
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
  | { type: "status"; message: string }
  | { type: "delta"; textDelta: string }
  | { type: "metadata"; grounding: ChatGrounding | null }
  | {
      type: "done";
      assistantMessage: ApiChatMessage;
      conversationId: string;
      contextWindow: number;
      historyLimit: number;
      memoryProposal: MemoryProposalResult;
      llmDebugTracesEnabled?: boolean;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

function streamJsonEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: ChatStreamEvent,
): void {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
}

function visibleDeltas(text: string): string[] {
  const matches = text.match(/\S+\s*/g);
  return matches?.length ? matches : [text];
}

function activeTranscriptContext(messages: StoredChatMessage[]): string[] {
  return formatActiveChatTranscript(messages, ACTIVE_TRANSCRIPT_CHAR_BUDGET);
}

async function recordCompletedTurn(input: {
  conversationId: string;
  userRecord: StoredChatMessage;
  assistantRecord: StoredChatMessage;
  latestMessage: string;
}): Promise<void> {
  try {
    await trainerMemoryStore().addCompletedTurn({
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

function streamingResponse(input: {
  conversationId: string;
  latestMessage: string;
  previousMessages: StoredChatMessage[];
  userRecord: StoredChatMessage;
  memoryProposal: MemoryProposalResult;
  requestSignal: AbortSignal;
  debugTraceEnabled: boolean;
}) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        streamJsonEvent(controller, {
          type: "start",
          conversationId: input.conversationId,
          userMessage: apiMessage(input.userRecord, input.debugTraceEnabled),
        });
        streamJsonEvent(controller, {
          type: "status",
          message:
            "Trainer is preparing a safe final answer from bounded local context.",
        });
        const previousFailure = latestFailedAssistantMessage(
          input.previousMessages,
        );
        let text: string;
        let grounding: ChatGrounding | null;
        let messagesForContext = [...input.previousMessages, input.userRecord];

        if (previousFailure && isFailureMetaQuestion(input.latestMessage)) {
          text = explainPreviousToolFailure(previousFailure);
          grounding = previousFailure.grounding;
        } else {
          const { model, provider, modelName } = selectedModel();
          const result = await orchestrateTrainerChat({
            model,
            system: await buildSystemContext(
              input.latestMessage,
              messagesForContext,
              input.conversationId,
            ),
            userRequest: input.latestMessage,
            debug: {
              enabled: input.debugTraceEnabled,
              provider,
              model: modelName,
            },
          });
          text = result.text;
          grounding = withDebugTrace(result.grounding, result.debugTrace);
          streamJsonEvent(controller, {
            type: "metadata",
            grounding: groundingForApi(grounding, false),
          });
        }

        for (const textDelta of visibleDeltas(text)) {
          if (input.requestSignal.aborted) throw new Error("stream aborted");
          streamJsonEvent(controller, { type: "delta", textDelta });
        }
        if (input.requestSignal.aborted) throw new Error("stream aborted");
        const assistantRecord = appendChatMessage({
          conversationId: input.conversationId,
          role: "assistant",
          content: text,
          grounding,
        });
        await recordCompletedTurn({
          conversationId: input.conversationId,
          userRecord: input.userRecord,
          assistantRecord,
          latestMessage: input.latestMessage,
        });
        const messages = listRecentChatMessages(
          input.conversationId,
          CHAT_HISTORY_LIMIT,
        );
        messagesForContext = messages;
        streamJsonEvent(controller, {
          type: "done",
          assistantMessage: apiMessage(
            assistantRecord,
            input.debugTraceEnabled,
          ),
          conversationId: input.conversationId,
          contextWindow: activeTranscriptContext(messagesForContext).length,
          historyLimit: CHAT_HISTORY_LIMIT,
          memoryProposal: input.memoryProposal,
          llmDebugTracesEnabled: input.debugTraceEnabled,
        });
        controller.close();
      } catch (error) {
        streamJsonEvent(controller, {
          type: "error",
          code: input.requestSignal.aborted ? "aborted" : "chat_failed",
          message:
            error instanceof Error && error.message !== "stream aborted"
              ? error.message
              : "Chat stream stopped before a complete assistant answer was persisted.",
          retryable: true,
        });
        controller.close();
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

function conversationIdFromRequest(request: Request): string {
  const url = new URL(request.url);
  return safeConversationId(url.searchParams.get("conversationId"));
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

async function buildSystemContext(
  latestMessage: string,
  recentMessages: StoredChatMessage[],
  conversationId: string,
): Promise<string> {
  const counts = dataCounts();
  const detailAvailability = listActivityDetailAvailability(12)
    .map(
      (item) =>
        `${item.garminId}: status ${item.status}, records ${item.recordCount}, laps ${item.lapCount}, streams ${item.hasStreams}, GPS ${item.hasGps}, HR ${item.hasHeartRate}, elevation ${item.hasElevation}`,
    )
    .join("\n");
  const coverage = counts.detailCoverage;
  let retrievedMemories: RetrievedMemory[] = [];
  try {
    retrievedMemories = await trainerMemoryStore().search(
      latestMessage,
      { userId: LOCAL_MEMORY_USER_ID, conversationId },
      8,
    );
  } catch {
    retrievedMemories = [];
  }
  const context = `${buildTrainerContext({
    activities: listRecentActivities(),
    health: listRecentDailyHealth(),
    profile: getTrainerProfile(),
    athleteBaseline: getGarminAthleteBaseline(),
    bodyMetrics: getGarminBodyMetrics(),
    retrievedMemories,
    trainingPlan: trainingPlanStatus(),
    currentDate: new Date(),
    recentMessages: activeTranscriptContext(recentMessages),
  })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and detail coverage ${coverage.terminal}/${coverage.total} terminal (${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable failures). Active conversation context is selected from the current chat up to a safe transcript budget; New chat is the reset boundary for this short-term context. Use only selected recent facts and explicit tool/local analytics results for detailed claims. Deleted, expired, disabled, unavailable, or unrelated memories are not included and must not affect the answer. Never describe summary-only analytics as FIT/stream analysis; only claim detailed FIT/stream evidence when an activity has available or partial detail with records/laps. Never request or expose Garmin credentials, raw FIT bytes, raw connector payloads, or unbounded full-history/stream dumps.`;
  return `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`;
}

export async function GET(request: Request) {
  try {
    const conversationId = conversationIdFromRequest(request);
    const debugTraceEnabled = isLlmDebugTraceEnabled();
    ensureConversation(conversationId);
    const messages = listRecentChatMessages(conversationId, CHAT_HISTORY_LIMIT);
    return NextResponse.json({
      conversationId,
      messages: messages.map((message) =>
        apiMessage(message, debugTraceEnabled),
      ),
      contextWindow: activeTranscriptContext(messages).length,
      historyLimit: CHAT_HISTORY_LIMIT,
      llmDebugTracesEnabled: debugTraceEnabled,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat history failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const conversationId = conversationIdFromRequest(request);
    clearConversationHistory(conversationId);
    ensureConversation(conversationId);
    return NextResponse.json({
      conversationId,
      messages: [],
      cleared: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat clear failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      conversationId?: string;
      message?: string;
      messages?: UIMessage[];
      stream?: boolean;
    };
    const conversationId = safeConversationId(body.conversationId);
    const debugTraceEnabled = isLlmDebugTraceEnabled();
    const latestMessage = latestRequestMessage(body);
    if (!latestMessage) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

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
    const memoryProposal: MemoryProposalResult = { status: "none" };
    if (body.stream === true) {
      return streamingResponse({
        conversationId,
        latestMessage,
        previousMessages,
        userRecord,
        memoryProposal,
        requestSignal: request.signal,
        debugTraceEnabled,
      });
    }

    const previousFailure = latestFailedAssistantMessage(previousMessages);
    if (previousFailure && isFailureMetaQuestion(latestMessage)) {
      const text = explainPreviousToolFailure(previousFailure);
      const assistantRecord = appendChatMessage({
        conversationId,
        role: "assistant",
        content: text,
        grounding: withDebugTrace(
          previousFailure.grounding,
          debugTraceEnabled
            ? fallbackLlmDebugTrace({
                userRequest: latestMessage,
                finalAnswer: text,
                toolSteps: previousFailure.grounding?.toolSteps,
                reason:
                  "Explained the previous persisted tool failure without a new provider call.",
              })
            : undefined,
        ),
      });
      await recordCompletedTurn({
        conversationId,
        userRecord,
        assistantRecord,
        latestMessage,
      });
      const messages = listRecentChatMessages(
        conversationId,
        CHAT_HISTORY_LIMIT,
      );

      return NextResponse.json({
        conversationId,
        messages: messages.map((message) =>
          apiMessage(message, debugTraceEnabled),
        ),
        assistant: apiMessage(assistantRecord, debugTraceEnabled),
        contextWindow: activeTranscriptContext(messages).length,
        historyLimit: CHAT_HISTORY_LIMIT,
        toolEvidence: previousFailure.grounding,
        toolSteps: [],
        memoryProposal,
        llmDebugTracesEnabled: debugTraceEnabled,
      });
    }

    const messagesForContext = [...previousMessages, userRecord];
    const { model, provider, modelName } = selectedModel();
    const result = await orchestrateTrainerChat({
      model,
      system: await buildSystemContext(
        latestMessage,
        messagesForContext,
        conversationId,
      ),
      userRequest: latestMessage,
      debug: { enabled: debugTraceEnabled, provider, model: modelName },
    });

    const assistantRecord = appendChatMessage({
      conversationId,
      role: "assistant",
      content: result.text,
      grounding: withDebugTrace(result.grounding, result.debugTrace),
    });
    await recordCompletedTurn({
      conversationId,
      userRecord,
      assistantRecord,
      latestMessage,
    });
    const messages = listRecentChatMessages(conversationId, CHAT_HISTORY_LIMIT);

    return NextResponse.json({
      conversationId,
      messages: messages.map((message) =>
        apiMessage(message, debugTraceEnabled),
      ),
      assistant: apiMessage(assistantRecord, debugTraceEnabled),
      contextWindow: activeTranscriptContext(messagesForContext).length,
      historyLimit: CHAT_HISTORY_LIMIT,
      toolEvidence: result.grounding,
      toolSteps: result.toolSteps.map((step) => ({
        index: step.index,
        tool: step.tool,
        status: step.status,
        summary: step.summary,
        activityIds: step.activityIds,
        privacy: step.privacy,
        reason: step.reason,
        selection: step.selection,
      })),
      memoryProposal,
      llmDebugTracesEnabled: debugTraceEnabled,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 500 },
    );
  }
}
