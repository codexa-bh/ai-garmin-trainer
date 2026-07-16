import { generateText, UIMessage } from "ai";
import { NextResponse } from "next/server";
import {
  buildTrainerContext,
  formatRecentChatHistory,
  TRAINER_SYSTEM_PROMPT,
} from "@/lib/ai/context";
import { selectedModel } from "@/lib/ai/providers";
import { analyzeStoredActivity } from "@/lib/analytics/activity";
import { requireSessionEmail } from "@/lib/auth/session";
import {
  appendChatMessage,
  clearConversationHistory,
  dataCounts,
  DEFAULT_CONVERSATION_ID,
  ensureConversation,
  getTrainerProfile,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentChatMessages,
  listRecentDailyHealth,
  type ChatGrounding,
  type StoredChatMessage,
} from "@/lib/db/repository";
import type { NormalizedActivity } from "@/lib/garmin/types";

const CHAT_HISTORY_LIMIT = 12;

function explicitGarminId(text: string): string | null {
  return text.match(/\b\d{6,}\b/)?.[0] ?? null;
}

function isActivityAnalysisPrompt(text: string): boolean {
  return /\b(activity|hike|run|ride|workout|result|analyse|analyze|latest|just went|vrh zakotja)\b/i.test(
    text,
  );
}

function isActivityFollowUp(text: string): boolean {
  return /\b(that|it|same|previous|above|follow[- ]?up|tomorrow|next|compare|compared|should i do)\b/i.test(
    text,
  );
}

function resolveActivityId(
  text: string,
  activities: NormalizedActivity[],
  recentMessages: StoredChatMessage[],
): string | null {
  const explicit = explicitGarminId(text);
  if (explicit) return explicit;
  const lower = text.toLowerCase();
  const byName = activities.find(
    (activity) => activity.name && lower.includes(activity.name.toLowerCase()),
  );
  if (byName) return byName.garminId;
  if (isActivityAnalysisPrompt(text)) return activities[0]?.garminId ?? null;
  if (isActivityFollowUp(text)) {
    const lastActivityEvidence = [...recentMessages]
      .reverse()
      .find((message) => message.grounding?.activityId)?.grounding;
    return lastActivityEvidence?.activityId ?? null;
  }
  return null;
}

function fallbackActivityAnswer(
  analysis: ReturnType<typeof analyzeStoredActivity>,
): string {
  const activity = analysis.activity;
  if (!activity)
    return "I could not find that imported activity in local SQLite.";
  const zones = analysis.heartRateZones
    .map((zone) => `Z${zone.zone} ${zone.seconds}s (${zone.percent}%)`)
    .join(", ");
  return [
    `Tool evidence: analyzeActivity (server-side deterministic local analytics).`,
    `Activity: ${activity.name ?? activity.garminId} on ${activity.date}, ${activity.distanceKm ?? "n/a"} km in ${activity.durationMin ?? "n/a"} min, pace ${activity.paceMinPerKm?.toFixed(1) ?? "n/a"} min/km.`,
    `Heart rate: avg ${activity.avgHeartRate ?? "n/a"} bpm, max ${activity.maxHeartRate ?? "n/a"} bpm; zones ${zones || "not available"}.`,
    `Detail: ${analysis.streamSummary.records} normalized records, ${analysis.laps.length} laps; similar efforts ${analysis.similarEfforts.length}.`,
    `Privacy: ${analysis.privacy}`,
  ].join("\n");
}

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

function buildAnalysisGrounding(
  analysis: ReturnType<typeof analyzeStoredActivity>,
): ChatGrounding {
  return {
    tool: "analyzeActivity",
    activityId: analysis.activity?.garminId,
    activityName: analysis.activity?.name ?? null,
    activityDate: analysis.activity?.date ?? null,
    privacy: analysis.privacy,
    summary: analysis.activity
      ? `${analysis.activity.distanceKm ?? "n/a"} km, ${analysis.activity.durationMin ?? "n/a"} min, avg HR ${analysis.activity.avgHeartRate ?? "n/a"}, ${analysis.streamSummary.records} normalized records`
      : "Activity was not found in local SQLite.",
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
  const context = `${buildTrainerContext({
    activities: listRecentActivities(),
    health: listRecentDailyHealth(),
    profile: getTrainerProfile(),
    recentMessages: formatRecentChatHistory(recentMessages, 10),
  })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and ${counts.detailedActivities} locally detailed activities. Recent conversation is bounded to the latest local turns and concise tool evidence only. Use only selected recent facts and explicit tool/local analytics results for detailed claims. Never request or expose Garmin credentials, raw FIT bytes, raw connector payloads, or unbounded full-history/stream dumps.`;
  return `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`;
}

export async function GET() {
  try {
    await requireSessionEmail();
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
      { status: 401 },
    );
  }
}

export async function DELETE() {
  try {
    await requireSessionEmail();
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
      { status: 401 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await requireSessionEmail();
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
    const recentActivities = listRecentActivities();
    const activityId = resolveActivityId(
      latestMessage,
      recentActivities,
      previousMessages,
    );
    const { model } = selectedModel();
    const system = buildSystemContext(messagesForContext);

    let assistantText: string;
    let grounding: ChatGrounding | null = null;

    if (activityId) {
      const analysis = analyzeStoredActivity(activityId);
      grounding = buildAnalysisGrounding(analysis);
      const analysisJson = JSON.stringify(analysis).slice(0, 12000);
      const result = await generateText({
        model,
        system: `${system}\n\nDeterministic local analytics result from analyzeActivity (server-side prefetch; no provider tool loop):\n${analysisJson}\n\nWrite the answer from this analytics JSON and the bounded recent conversation when useful. Mention Tool evidence: analyzeActivity.`,
        prompt: latestMessage,
      });
      assistantText = result.text.trim() || fallbackActivityAnswer(analysis);
      assistantText = `${assistantText}\n\nTool evidence: analyzeActivity (server-side deterministic prefetch)\nPrivacy boundary: ${analysis.privacy}`;
    } else {
      const result = await generateText({
        model,
        system,
        prompt: latestMessage,
      });
      assistantText =
        result.text.trim() ||
        "I could not produce a useful answer from the local context.";
    }

    const assistantRecord = appendChatMessage({
      conversationId,
      role: "assistant",
      content: assistantText,
      grounding,
    });
    const messages = listRecentChatMessages(conversationId, CHAT_HISTORY_LIMIT);

    return NextResponse.json({
      conversationId,
      messages: messages.map(apiMessage),
      assistant: apiMessage(assistantRecord),
      contextWindow: Math.min(messagesForContext.length, 10),
      historyLimit: CHAT_HISTORY_LIMIT,
      toolEvidence: grounding,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 401 },
    );
  }
}
