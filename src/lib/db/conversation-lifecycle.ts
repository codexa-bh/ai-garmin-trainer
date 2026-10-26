import { getDatabase } from "./connection";
import {
  DEFAULT_CONVERSATION_ID,
  safeConversationId,
} from "@/lib/chat/conversation-policy";

export function deleteConversation(id = DEFAULT_CONVERSATION_ID): boolean {
  const conversationId = safeConversationId(id);
  const db = getDatabase();
  const changes = db.transaction(() => {
    // Keep a small tombstone: clearing/deleting history must not re-admit titles.
    db.prepare(
      `insert into conversation_title_attempt (conversation_id) values (?)
      on conflict(conversation_id) do update set pending = 0, claimed = 1`,
    ).run(conversationId);
    db.prepare("delete from weekly_proposal where conversation_id = ?").run(
      conversationId,
    );
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
