import { getDatabase } from "./connection";
import {
  DEFAULT_CONVERSATION_ID,
  safeConversationId,
} from "@/lib/chat/conversation-policy";

export function deleteConversation(id = DEFAULT_CONVERSATION_ID): boolean {
  const conversationId = safeConversationId(id);
  const db = getDatabase();
  const changes = db.transaction(() => {
    db.prepare("delete from message where conversation_id = ?").run(
      conversationId,
    );
    db.prepare(
      "update semantic_memory set status = 'deleted', updated_at = ? where source_conversation_id = ? and kind = 'conversation'",
    ).run(Date.now(), conversationId);
    return db
      .prepare("delete from conversation where id = ?")
      .run(conversationId).changes;
  })();
  return changes > 0;
}

export function clearConversationHistory(
  conversationId = DEFAULT_CONVERSATION_ID,
): void {
  deleteConversation(conversationId);
}
