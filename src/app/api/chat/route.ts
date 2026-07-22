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
  createTrainerMemoryProposal,
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

function safeConversationId(value: string | null | undefined): string {
  const candidate = value?.trim() || DEFAULT_CONVERSATION_ID;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(candidate)) {
    throw new Error(
      "Conversation id must be a local opaque id with letters, numbers, dashes, underscores, dots, or colons only",
    );
  }
  return candidate;
}

type MemoryProposalResult =
  | { status: "none" }
  | { status: "pending"; id: string; value: string }
  | { status: "skipped"; reason: string };

function explicitMemoryText(message: string): string | null {
  const trimmed = message.replace(/\s+/g, " ").trim();
  const match =
    /^(?:please\s+)?(?:can you\s+|could you\s+)?remember(?:\s+that)?[:\s]+(.+)$/i.exec(
      trimmed,
    );
  const value = match?.[1]?.replace(/[.!?]+$/, "").trim();
  return value || null;
}

function unsafeMemoryReason(value: string): string | null {
  const lower = value.toLowerCase();
  if (/\b(password|passcode|api key|secret|token|credential)\b/.test(lower)) {
    return "Credential-like content was not proposed as learned memory.";
  }
  if (/\b(raw fit|fit bytes|connector payload|garmin password)\b/.test(lower)) {
    return "Raw connector, FIT, or Garmin credential details cannot become learned memory.";
  }
  if (
    /\b(diagnos(?:e|is|ed)|prescription|medication dosage|blood pressure|symptom)\b/.test(
      lower,
    )
  ) {
    return "Medical or sensitive health details need an explicit Profile/task flow, not learned memory.";
  }
  return null;
}

function maybeCreateMemoryProposal(
  message: string,
  sourceRef: string,
): MemoryProposalResult {
  const value = explicitMemoryText(message);
  if (!value) return { status: "none" };
  if (value.length > 500) {
    return {
      status: "skipped",
      reason: "Remember request is too long for a learned-memory proposal.",
    };
  }
  const unsafeReason = unsafeMemoryReason(value);
  if (unsafeReason) return { status: "skipped", reason: unsafeReason };
  const proposal = createTrainerMemoryProposal({
    category: "learned_preference",
    value,
    sourceType: "chat_explicit_intent",
    sourceRef,
    provenanceText: `User explicitly asked to remember: ${value}`,
  });
  return { status: "pending", id: proposal.id, value: proposal.value };
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

export async function GET(request: Request) {
  try {
    const conversationId = conversationIdFromRequest(request);
    ensureConversation(conversationId);
    const messages = listRecentChatMessages(conversationId, CHAT_HISTORY_LIMIT);
    return NextResponse.json({
      conversationId,
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
    };
    const conversationId = safeConversationId(body.conversationId);
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
    const memoryProposal = maybeCreateMemoryProposal(
      latestMessage,
      userRecord.id,
    );
    const previousFailure = latestFailedAssistantMessage(previousMessages);
    if (previousFailure && isFailureMetaQuestion(latestMessage)) {
      const assistantRecord = appendChatMessage({
        conversationId,
        role: "assistant",
        content: explainPreviousToolFailure(previousFailure),
        grounding: previousFailure.grounding,
      });
      const messages = listRecentChatMessages(
        conversationId,
        CHAT_HISTORY_LIMIT,
      );

      return NextResponse.json({
        conversationId,
        messages: messages.map(apiMessage),
        assistant: apiMessage(assistantRecord),
        contextWindow: Math.min(messages.length, 10),
        historyLimit: CHAT_HISTORY_LIMIT,
        toolEvidence: previousFailure.grounding,
        toolSteps: [],
        memoryProposal,
      });
    }

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
        selection: step.selection,
      })),
      memoryProposal,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 500 },
    );
  }
}
