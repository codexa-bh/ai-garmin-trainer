import type { UIMessage } from "ai";
import { NextResponse } from "next/server";
import { activeTranscriptContext } from "@/lib/chat/context";
import { CHAT_HISTORY_LIMIT } from "@/lib/chat/turn";
import { prepareChatTurn } from "@/lib/chat/composition";
import { conversations } from "@/lib/chat/conversation-composition";
import { safeConversationId } from "@/lib/chat/conversation-policy";
import {
  apiMessage,
  jsonResponse,
  safeChatFailureMessage,
  streamingResponse,
} from "./delivery";

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

function conversationIdFromRequest(request: Request): string {
  const url = new URL(request.url);
  return safeConversationId(url.searchParams.get("conversationId"));
}

export async function GET(request: Request) {
  try {
    const conversationId = conversationIdFromRequest(request);
    const debugTraceEnabled = conversations.isDebugTraceEnabled();
    const messages = conversations.chatHistory(conversationId);
    return NextResponse.json({
      conversationId,
      messages: messages.map((message) =>
        apiMessage(message, debugTraceEnabled),
      ),
      contextWindow: activeTranscriptContext(messages).length,
      historyLimit: CHAT_HISTORY_LIMIT,
      llmDebugTracesEnabled: debugTraceEnabled,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat history failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const conversationId = conversationIdFromRequest(request);
    conversations.clearChatHistory(conversationId);
    return NextResponse.json({
      conversationId,
      messages: [],
      cleared: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "chat clear failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      conversationId?: string;
      message?: string;
      messages?: UIMessage[];
      stream?: boolean;
    };
    const conversationId = safeConversationId(body.conversationId);
    const debugTraceEnabled = conversations.isDebugTraceEnabled();
    const latestMessage = latestRequestMessage(body);
    if (!latestMessage) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    const turn = prepareChatTurn(conversationId, latestMessage);
    if (body.stream === true) {
      return streamingResponse({
        ...turn,
        memoryProposal: { status: "none" },
        requestSignal: request.signal,
        debugTraceEnabled,
      });
    }
    return await jsonResponse(turn, debugTraceEnabled);
  } catch (error) {
    return NextResponse.json(
      { error: safeChatFailureMessage(error) },
      { status: 500 },
    );
  }
}
