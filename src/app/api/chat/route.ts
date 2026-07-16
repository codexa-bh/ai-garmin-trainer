import { streamText, convertToModelMessages, UIMessage } from "ai";
import { NextResponse } from "next/server";
import { buildTrainerContext, TRAINER_SYSTEM_PROMPT } from "@/lib/ai/context";
import { selectedModel } from "@/lib/ai/providers";
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
    })}\n\nImported data counts: ${counts.activities} activities and ${counts.healthDays} daily health records. Use only the selected recent facts above for detailed claims; mention when older data may exist but was not selected.`;
    const result = streamText({
      model,
      system: `${TRAINER_SYSTEM_PROMPT}\n\nGrounding context:\n${context}`,
      messages: await convertToModelMessages(messages),
    });
    return result.toTextStreamResponse();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat failed" },
      { status: 401 },
    );
  }
}
