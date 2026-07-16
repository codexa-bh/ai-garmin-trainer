import { streamText, convertToModelMessages, UIMessage } from "ai";
import { NextResponse } from "next/server";
import { buildTrainerContext, TRAINER_SYSTEM_PROMPT } from "@/lib/ai/context";
import { selectedModel } from "@/lib/ai/providers";
import { trainerTools } from "@/lib/ai/tools";
import { requireSessionEmail } from "@/lib/auth/session";
import {
  dataCounts,
  getTrainerProfile,
  listRecentActivities,
  listRecentDailyHealth,
} from "@/lib/db/repository";

export async function POST(request: Request) {
  try {
    await requireSessionEmail();
    const { messages } = (await request.json()) as { messages: UIMessage[] };
    const { model } = selectedModel();
    const counts = dataCounts();
    const context = `${buildTrainerContext({
      activities: listRecentActivities(),
      health: listRecentDailyHealth(),
      profile: getTrainerProfile(),
      recentMessages: messages.map((message) =>
        String(
          message.parts
            ?.map((part) => (part.type === "text" ? part.text : ""))
            .join(" ") ?? "",
        ),
      ),
    })}\n\nImported data counts: ${counts.activities} activities, ${counts.healthDays} daily health records, and ${counts.detailedActivities} locally detailed activities. Use only selected recent facts and explicit tool results for detailed claims; call analyzeActivity for activity-specific calculations when the user identifies an activity. Cite tool outputs by naming the tool and key fields used. Never request or expose Garmin credentials, raw FIT bytes, or unbounded full-history/stream dumps.`;
    const result = streamText({
      model,
      system: `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`,
      messages: await convertToModelMessages(messages),
      tools: trainerTools,
    });
    return result.toTextStreamResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 401 },
    );
  }
}
