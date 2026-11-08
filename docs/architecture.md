# Architecture

The supported product is a source-built macOS ARM64 Tauri app with a private,
single-user supervised loopback backend, not a standalone browser app or hosted service.
The model reasons; server-owned SQL retrieves bounded facts; bounded math transforms
those facts. UI composition does not own coaching policy, persistence or connector
credentials. See [design choices](design-choices-and-boundaries.md) for the reasoning
and [project guardrails](project-guardrails.md) for enforced dependency boundaries.

## Desktop runtime boundary

`src-tauri/src/{main,supervisor,settings,private_store,keychain,auth,onboarding}.rs` owns native private file settings, explicit read-only legacy Keychain adoption, bounded private Garmin auth, a single verified backend/window and owned-process lifecycle. `scripts/desktop/{assemble.mjs,settings.ts,config.ts,http-policy.ts,runtime.ts,garmin_auth.py}` owns locked resources, shared allowlisted validation, private activation and first-party pinned-library auth. Desktop never loads user env files; retained CLI env loading remains separate. Provider values from the owner-private plaintext document reach only the owned backend over its private activation/liveness pipe; ordinary operations never access Keychain; Garmin credentials remain transient in local setup/native auth, never trainer/model/HTTP context. Atomic versioned private documents and explicit all-slot adoption preserve legacy settings/Keychain originals; native-managed fresh-token allocation reuses pinned private-parent safety, and independent exclusive verified publication returns only a session-bound setup draft selection. Saved token paths remain compatible internal settings, not normal controls; ordinary Save projects only catalog/shared keys through a fixed authenticated owned-backend endpoint after private commit. See [settings/auth contract](desktop.md). It retains loopback HTTP delivery through the existing Next custom-server API, preserving routes/NDJSON/`after()`, not a new domain backend. Only setup may call settings/auth native commands; default remote trainer has no IPC grant, with the explicitly admitted result-only exception below. Setup-only `read_memory_status` uses the supervisor's exact live port/nonce and fixed `/__desktop/memory-status` resource; native validates a closed bounded enum/boolean DTO. This delegates only to `/api/cross-chat-summary?view=native`, not legacy list/health calls or a generic HTTP bridge. Status returns only active summary configuration and producer metadata, never content/private errors or a provider request. Normal Settings has no diagnostic button/result/timer and does not invoke this command automatically. No provider probe or migration is triggered. External navigation is refused.

Native smoke uses `src-tauri/src/{isolated_run,dev_bridge,dev_capture}.rs` for supported ordinary-artifact admission and shared closed control/capture, while legacy `smoke_config.rs` stays debug/probe-only. The fixed native-installed `src-tauri/debug/smoke.js` bootstrap uses production Next and rendered semantic actions, not state injection or a second application server. Ordinary admission pins private run state/lifetime ownership and verifies actual artifact/resource/source plus fresh native boot/capability identity before control; settings, DB validators/writer leases and the supervisor remain authoritative. Only its exact owned trainer origin receives a correlated-result grant, never settings/auth. Default launches install no bootstrap/bridge/grant despite supported code being present. The owned Python/Swift runner copies unmodified ordinary bundles outside checkout, leaves HOME unchanged and records hydrated save/restart plus fixed geometry-preserving redacted capture. Separately, debug-only `setup_smoke.rs`/`debug/setup-smoke.js` retain finite keyless local Settings/native-completion capture with exact safe run-local Save/defaults, not a new renderer IPC grant. Native credentials/MFA/adoption/pickers/Finish are refused in either admitted mode. Debug also retains finite Health range/capture and synthetic LLM disclosure actions; `dev_input.rs` sends only Enter/Space directly to the owned non-key WebView, never global/hardware input. All added Settings/Health/disclosure command variants and native-input/setup modules compile only with debug assertions. Ordinary native/renderer gates reject them and omit their observations; debug metadata receives closed bounded native schemas. Debug and launch-only release-denial observations remain distinct, not ordinary launch certificates. See [smoke protocol/ownership/evidence](dev-bridge.md) and its [expected task-needed extension recipe](dev-bridge.md#task-needed-bridge-and-runner-extensions). These are present implementation limits, not a permanent Settings/Sync/token feature ban; extensions must preserve native ownership, finite mode-specific admission and default-launch exclusion before use.

`db/desktop-preflight.ts` is an infrastructure adapter: existing-file/current-schema/integrity admission without migration. `db/writer-ownership.ts` is the shared source/desktop cooperative lease and macOS open-file check; `connection.ts` remains the sole lazy SQL owner. Desktop verifies the adoption overlay survives Next's env reset and its selected DB lease before readiness. Explicit first-run fresh initialization is an outer desktop adapter, not ordinary connection/admission: `scripts/desktop/initialize.ts` runs current migrations on in-memory SQLite and returns bounded serialized bytes. Native `onboarding.rs` owns fresh eligibility, private parent descriptors, exclusive staging/publication/target lease, exact identity and commit-aware retry. No selected file is opened writable for migration; ordinary existing-data preflight is unchanged. DB/private-settings/auth commits and backend readiness are distinct. Resource assets stay immutable; selected private state stays outside the bundle. Native owns only its process group, not external Ollama/listeners. See [desktop](desktop.md) for failure, interruption, schema/rollback and provenance details; `desktop-runtime.test.ts` and native Rust tests cover the new boundaries.

## Dependency and data flow

```text
page → TrainerDashboard shell → persistent feature hooks + conditional views
                                  ↓ fetch / NDJSON
API routes → application orchestration → repositories → SQLite
                     ↓                       ↑
             provider adapters       Garmin importer ← allowlisted stdio connector
                     ↓
             validated tool dispatch → SQL result handles → bounded pure math

context ← Profile + normalized Garmin facts + local replay + sealed summary pin
```

Runtime client closures cannot reach database, connector or provider capabilities.
DTOs are client contracts, not imports of server implementations. Storage cannot
import AI runtime code. The graph gate rejects runtime cycles and verifies the
pure math closure; it is not a general filesystem sandbox or proof of privacy.

## Enforced backend roles and composition inventory

[`backend-roles.mjs`](../scripts/backend-roles.mjs) is the complete per-file
feature/layer inventory, checked by normal architecture/validation commands.
Feature folders intentionally mix responsibilities; names/folder depth do not
confer an exemption. [Allowed edges and limitations](project-guardrails.md#featurelayer-ownership-runtime-and-erased-contracts)
include erased contracts without treating them as runtime execution or cycles.

| Feature                     | Inner contracts / application ports                                                                 | Outer composition and capability owners                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat / conversations        | `chat/{contracts,ports,context-ports}`, `createChatTurns`, `createChatContext`, `ConversationPorts` | `chat/{composition,conversation-composition}` binds storage, memory and selected AI generation; chat/conversation HTTP families invoke these seams                                                              |
| AI orchestration / tools    | `TrainerOrchestrationPorts`, tool ports, neutral tool schemas/types, selection/evidence/math        | `ai/{composition,tool-composition}`; provider generation/schema wrapping and model selection are adapters, not inner contracts                                                                                  |
| Guarded analytics           | `analytics/contracts`, synchronous execution/inspection ports and application                       | `ai/sql-analysis` composes `analytics/sqlite-execution`; tool facade never exposes a database handle                                                                                                            |
| Garmin                      | Import reader/storage/config/clock ports, sync/baseline/detail applications and pure normalizers    | `garmin/composition`; reader/MCP/FIT/archive/token/auth modules are mechanical adapters; `importer` is an outer compatibility facade                                                                            |
| Local data                  | Plain read models, selected-row policy, `LocalDataReads` / `LocalDataLifecycle`                     | `local-data/composition` binds SQLite for activity/Health/summary/delete, chat and tools                                                                                                                        |
| Profile / memory            | `ProfileStorage`, semantic `MemoryPorts`, management and legacy application contracts               | Profile/memory compositions bind SQL, config, embeddings/extraction; legacy and sqlite compatibility facades stay outer                                                                                         |
| Training Plan               | Contracts/policy/edits/snapshot and synchronous `TrainingPlanStore`                                 | `training-plan/composition` binds plan SQL for HTTP and tool use                                                                                                                                                |
| Infrastructure / operations | No business-policy exemption                                                                        | DB connection/schema/migrations/repositories, env, diagnostics doctor, connector configuration/auth/FIT and provider/config transports are explicitly classified adapters; diagnostics redaction is pure domain |

The `model-settings` feature owns strict versioned catalog/contracts and supplied-port preference application. Native Settings v3 preserves original v2/v1 settings and independent extraction/title fields; activation v3 carries immutable catalog and private selection-compatibility metadata over the existing private pipe (older v2/v1 remain supported). Lazy composition binds one durable explicit choice with frozen startup compatibility, preserving original preferences, placeholder-aware eligibility and exact chat-only provider construction. `/api/model-settings` returns bounded version-3 metadata; `chat/composition` captures selection/configuration once before context awaits. Live Settings publishes one complete validated catalog/key snapshot in a narrowly named process-owned cell shared by the separately built launcher and Next bundles, never a mutable whole-config env overlay. Fixed authenticated POST/GET validates boot/generation/revision; status acknowledges only published state. Native lock order is service-before-settings, with nonblocking service acquisition during startup and bounded transport. DB schema, provider probing and extraction/embedding topology remain unchanged. Focused `model-settings*` suites cover key/validation/persistence/redaction/UI and overlapping production turn binding.

First-prompt titles use chat-owned application ports, `chat/title-adapter` and the independent shared summary/title model selector, not extraction, ingestion or Trainer preferences. A synchronous message transaction reserves the first eligible message in `conversation_title_attempt`; one conditional claim admits generation. Next.js `after()` owns the bounded post-response work for both HTTP modes. Guarded SQL applies only to that surviving message's unchanged automatic excerpt, never a manual title, without changing recency. Clear/delete preserve small admission tombstones. Optional list `titlePending` metadata and the response `x-chat-title-pending` header drive at most four existing-list refetches; settlement/navigation/unmount stop further reads. See [title behavior and migration](memory.md#first-prompt-chat-titles), `conversation-title*` and chat-boundary tests.

All HTTP route families consume feature composition. `chat/delivery` owns
JSON/NDJSON transport; debug configuration is obtained request-time through the
existing conversation application port, not directly from env. The DB repository
no longer re-exports legacy-memory composition inward: callers of legacy use cases
use `memory/legacy-composition` directly. This removes an unused production facade
edge without changing its SQL, transaction, expiry or confirmation behavior.

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
one disposable tool context; each provider call owns its timeout. Provider disconnect semantics are unchanged. Explicit Sync cancellation/HTTP disconnect now stops sync admission and its owned reader work; persisted normalized data is not rolled back. No global DI
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
contract; Health mode/chart state still follows the Health view lifetime. Daily's
range-end civil date lives in the persistent Health hook: tabs and away/back do
not discard it. Refresh retains any range overlapping eligible loaded dates;
only initial load, explicit Latest, or lost-window reanchoring chooses latest.
The seven ascending calendar slots are not seven newest rows. Missing records,
fields, outside-loaded history and today's UTC in-progress values stay distinct;
no cross-day aggregation or additional read is introduced. Roving keyboard tabs
and responsive raw Daily chart cards with keyboard/pointer exact-value buttons
preserve access without a wide comparison table. Per-date source coverage and HRV
context live in a secondary disclosure; chart presentation projects finite values
or gaps without aggregation, interpolation or date compression.

Files below are in [`src/app/dashboard`](../src/app/dashboard):

| Owner                                                                               | Responsibility and exclusions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verification entry points                                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `use-chat.tsx`, `chat-view.tsx`, `chat-presentation.tsx`                            | Conversation CRUD/rename, history generations, streaming, cancellation/retry, composer and transcript rendering. Reuses `../use-active-conversation.ts` for transient unresolved/empty/selected React state; serializes DB selection/bootstrap/create/delete and rejects superseded history/page/list responses. No browser storage or provider access. Shell supplies focus/scroll integration and refresh callbacks.                                                                                                                                                             | `tests/profile-dashboard.test.tsx`, `tests/conversation-hydration.test.tsx`                                  |
| `use-health.tsx`, `health-view.tsx`, `health-metrics.tsx`, `health-daily-range.tsx` | Fetch generations/status and persistent Daily range; strict civil-date slots and raw Daily charts with exact-value/source-context readouts. Daily and weekly/monthly presentation reuse `../health-rollup-chart.tsx`; opening Health never initiates sync.                                                                                                                                                                                                                                                                                                                         | `tests/health-dashboard.test.tsx`, `tests/health-rollup-chart.test.tsx`, `tests/dashboard-features.test.tsx` |
| `use-activity.tsx`, `activity-view.tsx`, `activity-charts.tsx`                      | Search generations, paging/dedup guards, selection, charts/map and metric presentation. No importer or analytics policy; nullable/finite metric semantics are preserved.                                                                                                                                                                                                                                                                                                                                                                                                           | `tests/profile-dashboard.test.tsx`, `tests/activity-dashboard.test.ts`                                       |
| `use-training-plan.tsx`, `training-plan-view.tsx`                                   | Singleton snapshot, stale metadata, draft/edit/cancel/save lifecycle and Markdown view. No chat write authorization or schema ownership.                                                                                                                                                                                                                                                                                                                                                                                                                                           | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`, `tests/training-plan-route.test.ts` |
| `use-profile.tsx`, `profile-card.tsx`, `profile-fields.tsx`                         | Profile request generations, dirty-edit protection, retained preferences, form/save feedback. Does not own imported athlete/body metrics.                                                                                                                                                                                                                                                                                                                                                                                                                                          | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`, `tests/profile-route.test.ts`       |
| `use-memory.tsx`, `memory-content.tsx`, `memory-presentation.tsx`                   | Persistent generation-safe inspection/mutation owner; one complete generated summary and separate preference editors, exact-inspection confirmations and focused history/management views without archive, selective-import, technical or per-chat snapshot dashboards. Passive observations preserve mounted content; privacy mutations still revoke it. Contextual cancellation reconciles older imports without replay. Presentation translates state/coverage without changing source eligibility, engine policy, API or native Settings. No semantic search/vector retrieval. | `tests/summary-memory-ui.test.tsx`, `tests/profile-dashboard.test.tsx`, `tests/native-memory-smoke.test.ts`  |
| `use-sync.tsx`, `sync-view.tsx`, `sync-presentation.tsx`                            | Sync duplicate-start ref, NDJSON progress and bounded log, summary normalization, athlete/body summaries and detail refresh. Sync renders maintenance actions and current-operation feedback; Profile & data displays imported facts. Receives explicit Health-refresh callback; cannot import sibling state.                                                                                                                                                                                                                                                                      | `tests/profile-dashboard.test.tsx`, `tests/health-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`   |
| `use-model-settings.tsx`, `model-settings-card.tsx`                                 | Persistent shell-owned request state, refresh-on-chat-visibility and direct retry, authoritative explicit-choice save feedback and accessible dynamic activated-catalog control. No keys, SDKs, environment or storage access.                                                                                                                                                                                                                                                                                                                                                     | `tests/model-settings-ui.test.tsx`                                                                           |
| `use-data-controls.tsx`, `settings-view.tsx`                                        | Request status/error adapter and diagnostics visibility; composes Profile & data: Profile, imported facts, debug traces and existing deletion scopes; native Settings owns configuration. No new confirmation, mutation or credential authority.                                                                                                                                                                                                                                                                                                                                   | `tests/profile-dashboard.test.tsx`                                                                           |
| `contracts.tsx`, `transport.tsx`, `formatting.tsx`, `markdown.tsx`                  | Client wire shapes/defaults, existing response decoding/error behavior, shared labels and safe Markdown links/tables. No server capabilities or dashboard-wide mutable state.                                                                                                                                                                                                                                                                                                                                                                                                      | `tests/profile-dashboard.test.tsx`, `tests/dashboard-features.test.tsx`                                      |

Integration stays explicit: startup schedules conversation/memory/Profile/plan/summary
loads; history waits for resolved conversation selection via Effect Events; navigation
triggers Activity search and plan reload. The existing closed-to-open plan effect
revalidates persistent owners; weekly refresh retains the selected historical civil
week or rereads list pages through the oldest loaded week with fresh cursors and
deduplication. General Plan tab entry explicitly refreshes its saved snapshot.
Read generations reject superseded completions; active editor drafts survive
hidden views and refreshed snapshots. Cancel restores the current saved snapshot;
explicit save invalidates older reads. Navigation does not write or remount owners.
Original/latest disclosure equality compares only exact title and Markdown, not
revision/timestamp; the original remains the review baseline in storage.
Successful sync awaits summary refresh,
then refreshes already-loaded/open Health while preserving its Daily date range. Streamed chat
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
| Runtime/validation       | Locked install, explicit non-serving setup, native launch/build and blocking checks; not deployment/release authorization                                        | `package.json`, `scripts/desktop/*`, `scripts/{migrate,db-status,doctor}.ts`, `architecture-check.mjs`; `tests/desktop-only-product.test.ts`, `tests/desktop-runtime.test.ts`, `tests/guardrails.test.ts`                                   | `npm ci`, `CI=true npm run validate`; [validation](validation.md), E0007 live-smoke runbook and [developer process](developer-process.md)                                                                                                |

## AI application and provider/tool adapters

`ai/orchestrator.ts` consumes explicit `TrainerOrchestrationPorts`: plain
planner/final-synthesis generation and admitted tool execution. It has no SDK,
model, storage, environment, connector or outer composition dependency, including
erased types. The loop still owns raw-call aliases/malformed parsing, sequential
admission, actual-attempt counters, synthesis reserve, prior-pass plan snapshots and one
explicit context disposed in `finally`. No scheduling, coaching or retry policy
changes are hidden in this seam.

`tool-contracts.ts` owns unchanged Zod schemas/defaults and neutral descriptions;
`provider-tool-definitions.ts` alone wraps them with SDK `tool`. Selection and
handlers consume neutral contracts. `tool-ports.ts` accepts narrow guarded feature
capabilities from analytics, local-data/Garmin and Training Plan applications;
`tool-composition.ts` binds their existing lazy facades. Pure math stays local.
The dispatcher retains bounded exception handling; plan compare/write stays
synchronous, successful results alone register handles, and no singleton context
or ambient dependency setter is introduced. Debug/progress/tool metadata already
have neutral AI owners; grounding remains the chat-owned contract.

`ai/composition.ts` binds the selected model to `provider-generation.ts` before
calling policy; chat's request-time selection remains before context reads.
The adapter preserves planner action tools/auto/parallel options. Ordinary text
finishes a turn when no action calls remain. Reserved synthesis exposes no tools
or forced response protocol. Raw action results remain
application-validated, with one 180000ms per-call AbortController timeout and timer
cleanup. HTTP disconnect does not acquire
provider cancellation, and memory keeps independent provider configuration.

`tests/ai-application.test.ts` supplies capabilities directly without module mocks;
`provider-generation.test.ts` verifies exact SDK options/results, schema wrapping,
rejection/timer cleanup and isolated timeout signals. `ai-dependencies.test.ts`
follows the reviewed type-inclusive closure (only existing Zod schema use is an
external exception), with negative SDK/DB/connector/composition/ambient fixtures.
Existing schema snapshots, real SQLite tool suites, provider-mocked production
chat, budget/plan and overlapping-turn suites retain integration coverage.
Provider/tool ownership stays separate. H adds schema18 journal/segments and role
replay at the wire boundary; its [copy rehearsal, compatibility fence and native
evidence](conversation-history.md) replace a blanket migration no-op for that slice.
No UI redesign or primary activation is implied.

### Ordinary chat answers and evidence

Planner generation exposes actual action tools only. Nonempty ordinary text with
no pending calls finishes directly; mixed text/action responses still validate and
execute selected actions. Empty or malformed output is a provider-response failure,
not an evidence verdict, and adds no checker-repair call. Budget termination and
post-evidence provider/analytical failures retain one genuinely needed, budgeted,
action-disabled synthesis; unexpected calls there never execute.

The model-authored `completeTrainerTurn` certificate, per-cell assessment,
checker feedback and canned refusal are retired without replacement. Evidence
selection, accurate numbers, faithful prose and honest gap disclosure are ordinary
model responsibilities, not machine-certified facts. Instructions retain source
precedence and explicit missing/ambiguous/failed/partial/truncated coverage; lookup
metrics need no duplicate SQL merely to manufacture claim references. No prose
classifier, second judge, renamed terminal gate or automatic repair loop is added.
`getActivityDashboard` adds one read-only numerical overview for a known imported
ID through local-data application/composition. Shared inward summary/lap projections
preserve the dashboard API's units, nulls and speed fallback. Complete owned HR-zone
status/timing/boundary provenance precedes optional20-row lap/terrain sections;
lap source totals are explicitly unknown at the100-row dashboard source cap.
Terrain keeps its whole-analysis coverage/counts, including unsupported/partial
states independently of valid summary/HR facts. Numerical-only default exposes no GPS, charts/raw streams,
connector refresh, storage migration or focused-UI selection. Optional unique
`panels` selects heartRate/elevation/speed/route images from the same synchronously
captured dashboard input; route geometry is never implicit. The finite sharp PNG
adapter reuses shared chart calculations and the interactive map's unchanged
offline projection. Route images visibly disclose offline geometry/no topographic
background/no tiles, sampling and attribution; no remote tile fetch is added.
Images are 960×540, at most 1 MiB each/four panels. Above100,000 chart
samples a panel explicitly reports render_input_limit instead of silently
clipping/downsampling. A separate monospace identity line fits full64-character IDs. Missing data/render/unsupported
selected model leaves usable numbers and per-panel unavailability. This
finite result uses a dedicated complete native/legacy evidence path rather than
the generic1800-character preview; native fresh context remains an index only.
SQL/math, specialised terrain/detail tools and ordinary final prose remain available.

Per-turn `TrainerToolExecutionContext` owns image bytes separately from returned
steps, debug, grounding and stored history. Finally zeroes bytes/releases references
on success/error/currentness invalidation; already exported SDK/provider copies
cannot be recalled. Later turns/history have prose/numerical context only and
must explicitly request new images. Capture metadata binds activity, source hash,
UTC instant and selected panel, independent of the focused UI. Existing currentness
checks bracket asynchronous work. There is no durable media store or migration.

`provider-activity-images.ts` owns conservative exact support: direct OpenAI
Responses gpt-4o/gpt-4o-mini/gpt-4.1 family entries listed there, and loopback Ollama
llava/llama3.2-vision base or :latest identities. This is adapter/model-family
support, not remote readiness/installation certification. Unreviewed identities
(including gpt-6), custom tags, DeepSeek and OpenRouter remain explicit unsupported;
no probing, routing fallback or catalog redesign. Image-bearing direct Responses
requests explicitly use store:false, including legacy routes; SDK/provider error
echoes become fixed safe errors. This cannot recall already exported input or
guarantee external provider retention. Locked ai7 Responses receives
native tool content file/data PNG parts. Chat Completions keeps native call/result
pairing plus one labelled current-turn user image message, since image tool
results are unsupported there. Numerical evidence has one detailed carrier on
both native-envelope and legacy routes. Tests inspect real serialized requests;
keyless native proof is not live model interpretation.

Tool schemas/admission, guarded SQL/math, same-turn handles, prior-pass plan reads,
write/privacy/currentness boundaries and actual-call budgets/accounting remain.
All deterministic fallbacks disclose independently successful planning writes.

On conversation-envelope routes (full replay and memory-only), paired native
results are the sole detailed carrier of each executed step. Fresh context keeps
only its step/status/successful-handle index plus unpaired selection/budget
diagnostics. Complete General Plan and weekly documents remain in bounded native
results, including their untrusted-document boundary; earlier pairs remain
historical rather than being rewritten. The latest General Plan read and last two
successful weekly reads retain their existing applicability. Legacy no-envelope
requests keep textual evidence. This index alone proves no measurement, coverage
or write authorization. Display/debug grounding is independent and unchanged.

Chat retains typed current-date/prior-failure context, paired native exchanges,
immutable admitted snapshots, completion journals and JSON/NDJSON/history contracts.
Historical debug records remain readable without revalidation or rewriting failures;
obsolete response content is omitted if unexpectedly encountered in new diagnostics.
No database/import/UI shape migration; back-sync is a no-op and rollback is a source
revert. Source delivery does not restart/install/release the primary application.

## Guarded analytical policy and SQLite execution

`ai/sql-analysis.ts` is the lazy production composition/compatibility facade;
only `describeGarminDatabase` and `runReadOnlySql` are exposed to analytical tools.
`ai/analytics/contracts.ts` owns plain row/result/schema/input shapes and the
consumer-owned execution capabilities. Math, tool evidence and the turn-owned
handle map use these neutral types, never concrete SQLite types.

`analytics/schema.ts` owns the exact allowlisted descriptors, examples, limits
and privacy description; `policy.ts` owns admission precedence, CTE/table checks,
name/limit coercion, correction hints/error redaction and bounded normalization.
`application.ts` receives explicit execution and clock capabilities. It admits
before opening a session, runs one synchronous query and interprets its result.
The session exposes rows, empty-result column names and close, not a Database or
Statement. Inspection is a separate fixed-table statistics operation with no
caller-provided metadata SQL. There is no container or ambient dependency setter.

`analytics/sqlite-execution.ts` alone initializes the existing app DB, resolves
the path, opens readonly/fileMustExist with a 750ms busy timeout and enables
query_only. It keeps prepare → safeIntegers(false) → all, fixed inspection SQL,
and concrete close mechanics. The application retains open and initial clock
outside its try, elapsed checking immediately after all (before empty columns),
normalization inside catch/finally and unhandled close failures. Inspection
closes on success/failure. The existing timeout is **not** hard query preemption;
no parser fixes, extra queries, access expansion or lifecycle corrections are
hidden in this structural change. Only successful results register same-turn
handles in `tool-analytics.ts`; rejected/failed queries cannot replace them.

`tests/sql-compatibility.test.ts` freezes pre-extraction provider schema and
admission/error snapshots. `sql-application.test.ts` directly supplies ports and
a clock to cover rejection-before-I/O, ordering, limits, normalization and errors.
`sql-execution.test.ts` covers actual readonly/query_only settings, closed handles,
inspection and production tool wiring. `sql-dependencies.test.ts` checks the
transitive type-inclusive inner closure, with negative infrastructure/composition
fixtures; the runtime graph and existing SQL/math/tool/orchestrator suites remain
required. SQL/schema/back-sync is a no-op; source revert is sufficient rollback.

### Calculated activity-grade evidence

`analytics/calculated-grade.ts` owns pure mechanical signed altitude-change /
cumulative-distance-change estimates, not coaching classifications or dashboard
readouts. `sqlite-execution.ts` registers connection-local
`activity_calculated_grade(activity_id)` for guarded SQL: explicit activity IDs
select at most 100,000 normalized samples via the existing primary key, with at
most 32 function invocations per query. A lazy separate readonly/query-only
snapshot supplies samples because SQLite callbacks cannot re-enter the executing
connection; the query session closes both handles on success/failure. Unbound
schema inspection reports zero static rows as registration metadata, never as
activity availability, and never computes windows. The hidden `garmin_id`
parameter supports function arguments, WHERE constraints and constrained joins;
safe numeric ID literals are accepted. Unconstrained access fails with a bounded
correction message rather than silently reporting missing data.

Timestamp-only consecutive sections target 180 seconds, share boundary endpoints,
and require at least 60 seconds, 3 complete samples and 10 meters net distance.
Adjacent times strictly increase with gaps <=30 seconds; cumulative distance is
nonnegative/nondecreasing. Invalid sections return null and quality status, not
zero. Method, actual support and valid/total **section** coverage accompany grades;
shared endpoints mean summed sample counts are not unique-stream coverage.
No-stream/over-limit inputs return unavailable sentinels. Stored elapsed can be
an unmarked sample index and never establishes timing by itself. The descriptor
and executable single/multi-activity examples own the exact analytical contract.

Source `grade_pct`, source `has_grade`, imports and dashboard calculations remain
unchanged. No DB objects, migration, re-import or backfill: existing stored
prerequisites are derived at read time; source revert is sufficient rollback.
Pure edge fixtures, guarded relation/claim tests, readonly resource lifetime and
existing dashboard/privacy suites cover this addition. Grade remains an estimate,
not measured instantaneous slope, terrain or technicality.

## Local-data application and adapters

`local-data/application.ts` exposes synchronous read use cases and scoped deletion
through consumer-owned `LocalDataReads` / `LocalDataLifecycle` capabilities.
`composition.ts` binds the existing SQLite adapter lazily: Activity, Health,
summary and delete HTTP routes, chat context, Garmin read composition and local
data tools use these applications. Transport retains DTO/date serialization,
labels, lap-speed display fallbacks, parsing and error/status behavior. Health
retains its newest-first 366-day window; status retains its count fallback and
read order. Reference verification preserves its existing all-summary selection,
exact normalized-name/date/ID matching, order and ambiguity before match caps.

`contracts.ts` owns read models independently of SQLite. Existing plain Garmin
contracts (including stage-2 `HealthCoverage`) remain authoritative, not copied.
`health-policy.ts` owns nullish merging and clock-supplied trailing/refresh
criteria; `heart-rate-policy.ts` owns Garmin-total versus local-stream timing;
`activity-policy.ts`, `coverage-policy.ts` and `dashboard-policy.ts` own reference,
paging and selected-row interpretation. T0190 chart/route calculations remain
unchanged. The repository keeps proven SQL predicates, aggregate queries,
selection/order/caps, JSON/date/boolean row decoding and import transactions.
Pure functions receive selected values; no unbounded replacement of SQL filters,
new framework/container, ambient setter or inward compatibility-barrel import.

`db/local-data-lifecycle.ts` owns the two complete atomic bulk transactions. The
application selects one scope, then reads counts after its commit. Chat/Profile
clears messages, conversations and Profile only. Garmin clearing retains the exact
13-statement list/order and labels; in particular it does **not** newly delete
`activity_hr_zone_time`, `activity_detail_attempt`, either memory store, the plan,
app metadata, auth rows or external files. These historical exclusions are
compatibility, not cleanup opportunities. A later statement failure rolls back
all earlier statements; no catch/retry or expanded transaction includes counts.

`tests/local-data-application.test.ts` covers supplied ports and frozen pure inputs;
`local-data-wiring.test.ts` covers actual HTTP/tool/composition/SQLite, every bulk
table and exclusion, exact statement order, late-failure and missing-table rollback.
`local-data-dependencies.test.ts` follows type-inclusive pure/application closures
and rejects outer capabilities; existing dashboard, daily-health, summary, import,
chat and tool suites retain integration coverage. No schema, metric, data shape or
import behavior changes: migration/back-sync is a no-op, source revert is rollback.

## Garmin application and adapter boundary

Sync follows `api/sync → garmin/composition → sync-import`; targeted detail follows
`api/activity-detail → composition → detail-requests → detail-import`. The CLI and
local-data tool call the same composed imports. `importer.ts` is a thin legacy
facade, never an inward dependency. `createGarminImports` binds explicit named
reader operations, synchronous import storage, request-time config and a clock.
`baseline-import.ts` owns athlete/body refresh failure and preservation policy;
`detail-import.ts` owns effort/detail attempts, partial success and lifecycle;
`import-policy.ts` owns legacy date planning and detail error classification; pure `history-policy.ts` owns additive versioned family progress, unknown-boundary semantics, UTC date arithmetic and the finite Sync admission contract. Contracts live in
`import-contracts.ts`, `import-ports.ts` and existing feature types, not DB types.

`dependency-error.ts` is a closed pure Garmin action-error contract (launcher unavailable versus unknown startup), not a capability registry or process owner. MCP converts OS spawn facts to it; Sync carries its optional reason in the existing result envelope and renders setup guidance without a login recommendation. Native `runtime_dependency.rs` owns only the bounded non-installing auth-time installed-Python diagnostic; no startup/Settings/offline readiness gate is added. Optional FIT and persistent checkpoint versions are unchanged.

`reader-adapter.ts` owns MCP wire parsing, activity/health/detail normalization,
FIT supplement ordering and archive dispatch. Profile/body/FIT-baseline values
remain unknown inputs to the existing pure, validating feature normalizers; no
vendor SDK or arbitrary tool dispatcher enters application ports. Composition
supplies the pinned stdio client, local FIT wrappers and repository archive writer,
which still redacts before persistence. The archive precedes normalization and
normalized writes. All successful daily-health subreads precede archives; recognized plain-text authentication/rate-limit errors now stop before further date subreads. Unknown/malformed responses never become successful empty coverage.
No raw archive is exposed to the application store or HTTP response.

Composition performs no DB/env/clock/client work at import time. Sync records its
run before reader construction, starts/closes one reader per invocation and keeps
initial DTO reads outside its try/finally. Standalone effort converts startup
errors to failed results, while standalone detail propagates startup errors.
Close remains synchronous and is not swallowed. The new `garmin_history_v1` checkpoint keeps separate reverse health, frozen activity-window/page and body-history positions; old global cursors are never reused as range identities. Idempotent normalized writes precede cursor saves, so a crash replays rather than skips. Existing evidenced historical dates can be traversed without remote re-fetch; no local minimum becomes a remote lower-bound proof. Failed health dates remain separately unresolved. Body writes merge date-keyed history and preserve current facts during older-only batches. No schema migration/reset is needed.

The bounded tool/maintenance invocation retains 96 remote-operation attempts/180 seconds and 30 seconds per nested MCP/FIT operation. Explicit interactive POST selects one foreground operation with a non-resetting 30-minute/480-attempt ceiling and at least 1,000ms between serial dispatches. The supplied wait/clock/admission ports count startup, nested calls and pacing without introducing ambient capabilities into policy. One application claim spans all batches, normalized/cursor/operation settlement and owned close. Recent facts and common profile/FTP/FIT supplements run once; historical families rotate to avoid starvation under slow reads. Safe pre-dispatch batch exhaustion may continue; an in-flight timeout, connector/protocol/auth/rate/storage failure or no progress stops dispatch without retries. The outer reader owns timers/cancellation and reports even failures swallowed by best-effort baseline/detail policy back to interactive admission.

Pure `sync-policy.ts` owns the closed latest/history intent and authoritative historical action/next-work projection. The existing import application supplies current scope, validated checkpoints and the same SQL repair selection used for execution; `/api/summary` composes that passive projection alongside stored counts. Results and reload use the same policy, never text parsing or history-existence JSX rules. Latest writes only additive `garmin_latest_v1` settlement/counters and leaves family/discovery checkpoints byte-identical, including unfinished history. Explicit history refuses active, changed-scope, unsupported or failed/no-progress recovery state; its signature excludes repair rotation alone as useful progress. Existing legacy callers retain their bounded behavior. The persistent hook invalidates stale/superseded summary admission, sends explicit intent, retains disclosure/log state and requires refreshed settlement after transport loss. Technical logs are collapsed and not a hidden live region; upsert counters are processed/refreshed, never inferred new imports.

Pure `discovery-policy.ts` validates a single reviewed `get_weekly_steps` hint schema. Its 52-week logical range read prioritizes candidate dates only; no negative or cross-family coverage/bound is inferred. Named reader, application allowlist and enabled-tools agree; raw hint/profile payloads are not retained as discovery provenance. `garmin_discovery_v1` is additive alongside unchanged family v1: hint range/count/source/time, positive date queue/cursor and latest operation phase/attempts/batches/outcome/stop reason. Valid v1 checkpoints resume without resets; unknown new state refuses. Normalized writes precede family/queue cursor saves for replay. A compatible prior revision ignores the new key and preserves normalized data/backups; returning forward revalidates it. HTTP owns NDJSON/disconnect; persistent shell Sync survives navigation. Setup/launch/summary never start work; a lost response reconciles durable/live truth and restart requires explicit Resume. Persisted running without a live owner is interrupted, not active. No durable scheduler, generic job API or model-driven 30-minute continuation is introduced.

`tests/garmin-application.test.ts` uses supplied fake capabilities and ordered
write/event journals, without infrastructure mocks. `garmin-reader-adapter.test.ts`
checks wire/archive/FIT order; `garmin-production-wiring.test.ts` exercises actual
HTTP/composition/reader/SQLite wiring with only external connector/process seams
replaced. `garmin-dependencies.test.ts` follows type-inclusive closures and rejects
outer imports/ambient capabilities. Existing athlete, daily-health, detail,
connector and AI tool suites retain compatibility coverage. `garmin-history.test.ts` additionally exercises real HTTP/SQLite discovery, sparse metric islands, preserved old weight rows, fatal/protocol failures, cancellation/exclusion and nested admission/deadlines. SQL schema is unchanged, but checkpoint/body-merge semantics require same-task populated-copy transition/re-sync verification; they are not a data back-sync no-op. Source rollback ignores additive discovery keys and preserves normalized records/backups; the prior exhaustive policy is not bounded-sync certification.

## Personalization application and adapters

The [accepted memory contract](memory-redesign-contract.md) and [scenarios](memory-redesign-acceptance.md)
separate source behavior from evidence/activation. [S](cross-chat-summary.md) owns
one complete generated text, output-only exact-text ordinary edits and foreground
incremental generation; `db/summary-storage`
owns eligibility/lease/CAS/coverage/manual/spend and `db/summary-import` owns sealed
reviewed source selections/dispositions through that same writer.
`db/summary-rebuild` adds bounded original inventory/provenance and operation staging
under schema22/23 with sealed reviewed selection/legacy intent and known future-Clear restrictions; it supplies candidates to that writer, not a second generation
engine. Composition binds native boot/live configuration to reviewed Start and
foreground continuation; the ordinary lifetime alone schedules internal jobs.
Only complete validated replacement publishes, preserving manual/suppression and
stable-pin semantics. Original-message authority is conservatively fenced where
prior Clear eligibility cannot be proved. The provider
adapter reuses the existing exact provider routes for the independent shared
catalog choice; composition binds admitted native config. Selection decoding is
pure `model-settings/summary-selection`; `memory/summary-configuration` captures
identity/catalog/connection/keys without Trainer preference resolution. No
capacity/tokenizer/pricing qualification registry or application monetary/attempt
cap is required; provider refusals do not trigger fallback. One
launcher lifetime invokes its private tick; passive reads create no provider work.
`chat/summary-pin` retains frozen memory serialization and old projection compatibility;
new requests include full privacy-valid pins without token-count admission.
Conversation-owned
`db/conversation-summary-pin` seals/adopts/validates snapshots transactionally.
Schema20 adds those consumer/control/import/title-spend records without rewriting
18/19. Ordinary chat retires semantic retrieval/ingestion; legacy stores remain.

[Linked conversation replay/local compaction](conversation-history.md) is chat-owned,
not a second global-memory producer. Pure replay/compaction consumes narrow history
and generation ports; `db/conversation-history.ts` owns schema18 journal/segment/CAS,
privacy and spend transactions. `ai/conversation-transport.ts` counts exact SDK
Responses input before reviewed Luna inference; provider credentials remain with
existing selection. Null global summary and legacy/unavailable memory are supported
independently. Unknown models retain explicit legacy mode; none is substituted.

Memory follows `api/memory → memory/composition → management/application`.
`createMemoryStore` consumes feature-owned `MemoryPorts`: synchronous semantic
storage, embeddings, extraction, identity, clock and a secret-free configuration
snapshot. `retrieval-policy.ts` owns ranking, stable ties and render filtering;
`extraction-policy.ts` owns prompts, parsing and source/privacy validation using
plain generation results. No inner module imports SQL, environment, HTTP, SDKs
or composition, including erased types. Existing `TrainerMemoryStore` shapes
remain compatibility contracts for retained legacy maintenance, not ordinary chat.

`sqlite-storage.ts` retains SQL projections, serialized vectors/source IDs,
upsert conflict behavior, expiry selection and the 200-row candidate cap.
`embedding-adapter.ts` owns transport, timeout, normalization and unchanged SHA256
identities/vectors; `extraction-adapter.ts` selects existing DeepSeek/OpenAI and
disables tools. Composition preserves startup memory topology; current stores rotate only on shared-key changes, retaining old in-flight stores. Outer chat admission captures configuration for chat and deferred titles using its prepared-turn WeakMap/AsyncLocalStorage; it no longer constructs a legacy memory store. Titles use the explicit shared summary model and its captured provider configuration,
independently of summary On/Off, with durable attempt/usage receipts but no application
spending/count cap; clearing a key never substitutes another provider. Settings writes
precede singleton reset and health/list reload. Health never migrates; lazy legacy
migration still precedes ingestion/retrieval/enabled listing, records its marker
only after all rows and retains earlier writes on failure. No new retry occurs.

`profile/application.ts` owns normalization/read/save through `ProfileStorage`;
`profile/contracts.ts` owns the existing flexible Profile type independently of
AI presentation. `db/profile-repository.ts` retains synchronous serialization and
read-after-write. `memory/legacy-application.ts` owns proposal bounds, status
validation, expiry-before-list and lifecycle use cases; `legacy-contracts.ts`
owns their plain stored shapes. `db/legacy-memory-repository.ts` retains SQL and
atomic supersede/confirm. Compatibility repository/semantic/parser facades are
outer entry points, never dependencies of policy. HTTP retains error/status and
malformed-body behavior; no Profile error catch is added.

Direct fake-capability tests are in `tests/personalization-application.test.ts`;
`personalization-wiring.test.ts` covers real SQLite, chat completion, routes,
singleton reset, unchanged hash/vector/DTO values and confirmation rollback.
`personalization-dependencies.test.ts` checks type-inclusive closures with negative
SDK/storage/composition/ambient fixtures. Existing memory/config/Profile/chat
suites remain compatibility evidence. No UI, schema, data semantics, provider,
threshold, TTL or historical cleanup changes: migration/back-sync is a no-op and
source revert is sufficient rollback.

## Weekly plans and reviews

`weekly/{contracts,calendar}` owns civil Monday identity, timezone validation and local-midnight evidence intervals (including DST); `weekly/application` owns bounded document policy, immutable original/latest separation, as-of review revisions and direct guarded saves through synchronous `WeeklyStore` ports. `weekly/composition` lazily binds the JSON SQLite adapter and clock/opaque IDs. Migration 16 adds `weekly_artifact` and `weekly_proposal`; no general-plan or Garmin rows are derived/rewritten. Weekly-only data participates in upgrade backup detection.

Dedicated getWeeklyPlan/saveWeeklyDocuments tools consume complete prior-pass reads. Direct save validates current-turn ownership, calendar/content/privacy and unchanged full snapshots before one all-or-nothing weekly transaction; no proposal, assistant binding or confirmation is required. Legacy proposal/application compatibility and stored bytes remain, but are not exposed to the active model path, replayed or injected into chat context. General Plan and weekly bundle each have a once-per-turn attempt guard, including failed/uncertain attempts; distinct feature saves may coexist but are not atomic together. Failure output retains actual prior successes. Model selection follows actual user direction including no-save; there is no consent classifier or injection-proof guarantee. Debug/grounding retain metadata only, not weekly Markdown. Saved weekly artifacts survive chat/Profile and Garmin deletion.

Weekly KPI rubrics and completion scores are model-authored Markdown, not parsed/stored score fields or an app-owned engine. New rubrics allocate 100 full-target points with explained goal-relevant metrics; useful extras may exceed 100 without hiding unmet sport-specific commitments or double-counting benefits. Reviews name the complete original revision as baseline, with target-week SQL/math evidence and coverage limitations. Latest adaptations do not replace the denominator. Legacy rubrics remain provisional; no plan means no completion score and missing evidence never silently becomes zero. `review.planRevision` retains its existing latest-plan-at-save snapshot semantics; the contextual UI label is not a scoring-baseline claim. Existing documents/pending proposals are not migrated or automatically rescored.

`/api/weekly` is a read-only detail/paged-summary adapter; browser chat transports an IANA timezone and legacy callers receive an explicit server-local fallback. `use-weekly` is a persistent shell-owned request owner with generation guards and date/zone rollover checks. `weekly-plan-view` wraps the preserved General Plan editor with This Week/Upcoming/secondary History; history corrections merely prefill chat. Streaming and JSON successful-step metadata trigger refresh. Focus/section-return ownership remains in the dashboard shell. Focused coverage: `weekly.test.ts`, `weekly-ui.test.tsx`, existing chat/orchestrator/plan suites and the production composition/ownership checks.

## Training Plan application and adapters

`training-plan/{contracts,limits,policy,snapshot,edits}.ts` owns the singleton
plan representation, title/advisory review policy, complete-evidence validation/privacy
and original-document exact edits. `application.ts` consumes a synchronous
`TrainingPlanStore` (read/persist) and supplied clock. Manual save normalizes,
persists and reads back; guarded tool save reads/validates/compares the prior
snapshot, applies edits and saves without yielding. They intentionally do not
share authorization assumptions. Zod validates the existing complete-snapshot
shape; inner modules have no framework, SQL, AI SDK or composition dependencies.

`composition.ts` lazily binds the existing SQLite owner. HTTP retains alias parsing,
length errors and status mapping; chat consumes the feature status contract;
the tool adapter retains summaries/privacy and metadata-only save results.
Orchestration still owns prior-planner-pass snapshot timing and per-target attempt
admission; model-selected planning writes need no conversational consent ceremony. Manual writes can save documents the tool refuses to read; no new
sanitization or authorization policy is introduced. Repository compatibility
functions delegate inward rather than duplicating policy.

`training-plan-application.test.ts` exercises pure rules and supplied store journals;
`training-plan-wiring.test.ts` covers real HTTP/composition/tool/SQLite paths and
write failure. `training-plan-dependencies.test.ts` checks type-inclusive inward
dependencies with negative fixtures. Existing repository, route, evidence,
orchestrator and chat suites retain compatibility coverage. SQL, schema and
stored timestamps are unchanged; migration/back-sync is a no-op, source revert
is sufficient rollback. The legacy `stale`/`staleAfterDays` transport fields mean optional review timing after more than 60 elapsed days, not invalidity. UI and model-facing consumers translate them to neutral review wording; unknown revision dates cannot establish elapsed age. Saved documents and weekly commitments are unchanged. No release behavior changes.

## Chat execution and delivery

Chat follows `route → delivery → chat/composition → chat/turn`.
`createChatTurns` and `createChatContext` consume feature-owned ports; outer
composition binds existing storage/history, summary projection and provider/orchestrator
adapters. Selection returns a plain generation operation before context reads,
not an SDK model. Factories bind functions without opening storage or selecting
providers at import time. Application owners have no HTTP/stream, environment,
SQLite, singleton memory or SDK dependency, including erased type dependencies. Preparation atomically admits the user/source identity; generation produces a typed
answer and progress. Schema18 completion atomically links assistant and completion
journal, then reloads display history without awaiting legacy extraction/embedding or
global summary work.
Reviewed Luna uses role replay with exact preflight accounting and bounded local
compaction; display paging/legacy mode remain independent. Per-use privacy checks
stop stale work and final delivery; owned failure/abort releases its admission.
Summary control/manual/expiry authority is checked too, even for null pins. The
completing correction receives only its own updated receipt. New summary-dependent
debug copies carry a metadata marker and are removed on revocation; the UI reloads
committed history while preserving original visible answers and legacy grounding.
[The current contract](conversation-history.md) records limits and evidence boundaries. JSON and NDJSON share those operations, while delivery owns DTOs,
debug visibility and the existing stream abort-before-completion boundary.

`src/lib/chat/{context,turn,conversations}.ts` expose application factories
covered by `tests/chat-application.test.ts` with supplied fake ports, without
module-mocking infrastructure. `tests/chat-boundaries.test.ts` retains production
composition characterization; `tests/chat-delivery.test.ts` isolates delivery;
`tests/chat-route.test.ts` retains real orchestrator wiring. The type-inclusive
AST closure check in `tests/chat-dependencies.test.ts` rejects outer dependencies
through imports/re-exports/helpers, including erased types; it complements rather
than replaces the runtime architecture graph.

Conversation routes call `conversation-composition.ts` / `conversations.ts` for
history, paging, creation, rename and delete/fallback. `contracts.ts` owns stored
message/conversation/grounding/page shapes; `conversation-policy.ts` owns pure
ID/title rules. Dates and wire representations are unchanged. Deletion remains
one synchronous transactional adapter call before fallback selection; missing
conversation deletion still cleans only matching conversation-derived memories. Mode-specific context counts and metadata differences remain delivery contracts.
Prior-failure follow-ups now use normal generated-answer delivery with explicit
failure context rather than a keyword-triggered bypass. See [chat ownership](design-choices-and-boundaries.md#chat-application-and-http-delivery).

## Turn-owned tool execution

Each orchestration creates one `TrainerToolExecutionContext`, passes it explicitly
through typed dispatch to analytics, and disposes it in `finally` on every exit.
Only successful SQL/math results register handles. Clearing the registry does not
mutate returned evidence arrays; names may still be overwritten/chained **within**
a turn, but cannot be cleared, overwritten or consumed by another turn. This is an
intentional concurrency correction, independently tested with provider barriers.

`tool-contracts.ts` validates provider inputs into a discriminated union;
`tool-types.ts` owns dependency-free metadata. `tool-selection.ts` owns synchronous
batch validation, stable priority ordering, combined-capacity truncation and
selection metadata. It observes readonly prior steps and imports only contracts,
shared execution policy and the rejected-step constructor in
`tool-step-diagnostics.ts` (whose imports are erased types); it cannot execute tools
or import orchestration. Successful per-tool quotas are retired; only actual
combined provider/tool attempts consume the 30-execution allowance, preserving
one action-disabled synthesis reserve and the soft target of 20.
Direct tests in `tests/tool-selection.test.ts` need no execution/provider mocks;
`tests/tool-selection-orchestration.test.ts` exercises repeated successful/failed
attempts, truncation, reserve and supported three-execution mode, alongside the
existing integrated orchestration/plan regressions. Actual serialized native and
legacy evidence is covered by `tests/trainer-request-evidence.test.ts`.
The dispatcher receives explicit feature capabilities from outer
`tool-composition.ts` and calls analytics, local-data and Training Plan handlers. `tool-evidence.ts` only formats,
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
  grounding serialization and the single monotonic message timestamp state.
- `conversation-history.ts` owns schema18 source admission/completion sequence,
  segment/revision/boundary/integrity compare-publication, privacy invalidation and
  conservative durable local-compaction spend. It reuses the lazy connection and
  existing message/title writes; generation never holds its transaction.
  It imports pure chat-owned ID/title policy and contracts; compatibility exports
  remain for existing callers.
- `training-plan-repository.ts` owns singleton plan SQL and row/ISO conversion.
  Feature-owned application/rules own normalization, staleness and synchronous
  guarded read/compare/edit/write; AI retains presentation and planner timing.
- `conversation-lifecycle.ts` owns the complete single-conversation deletion
  transaction: messages, conversation-derived semantic memory soft deletion, then
  conversation. History clear delegates to it; chat application use cases own
  fallback selection.
- `profile-repository.ts` and `legacy-memory-repository.ts` own Profile and legacy
  memory SQL; `memory/sqlite-storage.ts` owns semantic SQL. Feature applications
  own normalization and lifecycle policy through explicit ports.
- `local-data-lifecycle.ts` owns exact atomic bulk deletion capabilities.
- `repository.ts` retains Garmin SQL, summaries and metadata, with feature-owned
  local-data interpretation helpers and compatibility exports for earlier callers. Extracted storage owners never
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

## Selected-activity chart and route calculations

`src/lib/analytics/activity-dashboard-calculations.ts` owns two synchronous pure
facades over already selected, ordered normalized rows: `buildActivityDashboardCharts`
and `buildActivityDashboardRoute`. It has no imports or storage, environment,
filesystem, provider or connector capability. Its plain chart/route contracts are
composed into the repository's existing `ActivityDashboardDetail` response.

`getActivityDashboardDetail` retains SQLite queries, row selection/order, detail
availability and laps; local-data policies own selected-row and HR-zone composition,
alongside chart timing,
60-second distance-based speed, 180-second grade readouts and route filtering,
bounds and endpoint-preserving sampling. Chart points are not downsampled. Route
bounds use every accepted point, including points omitted by the 400-point cap.
There is no sorting, input mutation, new fallback, formula or schema change.
The existing repository window-constant exports remain compatible.

Chart points additionally retain `sourceElapsedSec`, the original stored row key,
independent of displayed timestamp-derived seconds. Metric-filtered chart samples
report transient pointer/keyboard selection to `ActivityView`, which owns
payload-scoped selection and owner-aware clearing. `RouteMap` chooses the nearest
supported retained GPS key (earlier ties, stable duplicates) and draws a distinct
non-intercepting dot using the active external/offline projection, without moving
the viewport. Missing metadata or GPS support hides only this dot; no interpolation,
fetching, persistence, backfill or terrain-section map linkage is introduced.
`tests/activity-route-position.test.tsx` and dashboard interaction coverage verify
alignment, clearing, sparse/capped GPS and preservation of map controls.

`tests/activity-dashboard-calculations.test.ts` exercises the pure facades without
SQLite or environment setup, including original window-boundary/duplicate behavior
and frozen inputs. `tests/activity-dashboard.test.ts` retains repository/API wiring,
privacy, lap and HR-zone integration coverage. Source revert is sufficient rollback;
no stored-data backfill or migration is needed.

## Shared activity terrain-section evidence

`analytics/terrain-sections.ts` is neutral pure elevation-profile analysis, not a coaching score. `local-data/application.ts#createTerrainAnalysis` consumes a single capped normalized selected-read capability; composition binds `repository.ts#getActivityTerrainInput` (100,001 rows detects the 100,000-point limit) and adds the same canonical result to the dashboard DTO. There is no raw archive, connector, persistence/cache or migration dependency. Reimported normalized inputs recompute on the next read; back-sync is a no-op and rollback is a source revert.

Terrain-v2 uses 25m distance anchors, isolated >10m spike rejection when adjacent neighbors agree within 2m and triangular [1,2,1]/4 smoothing. It detects sustained trend changes, not fixed tiles: a continuously sliding 100m signed-grade window and 300m rolling-relief window supply ±3% enter / ±2% stay evidence. A changed trend must persist >=300m; climb/descent changes also need >=6m vertical support. Refine the boundary to a nearby profile extremum/plateau edge within100m. Require >=300m on both sides before committing a boundary, absorb short initial/transient/final features, and reject disconnected runs below300m rather than join gaps. Final rolling labels require a sustained detected rolling trend plus >=10m each ascent/descent and range, with |net|/gross<0.6; small flat noise or one absorbed short hill cannot turn a long flat approach into rolling terrain. Merge equal adjacent final kinds only inside a continuous run. Windows and 25m resolution do not impose output section lengths or periodic cuts. Invalid ranges, >30s time gaps and >100m distance gaps split runs. Ascent/descent integrate filtered edges once; signed grade uses net filtered elevation / recorded along-route distance. Steep up/down support counts >=10% filtered anchor-edge distance, not instantaneous maxima. Distance coverage uses all valid positive recorded changes, including unsupported gaps; timestamp coverage uses distance-split adjacent-edge counts. Consistent timezone-less Garmin timestamps establish a relative clock; stored elapsed alone never establishes seconds. Original valid adjacent time edges supply elapsed/estimated stationary (<=0.3m/s for >=30s)/moving, elapsed pace and pairwise time-weighted HR with explicit support. Missing metrics remain null.

`analyzeActivityTerrain` admits one ID and 1–20 result rows, omits raw samples/GPS/paths and preserves whole-analysis coverage/totals before row caps. Successful rows register in the existing turn-owned handle map for bounded math and useful evidence-backed prose. Unavailable results register nothing; partial/truncated analysis requires explicit limitations with useful supported partial facts. Existing SQL/math semantics, budgets, source grade, hover formulas and laps remain unchanged.

The additive Terrain sections grid labels the section's time-weighted mean as **Avg HR**, formats durations as h/m/s with zero units omitted (zero stays0s), and shows elapsed pace as a human duration per kilometre. Detailed timing/HR support lives in **Method and quality**; a main-grid **Data notes** column appears only for incomplete/unavailable row support, with readable global gap/partial/truncation messages. Raw API/tool values and analytical weighting remain unchanged. The grid has keyboard/pointer buttons and an elevation interval overlay independent of hover. Activity changes reset selection. Raw chart timelines use stored coordinates; timestamp-derived charts highlight only with matching source-row origins/counts, otherwise explicitly report unavailable alignment. No map highlight: route points are independently sampled and retain stored elapsed coordinates. Missing old payloads are tolerated. Numerical, API/tool equality, privacy/grounding/isolation and no-GPS UI tests live in `terrain-*` and the existing dashboard suites. Public examples are synthetic; real smoke remains private/local.

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
