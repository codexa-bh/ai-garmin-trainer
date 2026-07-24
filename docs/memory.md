# Embedded SQLite semantic memory

The trainer uses an app-owned semantic-memory adapter under `src/lib/memory`. The operator-approved T039 pivot stores memory text, metadata, lifecycle state, and embedding vectors directly in the local SQLite database (`DATABASE_PATH`). No Qdrant, Docker sidecar, hosted vector database, Mem0 Platform account, or public service is required.

SQLite remains the canonical store for transcript, Profile, Garmin facts, and derived semantic memory. Chat transcripts provide same-chat continuity only for the active conversation and are selected under a safe context budget; starting a New chat is the reset boundary for that short-term transcript context. Semantic memory is a separate bounded retrieval layer for concise cross-session user facts: Garmin measurements must come from local SQLite/tools at answer time, not from model-extracted memory.

## Configuration

Set `MEMORY_ENABLED=true` to enable retrieval and post-completion ingestion. For no-paid local semantic memory, use Ollama with a small purpose-built embedding model:

```bash
ollama pull nomic-embed-text
```

```env
MEMORY_ENABLED=true
MEMORY_EMBEDDING_PROVIDER=ollama
MEMORY_EMBEDDING_MODEL=nomic-embed-text
MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434
```

The Ollama path is loopback-only. It sends concise filtered memory candidates to the local daemon, does not require `OPENAI_API_KEY`, and does not send Garmin credentials, raw connector payloads, assistant answer prose, or unrestricted transcripts. Health is `ready` only when the local daemon/model embedding endpoint returns a valid vector. If Ollama is stopped, slow, missing the model, configured with a non-loopback URL, or returns a malformed embedding, memory reports an actionable not-ready state and chat remains available without memory retrieval/ingestion.

OpenAI-compatible embeddings remain supported through the existing `OPENAI_API_KEY` contract, not a separate memory-only key:

```env
MEMORY_ENABLED=true
MEMORY_EMBEDDING_PROVIDER=openai
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=...
MEMORY_EMBEDDING_DIMS=1536
```

DeepSeek is the default chat provider in `AI_PROVIDER=auto`, but DeepSeek chat credentials do not currently imply embedding capability. Chat models such as Gemma are also not the preferred memory embedding mechanism: embedding-specific models such as `nomic-embed-text` are smaller, faster, and trained to produce stable semantic vectors, while local chat/tool reasoning is a separate follow-up evaluation. If `OPENAI_API_KEY` is missing or still contains a placeholder example value, enabled OpenAI memory reports `misconfigured` instead of ready. For local non-provider tests, set `MEMORY_EMBEDDING_PROVIDER=deterministic`; deterministic vectors are useful for validation but are not semantic provider embeddings.

`npm run doctor -- --json` reports the selected chat provider, fallback mode, and memory readiness, including Ollama daemon/model remediation, without printing keys, prompts, raw transcripts, vectors, or local file contents.

## Privacy and controls

Memory ingestion runs only after a complete assistant answer has been persisted. It stores zero or more concise user-derived candidates for explicit preferences, goals, corrections, recurring constraints, or useful temporary plans; low-value transient turns commonly create no memory. The stored text is capped for inspectability and is derived from the user message, not the assistant response. Deterministic filters reject credential-like text, raw Garmin/FIT/connector payloads, precise stream/location markers, policy/prompt-injection text, assistant/tool prose, and medical/sensitive inferences before storage or embedding. Retrieved memories are labelled as user-derived cross-session context and are lower authority than current user corrections, the active chat transcript, Profile, and Garmin/tool evidence.

The settings UI exposes readiness, enable/disable, inspect, edit, delete one, and clear all controls. Disable stops both retrieval and ingestion. Delete/clear affects subsequent answers immediately and does not delete Profile, chat transcript, or normalized Garmin data. Existing older noisy rows remain editable/deletable by the user; this release does not automatically clean historical memory.

## Backup, restore, and reset

Semantic memory is stored in the same SQLite database as the app. Back up `DATABASE_PATH` and SQLite sidecar files (`-wal`, `-shm`) while the app is stopped. Restoring that database restores semantic memory together with app-owned transcript/Profile/Garmin state.

To reset only semantic memory, use the Memory settings “Clear all memory” control. To reset chat/Profile or Garmin data, use their separate controls; those do not clear semantic memory unless explicitly stated.
