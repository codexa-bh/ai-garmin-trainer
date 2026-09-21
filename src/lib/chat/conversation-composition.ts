import {
  ensureConversation,
  listRecentChatMessages,
  createConversation,
  listConversations,
  getConversation,
  renameConversation,
  listChatMessagePage,
} from "@/lib/db/conversation-repository";
import {
  clearConversationHistory,
  deleteConversation,
} from "@/lib/db/conversation-lifecycle";
import { isLlmDebugTraceEnabled } from "@/lib/env";
import { createConversationUseCases } from "./conversations";

export const conversations = createConversationUseCases({
  createConversation: (input) => createConversation(input),
  listConversations: (limit) => listConversations(limit),
  getConversation: (id) => getConversation(id),
  renameConversation: (id, title) => renameConversation(id, title),
  ensureConversation: (id) => ensureConversation(id),
  listRecentChatMessages: (id, limit) => listRecentChatMessages(id, limit),
  listChatMessagePage: (input) => listChatMessagePage(input),
  deleteConversation: (id) => deleteConversation(id),
  clearConversationHistory: (id) => clearConversationHistory(id),
  isDebugTraceEnabled: () => isLlmDebugTraceEnabled(),
});
