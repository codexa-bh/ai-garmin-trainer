import {
  streamText,
  generateText,
  convertToModelMessages,
  isStepCount,
  UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { buildTrainerContext, TRAINER_SYSTEM_PROMPT } from "@/lib/ai/context";
import { selectedModel } from "@/lib/ai/providers";
import { trainerTools } from "@/lib/ai/tools";
import { requireSessionEmail } from "@/lib/auth/session";
import {
  dataCounts,
  getTrainerProfile,
  listActivityDetailAvailability,
  listRecentActivities,
  listRecentDailyHealth,
} from "@/lib/db/repository";

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
    const requiresActivityTool = /\b\d{6,}\b/.test(latestMessage);
    const { model } = selectedModel();
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
      recentMessages: messageTexts,
    })}\n\nDetailed activity availability (local SQLite):\n${detailAvailability || "No detailed activities backfilled yet"}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and ${counts.detailedActivities} locally detailed activities. You have analytics tools available in this request. Use only selected recent facts and explicit tool results for detailed claims. When the user asks about a specific Garmin activity ID, activity name, or activity-specific calculation, you MUST call analyzeActivity before answering; do not say you lack access unless the tool result says the activity/detail is missing. Cite tool outputs by naming the tool and key fields used. Never request or expose Garmin credentials, raw FIT bytes, or unbounded full-history/stream dumps.`;
    const system = `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`;
    const modelMessages = await convertToModelMessages(messages);

    if (requiresActivityTool) {
      const result = await generateText({
        model,
        system,
        messages: modelMessages,
        tools: trainerTools,
        stopWhen: isStepCount(5),
      });
      const toolNames = result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      );
      if (!toolNames.includes("analyzeActivity")) {
        return NextResponse.json(
          {
            error:
              "Activity-specific chat did not call analyzeActivity; retry with a supported provider/model.",
            toolNames,
          },
          { status: 502 },
        );
      }
      return new Response(
        `${result.text}\n\nTool evidence: ${toolNames.join(", ")}`,
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    const result = streamText({
      model,
      system,
      messages: modelMessages,
      tools: trainerTools,
      stopWhen: isStepCount(5),
    });
    return result.toTextStreamResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 401 },
    );
  }
}
