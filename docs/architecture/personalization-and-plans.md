# Architecture: personalization, weekly plans and Training Plan

Part of the [architecture overview](../architecture.md).

## Personalization application and adapters

[S](../cross-chat-summary.md) owns
one complete generated text, selection-first complete-replacement ordinary maintenance
and foreground incremental generation; `db/summary-storage`
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

[Linked conversation replay/local compaction](../conversation-history.md) is chat-owned,
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
or composition, including erased types. `TrainerMemoryStore` shapes remain internal capability contracts behind management,
not ordinary-chat dependencies or a public ingestion/retrieval facade.

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
read-after-write. `memory/legacy-contracts.ts` retains only the plain `TrainerMemory`
context shape; old proposal/lifecycle/SQL-writer facades are not entrypoints.
`memory/sqlite-storage.ts` still reads preserved confirmed legacy rows for existing
management migration. No stored rows, schema or markers are removed. Parser policy
is consumed through the existing extractor application, not a compatibility barrel.
HTTP retains error/status and malformed-body behavior; no Profile error catch is added.

Direct fake-capability tests are in `tests/personalization-application.test.ts`;
`personalization-wiring.test.ts` covers real SQLite, chat completion, routes,
management reset, unchanged hash/vector/DTO values and unrelated-data preservation.
`sqlite-memory-adapter.test.ts` exercises management read/change, persisted-row
reopening/migration, normalized vectors, failed updates and Off/On/delete/clear.
Legacy proposal/confirmation-only tests do not define a supported product API.
`personalization-dependencies.test.ts` checks type-inclusive closures with negative
SDK/storage/composition/ambient fixtures. Existing memory/config/Profile/chat
suites remain compatibility evidence. No UI, schema, data semantics, provider,
threshold, TTL or historical cleanup changes: migration/back-sync is a no-op and
source revert is sufficient rollback.

## Weekly plans and reviews

`weekly/{contracts,calendar}` owns civil Monday identity, timezone validation and local-midnight evidence intervals (including DST); `weekly/application` owns bounded document policy, immutable original/latest separation, as-of review revisions and direct guarded saves through synchronous `WeeklyStore` ports. `weekly/composition` lazily binds the JSON SQLite adapter and clock/opaque IDs. Migration 16 adds `weekly_artifact` and `weekly_proposal`; no general-plan or Garmin rows are derived/rewritten. Weekly-only data participates in upgrade backup detection.

Dedicated getWeeklyPlan/getWeeklyKpis/saveWeeklyDocuments/saveWeeklyKpis tools consume complete prior-pass reads; getKpiProgress is bounded saved-only history. Focused KPI saves and optional kpiChanges in the narrative bundle share the same once-per-turn weekly attempt and transaction owner. Direct save validates current-turn ownership, calendar/content/privacy and unchanged full snapshots before one all-or-nothing weekly transaction; no proposal, assistant binding or confirmation is required. Legacy proposal/application compatibility and stored bytes remain, but are not exposed to the active model path, replayed or injected into chat context. General Plan and weekly bundle each have a once-per-turn attempt guard, including failed/uncertain attempts; distinct feature saves may coexist but are not atomic together. Failure output retains actual prior successes. Model selection follows actual user direction including no-save; there is no consent classifier or injection-proof guarantee. Debug/grounding retain metadata only, not weekly Markdown. Saved weekly artifacts survive chat/Profile and Garmin deletion.

[Structured weekly KPIs](../weekly-kpis.md) are weekly-owned contracts/application policy (`weekly/{kpi-contracts,kpis}`), persisted separately by weekly-repository on the same lazy transaction. Schema26 adds weekly_kpi JSON and the concept/track signature inventory. Canonical reads compose narrative and complete selected KPI baselines; focused/combined writes share revision/calendar/current-turn authority and the once-per-turn attempt family. Explicit reviewed maintenance (`weekly/backfill`, scripts/backfill-weekly-kpis.ts) is never startup parsing, coaching or historical rescoring. A shared weekly-owned read-only latest-set/achievement projection drives compact report and primary saved weekly percentage chart. It sums independent scored-track allocations (unmapped legacy item pools count once until reviewed conversion), preserves the matching saved assessment/total when no automatic fallback is used, otherwise sums exact reviewed awards, declared-rule candidates and reviewed extras once, retains above100 and truezero, and leaves missing/incomplete/obsolete scores as gaps. Progress separately discovers the latest established plan through weekly-repository, independent of chart range; its bounded canonical identities/names support current-only choices and future trainer reuse. Individual history joins exact stable concept/key/kind/unit/meaning, never fuzzy renderer matching or an obsolete set. KPI-only records survive existing deletion scopes. The trainer owns the agreement, eligibility, reviewed awards and extras; pure weekly code only executes opt-in closed numeric rules, never a coaching rubric. New rubrics allocate 100 full-target points with explained goal-relevant metrics; useful extras may exceed 100 without hiding unmet sport-specific commitments or double-counting benefits. Reviews name the latest committed KPI set, with target-week SQL/math evidence and coverage limitations; superseded assessments never become the latest plan's score. Optional set.planRevision records narrative provenance; legacy review-defined eligibility requires an explicit match to the latest narrative. Narrative/review-only writes do not themselves establish new targets. Distinct finite source-binding maintenance compares exact narrative and expected structured state and only appends bindings/conflict revision, with idempotent rerun and atomic refusal; no schema DDL or rescoring. Legacy rubrics remain provisional; no plan means no completion score and missing evidence never silently becomes zero. `review.planRevision` retains its existing latest-plan-at-save snapshot semantics; the contextual UI label is not a scoring-baseline claim. Existing documents/pending proposals are not migrated or automatically rescored.

Measured actuals (schema28 `weekly_kpi_recipe`/`weekly_kpi_measurement`) are measurement-only state beside assessments. See [weekly KPIs](../weekly-kpis.md#measured-actuals). Reads attach the stored week measurements, and `kpiActual` is the one grid/chart/tool projection; `latestKpiScore` derives only explicitly declared numeric rules from compatible stored measurements, preserving reviewed per-track precedence and provisional provenance. Its exact selector is independent of score/actual derivation to avoid recursion. Canonical reads attach bounded `points` metadata, never persisted scores. `saveKpiRecipes` joins the weekly once-per-turn save family, while `refreshKpiMeasurements` is a measurement-only effect. Tool dispatch best-effort refreshes the current Monday once after a successful current-week commitment save, outside the transaction and without changing the confirmed save result; no new import/sync wiring.

`/api/weekly` GET is a read-only detail/paged-summary adapter; its only POST retains the `refresh-current-week` action name but delegates to the measurement use case's current-plus-previous-week default, returning both statuses and a combined failure count; browser chat transports an IANA timezone and legacy callers receive an explicit server-local fallback. `use-weekly` is a persistent shell-owned request owner with generation guards and date/zone rollover checks. `weekly-plan-view` wraps the preserved General Plan editor with This Week/Upcoming/secondary History; normal Back to chat navigation remains, without redundant discussion or review-prefill actions. Streaming and JSON successful-step metadata trigger refresh. Focus/section-return ownership remains in the dashboard shell. Focused coverage: `weekly.test.ts`, `weekly-ui.test.tsx`, existing chat/orchestrator/plan suites and the production composition/ownership checks.

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
