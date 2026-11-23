# Architecture: AI, chat execution and tools

Part of the [architecture overview](../architecture.md).

## AI application and provider/tool adapters

`ai/orchestrator.ts` consumes explicit `TrainerOrchestrationPorts`: plain
planner/final-synthesis generation and admitted tool execution. It has no SDK,
model, storage, environment, connector or outer composition dependency, including
erased types. The loop still owns raw-call aliases/malformed parsing, sequential
admission, actual-attempt counters, synthesis reserve, prior-pass plan snapshots and one
explicit context disposed in `finally`. No scheduling, coaching or retry policy
changes are hidden in this seam.

`tool-contracts.ts` owns strict Zod parsing/defaults and neutral descriptions.
Weekly generation shapes derive from these schemas but omit obsolete prose;
legacy parsing accepts rich saved-call fields without making models generate them.
`provider-tool-definitions.ts` alone wraps with SDK `tool`/`asSchema`, retaining
minimal advertised JSON and the same strict legacy-compatible parser in SDK
validation. Selection and handlers consume neutral contracts. `tool-ports.ts` accepts narrow guarded feature
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
evidence](../conversation-history.md) replace a blanket migration no-op for that slice.
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
preserve the dashboard API's units, nulls and speed fallback. A separate known-ID normalized grounding read adds signed activity battery delta, source-distinct list/FIT cadence/stride, historical per-lap HR buckets and all five snowboard per-type aggregates, with independent group coverage and exact supplementary lap/bucket omissions (20 laps × 8 buckets). It does not change the UI dashboard DTO, producer/storage schema or image input. Complete owned HR-zone
status/timing/boundary provenance precedes optional20-row lap/terrain sections;
lap source totals are explicitly unknown at the100-row dashboard source cap.
Terrain keeps its whole-analysis coverage/counts, including unsupported/partial
states independently of valid summary/HR facts. Numerical-only default exposes no GPS, charts/raw streams,
connector refresh, storage migration or focused-UI selection. Optional unique
`panels` selects heartRate/elevation/speed/route images from the same synchronously
captured dashboard input; route geometry is never implicit. The finite resvg-wasm PNG
adapter (macOS system Helvetica/Menlo fonts; none bundled or downloaded) reuses shared chart calculations and the interactive map's unchanged
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
revert.

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
[The current contract](../conversation-history.md) records limits and evidence boundaries. JSON and NDJSON share those operations, while delivery owns DTOs,
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
failure context rather than a keyword-triggered bypass. See [chat ownership](../component-responsibilities.md#chat-application-and-http-delivery).

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
[tool-runtime boundaries](../component-responsibilities.md#explicit-tool-runtime-boundaries-srclibaitool-ts)
and `tests/tool-runtime-ownership.test.ts` / `tests/tool-boundaries.test.ts`.
