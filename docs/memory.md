# Embedded SQLite semantic memory

The trainer uses an app-owned semantic-memory adapter under `src/lib/memory`. The operator-approved T039 pivot stores memory text, metadata, lifecycle state, and embedding vectors directly in the local SQLite database (`DATABASE_PATH`). No Qdrant, Docker sidecar, hosted vector database, Mem0 Platform account, or public service is required.

SQLite remains the canonical store for transcript, Profile, Garmin facts, and derived semantic memory. Semantic memory is still a bounded retrieval layer: Garmin measurements must come from local SQLite/tools at answer time, not from model-extracted memory.

## Configuration

Set `MEMORY_ENABLED=true` to enable retrieval and post-completion ingestion. Configure an OpenAI-compatible embedding provider separately:

```env
MEMORY_ENABLED=true
MEMORY_EMBEDDING_PROVIDER=openai
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
MEMORY_EMBEDDING_API_KEY=...
MEMORY_EMBEDDING_DIMS=1536
```

If `MEMORY_EMBEDDING_API_KEY` is omitted, the app falls back to `OPENAI_API_KEY`. DeepSeek chat does not imply embeddings. Embedding calls may incur provider cost; memory software/storage is local.

`npm run doctor -- --json` reports memory readiness without printing keys, prompts, raw transcripts, vectors, or local file contents.

## Privacy and controls

Memory ingestion runs only after a complete assistant answer has been persisted. Deterministic filters reject credential-like text, raw Garmin/FIT/connector payloads, precise stream/location markers, policy/prompt-injection text, and medical/sensitive inferences before storage or embedding. Retrieved memories are labelled as untrusted user-derived context and are lower authority than current user corrections, Profile, and Garmin/tool evidence.

The settings UI exposes readiness, enable/disable, inspect, edit, delete one, and clear all controls. Disable stops both retrieval and ingestion. Delete/clear affects subsequent answers immediately and does not delete Profile, chat transcript, or normalized Garmin data.

## Backup, restore, and reset

Semantic memory is stored in the same SQLite database as the app. Back up `DATABASE_PATH` and SQLite sidecar files (`-wal`, `-shm`) while the app is stopped. Restoring that database restores semantic memory together with app-owned transcript/Profile/Garmin state.

To reset only semantic memory, use the Memory settings “Clear all memory” control. To reset chat/Profile or Garmin data, use their separate controls; those do not clear semantic memory unless explicitly stated.
