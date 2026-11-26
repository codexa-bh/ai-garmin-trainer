# Architecture: personalization, weekly plans and Training Plan

Part of [architecture](../architecture.md). This page owns component boundaries, not duplicate product specifications: use [memory](../memory.md), [summary](../cross-chat-summary.md), [Training Plan](../training-plan.md) and [weekly KPIs](../weekly-kpis.md) for behavior and maintenance.

## Personalization application and adapters

`memory` owns summary policy; `db/summary-storage` owns eligibility, leases, CAS, coverage, manual controls and spend. Import/rebuild seal selections, stage originals and supply candidates to that same writer. Composition binds native configuration to reviewed Start/foreground continuation; only ordinary launcher lifetime schedules private ticks. Passive reads never generate, incomplete replacements never publish, and unproven post-Clear eligibility stays fenced.

`model-settings/summary-selection` decodes the independent summary/title choice; `memory/summary-configuration` captures model/catalog/connection/keys without Trainer preferences or fallback. Chat owns replay/compaction and sealed consumers, not another global producer. Null or explicit legacy/unavailable state is valid.

`api/memory → composition → management/application` keeps legacy semantic stores management-internal, not ordinary-chat retrieval/ingestion. `MemoryPorts` supplies synchronous storage, embedding/extraction, identity, clock and secret-free snapshots. Pure policy imports no SQL/env/HTTP/SDK/composition, including types. SQLite owns serialization/upserts/expiry and the 200-row candidate cap; adapters own transport/timeouts/normalization/identities and tool-disabled legacy generation. Key changes rotate the lazy store without changing in-flight snapshots; settings write before reset/reload. Health never migrates. Lazy legacy migration marks completion only after all rows, retains earlier writes on failure and never retries automatically.

`profile/application` normalizes through synchronous storage; repository owns serialization/read-after-write. Retired proposal/confirm/reject/forget facades stay retired, with legacy rows/vectors/markers preserved. HTTP retains malformed-body/status behavior without a new catch. [Conversation titles](backend-roles.md#conversation-titles-and-selection) are independent of summary On/Off and Trainer choice.

## Weekly plans and reviews

`weekly/{contracts,calendar}` owns civil Monday/timezone/DST identity; `weekly/application` owns bounded documents and guarded synchronous saves. Composition lazily binds SQLite/clock/IDs. Weekly artifacts/proposals count for upgrade backup detection and survive chat/Profile/Garmin deletion.

Tools require complete prior-visible evidence from foreground preload or explicit prior-pass reads, plus current-turn/calendar/content/privacy/full-snapshot checks. [Chat preparation](ai-and-chat.md#chat-execution-and-delivery) owns preload bounds and invalidation. General Plan and weekly mutations have separate one-attempt outcomes; focused KPI and narrative changes share the weekly transaction/attempt, including uncertainty. Review/next-plan may commit atomically. Disclose prior successful effects after later failure; never replay legacy proposals. Debug/grounding carry metadata, not document bodies. [Coaching](../coaching-instructions-and-sources.md#weekly-planning-and-review) owns no-save intent, without a consent classifier or injection-proof guarantee.

`weekly/{kpi-contracts,kpis}` owns targets/assessments; `weekly/measurements` owns verification/coalescing/conditional publication; `analytics/recipe-execution` supplies readonly isolation. UI/tools share projections, not narrative parsing, historical rescoring or renderer inference. [KPI contract](../weekly-kpis.md) owns exact rules and limits.

`/api/weekly` GET is readonly. `refresh-current-week` POST returns current/previous measurement statuses and combined failures. Chat supplies IANA timezone; legacy callers get explicit server-local fallback. Shell-owned `use-weekly` guards generations/date-zone rollover; [dashboard](dashboard.md) owns refresh/navigation.

## Training Plan application and adapters

`training-plan/{contracts,limits,policy,snapshot,edits}` owns normalization, review timing, complete evidence/privacy and original-text edits. `application` consumes synchronous store/clock; composition lazily binds SQL. Manual save persists/read-backs; guarded tool compare/edit/write never yields. Manual writes do not inherit tool-read authorization assumptions.

[Training Plan](../training-plan.md) owns operator behavior and review timing. The 2200-character compact preview is incomplete; `getTrainingPlan` preserves complete Markdown within 32000-character/title bounds, outside the 1800-character generic preview. Existing-plan writes require a complete prior-visible snapshot (foreground preload or prior-planner-pass read) compared with current state. Mutually exclusive `edits`/`contentMarkdown` choose unique non-overlapping original-text edits or full replacement, preserving unmentioned content/omitted title. Planner intent chooses targeted changes versus creation/replacement; there is no extra permission, proposal or mandatory confirmation step. The latest complete read reaches planning/synthesis outside generic previews; debug/grounding retain metadata only. Unsupported snapshots fail closed, but key/path-like user prose remains complete untrusted content, not a credential read or a reason to censor an overwrite. Structural refusals omit raw errors; uncertain persistence needs inspection before retry. No inner framework/SQL/SDK/composition imports; compatibility functions delegate inward.

Verification: personalization/Training Plan application, dependency and production-wiring suites; SQLite-memory adapters; weekly/KPI, route, evidence and orchestration tests. Pure-port tests do not replace real SQLite/wiring coverage.
