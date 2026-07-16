import { streamText, convertToModelMessages, UIMessage } from "ai";
import { NextResponse } from "next/server";
import { buildTrainerContext, TRAINER_SYSTEM_PROMPT } from "@/lib/ai/context";
import { selectedModel } from "@/lib/ai/providers";
import { requireSessionEmail } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    await requireSessionEmail();
    const { messages } = (await request.json()) as { messages: UIMessage[] };
    const { model } = selectedModel();
    const context = buildTrainerContext({
      activities: [],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      recentMessages: messages.map((message) =>
        String(
          message.parts
            ?.map((part) => (part.type === "text" ? part.text : ""))
            .join(" ") ?? "",
        ),
      ),
    });
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
