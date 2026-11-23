# Architecture: backend roles and composition

Part of the [architecture overview](../architecture.md).

## Enforced backend roles and composition inventory

[`backend-roles.mjs`](../../scripts/backend-roles.mjs) is the complete per-file
feature/layer inventory, checked by normal architecture/validation commands.
Feature folders intentionally mix responsibilities; names/folder depth do not
confer an exemption. [Allowed edges and limitations](../project-guardrails.md#featurelayer-ownership-runtime-and-erased-contracts)
include erased contracts without treating them as runtime execution or cycles.

| Feature                     | Inner contracts / application ports                                                                 | Outer composition and capability owners                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat / conversations        | `chat/{contracts,ports,context-ports}`, `createChatTurns`, `createChatContext`, `ConversationPorts` | `chat/{composition,conversation-composition}` binds storage, memory and selected AI generation; chat/conversation HTTP families invoke these seams                                                         |
| AI orchestration / tools    | `TrainerOrchestrationPorts`, tool ports, neutral tool schemas/types, selection/evidence/math        | `ai/{composition,tool-composition}`; provider generation/schema wrapping and model selection are adapters, not inner contracts                                                                             |
| Guarded analytics           | `analytics/contracts`, synchronous execution/inspection ports and application                       | `ai/sql-analysis` composes `analytics/sqlite-execution`; tool facade never exposes a database handle                                                                                                       |
| Garmin                      | Import reader/storage/config/clock ports, sync/baseline/detail applications and pure normalizers    | `garmin/composition`; reader/MCP/FIT/archive/token/auth modules are mechanical adapters; sync/detail callers use composition directly                                                                      |
| Local data                  | Plain read models, selected-row policy, `LocalDataReads` / `LocalDataLifecycle`                     | `local-data/composition` binds SQLite for activity/Health/summary/delete, chat and tools                                                                                                                   |
| Profile / memory            | `ProfileStorage`, semantic `MemoryPorts`, management and legacy application contracts               | Profile/memory compositions bind SQL, config, embeddings/extraction; management owns preserved-record operations, not a public legacy proposal facade                                                      |
| Training Plan               | Contracts/policy/edits/snapshot and synchronous `TrainingPlanStore`                                 | `training-plan/composition` binds plan SQL for HTTP and tool use                                                                                                                                           |
| Infrastructure / operations | No business-policy exemption                                                                        | DB connection/schema/migrations/repositories, env, diagnostics doctor, Garmin connection/HTTPS/FIT and provider/config transports are explicitly classified adapters; diagnostics redaction is pure domain |

The `model-settings` feature owns strict versioned catalog/contracts and supplied-port preference application. Native Settings v3 preserves original v2/v1 settings and independent extraction/title fields; activation v3 carries immutable catalog and private selection-compatibility metadata over the existing private pipe (older v2/v1 remain supported). Lazy composition binds one durable explicit choice with frozen startup compatibility, preserving original preferences, placeholder-aware eligibility and exact chat-only provider construction. `/api/model-settings` returns bounded version-3 metadata; `chat/composition` captures selection/configuration once before context awaits. Live Settings publishes one complete validated catalog/key snapshot in a narrowly named process-owned cell shared by the separately built launcher and Next bundles, never a mutable whole-config env overlay. Fixed authenticated POST/GET validates boot/generation/revision; status acknowledges only published state. Native lock order is service-before-settings, with nonblocking service acquisition during startup and bounded transport. DB schema, provider probing and extraction/embedding topology remain unchanged. Focused `model-settings*` suites cover key/validation/persistence/redaction/UI and overlapping production turn binding.

[ChatGPT subscription](../chatgpt.md) adds native-only protected registration/token ownership plus a bounded pipe-fed public-OAuth helper, not an app-auth/provider framework. The v2 private record has one explicit active registration, retained recovery records and original-preserving v1 compatibility; only active metadata/credential access is projected, with an explicit Switch account or one-time legacy reconciliation. Archived choices remain unavailable, never retargeted. Startup version4 wraps the prior activation with the private credential broker descriptor; no credential/capability enters renderer, argv or inherited connector env. Pure `model-settings/chatgpt-metadata` owns secret-free identity validation; `ai/chatgpt-{connection,transport,generation}` owns private access and compatible actual Responses streaming/namespace/terminal decoding behind existing generation contracts. Catalog identity additionally binds registration; independent shared summary/title identity uses version2. Scope/epoch currentness spans tools, delivery and summary candidates; old metadata cannot resurrect disconnected access. Native acknowledged connection changes issue the existing metadata-refresh notification. Existing API-key adapters, app preference structures and normalized SQLite schema remain unchanged. Inactive legacy extraction/vectors are not revived.

First-prompt titles use chat-owned application ports, `chat/title-adapter` and the independent shared summary/title model selector, not extraction, ingestion or Trainer preferences. A synchronous message transaction reserves the first eligible message in `conversation_title_attempt`; one conditional claim admits generation. Next.js `after()` owns the bounded post-response work for both HTTP modes. Guarded SQL applies only to that surviving message's unchanged automatic excerpt, never a manual title, without changing recency. Clear/delete preserve small admission tombstones. Optional list `titlePending` metadata and the response `x-chat-title-pending` header drive at most four existing-list refetches; settlement/navigation/unmount stop further reads. See [title behavior and migration](../memory.md#first-prompt-chat-titles), `conversation-title*` and chat-boundary tests.

All HTTP route families consume feature composition. `chat/delivery` owns
JSON/NDJSON transport; debug configuration is obtained request-time through the
existing conversation application port, not directly from env. Personalization routes use Profile and memory-management composition directly.
There is no legacy proposal/confirm/reject/forget facade or public semantic-store
adapter entrypoint. Preserved legacy rows, vectors, migration markers and schema
remain unchanged; management's existing bounded listing/migration and explicit
read-only inspection remain separate from ordinary chat.

Conversation selection uses the existing `app_metadata` key `chat.active_conversation.v1`
(identity only; empty string represents resolved-empty). Lazy conversation composition
binds metadata reads/writes; `GET /api/conversations/selection` validates saved existence
without sidebar-page limits, then repairs stale selection with `updated_at DESC, id DESC`.
`PUT` accepts only a valid existing `conversationId`, never creating or retimestamping it.
Delete repairs selection only when it still names that deleted row. The UI serializes
selection mutations; generation guards prevent stale reads/delete responses undoing newer
intent. Failures have explicit selection retry, not a browser/default rescue. No schema
migration, browser import, model preference change or eager resource is introduced.

Resource ownership stays unchanged: compositions bind functions at import time,
not resources. One lazy SQLite connection is shared; memory topology is
snapshotted from the startup base; credential changes create a new lazy current store while old work retains its immutable snapshot; each Garmin import starts/closes one reader;
each guarded SQL invocation owns/closes its readonly session; each AI turn owns
one disposable tool context; each provider call owns its timeout. Existing provider disconnect semantics are unchanged; optional subscription invalidation follows its explicit native registration epochs. Explicit Sync cancellation/HTTP disconnect now stops sync admission and its owned reader work; persisted normalized data is not rolled back. No global DI
container, ambient setter, eager initialization, schema/data migration or new
retry is introduced. Explicit operational auth/migrate/status/doctor scripts remain
outer entrypoints, not domain services.

`tests/backend-composition.test.mjs` checks the complete route mapping and imports
all production routes with DB/env/provider/connector access probes; construction
must not invoke any. It also checks request-time debug-port delegation. Existing
`*-application`, `*-wiring`, SQL execution, provider generation and connector reader
suites cover supplied ports, real adapters, singleton/transaction lifetimes and
failure paths. API-only smoke runs on a disposable populated DB; rollback is a
source revert, data back-sync is a no-op.
