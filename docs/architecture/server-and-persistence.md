# Architecture: server, persistence and raw payloads

Part of the [architecture overview](../architecture.md).

## Main server and operational components

Paths in the table are repository-relative source/test entry points. Specialized
docs carry the deeper contract rather than duplicating it here.

| Component                | Owns / does not own                                                                                                                                                                                                                                                                                                                             | Source and tests                                                                                                                                                                                                                                                                                                                                       | Failure/privacy/operational reference                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API delivery             | HTTP validation, compatible payloads, streaming/cancellation and route orchestration; not SQL schema, coaching formulas or Garmin authentication                                                                                                                                                                                                | `src/app/api/*/route.ts`; `tests/chat-route.test.ts`, `tests/profile-route.test.ts`, `tests/memory-route.test.ts`, `tests/health-dashboard-route.test.ts`, `tests/training-plan-route.test.ts`                                                                                                                                                         | No app sign-in boundary: loopback binding is operationally required. [Local runtime](../local-runtime.md)                                                                                                                                   |
| Context and instructions | Bounded source precedence, user/Profile/transcript/Garmin/memory separation; prior assistant prose is not measurement authority                                                                                                                                                                                                                 | `src/lib/ai/context.ts`, `trainer-instructions.ts`, `training-plan-evidence.ts`; `tests/trainer-instructions.test.ts`, `tests/training-plan-evidence.test.ts`                                                                                                                                                                                          | [Coaching instructions](../coaching-instructions-and-sources.md); plan snapshot/write rules in [design choices](../design-choices-and-boundaries.md)                                                                                        |
| Providers                | Explicit vendor configuration and adapters; no data repository or coaching rubric                                                                                                                                                                                                                                                               | `src/lib/ai/providers.ts`, `provider-errors.ts`; `tests/provider-config.test.ts`, `tests/openrouter-adapter.test.ts`, `tests/env.test.ts`                                                                                                                                                                                                              | Auto selection is **DeepSeek-first, OpenAI fallback**; explicit OpenRouter uses chat completions, Ollama endpoints must be loopback. Memory extraction/embeddings are separately configured. [Memory](../memory.md)                         |
| Orchestration and tools  | Sequential validated dispatch, same-turn evidence, budgets and bounded synthesis/failure prose; not hidden ranking weights                                                                                                                                                                                                                      | `src/lib/ai/orchestrator.ts`, `tool-contracts.ts`, `tool-execution.ts`, `tool-execution-context.ts`, `tool-evidence.ts`, `execution-budget.ts`; `tests/ai-orchestrator.test.ts`, `tests/ai-tools.test.ts`, `tests/trainer-progress.test.ts`                                                                                                            | 30 combined admitted provider/tool attempts, soft target 20, one final-answer reserve. Failed attempts count; analytical successful-result quotas are separate (limit 30), not the obsolete schema=1/SQL=2/math=1/four-tool budget.         |
| SQL and math             | One allowlisted read-only SELECT/WITH, capped rows and same-turn handles; bounded generic formula/aggregation/ranking                                                                                                                                                                                                                           | `src/lib/ai/sql-analysis.ts`, `math-analysis.ts`; `tests/sql-analysis.test.ts`, `tests/math-analysis.test.ts`, `tests/architecture-graph.test.mjs`                                                                                                                                                                                                     | No raw archive, auth, filesystem/process/network or arbitrary scripts. Pure local math helpers require graph verification. Generated analysis is a deprecated opt-in fallback, not normal analytics. [Guardrails](../project-guardrails.md) |
| Storage and lifecycle    | SQLite schema/version integrity, repositories, conversations, plan, Profile, normalized Garmin data, memory and scoped deletion; no providers/prompts                                                                                                                                                                                           | `src/lib/db/schema.ts`, `migrations.ts`, `repository.ts`; `tests/migrations.test.ts`, `tests/chat-history.test.ts`, `tests/training-plan-repository.test.ts`, `tests/import-summary.test.ts`                                                                                                                                                           | Garmin deletion is separate from chat/Profile/memory. No migration in this refactor. [Developer process](../developer-process.md)                                                                                                           |
| Garmin reader/import     | Official Personal API over fixed-origin HTTPS, read-only closed endpoint set, in-process FIT, normalization, resumable checkpoints, detail availability, redacted archive, additional evidence groups with per-group coverage and the explicit history backfill ([contract](../garmin-extra-data.md)); no Garmin write-back/password collection | `src/lib/garmin/official-*.ts`, `extra-*.ts`, `snow-{splits,backfill}.ts`, `connection.ts`, `composition.ts`, `raw-payload.ts`, `db/{extra-data,snow-split}-repository.ts`, `scripts/backfill-garmin-extra.ts`; `tests/snow-*.test.ts`; `tests/official-*.test.ts`, `tests/garmin-production-wiring.test.ts`, `tests/garmin-product-exclusion.test.ts` | New API, key expiry/revocation and undocumented rate limits. [Garmin risk](../garmin-risk.md), [key handling](../garmin-auth.md)                                                                                                            |
| Semantic memory          | Embedded SQLite retrieval, concise user-derived facts, independent embeddings/extraction and inspectable lifecycle; not a transcript/Garmin archive                                                                                                                                                                                             | `src/lib/memory/*`, `src/lib/ai/profile.ts`; `tests/sqlite-memory-adapter.test.ts`, `tests/memory-contract.test.ts`, `tests/memory-config.test.ts`                                                                                                                                                                                                     | Corrections, current transcript, Profile and tool facts outrank memory; diagnosis/treatment is excluded from durable memory. [Memory contract](../memory.md)                                                                                |
| Diagnostics              | Allowlisted readiness/redaction reports, not token-content inspection or destructive repair                                                                                                                                                                                                                                                     | `src/lib/diagnostics/*`, `scripts/doctor.ts`; `tests/doctor.test.ts`                                                                                                                                                                                                                                                                                   | Debug traces may contain private normalized context and stay local. [Source readiness](../source-beta-readiness.md)                                                                                                                         |
| Runtime/validation       | Locked install, explicit non-serving setup, native launch/build and blocking checks; not deployment/release authorization                                                                                                                                                                                                                       | `package.json`, `scripts/desktop/*`, `scripts/{migrate,db-status,doctor}.ts`, `architecture-check.mjs`; `tests/desktop-only-product.test.ts`, `tests/desktop-runtime.test.ts`, `tests/guardrails.test.ts`                                                                                                                                              | `npm ci`, `CI=true npm run validate`; [validation](../validation.md), E0007 live-smoke runbook and [developer process](../developer-process.md)                                                                                             |

## Persistence owners

- `src/lib/db/connection.ts` owns the single lazy SQLite connection, ordered
  migrations and existing compatibility DDL. All storage owners use it directly.
- `conversation-repository.ts` owns conversation/message persistence, pagination,
  grounding serialization and the single monotonic message timestamp state.
- `conversation-history.ts` owns schema18 source admission/completion sequence,
  segment/revision/boundary/integrity compare-publication, privacy invalidation and
  conservative durable local-compaction spend. It reuses the lazy connection and
  existing message/title writes; generation never holds its transaction.
  It imports pure chat-owned ID/title policy and contracts directly; callers use
  the authoritative policy/storage owner rather than an unused repository barrel.
- `training-plan-repository.ts` owns singleton plan SQL and row/ISO conversion.
  Feature-owned application/rules own normalization, staleness and synchronous
  guarded read/compare/edit/write; AI retains presentation and planner timing.
- `conversation-lifecycle.ts` owns the complete single-conversation deletion
  transaction: messages, conversation-derived semantic memory soft deletion, then
  conversation. History clear delegates to it; chat application use cases own
  fallback selection.
- `profile-repository.ts` owns Profile SQL; `memory/sqlite-storage.ts` owns semantic
  SQL and reads preserved legacy rows for management migration. There is no old
  proposal/confirm SQL-writer facade. Feature applications own normalization and
  management policy through explicit ports.
- `local-data-lifecycle.ts` owns exact atomic bulk deletion capabilities.
- `repository.ts` retains Garmin SQL, summaries and metadata, with feature-owned
  local-data interpretation helpers and runtime-consumed exports only. Constants,
  policy, types and conversation operations use their authoritative owners.
  Extracted storage owners never
  import the facade; semantic configuration/metadata adapters still use its
  existing metadata operations, including narrow insert-if-absent choice initialization. `model-settings` consumes prior saved/legacy/default intent once into `ai.chat_model.choice`; original preference bytes remain unchanged.

Dependency direction is delivery → outer composition → application ports, with
storage adapters implementing those capabilities and depending on chat-owned
contracts/policy. Storage I/O flows through connection → env/migrations. Lifecycle
uses pure conversation ID validation, not the reverse. Debug/tool metadata use
plain AI contracts, not implementation-owned types. Schema18 adds H journal/segment
transactions and derivative invalidation to existing lifecycle owners, without
widening other deletion scopes. In particular bulk chat/Profile clearing continues
to preserve semantic memory, unlike single-conversation deletion. Rehearse explicit
copy migration; older desktop admission refuses the new schema.
`tests/persistence-ownership.test.ts` covers shared connection visibility, edge
contracts, deletion scope/rollback and route fallback; existing history, memory,
plan, summary and migration suites remain integration evidence.

## Raw payload and evidence boundary

The app stores normalized facts **and** a local `garmin_raw_payload` archive where
supported. `repository.ts` calls `redactGarminRawPayload` before archive persistence;
credential/token/auth/cookie/command/environment/path-like fields are redacted.
The archive is not generally exposed to the model, SQL tools, browser or public
artifacts. Bounded analysis-bundle paths apply their own redaction and evidence
limits. “All raw payloads are discarded after normalization” is not an accurate
statement of current storage behavior. Raw FIT, credentials, precise streams and
private chat must not appear in task/PR smoke evidence.

Ordinary chat displays synthesized prose and a generic local-data marker. Grounding
retains ordered server-authored tool metadata; local debug diagnostics are a separate
explicit surface. Failures return bounded truthful limitations, not invented Garmin
facts or raw tool dumps. Refactoring the client does not alter any of these policies.
