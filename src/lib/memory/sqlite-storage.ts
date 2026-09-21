import { getDatabase } from "../db/connection";
import { getAppMetadata, setAppMetadata } from "../db/repository";
import { LOCAL_MEMORY_USER_ID } from "./types";
import type {
  MemoryPersistence,
  SemanticMemoryRow,
  LegacyMemoryRow,
} from "./ports";
const ACTIVE_STATUS = "active";
const LEGACY_MIGRATION_KEY = "memory.sqlite_legacy_migrated";
export const sqliteMemoryPersistence: MemoryPersistence = {
  rows(now) {
    return getDatabase()
      .prepare(
        `select id, user_id as userId, kind, text, status, embedding_json as embeddingJson,
                embedding_model as embeddingModel, source_conversation_id as sourceConversationId,
                source_message_ids_json as sourceMessageIdsJson, source, created_at as createdAt,
                updated_at as updatedAt, expires_at as expiresAt
         from semantic_memory
         where user_id = ? and status = ? and (expires_at is null or expires_at > ?)
         order by updated_at desc
         limit 200`,
      )
      .all(LOCAL_MEMORY_USER_ID, ACTIVE_STATUS, now) as SemanticMemoryRow[];
  },
  upsert(input) {
    getDatabase()
      .prepare(
        `insert into semantic_memory (id, user_id, kind, text, status, embedding_json, embedding_model,
                                      source_conversation_id, source_message_ids_json, source,
                                      created_at, updated_at, expires_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set text = excluded.text,
                                      status = excluded.status,
                                      embedding_json = excluded.embedding_json,
                                      embedding_model = excluded.embedding_model,
                                      updated_at = excluded.updated_at,
                                      expires_at = excluded.expires_at`,
      )
      .run(
        input.id,
        LOCAL_MEMORY_USER_ID,
        input.kind,
        input.text,
        ACTIVE_STATUS,
        JSON.stringify(input.embedding),
        input.embeddingModel,
        input.conversationId ?? null,
        JSON.stringify((input.sourceMessageIds ?? []).slice(0, 8)),
        input.source,
        input.createdAt?.getTime() ?? input.now,
        input.now,
        input.expiresAt?.getTime() ?? null,
      );
  },
  legacyRows(now) {
    return getDatabase()
      .prepare(
        `select id, category, value, status, source_type as sourceType, source_ref as sourceRef,
                provenance_text as provenanceText, created_at as createdAt, updated_at as updatedAt,
                expires_at as expiresAt
         from trainer_memory
         where status = 'confirmed' and (expires_at is null or expires_at > ?)`,
      )
      .all(now) as LegacyMemoryRow[];
  },
  migrationDone() {
    return getAppMetadata(LEGACY_MIGRATION_KEY) === "done";
  },
  markMigrated() {
    setAppMetadata(LEGACY_MIGRATION_KEY, "done");
  },
  update(id, text, embedding, model, now) {
    getDatabase()
      .prepare(
        `update semantic_memory
         set text = ?, embedding_json = ?, embedding_model = ?, updated_at = ?
         where id = ? and user_id = ? and status = ?`,
      )
      .run(
        text,
        JSON.stringify(embedding),
        model,
        now,
        id,
        LOCAL_MEMORY_USER_ID,
        ACTIVE_STATUS,
      );
  },

  delete(id, now) {
    getDatabase()
      .prepare(
        "update semantic_memory set status = 'deleted', updated_at = ? where id = ? and user_id = ?",
      )
      .run(now, id, LOCAL_MEMORY_USER_ID);
  },

  clearAll(now) {
    getDatabase()
      .prepare(
        "update semantic_memory set status = 'deleted', updated_at = ? where user_id = ?",
      )
      .run(now, LOCAL_MEMORY_USER_ID);
  },

  probe() {
    getDatabase()
      .prepare("select count(*) as count from semantic_memory")
      .get();
  },
};
