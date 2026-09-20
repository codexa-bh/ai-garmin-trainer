import { NextResponse } from "next/server";
import {
  createConversation,
  listConversations,
  safeConversationId,
} from "@/lib/db/conversation-repository";

function conversationSummary(
  item: ReturnType<typeof listConversations>[number],
) {
  return {
    id: item.id,
    title: item.title,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 40);
    return NextResponse.json({
      conversations: listConversations(limit).map(conversationSummary),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "conversation list failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      title?: string;
    };
    const conversation = createConversation({
      id: body.id ? safeConversationId(body.id) : undefined,
      title: body.title,
    });
    return NextResponse.json({
      conversation: conversationSummary(conversation),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "conversation create failed",
      },
      { status: 400 },
    );
  }
}
