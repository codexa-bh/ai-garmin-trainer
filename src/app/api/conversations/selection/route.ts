import { NextResponse } from "next/server";
import { conversations } from "@/lib/chat/conversation-composition";

export function GET() {
  try {
    return NextResponse.json(conversations.resolveSelection());
  } catch {
    return NextResponse.json(
      { error: "Conversation selection could not be loaded. Please retry." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("conversationId" in body)
  ) {
    return NextResponse.json(
      { error: "Expected only conversationId" },
      { status: 400 },
    );
  }
  try {
    const selected = conversations.selectConversation(body.conversationId);
    return selected
      ? NextResponse.json(selected)
      : NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  } catch (error) {
    const invalid =
      error instanceof Error && error.message.startsWith("Conversation id");
    return NextResponse.json(
      {
        error: invalid
          ? "Invalid conversation id"
          : "Conversation selection could not be saved. Please retry.",
      },
      { status: invalid ? 400 : 500 },
    );
  }
}
