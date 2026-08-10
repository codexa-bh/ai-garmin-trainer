import { NextResponse } from "next/server";
import { isLlmDebugTraceEnabled } from "@/lib/env";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listChatMessagePage,
  listConversations,
  renameConversation,
  safeConversationId,
} from "@/lib/db/repository";

const DEFAULT_PAGE_LIMIT = 30;

type RouteContext = {
  params: Promise<{ conversationId: string }> | { conversationId: string };
};

async function paramsFrom(context: RouteContext) {
  return await context.params;
}

function apiMessage(
  message: ReturnType<typeof listChatMessagePage>["messages"][number],
  includeDebugTrace = false,
) {
  const grounding = includeDebugTrace
    ? message.grounding
    : message.grounding?.debugTrace
      ? (() => {
          const visibleGrounding = { ...message.grounding! };
          delete visibleGrounding.debugTrace;
          return Object.keys(visibleGrounding).length ? visibleGrounding : null;
        })()
      : message.grounding;
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    grounding,
    createdAt: message.createdAt.toISOString(),
  };
}

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const { conversationId: rawConversationId } = await paramsFrom(context);
    const conversationId = safeConversationId(rawConversationId);
    const url = new URL(request.url);
    const conversation = getConversation(conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    const debugTraceEnabled = isLlmDebugTraceEnabled();
    const page = listChatMessagePage({
      conversationId,
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_LIMIT),
    });
    return NextResponse.json({
      conversation: conversationSummary(conversation),
      conversationId,
      messages: page.messages.map((message) =>
        apiMessage(message, debugTraceEnabled),
      ),
      nextCursor: page.nextCursor,
      llmDebugTracesEnabled: debugTraceEnabled,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "conversation load failed",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { conversationId: rawConversationId } = await paramsFrom(context);
    const conversationId = safeConversationId(rawConversationId);
    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
    } | null;
    if (typeof body?.title !== "string") {
      return NextResponse.json(
        { error: "Conversation title must be a string" },
        { status: 400 },
      );
    }
    const conversation = renameConversation(conversationId, body.title);
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      conversation: conversationSummary(conversation),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "conversation rename failed";
    const status =
      message.includes("Conversation id") || message.includes("title")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { conversationId: rawConversationId } = await paramsFrom(context);
    const conversationId = safeConversationId(rawConversationId);
    const deleted = deleteConversation(conversationId);
    const remaining = listConversations(1)[0] ?? createConversation();
    return NextResponse.json({
      deleted,
      conversationId,
      nextConversationId: remaining.id,
      conversations: listConversations().map(conversationSummary),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "conversation delete failed",
      },
      { status: 500 },
    );
  }
}
