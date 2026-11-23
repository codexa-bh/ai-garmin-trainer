# Architecture: server, persistence and raw payloads

Part of [architecture](../architecture.md).

## Main server and operational components

HTTP routes translate requests/results through feature composition; loopback binding is required and is not an app sign-in boundary. Read the changed area's [architecture guide](../architecture.md#area-guides), not a duplicate component inventory:

- Chat/provider/tool execution: [AI and chat](ai-and-chat.md).
- SQL/math and scoped deletion: [analytics and local data](analytics-and-local-data.md).
- Import/normalization: [Garmin](garmin.md).
- Profile/memory/plans: [personalization](personalization-and-plans.md).
- Native lifecycle/private state: [desktop](../desktop.md).
- Readiness and developer checks: [validation](../validation.md), [guardrails](../project-guardrails.md), [source readiness](../source-beta-readiness.md).

## Persistence owners

`db/connection.ts` owns the single lazy SQLite connection, ordered migrations and compatibility DDL. Storage adapters use it directly; extracted owners never import the `repository.ts` compatibility facade. Feature applications own policy through synchronous ports; storage owns SQL/row decoding, not prompts or provider calls.

- `conversation-repository`: messages/conversations, pagination, grounding and monotonic message timestamps.
- `conversation-history`: admission/completion journals, segments/CAS, integrity/privacy and durable local-compaction spend. Generation holds no transaction. [Conversation history](../conversation-history.md) owns migration and compatibility.
- `conversation-lifecycle`: one atomic deletion—messages, soft deletion of semantic rows matching conversation ID **and** conversation kind, then conversation—even for a missing target. Chat application selects fallback. Saved/non-conversation memory is outside this scope.
- `training-plan-repository`: singleton SQL/ISO conversion; feature rules own normalization/review/guarded edits.
- `profile-repository` and `memory/sqlite-storage`: Profile and preserved semantic storage; no retired proposal/confirmation writer facade.
- `local-data-lifecycle`: exact bulk scopes and rollback; [local-data](analytics-and-local-data.md#local-data-application-and-adapters) owns their exclusions.
- `repository`: Garmin SQL, summaries and metadata. Local-data policy interprets selected rows. Model selection initializes `ai.chat_model.choice` once from prior intent while preserving original preference bytes.

Storage may depend on plain feature contracts/policy, never AI runtime. Conversation lifecycle depends on pure ID validation, not the reverse. Bulk chat/Profile clearing preserves semantic memory, unlike single-conversation deletion. Schema changes require explicit copy rehearsal; older desktop admission refuses unsupported schemas. `persistence-ownership.test.ts` covers shared visibility, deletion/rollback and route fallback; history/memory/plan/migration suites cover integration.

## Raw payload and evidence boundary

Normalized facts coexist with a local `garmin_raw_payload` archive. The repository calls `redactGarminRawPayload` **before** persistence, removing credential/token/auth/cookie/command/environment/path-like fields. The archive is not general model/SQL-tool/renderer/public-artifact input. Bounded analysis bundles have their own redaction/evidence limits. Never put raw FIT, credentials, precise streams or private chat into task/PR evidence.

Ordinary chat displays synthesized prose and a generic local-data marker. Grounding retains ordered tool metadata; local debug is a separate explicit private surface. Failures disclose bounded truthful limitations, not invented facts or raw dumps.
