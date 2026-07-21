import { UIMessage } from "ai";
import { NextResponse } from "next/server";
import {
  buildTrainerContext,
  formatRecentChatHistory,
  TRAINER_SYSTEM_PROMPT,
} from "@/lib/ai/context";
import { orchestrateTrainerChat } from "@/lib/ai/orchestrator";
import { selectedModel } from "@/lib/ai/providers";
import {
  appendChatMessage,
  clearConversationHistory,
  dataCounts,
  DEFAULT_CONVERSATION_ID,
  ensureConversation,
  getGarminAthleteBaseline,
  getTrainerProfile,
  listActivityDetailAvailability,
  listActiveTrainerMemories,
  listRecentActivities,
  listRecentChatMessages,
  listRecentDailyHealth,
  type StoredChatMessage,
} from "@/lib/db/repository";

const CHAT_HISTORY_LIMIT = 12;

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

function apiMessage(message: StoredChatMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    grounding: message.grounding,
    createdAt: message.createdAt.toISOString(),
  };
}

function buildSystemContext(recentMessages: StoredChatMessage[]): string {
  const counts = dataCounts();
  const detailAvailability = listActivityDetailAvailability(12)
    .map(
      (item) =>
        `${item.garminId}: status ${item.status}, records ${item.recordCount}, laps ${item.lapCount}, streams ${item.hasStreams}, GPS ${item.hasGps}, HR ${item.hasHeartRate}, elevation ${item.hasElevation}`,
    )
    .join("\n");
  const coverage = counts.detailCoverage;
  const context = `${buildTrainerContext({
    activities: listRecentActivities(),
    health: listRecentDailyHealth(),
    profile: getTrainerProfile(),
    athleteBaseline: getGarminAthleteBaseline(),
    learnedMemories: listActiveTrainerMemories(),
    recentMessages: formatRecentChatHistory(recentMessages, 10),
  })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and detail coverage ${coverage.terminal}/${coverage.total} terminal (${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable failures). Recent conversation is bounded to the latest local turns and concise tool evidence only. Use only selected recent facts and explicit tool/local analytics results for detailed claims. Pending, expired, rejected, superseded, or deleted learned memories are not included and must not affect the answer. Never describe summary-only analytics as FIT/stream analysis; only claim detailed FIT/stream evidence when an activity has available or partial detail with records/laps. Never request or expose Garmin credentials, raw FIT bytes, raw connector payloads, or unbounded full-history/stream dumps.`;
  return `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`;
}

export async function GET() {
  try {
    ensureConversation();
    const messages = listRecentChatMessages(
      DEFAULT_CONVERSATION_ID,
      CHAT_HISTORY_LIMIT,
    );
    return NextResponse.json({
      conversationId: DEFAULT_CONVERSATION_ID,
      messages: messages.map(apiMessage),
      contextWindow: Math.min(messages.length, 10),
      historyLimit: CHAT_HISTORY_LIMIT,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat history failed" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    clearConversationHistory(DEFAULT_CONVERSATION_ID);
    ensureConversation();
    return NextResponse.json({
      conversationId: DEFAULT_CONVERSATION_ID,
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
    };
    const conversationId =
      body.conversationId?.trim() || DEFAULT_CONVERSATION_ID;
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
    const messagesForContext = [...previousMessages, userRecord];
    const { model } = selectedModel();
    const result = await orchestrateTrainerChat({
      model,
      system: buildSystemContext(messagesForContext),
      userRequest: latestMessage,
    });

    const assistantRecord = appendChatMessage({
      conversationId,
      role: "assistant",
      content: result.text,
      grounding: result.grounding,
    });
    const messages = listRecentChatMessages(conversationId, CHAT_HISTORY_LIMIT);

    return NextResponse.json({
      conversationId,
      messages: messages.map(apiMessage),
      assistant: apiMessage(assistantRecord),
      contextWindow: Math.min(messagesForContext.length, 10),
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
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 500 },
    );
  }
}
