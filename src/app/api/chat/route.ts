import {
  streamText,
  generateText,
  convertToModelMessages,
  UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { buildTrainerContext, TRAINER_SYSTEM_PROMPT } from "@/lib/ai/context";
import { selectedModel } from "@/lib/ai/providers";
import { analyzeStoredActivity } from "@/lib/analytics/activity";
import { requireSessionEmail } from "@/lib/auth/session";
import {
  dataCounts,
  getTrainerProfile,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentDailyHealth,
} from "@/lib/db/repository";
import type { NormalizedActivity } from "@/lib/garmin/types";

function explicitGarminId(text: string): string | null {
  return text.match(/\b\d{6,}\b/)?.[0] ?? null;
}

function isActivityAnalysisPrompt(text: string): boolean {
  return /\b(activity|hike|run|ride|workout|result|analyse|analyze|latest|just went|vrh zakotja)\b/i.test(
    text,
  );
}

function resolveActivityId(
  text: string,
  activities: NormalizedActivity[],
): string | null {
  const explicit = explicitGarminId(text);
  if (explicit) return explicit;
  const lower = text.toLowerCase();
  const byName = activities.find(
    (activity) => activity.name && lower.includes(activity.name.toLowerCase()),
  );
  if (byName) return byName.garminId;
  return isActivityAnalysisPrompt(text)
    ? (activities[0]?.garminId ?? null)
    : null;
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

export async function POST(request: Request) {
  try {
    await requireSessionEmail();
    const { messages } = (await request.json()) as { messages: UIMessage[] };
    const messageTexts = messages.map((message) =>
      String(
        message.parts
          ?.map((part) => (part.type === "text" ? part.text : ""))
          .join(" ") ?? "",
      ),
    );
    const latestMessage = messageTexts.at(-1) ?? "";
    const recentActivities = listRecentActivities();
    const activityId = resolveActivityId(latestMessage, recentActivities);
    const { model } = selectedModel();
    const counts = dataCounts();
    const detailAvailability = listActivityDetailAvailability(12)
      .map(
        (item) =>
          `${item.garminId}: status ${item.status}, records ${item.recordCount}, laps ${item.lapCount}, streams ${item.hasStreams}, GPS ${item.hasGps}, HR ${item.hasHeartRate}, elevation ${item.hasElevation}`,
      )
      .join("\n");
    const context = `${buildTrainerContext({
      activities: recentActivities,
      health: listRecentDailyHealth(),
      profile: getTrainerProfile(),
      recentMessages: messageTexts,
    })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and ${counts.detailedActivities} locally detailed activities. You have analytics tools available in this request. Use only selected recent facts and explicit tool results for detailed claims. When the user asks about a specific Garmin activity ID, activity name, or activity-specific calculation, you MUST call analyzeActivity before answering; do not say you lack access unless the tool result says the activity/detail is missing. Cite tool outputs by naming the tool and key fields used. Never request or expose Garmin credentials, raw FIT bytes, or unbounded full-history/stream dumps.`;
    const system = `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`;
    const modelMessages = await convertToModelMessages(messages);

    if (activityId) {
      const analysis = analyzeStoredActivity(activityId);
      const analysisJson = JSON.stringify(analysis).slice(0, 12000);
      const result = await generateText({
        model,
        system: `${system}\n\nDeterministic local analytics result from analyzeActivity (server-side prefetch; no provider tool loop):\n${analysisJson}\n\nWrite the answer from this analytics JSON. Mention Tool evidence: analyzeActivity.`,
        prompt: latestMessage,
      });
      const text = result.text.trim() || fallbackActivityAnswer(analysis);
      return new Response(
        `${text}\n\nTool evidence: analyzeActivity (server-side deterministic prefetch)\nPrivacy boundary: ${analysis.privacy}`,
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    const result = streamText({
      model,
      system,
      messages: modelMessages,
    });
    return result.toTextStreamResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 401 },
    );
  }
}
