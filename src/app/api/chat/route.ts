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
  activityDetailCoverage,
  appendChatMessage,
  clearConversationHistory,
  dataCounts,
  DEFAULT_CONVERSATION_ID,
  ensureConversation,
  getActivityByGarminId,
  getTrainerProfile,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentChatMessages,
  listRecentDailyHealth,
  type ChatGrounding,
  type StoredChatMessage,
} from "@/lib/db/repository";
import { backfillActivityDetail, runGarminSync } from "@/lib/garmin/importer";
import type { NormalizedActivity } from "@/lib/garmin/types";

const CHAT_HISTORY_LIMIT = 12;

function explicitGarminIds(text: string): string[] {
  return [...new Set(text.match(/\b\d{6,}\b/g) ?? [])];
}

function explicitGarminId(text: string): string | null {
  return explicitGarminIds(text)[0] ?? null;
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

function wantsSyncAction(text: string): boolean {
  return /\b(sync|synchroni[sz]e|import garmin|refresh garmin)\b/i.test(text);
}

function wantsSyncStatus(text: string): boolean {
  return /\b(sync status|detail coverage|coverage status|what.*synced|what.*imported)\b/i.test(
    text,
  );
}

function wantsDetailRefresh(text: string): boolean {
  return /\b(refresh|force refresh|backfill|fetch detail|detail refresh)\b/i.test(
    text,
  );
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
      ? `${analysis.activity.distanceKm ?? "n/a"} km, ${analysis.activity.durationMin ?? "n/a"} min, avg HR ${analysis.activity.avgHeartRate ?? "n/a"}, detail status ${analysis.availability?.status ?? "not_requested"}, ${analysis.streamSummary.records} normalized records`
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
  const coverage = counts.detailCoverage;
  const context = `${buildTrainerContext({
    activities: listRecentActivities(),
    health: listRecentDailyHealth(),
    profile: getTrainerProfile(),
    recentMessages: formatRecentChatHistory(recentMessages, 10),
  })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and detail coverage ${coverage.terminal}/${coverage.total} terminal (${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable failures). Recent conversation is bounded to the latest local turns and concise tool evidence only. Use only selected recent facts and explicit tool/local analytics results for detailed claims. Never describe summary-only analytics as FIT/stream analysis; only claim detailed FIT/stream evidence when an activity has available or partial detail with records/laps. Never request or expose Garmin credentials, raw FIT bytes, raw connector payloads, or unbounded full-history/stream dumps.`;
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
    const explicitIds = explicitGarminIds(latestMessage);

    if (wantsDetailRefresh(latestMessage) && explicitIds.length > 0) {
      const garminId = explicitIds[0];
      const activity = getActivityByGarminId(garminId);
      const result = activity
        ? await backfillActivityDetail(garminId, { force: true })
        : null;
      const coverage = activityDetailCoverage();
      const assistantText = activity
        ? [
            `Forced local detail refresh for Garmin activity ${garminId}: ${result?.status ?? "failed"}, detail status ${result?.detailStatus ?? "failed"}.`,
            `Records ${result?.recordCount ?? 0}; laps ${result?.lapCount ?? 0}; retryable ${result?.retryable ? "yes" : "no"}; preserved previous usable detail ${result?.preservedPrevious ? "yes" : "no"}.`,
            result?.detail ?? "No connector detail returned.",
            `Coverage now ${coverage.terminal}/${coverage.total} terminal; ${coverage.pending} pending; ${coverage.retryableFailures} retryable failures.`,
            "Tool evidence: forceRefreshActivityDetail (server-side bounded action).",
            "Privacy boundary: read-only Garmin connector call; raw FIT/connector payload and credentials were not sent to the model or retained.",
          ].join("\n")
        : `No imported local activity with Garmin ID ${garminId}. Run sync first or check the ID. Tool evidence: forceRefreshActivityDetail rejected unknown ID.`;
      const grounding: ChatGrounding = {
        tool: "forceRefreshActivityDetail",
        activityId: garminId,
        activityName: activity?.name ?? null,
        activityDate: activity?.startedAt.toISOString().slice(0, 10) ?? null,
        privacy:
          "Server-side bounded action used normalized local data and discarded raw connector payloads.",
        summary: assistantText.slice(0, 500),
      };
      const assistantRecord = appendChatMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        grounding,
      });
      const messages = listRecentChatMessages(
        conversationId,
        CHAT_HISTORY_LIMIT,
      );
      return NextResponse.json({
        conversationId,
        messages: messages.map(apiMessage),
        assistant: apiMessage(assistantRecord),
        contextWindow: Math.min(messagesForContext.length, 10),
        historyLimit: CHAT_HISTORY_LIMIT,
        toolEvidence: grounding,
      });
    }

    if (wantsSyncStatus(latestMessage)) {
      const coverage = activityDetailCoverage();
      const counts = dataCounts();
      const assistantText = `Local Garmin status: ${counts.activities} activity summaries, ${counts.healthDays} health days, detail coverage ${coverage.terminal}/${coverage.total} terminal (${coverage.available} available, ${coverage.partial} partial, ${coverage.unsupported} unsupported, ${coverage.pending} pending, ${coverage.retryableFailures} retryable failures, ${coverage.preservedFailures} preserved failed refreshes). Tool evidence: syncStatus.`;
      const grounding: ChatGrounding = {
        tool: "syncStatus",
        privacy: "Read from local normalized SQLite only.",
        summary: assistantText,
      };
      const assistantRecord = appendChatMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        grounding,
      });
      const messages = listRecentChatMessages(
        conversationId,
        CHAT_HISTORY_LIMIT,
      );
      return NextResponse.json({
        conversationId,
        messages: messages.map(apiMessage),
        assistant: apiMessage(assistantRecord),
        contextWindow: Math.min(messagesForContext.length, 10),
        historyLimit: CHAT_HISTORY_LIMIT,
        toolEvidence: grounding,
      });
    }

    if (wantsSyncAction(latestMessage)) {
      const result = await runGarminSync();
      const assistantText = `${result.status === "completed" ? "Garmin sync completed" : "Garmin sync failed"}: ${result.detail} Tool evidence: runGarminSync. Privacy boundary: read-only stdio connector, normalized SQLite writes only, no Garmin write-back.`;
      const grounding: ChatGrounding = {
        tool: "runGarminSync",
        privacy:
          "Read-only Garmin MCP stdio connector and app-owned normalized SQLite writes only.",
        summary: assistantText.slice(0, 500),
      };
      const assistantRecord = appendChatMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        grounding,
      });
      const messages = listRecentChatMessages(
        conversationId,
        CHAT_HISTORY_LIMIT,
      );
      return NextResponse.json({
        conversationId,
        messages: messages.map(apiMessage),
        assistant: apiMessage(assistantRecord),
        contextWindow: Math.min(messagesForContext.length, 10),
        historyLimit: CHAT_HISTORY_LIMIT,
        toolEvidence: grounding,
      });
    }

    const activityId = resolveActivityId(
      latestMessage,
      recentActivities,
      previousMessages,
    );
    const activityIds =
      explicitIds.length > 1 ? explicitIds : activityId ? [activityId] : [];
    const { model } = selectedModel();
    const system = buildSystemContext(messagesForContext);

    let assistantText: string;
    let grounding: ChatGrounding | null = null;

    if (activityIds.length) {
      const analyses = activityIds.map((id) => analyzeStoredActivity(id));
      grounding =
        analyses.length === 1
          ? buildAnalysisGrounding(analyses[0])
          : {
              tool: "analyzeActivity",
              privacy:
                "Computed from local normalized SQLite summaries/detail only; raw FIT and credentials were not sent to the model.",
              summary: analyses
                .map(
                  (analysis) =>
                    `${analysis.activity?.garminId ?? "unknown"}: ${analysis.activity ? `detail ${analysis.availability?.status ?? "not_requested"}, records ${analysis.streamSummary.records}` : "not found locally"}`,
                )
                .join("; "),
            };
      const analysisJson = JSON.stringify(analyses).slice(0, 16000);
      const result = await generateText({
        model,
        system: `${system}\n\nDeterministic local analytics results from analyzeActivity for every explicit requested activity ID (server-side prefetch; no provider tool loop):\n${analysisJson}\n\nWrite the answer from this analytics JSON and the bounded recent conversation when useful. Address every requested ID separately. If an activity has only a summary or no stream records, say so and do not describe it as detailed FIT/stream analysis. Mention Tool evidence: analyzeActivity.`,
        prompt: latestMessage,
      });
      assistantText =
        result.text.trim() ||
        analyses
          .map((analysis) => fallbackActivityAnswer(analysis))
          .join("\n\n");
      assistantText = `${assistantText}\n\nTool evidence: analyzeActivity (server-side deterministic prefetch for ${activityIds.join(", ")})\nPrivacy boundary: ${analyses[0].privacy}`;
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
