# Architecture

The supported product is a private, single-user loopback app, not a hosted service.
The model reasons; server-owned SQL retrieves bounded facts; bounded math transforms
those facts. UI composition does not own coaching policy, persistence or connector
credentials. See [design choices](design-choices-and-boundaries.md) for the reasoning
and [project guardrails](project-guardrails.md) for enforced dependency boundaries.

## Dependency and data flow

```text
page → TrainerDashboard shell → persistent feature hooks + conditional views
                                  ↓ fetch / NDJSON
API routes → application orchestration → repositories → SQLite
                     ↓                       ↑
             provider adapters       Garmin importer ← allowlisted stdio connector
                     ↓
             validated tool dispatch → SQL result handles → bounded pure math

context ← Profile + normalized Garmin facts + current transcript + semantic memory
```

Runtime client closures cannot reach database, connector or provider capabilities.
DTOs are client contracts, not imports of server implementations. Storage cannot
import AI runtime code. The graph gate rejects runtime cycles and verifies the
pure math closure; it is not a general filesystem sandbox or proof of privacy.

## Dashboard ownership and lifetime

[`trainer-dashboard.tsx`](../src/app/trainer-dashboard.tsx) retains navigation,
section visibility, focus return, transcript scroll restoration, startup scheduling
and cross-feature refresh wiring. Mobile navigation composes
[`mobile-navigation-sheet.tsx`](../src/app/mobile-navigation-sheet.tsx), whose
native dialog owns modality, focus trapping, dismissal and breakpoint cleanup
(`tests/mobile-navigation-sheet.test.tsx`). The shell retains destination focus
handoffs, including the extracted chat drawer's close-button ref.
Every feature hook is called unconditionally in
the persistent shell. Hiding a view does **not** unmount its state/request owner or
restart startup fetches. Views retain the prior conditional mounting and DOM/CSS
contract; Health mode/chart state still follows the Health view lifetime.

Files below are in [`src/app/dashboard`](../src/app/dashboard):

| Owner                                                              | Responsibility and exclusions                                                                                                                                                                                                                                              | Verification entry points                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `use-chat.tsx`, `chat-view.tsx`, `chat-presentation.tsx`           | Conversation CRUD/rename, history generations, streaming, cancellation/retry, composer and transcript rendering. Reuses `../use-active-conversation.ts`; no independent selection store or provider access. Shell supplies focus/scroll integration and refresh callbacks. | `tests/profile-dashboard.test.tsx`, `tests/conversation-hydration.test.tsx`                                  |
| `use-health.tsx`, `health-view.tsx`, `health-metrics.tsx`          | Fetch status, selected day/date preservation, daily widgets and weekly/monthly calculations. Reuses `../health-rollup-chart.tsx`; opening Health never initiates sync.                                                                                                     | `tests/health-dashboard.test.tsx`, `tests/health-rollup-chart.test.tsx`, `tests/dashboard-features.test.tsx` |
| `use-activity.tsx`, `activity-view.tsx`, `activity-charts.tsx`     | Search generations, paging/dedup guards, selection, charts/map and metric presentation. No importer or analytics policy; nullable/finite metric semantics are preserved.                                                                                                   | `tests/profile-dashboard.test.tsx`, `tests/activity-dashboard.test.ts`                                       |
| `use-training-plan.tsx`, `training-plan-view.tsx`                  | Singleton snapshot, stale metadata, draft/edit/cancel/save lifecycle and Markdown view. No chat write authorization or schema ownership.                                                                                                                                   | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`, `tests/training-plan-route.test.ts` |
| `use-profile.tsx`, `profile-card.tsx`, `profile-fields.tsx`        | Profile request generations, dirty-edit protection, retained preferences, form/save feedback. Does not own imported athlete/body metrics.                                                                                                                                  | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`, `tests/profile-route.test.ts`       |
| `use-memory.tsx`, `memory-content.tsx`, `memory-presentation.tsx`  | Readiness/list, filters/sort, edit/toggle/delete/clear and confirmations. No embedding/extraction policy or transcript archive.                                                                                                                                            | `tests/profile-dashboard.test.tsx`, `tests/memory-route.test.ts`                                             |
| `use-sync.tsx`, `sync-view.tsx`, `sync-presentation.tsx`           | Sync duplicate-start ref, NDJSON progress and bounded log, summary normalization, athlete/body summaries and detail refresh. Receives explicit Health-refresh callback; cannot import sibling state.                                                                       | `tests/profile-dashboard.test.tsx`, `tests/health-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`   |
| `use-data-controls.tsx`, `settings-view.tsx`                       | Request status/error adapter and diagnostics visibility; composes Profile, imported summaries, debug traces and existing deletion scopes. No new confirmation, mutation or credential authority.                                                                           | `tests/profile-dashboard.test.tsx`                                                                           |
| `contracts.tsx`, `transport.tsx`, `formatting.tsx`, `markdown.tsx` | Client wire shapes/defaults, existing response decoding/error behavior, shared labels and safe Markdown links/tables. No server capabilities or dashboard-wide mutable state.                                                                                              | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`                                      |

Integration stays explicit: startup schedules conversation/memory/Profile/plan/summary
loads; persisted conversation changes load history via Effect Events; navigation
triggers Activity search and plan reload. Successful sync awaits summary refresh,
then refreshes already-loaded/open Health while preserving its date. Streamed chat
completion refreshes memories/conversations and conditionally the plan. JSON fallback
retains its different refresh conditions. These are compatibility contracts, not
opportunities to normalize behavior during extraction. Keyboard effects read current
close handlers without depending on render-local identities.

## Main server and operational components

Paths in the table are repository-relative source/test entry points. Specialized
docs carry the deeper contract rather than duplicating it here.

| Component                | Owns / does not own                                                                                                                                              | Source and tests                                                                                                                                                                                                                            | Failure/privacy/operational reference                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API delivery             | HTTP validation, compatible payloads, streaming/cancellation and route orchestration; not SQL schema, coaching formulas or Garmin authentication                 | `src/app/api/*/route.ts`; `tests/chat-route.test.ts`, `tests/profile-route.test.ts`, `tests/memory-route.test.ts`, `tests/health-dashboard-route.test.ts`, `tests/training-plan-route.test.ts`                                              | No app sign-in boundary: loopback binding is operationally required. [Local runtime](local-runtime.md)                                                                                                                                   |
| Context and instructions | Bounded source precedence, user/Profile/transcript/Garmin/memory separation; prior assistant prose is not measurement authority                                  | `src/lib/ai/context.ts`, `trainer-instructions.ts`, `training-plan-evidence.ts`; `tests/trainer-instructions.test.ts`, `tests/training-plan-evidence.test.ts`                                                                               | [Coaching instructions](coaching-instructions-and-sources.md); plan snapshot/write rules in [design choices](design-choices-and-boundaries.md)                                                                                           |
| Providers                | Explicit vendor configuration and adapters; no data repository or coaching rubric                                                                                | `src/lib/ai/providers.ts`, `provider-errors.ts`; `tests/provider-config.test.ts`, `tests/openrouter-adapter.test.ts`, `tests/env.test.ts`                                                                                                   | Auto selection is **DeepSeek-first, OpenAI fallback**; explicit OpenRouter uses chat completions, Ollama endpoints must be loopback. Memory extraction/embeddings are separately configured. [Memory](memory.md)                         |
| Orchestration and tools  | Sequential validated dispatch, same-turn evidence, budgets and bounded synthesis/failure prose; not hidden ranking weights                                       | `src/lib/ai/orchestrator.ts`, `tool-contracts.ts`, `tool-execution.ts`, `tool-execution-context.ts`, `tool-evidence.ts`, `execution-budget.ts`; `tests/ai-orchestrator.test.ts`, `tests/ai-tools.test.ts`, `tests/trainer-progress.test.ts` | 30 combined admitted provider/tool attempts, soft target 20, one final-answer reserve. Failed attempts count; analytical successful-result quotas are separate (limit 30), not the obsolete schema=1/SQL=2/math=1/four-tool budget.      |
| SQL and math             | One allowlisted read-only SELECT/WITH, capped rows and same-turn handles; bounded generic formula/aggregation/ranking                                            | `src/lib/ai/sql-analysis.ts`, `math-analysis.ts`; `tests/sql-analysis.test.ts`, `tests/math-analysis.test.ts`, `tests/architecture-graph.test.mjs`                                                                                          | No raw archive, auth, filesystem/process/network or arbitrary scripts. Pure local math helpers require graph verification. Generated analysis is a deprecated opt-in fallback, not normal analytics. [Guardrails](project-guardrails.md) |
| Storage and lifecycle    | SQLite schema/version integrity, repositories, conversations, plan, Profile, normalized Garmin data, memory and scoped deletion; no providers/prompts            | `src/lib/db/schema.ts`, `migrations.ts`, `repository.ts`; `tests/migrations.test.ts`, `tests/chat-history.test.ts`, `tests/training-plan-repository.test.ts`, `tests/import-summary.test.ts`                                                | Garmin deletion is separate from chat/Profile/memory. No migration in this refactor. [Developer process](developer-process.md)                                                                                                           |
| Garmin connector/import  | Pinned stdio, read-operation allowlist, normalization, resumable checkpoints, detail availability and redacted archive; no Garmin write-back/password collection | `src/lib/garmin/client.ts`, `importer.ts`, `mcp-config.ts`, `raw-payload.ts`; `tests/garmin.test.ts`, `tests/detail-sync.test.ts`, `tests/daily-health-sync.test.ts`, `tests/garmin-mcp-config.test.ts`                                     | Undocumented consumer endpoints are an explicit private-MVP risk. [Garmin risk](garmin-risk.md), [out-of-band auth](garmin-auth.md)                                                                                                      |
| Semantic memory          | Embedded SQLite retrieval, concise user-derived facts, independent embeddings/extraction and inspectable lifecycle; not a transcript/Garmin archive              | `src/lib/memory/*`, `src/lib/ai/profile.ts`; `tests/sqlite-memory-adapter.test.ts`, `tests/memory-contract.test.ts`, `tests/memory-config.test.ts`                                                                                          | Corrections, current transcript, Profile and tool facts outrank memory; diagnosis/treatment is excluded from durable memory. [Memory contract](memory.md)                                                                                |
| Diagnostics              | Allowlisted readiness/redaction reports, not token-content inspection or destructive repair                                                                      | `src/lib/diagnostics/*`, `scripts/doctor.ts`; `tests/doctor.test.ts`                                                                                                                                                                        | Debug traces may contain private normalized context and stay local. [Source readiness](source-beta-readiness.md)                                                                                                                         |
| Runtime/validation       | Reproducible Node 22 install, build/doctor/loopback start and blocking checks; not deployment/release authorization                                              | `package.json`, `scripts/bootstrap-local.mjs`, `restart-local.sh`, `migrate.ts`, `architecture-check.mjs`; `tests/bootstrap-local.test.ts`, `tests/restart-local.test.ts`, `tests/guardrails.test.ts`                                       | `npm ci`, `CI=true npm run validate`; [validation](validation.md), E0007 live-smoke runbook and [developer process](developer-process.md)                                                                                                |

## Chat execution and delivery

Chat now follows `route → delivery → chat/turn → chat/context + providers +
orchestrator + repositories/memory`. Application owners have no HTTP/stream or
route dependency. Preparation saves the user; generation produces a typed answer
and progress; completion saves the assistant, awaits best-effort memory and
reloads history. JSON and NDJSON share those operations, while delivery owns DTOs,
debug visibility and the existing stream abort-before-completion boundary.

`src/lib/chat/{context,turn}.ts` and `src/app/api/chat/delivery.ts` expose the seams
covered directly by `tests/chat-boundaries.test.ts` and
`tests/chat-delivery.test.ts`; integrated `tests/chat-route.test.ts` retains real
orchestrator wiring. Mode-specific context counts, previous-failure debug traces
and metadata differences are compatibility requirements, not normalization
opportunities. See [chat ownership](design-choices-and-boundaries.md#chat-application-and-http-delivery).

## Turn-owned tool execution

Each orchestration creates one `TrainerToolExecutionContext`, passes it explicitly
through typed dispatch to analytics, and disposes it in `finally` on every exit.
Only successful SQL/math results register handles. Clearing the registry does not
mutate returned evidence arrays; names may still be overwritten/chained **within**
a turn, but cannot be cleared, overwritten or consumed by another turn. This is an
intentional concurrency correction, independently tested with provider barriers.

`tool-contracts.ts` validates provider inputs into a discriminated union;
`tool-types.ts` owns dependency-free metadata. `tool-selection.ts` owns synchronous
batch validation, stable priority ordering, successful-quota eligibility,
truncation and selection metadata. It observes readonly turn snapshots and imports
only contracts, shared execution policy and the rejected-step constructor
in `tool-step-diagnostics.ts` (whose imports are erased types); it cannot execute tools or import orchestration.
The loop delegates selection and live quota rechecks while retaining all mutations.
Direct tests in `tests/tool-selection.test.ts` need no execution/provider mocks;
`tests/tool-selection-orchestration.test.ts` exercises live rechecks at a controlled
quota edge, alongside the existing integrated orchestration/plan regressions.
The dispatcher directly composes
analytics, local-data and Training Plan handlers. `tool-evidence.ts` only formats,
redacts and grounds evidence, with erased result-type imports and no execution
capabilities. Math receives rows only, never the context owner or repository.
Orchestration retains sequential admission, budgets, prior-pass plan snapshots,
side-effect guards and synthesis. Cancellation semantics are unchanged. See
[tool-runtime boundaries](design-choices-and-boundaries.md#explicit-tool-runtime-boundaries-srclibaitool-ts)
and `tests/tool-runtime-ownership.test.ts` / `tests/tool-boundaries.test.ts`.

## Persistence owners

- `src/lib/db/connection.ts` owns the single lazy SQLite connection, ordered
  migrations and existing compatibility DDL. All storage owners use it directly.
- `conversation-repository.ts` owns conversation/message persistence, pagination,
  title/grounding helpers and the single monotonic message timestamp state.
- `training-plan-repository.ts` owns singleton plan persistence and revision/stale
  metadata. Synchronous snapshot authorization/edit/write stays in the AI handler.
- `conversation-lifecycle.ts` owns the complete single-conversation deletion
  transaction: messages, conversation-derived semantic memory soft deletion, then
  conversation. History clear delegates to it; routes retain fallback selection.
- `repository.ts` deliberately retains Profile/memory, Garmin, summaries, metadata
  and bulk deletion. Explicit compatibility exports serve existing integration
  callers; new domain consumers import the cohesive owners, never the facade.

Dependency direction is consumer → domain/lifecycle → connection → env/migrations.
Lifecycle uses conversation ID validation, not the reverse. Storage references AI
contracts only through erased type imports. No SQL, schema, migration, transaction
scope or bulk-deletion behavior changes. In particular bulk chat/Profile clearing
continues to preserve semantic memory, unlike single-conversation deletion.
`tests/persistence-ownership.test.ts` covers shared connection visibility, edge
contracts, deletion scope/rollback and route fallback; existing history, memory,
plan, summary and migration suites remain integration evidence.

## Selected-activity chart and route calculations

`src/lib/analytics/activity-dashboard-calculations.ts` owns two synchronous pure
facades over already selected, ordered normalized rows: `buildActivityDashboardCharts`
and `buildActivityDashboardRoute`. It has no imports or storage, environment,
filesystem, provider or connector capability. Its plain chart/route contracts are
composed into the repository's existing `ActivityDashboardDetail` response.

`getActivityDashboardDetail` retains SQLite queries, row selection/order, detail
availability, laps and HR-zone composition; it delegates only chart timing,
60-second distance-based speed, 180-second grade readouts and route filtering,
bounds and endpoint-preserving sampling. Chart points are not downsampled. Route
bounds use every accepted point, including points omitted by the 400-point cap.
There is no sorting, input mutation, new fallback, formula or schema change.
The existing repository window-constant exports remain compatible.

`tests/activity-dashboard-calculations.test.ts` exercises the pure facades without
SQLite or environment setup, including original window-boundary/duplicate behavior
and frozen inputs. `tests/activity-dashboard.test.ts` retains repository/API wiring,
privacy, lap and HR-zone integration coverage. Source revert is sufficient rollback;
no stored-data backfill or migration is needed.

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
