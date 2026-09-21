import type {
  ChatMessagePage,
  ChatPageRequest,
  StoredChatMessage,
  StoredConversation,
} from "./contracts";
import { safeConversationId } from "./conversation-policy";
import { CHAT_HISTORY_LIMIT } from "./turn";

export type ConversationPorts = {
  createConversation(input?: {
    id?: string;
    title?: string;
  }): StoredConversation;
  listConversations(limit?: number): StoredConversation[];
  getConversation(id: string): StoredConversation | null;
  renameConversation(id: string, title: string): StoredConversation | null;
  ensureConversation(id: string): unknown;
  listRecentChatMessages(id: string, limit: number): StoredChatMessage[];
  listChatMessagePage(input: ChatPageRequest): ChatMessagePage;
  // One atomic storage operation, including conversation-derived semantic memory.
  deleteConversation(id: string): boolean;
  clearConversationHistory(id: string): void;
  isDebugTraceEnabled(): boolean;
};

export function createConversationUseCases(ports: ConversationPorts) {
  return {
    isDebugTraceEnabled: () => ports.isDebugTraceEnabled(),
    listConversations(limit?: number) {
      return ports.listConversations(limit);
    },
    createConversation(input: { id?: string; title?: string }) {
      return ports.createConversation({
        id: input.id ? safeConversationId(input.id) : undefined,
        title: input.title,
      });
    },
    loadConversationPage(input: ChatPageRequest) {
      const conversationId = safeConversationId(input.conversationId);
      const conversation = ports.getConversation(conversationId);
      if (!conversation) return null;
      const debugTraceEnabled = ports.isDebugTraceEnabled();
      const page = ports.listChatMessagePage({ ...input, conversationId });
      return { conversation, page, debugTraceEnabled };
    },
    renameConversation(id: string, title: string) {
      return ports.renameConversation(safeConversationId(id), title);
    },
    deleteConversation(id: string) {
      const conversationId = safeConversationId(id);
      const deleted = ports.deleteConversation(conversationId);
      const remaining =
        ports.listConversations(1)[0] ?? ports.createConversation();
      return {
        deleted,
        conversationId,
        nextConversationId: remaining.id,
        conversations: ports.listConversations(),
      };
    },
    chatHistory(conversationId: string) {
      ports.ensureConversation(conversationId);
      return ports.listRecentChatMessages(conversationId, CHAT_HISTORY_LIMIT);
    },
    clearChatHistory(conversationId: string) {
      ports.clearConversationHistory(conversationId);
      ports.ensureConversation(conversationId);
    },
  };
}
