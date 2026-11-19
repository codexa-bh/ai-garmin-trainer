import { getDatabase } from "../src/lib/db/connection";

// Test-owned persisted setup; no retired proposal/confirmation/ingestion API.
export function seedSemanticMemory(
  id = "authored-memory",
  text = "I prefer morning hikes",
) {
  getDatabase()
    .prepare(
      `insert into semantic_memory (id,user_id,kind,text,status,embedding_json,embedding_model,source_conversation_id,source_message_ids_json,source,created_at,updated_at,expires_at)
     values (?,'local-default','saved_preference',?,'active','[1,0]','test','authored-chat','["authored-user"]','authored-test',1000,1000,null)`,
    )
    .run(id, text);
  return id;
}
export function seedLegacyMemory(
  id: string,
  status: "confirmed" | "rejected",
  value: string,
) {
  getDatabase()
    .prepare(
      `insert into trainer_memory (id,category,value,status,source_type,provenance_text,created_at,updated_at)
     values (?,'learned_preference',?,?,'authored-test','Authored preserved legacy input',1000,1000)`,
    )
    .run(id, value, status);
  return id;
}
