import { validTimeZone } from "@/lib/weekly/calendar";
import type { UIMessage } from "ai";
import { after, NextResponse } from "next/server";
import { activeTranscriptContext } from "@/lib/chat/context";
import { CHAT_HISTORY_LIMIT } from "@/lib/chat/turn";
import {
  prepareChatTurn,
  completeConversationTitle,
} from "@/lib/chat/composition";
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
      timeZone?: string;
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

    if (body.timeZone !== undefined && !validTimeZone(body.timeZone))
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    const turn = prepareChatTurn(conversationId, latestMessage, body.timeZone);
    if (turn.titleAdmitted)
      after(async () => {
        try {
          await completeConversationTitle(turn);
        } catch {
          console.warn(
            "Chat title: background completion failed; excerpt retained.",
          );
        }
      });
    let response: Response;
    if (body.stream === true) {
      response = streamingResponse({
        ...turn,
        memoryProposal: { status: "none" },
        requestSignal: request.signal,
        debugTraceEnabled,
      });
    } else {
      response = await jsonResponse(turn, debugTraceEnabled);
    }
    if (turn.titleAdmitted)
      response.headers.set("x-chat-title-pending", "true");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: safeChatFailureMessage(error) },
      { status: 500 },
    );
  }
}
