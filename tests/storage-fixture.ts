// Test-only access to authoritative production storage owners. No application
// code imports this facade; retired production barrels are not runtime APIs.
export * from "../src/lib/db/repository";
export * from "../src/lib/db/connection";
export * from "../src/lib/db/conversation-repository";
export { clearConversationHistory } from "../src/lib/db/conversation-lifecycle";
export {
  DEFAULT_CONVERSATION_ID,
  safeConversationId,
  normalizeConversationTitle,
  initialConversationTitle,
} from "../src/lib/chat/conversation-policy";
export { verifyActivityReference } from "../src/lib/local-data/composition";

import { getDatabase } from "../src/lib/db/connection";

// Arrange persisted checkpoints without retaining a test-only product writer.
export function saveCheckpoint(key: string, value: string): void {
  getDatabase()
    .prepare(
      "insert into sync_checkpoint (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at",
    )
    .run(key, value, Date.now());
}
