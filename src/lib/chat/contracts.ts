import type { LlmDebugTrace } from "@/lib/ai/debug-types";

export type ChatRole = "user" | "assistant";

export type ChatGrounding = {
  debugTrace?: LlmDebugTrace;
  tool?: string;
  activityId?: string;
  activityName?: string | null;
  activityDate?: string | null;
  privacy?: string;
  summary?: string;
  toolSteps?: Array<{
    index: number;
    tool: string;
    status: "succeeded" | "rejected" | "failed";
    summary: string;
    activityIds?: string[];
    privacy: string;
    reason?: string;
    selection?: {
      reason: "multiple_tool_calls";
      count: number;
      toolNames: string[];
      selectedTool?: string;
    };
  }>;
};

// Explicit server facts for generation, never inferred from transcript prose.
export type ChatTurnContext = {
  currentDate?: string;
  previousFailures?: Array<
    Pick<
      NonNullable<ChatGrounding["toolSteps"]>[number],
      "tool" | "status" | "reason" | "summary"
    >
  >;
};

export type StoredChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  grounding: ChatGrounding | null;
  createdAt: Date;
};

export type StoredConversation = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationSummary = StoredConversation;

export type ChatMessagePage = {
  conversationId: string;
  messages: StoredChatMessage[];
  nextCursor: string | null;
};

export type ChatPageRequest = {
  conversationId?: string;
  cursor?: string | null;
  limit?: number;
};
