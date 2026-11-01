# Embedded SQLite semantic memory

The trainer uses an app-owned semantic-memory adapter under `src/lib/memory`. The operator-approved T039 pivot stores memory text, metadata, lifecycle state, and embedding vectors directly in the local SQLite database (`DATABASE_PATH`). No Qdrant, Docker sidecar, hosted vector database, Mem0 Platform account, or public service is required.

SQLite remains the canonical store for transcript, Profile, Garmin facts, and derived semantic memory. Chat transcripts provide same-chat continuity only for the active conversation and are selected under a safe context budget; starting a New chat is the reset boundary for that short-term transcript context. Semantic memory is a separate bounded retrieval layer for concise cross-session user facts: Garmin measurements must come from local SQLite/tools at answer time, not from model-extracted memory.

## Configuration

For desktop use **Settings → Memory → Remember useful details — On/Off**, with deliberately expandable **Memory configuration** for provider/model/endpoint and fact-selection mode. **Troubleshooting / technical controls** retains dimensions, timeouts and executable overrides. Collapsing or switching Off never resets these values. Off is not deletion or re-embedding, and does not stop independent chat/title processing. The separate immediate Trainer Memory-panel preference remains unchanged by a native Save, even when saving On. Configure with provider keys in the native owner-private plaintext file (same-user/privileged processes and backups can read it); Save then explicitly quit/reopen. Desktop never loads env files. Field identifiers/examples below describe the internal adapter and retained maintenance CLI equivalents, not a desktop env-file setup recipe. CLI doctor does not read private native settings/legacy Keychain. See [storage/adoption/recovery](desktop.md#explicit-private-state-adoption).

Set `MEMORY_ENABLED=true` to enable retrieval and post-completion ingestion. For the local, no-paid **embedding step**, use Ollama with a small purpose-built embedding model (LLM fact extraction can still use cloud AI):

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

DeepSeek is the default chat provider in `AI_PROVIDER=auto` and can be used for guarded memory extraction, but DeepSeek chat credentials do not imply embedding capability. Chat catalog entries, defaults and saved selections are separate from memory extraction. The preserved legacy `AI_PROVIDER`/cloud model fields retain extraction and title intent; native catalog edits never rewrite them. Legacy Ollama/OpenRouter intent still means cloud auto compatibility, not extraction through those chat providers: extraction prompts are not sent to either chat provider, and the extractor uses configured DeepSeek/OpenAI if available or deterministic fallback otherwise. Chat models such as Gemma are also not the preferred memory embedding mechanism: embedding-specific models such as `nomic-embed-text` are smaller, faster, and trained to produce stable semantic vectors, while chat-model extraction only proposes candidate text before server validation and embedding. If `OPENAI_API_KEY` is missing or still contains a placeholder example value, enabled OpenAI memory reports `misconfigured` instead of ready. For local non-provider tests, set `MEMORY_EMBEDDING_PROVIDER=deterministic`; deterministic vectors are useful for validation but are not semantic provider embeddings.

Memory extraction defaults to `MEMORY_EXTRACTION_MODE=llm`: after a completed turn, the app sends the compact latest user message to configured DeepSeek/OpenAI with tools disabled and a strict JSON-only extraction prompt. When present and safe, the prompt also includes a bounded excerpt of the immediately previous assistant response as lower-authority context only for resolving explicit user confirmations, corrections, or selections such as “remember that” or “use the second option going forward.” The server parses the JSON fail-closed, rejects malformed/extra-prose output, validates candidate kind/length/safety/source policy, requires explicit latest-user authorization for assistant-context-derived candidates, drops unsafe Garmin/tool/assistant/medical/credential claims, deduplicates accepted candidates, and falls back to deterministic T048 extraction when the model extractor is unavailable, times out, or returns invalid JSON. `MEMORY_EXTRACTION_MODE=deterministic` skips the model extractor, and `MEMORY_EXTRACTION_MODE=off` disables post-answer ingestion while leaving existing memory retrieval/list/delete controls intact. `MEMORY_EXTRACTION_TIMEOUT_MS` bounds the extraction call separately from embedding timeout.

Launch only through [Tauri](desktop.md). Ollama is independently operator-managed: start `OLLAMA_HOST=http://127.0.0.1:11434 ollama serve` and pull the configured embedding model using that same loopback origin. Desktop neither starts/stops the daemon nor installs software/downloads models. Memory readiness still requires a real valid embedding response; absent/slow services degrade memory while offline views/chat remain available. See [native lifecycle and external tools](local-runtime.md#native-development-and-restart).

`npm run doctor -- --json` reports the selected chat provider, fallback mode, Ollama chat readiness when `AI_PROVIDER=ollama`, and memory readiness, including Ollama daemon/model remediation, without printing keys, base URLs, prompts, raw transcripts, vectors, or local file contents.

### Configuration versus observed readiness

Native **Save for next launch** does not switch the current backend. Draft, saved startup configuration and active runtime are distinct. Explicit **Read active memory status** reports the owned backend's configured On/Off, separate user-disable preference, embedding provider and actual extraction selection. It reads existing metadata and cached health only: no memory list/legacy migration, storage probe, provider call or paid extraction check. Unavailable/stopped/no observation is unknown, never Ready. Existing observations expire after 60 seconds and are cleared on configuration/preference reset. A recent valid Ollama vector/storage check is scoped to that local step; deterministic vectors are test-only. OpenAI-compatible configuration and extraction provider selection are not remote readiness proofs. Errors use fixed safe categories rather than vendor text, paths, URLs or memory content. Use the existing Memory panel to check its configured service; never change dimensions/reset records just to clear a status.

This presentation/status change requires no SQLite schema/index/vector/data migration or back-sync. It neither converts stored vectors nor changes selection, processing, retention or deletion policy.

## First-prompt chat titles

New chats use the existing DeepSeek/OpenAI extraction selector for one best-effort descriptive title in the first prompt's language, independently of `MEMORY_ENABLED`, extraction mode and chat catalog/default/runtime preference. This is not memory ingestion: only the first prompt's 2000-character prefix is sent with title-only instructions, no tools or retrieved context, no SDK retries and a 3000ms abortable deadline. Missing selection, timeout or invalid output leaves the immediate prompt excerpt.

Title completion is owned by Next.js `after()` outside both JSON and stream answer delivery. A durable first-message reservation prevents retries and clear/delete/recreate from admitting another attempt. Manual/custom names win, stale deleted/cleared messages cannot apply, and late metadata does not change conversation recency. The existing list refreshes a bounded number of times for pending titles without replacing selection or transcript. Shutdown can lose this best-effort work; there is no retry queue or historical retitling.

Schema migration 17 adds only the title-attempt identity/claim table. It needs no data backfill and does not modify historical titles. Apply the normal backed-up migration procedure before running updated source against an existing DB; source delivery does not migrate/restart a running primary app.

## Privacy and controls

Memory ingestion runs only after a complete assistant answer has been persisted. It stores zero or more concise user-derived candidates for explicit preferences, goals, corrections, recurring constraints, or useful temporary plans; low-value transient turns commonly create no memory. The stored text is capped for inspectability and remains user-authorized: the latest user message is the primary source, and the previous assistant excerpt may only disambiguate an explicit user confirmation/selection/correction. The app does not store assistant prose, assistant-authored coaching conclusions, or Garmin/tool facts as semantic memory. Model-assisted extraction is lower-authority than server rules: deterministic filters reject credential-like text, raw Garmin/FIT/connector payloads, precise stream/location markers, policy/prompt-injection text, assistant/tool prose, model-inferred Garmin facts, and medical/sensitive inferences before storage or embedding. Retrieved memories are labelled as user-derived cross-session context and are lower authority than current user corrections, the active chat transcript, Profile, and Garmin/tool evidence.

The Memory side sheet exposes readiness, enable/disable, inspect, edit, delete one, and clear all controls. Disable stops both retrieval and ingestion. Delete/clear affects subsequent answers immediately and does not delete Profile, chat transcript, or normalized Garmin data. Existing older noisy rows remain editable/deletable by the user; this release does not automatically clean historical memory.

## Backup, restore, and reset

Semantic memory is stored in the same SQLite database as the app. Quit the native app before backing up `DATABASE_PATH` and any SQLite sidecars (`-wal`, `-shm`); use SQLite's online backup API for a consistent active-WAL copy rather than copying a live main file. Restoring that database restores semantic memory together with app-owned transcript/Profile/Garmin state.

To reset only semantic memory, open the Memory side sheet and use “Clear all memory.” To reset chat/Profile or Garmin data, use their separate controls; those do not clear semantic memory unless explicitly stated.
