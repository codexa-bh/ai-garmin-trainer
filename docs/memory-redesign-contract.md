# Memory redesign: accepted architecture and compatibility contract

**Accepted target, not an installed-activation or evidence certificate.** T0268 was
documentation only; H/S were delivered separately and T0272 integrates consumer,
controls, historical transition and legacy-runtime retirement. Current source
behavior and qualified-route limits are documented in [memory](memory.md) and
[cross-chat summary](cross-chat-summary.md). Baseline observations and historical
slice records below remain attributed to their original source. Required native,
semantic/provider and primary-activation evidence must be recorded independently;
this document does not declare every scenario passed. All examples in
[the acceptance contract](memory-redesign-acceptance.md) are authored synthetic data.

**T0272 operator amendment — shared summary/title model:** future automatic titles
use the explicit summary selection, not the extraction/chat selector or a second
title selector. Summary Off does not disable title processing. Original extraction/
title compatibility fields remain preserved. Titles retain first-prompt/lifetime/
manual-title/deletion safeguards,3000ms/120-output limits and no retry/fallback;
the separate purpose reserves USD0.001 per attempt,100 attempts/USD0.10 per local day.
Unselected/unsupported/missing-key routes retain excerpts. This amendment supersedes
only the earlier title-selector clauses; it grants no provider/private/primary effect.

## 1. Baseline, authority and decisions

Baseline inspected: source `a76e826b4d3dcf93c11c9a1482dc9d2863e30702` (2026-11-03).
Paths/symbols below are evidence entry points, not line-stable APIs.

| Current evidence                                                                                                                                                                  | Observed behavior                                                                                                                                                                             | Target decision                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [chat/turn.ts](../src/lib/chat/turn.ts), `prepareChatTurn`                                                                                                                        | Loads 40 messages; user persists before generation; last eight messages also feed weekly continuity                                                                                           | Immutable role-preserving conversation segments, bounded by tokens; one continuity owner, not a second weekly tail                                 |
| [chat/context.ts](../src/lib/chat/context.ts), [ai/context.ts](../src/lib/ai/context.ts)                                                                                          | 6000-character selected transcript, assistant prose generally omitted; immediately preceding proposal excerpt is exceptional; eight vector matches; changing date/Profile/Garmin/plan context | Stable policy + pinned memory + append-only user **and assistant** continuity; fresh grounding appended per turn                                   |
| [ai/orchestrator.ts](../src/lib/ai/orchestrator.ts), [provider-generation.ts](../src/lib/ai/provider-generation.ts)                                                               | Planner/final synthesis rebuild dynamic system context and send `prompt: userRequest`; not stored-message replay                                                                              | Explicit ordered message input; planner and final-synthesis have separate stable tool/policy identities                                            |
| `completeChatTurn`, [chat/delivery.ts](../src/app/api/chat/delivery.ts)                                                                                                           | Assistant save precedes awaited swallowed ingestion errors; final NDJSON done/JSON awaits it                                                                                                  | Atomic completion/outbox write, then answer delivery; generation is never awaited by delivery                                                      |
| [memory/application.ts](../src/lib/memory/application.ts), [sqlite-storage.ts](../src/lib/memory/sqlite-storage.ts), [retrieval-policy.ts](../src/lib/memory/retrieval-policy.ts) | Extraction then embedding; latest 200 eligible rows ranked, at most eight retrieved; vector-model/dimension matching not enforced                                                             | Text-only incremental global summary, independent of embedding availability; preserve legacy store without mixing vectors                          |
| [extraction-policy.ts](../src/lib/memory/extraction-policy.ts) versus `recordCompletedTurn`                                                                                       | Prompt says immediately previous assistant; input is the newly generated answer                                                                                                               | New source records explicitly distinguish prior referent from completed answer; do not reuse this ambiguous payload or repair it in this docs task |
| [schema.ts](../src/lib/db/schema.ts), [migrations.ts](../src/lib/db/migrations.ts)                                                                                                | Schema 17; message has ID/conversation/role/content/grounding/time, no durable turn-completion sequence; stored content is capped at 12000 UTF-16 units                                       | Additive versioned turn journal and snapshot metadata; never infer completeness from timestamps alone                                              |
| [conversation-lifecycle.ts](../src/lib/db/conversation-lifecycle.ts), [local-data-lifecycle.ts](../src/lib/db/local-data-lifecycle.ts)                                            | Single-chat deletion soft-deletes only matching `kind=conversation` semantic rows; bulk chat/Profile clear preserves both memory stores; Garmin clear is separate                             | New derivatives invalidated by source deletion, with exact displayed scope; legacy exclusions must not be silently changed                         |

Current [architecture](architecture.md#persistence-owners),
[boundaries](design-choices-and-boundaries.md#srclibmemory),
[desktop](desktop.md#explicit-private-state-adoption) and
[developer guardrails](developer-process.md) constrain the target. Historical
confirmation/medical-response restrictions are not reinstated: current chat/plan
policy remains authoritative. T0283 explicitly supersedes this contract's former
cross-chat content-pattern exclusions: user-authored topic words, URLs, paths,
key-like examples and quoted instructions are admissible untrusted discussion,
without replacement screening or rewriting. Independent structure/source/no-save
controls remain; native secrets/tool payloads are not sources. Separate local
compaction and inactive legacy semantic policies remain unchanged. Prior assistant
prose is continuity, **never** Garmin evidence, policy,
user endorsement, or permission for a save/tool action.

Decisions: no daemon, no automatic provider substitution, no embedding prerequisite,
no unrestricted cross-chat assistant/tool archive, no historical vector deletion,
no automatic primary migration, no automatic activation. New summary export is
limited to minimized user-derived context and explicitly resolved referents under
concrete source/privacy rules; broader native/private input access requires operator scope
approval before implementation or activation. The full target remains gated on
privacy/serialization/native proof in the owning future slice.

## 2. Provider requests, provenance and context budgets

### Current SDK and wire boundary

The lock pins `ai` 7.0.29, `@ai-sdk/openai` 4.0.15 and `@ai-sdk/deepseek` 3.0.11.
Inspection of their installed `src` converters establishes these mechanical paths:

- Direct OpenAI: `createOpenAI(...)(modelId)` uses Responses. Structured policy and
  dynamic context become two system inputs only for the app's explicit cache list
  (`gpt-6-luna`, `gpt-6-astra`, `gpt-6.1-sol`); otherwise they are concatenated.
  SDK `openai-language-model-capabilities.ts` currently maps those `gpt-6*` IDs to
  **system**, not developer; known reasoning families can instead map to developer.
  Responses user text becomes `role:user / content:[{type:input_text,text}]`;
  assistant text becomes `role:assistant / output_text`; tool calls/results become
  `function_call` / `function_call_output` with matching `call_id`.
- Direct DeepSeek: `deepseek(modelId)` uses chat completions. Converter maps
  system/user/assistant text to those roles; assistant calls use `tool_calls`,
  results use `role:tool` with `tool_call_id`. Reasoning replay differs for V4
  versus other models; do not persist or replay private reasoning as continuity.
- OpenRouter and loopback Ollama: explicit `openai.chat(modelId)` compatibility
  transport. SDK chat converter defaults to system, uses assistant `tool_calls`
  and matching tool messages, and JSON-encodes structured outputs. A route's
  actual role/tool support is not established by that converter.
- Current planner exposes action tools plus `completeTrainerTurn`, auto choice,
  parallel calls disabled; final synthesis exposes only `completeTrainerTurn`.
  Current tool evidence is rendered into system text, **not** replayed native tool
  messages. Existing adapter-option tests do not prove final HTTP serialization.

Sources: `node_modules/@ai-sdk/openai/src/{openai-provider.ts,openai-language-model-capabilities.ts,
responses/convert-to-openai-responses-input.ts,chat/convert-to-openai-chat-messages.ts}`
and `@ai-sdk/deepseek/src/chat/convert-to-deepseek-chat-messages.ts` after locked
install. These are inspection evidence, not new vendored files. Future tests must
capture the SDK's serialized request through an injected fake transport (no keys
or network), including role remapping, generated IDs, JSON ordering, tool schema
order, warnings, output limits, retry options and provider cache options. Unsupported
role removal/part loss fails admission; never silently flatten history to fix it.

### Target canonical request order

Each request has an exact `provider/model/transport/policyVersion/toolsetVersion`
identity. Store neutral text and approved structured metadata, not vendor response
IDs or reasoning. No server-side provider conversation/thread becomes a source of
truth or a deletion shortcut. Do not add provider-side persistence for cache reuse;
verify supported stateless/store controls before activation, otherwise leave the
redesign unavailable for that route. This does not promise provider log erasure.

| Ordered block | Logical role / contents                                                                                                                                                  | Stability and authority                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1             | system policy; tool definitions in SDK tools field                                                                                                                       | Versioned deterministic bytes/order; no clock, Profile, budget counters or private source text                                |
| 2             | user-data block: pinned global revision and same-chat compaction, with explicit untrusted source labels                                                                  | Immutable within segment; not a system instruction. Revision metadata contains no credentials or variable last-used timestamp |
| 3             | completed segment history: actual user and assistant roles, in durable turn/message order                                                                                | Append only; exact accepted visible text, not rewritten summaries on every turn; assistant prose remains unverified           |
| 4             | user-data block: fresh turn grounding, server date/timezone, Profile revision, normalized data as-of/coverage, plan/weekly revisions, prior failures labelled historical | Appended for this turn; current local context, not an old prefix disguised as fresh                                           |
| 5             | actual current user message                                                                                                                                              | Latest intent/correction; kept separate from data delimiters                                                                  |
| 6             | current-turn native assistant tool calls and bounded validated tool responses                                                                                            | IDs bind turn/call/tool/status/source revision; append in actual execution order                                              |
| 7             | server-authored synthesis/budget/rejection context, when needed                                                                                                          | Appended data, never rewrites earlier history; final-synthesis policy/tool identity may differ from planner                   |

History must replay exactly the text accepted for persistence/display, not a different
truncated copy. Initially H rejects user inputs over the existing 12000 UTF-16-unit
storage bound before persistence/provider admission; oversized generated visible text
fails completion with an honest limitation rather than storing a truncated successful
answer. Full-text capacity expansion is not implicit. Legacy already-truncated messages
remain labelled legacy/possibly incomplete, not reconstructed from private logs.

Consecutive user-data/user messages are deliberate; never invent an assistant
acknowledgment to force alternation. Transport contract tests must verify exact
support; unsupported routes stay on existing behavior with an explicit status.
Within a turn, blocks 4–6 are frozen as admitted, except newly appended tool
results. Future turns retain the previous visible messages and minimized historical
context envelope; old grounding is explicitly historical, not reusable evidence.
Do not persist unrestricted tool results. Keep deterministic safe result/status
summaries, IDs and provenance; re-read current measurements in a new turn.
Omit old native tool call/result pairs together if they cannot be safely persisted;
retain the visible assistant response as unverified prose. Never leave an orphan
call/result or fabricate success. `completeTrainerTurn` remains a non-executing
terminal declaration, not replayable save permission.

Fresh context includes current Profile, health/activity coverage, current date and
plan calendar; historical snapshots retain their as-of/version. Profile corrections,
source edits and urgent invalidations force a segment boundary, sacrificing cache
identity. Current explicit correction wins for preferences/intent; measured Garmin
claims still require verified current-turn evidence, even if the user disagrees.
A plan preview is incomplete, not write authority. Existing complete-read, exact
revision/edit, original-weekly-commitment and atomic plan/review rules survive.

### Budgets and deliberate compaction

Proposed defaults are app limits, **not** claims about vendor limits:

| Limit                       | Decision                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary character cap N     | Default 6000, integer range 1000–20000; reject fractions/NaN/out-of-range rather than silently clamp                                                                                                                                                                   |
| Character semantics         | Unicode scalar values after CRLF→LF; reject unpaired surrogates, preserve text normalization (do not fold languages); never split grapheme clusters on display. Count whole rendered item text including separators                                                    |
| Model capability            | Exact route must have reviewed context C, output O, tokenizer/framing and role/tool profile; unknown model keeps old path, no redesign activation. Unknown summary capability means no summary calls                                                                   |
| Application context ceiling | `Ceff = min(C, 32768)` tokens initially; reserve output `min(O,4096)` and framing margin `max(1024,ceil(0.05*Ceff))`; reject profiles with less than 8192 total or less than 1024 output support                                                                       |
| Input allocation            | From remaining input capacity, stable policy/tools first; current user + grounding + current-turn tools reserve up to 8192 tokens; pinned global text at most 2048 tokens and N characters; same-chat compact text at most 2048 tokens; history receives the remainder |
| Trigger                     | Before admitting a new request, compact when history reaches 80% of its current allocation, or when prospective full request would exceed the hard input budget. Preserve at least last two completed turns if they fit; do not use a sliding tail every turn          |
| Output/tool safety          | Enforce provider output cap on each call. Existing 30 combined provider/tool attempts and one final-answer reserve remain; count actual tool schema/output tokens, full plan reads and all prior call context, not just transcript                                     |

Use a verified model tokenizer plus measured SDK framing/tool overhead. A conservative
UTF-8-byte upper bound plus reviewed framing may be used only where demonstrated
safe for that exact tokenizer; otherwise disable the new path, not assume chars/4.
N is storage/display policy, not a token guarantee: if text exceeds 2048 tokens,
select whole lower-priority items out of the pinned projection and disclose that
bounded projection. Do not overwrite the global revision or sever provenance.
For large CJK/emoji/source inputs, enforce both budgets independently.

Compaction runs at a boundary before the next answer, under a 30-second total deadline
(T0269 explicit operator amendment after measured five-second live timeouts; other bounds unchanged),
no automatic retry, no tools, same admitted chat provider only if its text-only
capability/cost profile is approved. Reserve at most USD 0.01 per call and USD 0.10
per local day in a separate durable compaction budget (including unknown outcomes);
unknown cloud pricing refuses compaction. Cap at ten attempts/day, 8192 input tokens
and 2048 output tokens (or smaller reviewed model allowances). Local generation
retains these time/token/attempt limits, not unlimited CPU. It consumes the previous **conversation-only**
compact record plus one oldest contiguous prefix of not-yet-compacted local completed
turns fitting that 8192-token cap; retain the remaining turns unchanged. Admit only
one such batch per boundary, not an unbounded blocking compression loop. If it cannot
free sufficient capacity, use the failure/overflow path below. Never consume the global
summary or fresh tool payload. Keep decisions, rationale, alternatives and user
referents labelled by speaker. Publish a new segment + covered-through turn
atomically using conversation revision comparison, and adopt the latest valid
global revision there. Explicit refresh creates the same controlled boundary.
If compaction fails, use the unchanged segment only if the entire prospective
request still fits. At hard overflow, return a clear context-capacity limitation
before an answer-generation/tool call; preserve transcript and offer retry/explicit New chat.
Never silently drop early context or treat failed compaction as a valid summary.
A single oversized new prompt/required plan read also fails with a bounded reason
instead of splitting away safety evidence or weakening full-read requirements.

### Provider capability and unknown matrix

No private settings/key/model catalog was inspected. Exact **active** configured
identities, funding, prices, remote limits and cache results are unknown. Literal
source defaults below are compatibility evidence, not recommended or proven models.
For every activation record exact provider/model ID, route, capability revision,
context/output limits, tokenizer, reviewed price ceilings and evidence date. Aliases
and OpenRouter route changes invalidate that capability record.

| Provider / source identity                                        | Transport and roles/tools                                                                                                        | Budgets and cache evidence                                                                                                                                               | Conservative behavior                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI; source `AI_MODEL=gpt-6-luna`, catalog exact IDs arbitrary | Responses; converter supports system/developer, user, assistant, function calls/results; actual model contract still needs proof | App sends explicit breakpoint + 30m TTL only for three direct IDs above. Remote support, C/O/pricing unknown; raw `input_tokens_details.cached_tokens` usable if present | No extrapolation to other IDs, no Codex-subscription billing assumption; unsupported options omit only with reviewed no-cache profile, not role/policy loss |
| DeepSeek; source `DEEPSEEK_MODEL=deepseek-flash`                  | Direct chat; text roles/tools converter; V4 reasoning differences; final tool choice auto                                        | No app explicit cache control; raw `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` may be present. C/O/prices/remote behavior unknown                             | Keep reasoning out of replay; no forced tool-choice assumption; unknown cache stays unknown                                                                 |
| OpenRouter; source `nvidia/nemotron-3.5-lightning:free`           | Explicit compatibility chat route; roles/tools may vary by upstream                                                              | No current explicit cache policy; reliable prompt usage/cached details route-dependent; free label is not budget/capability proof                                        | Explicit opt-in, pinned reviewed route; no silent upstream/account/model switch; unavailable on route drift                                                 |
| Ollama; source `qwen3.5:4b`                                       | Explicit loopback compatibility chat; exact installed model/tool support unverified                                              | No proven cache usage/billing counters or C/O; configured context may differ from model metadata                                                                         | Optional only; operator manages daemon/model, no download/start or embedding requirement; local still needs capability proof                                |

[provider-generation.ts](../src/lib/ai/provider-generation.ts) already distinguishes
missing raw usage from zero. Future measurements retain this property: request ID
and purpose once per actual attempt, not aggregate plus every SDK step twice.
`cached=null` means unknown, not zero or savings. Prefix-byte identity is a
serialization result, not provider cache residency, hit rate, price or latency.

## 3. Two state owners, one source journal

### Ownership and illustrative records

These are design fields, not executable schemas or migrations. Application contracts
stay pure; composition binds clock/storage/generation; SQLite adapters alone transact.

| Owner / proposed record                                 | Required identity and contents                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation completion journal (DB conversation owner) | Monotonic transactional `eventSeq`; unique `(turnId,sourceVersion,eventKind)`; conversation/user/assistant IDs and versions, source-admission sequence, explicit completed/aborted state, eligibility and privacy generation; no source text copy                                           |
| Conversation segment (chat owner)                       | Format version 1, segment revision, source conversation revision, pinned global revision or null, privacy/correction generations, conversation compact text + exact local turn coverage and dependency IDs, immutable projection/tool/policy identities                                     |
| Global state (memory summary owner)                     | Format version 1, monotonic revision, parent revision, privacy/control/correction generations, manual revision, bounded dense text, character count/N, source event frontier, item/provenance digest, created/as-of times, model/capability/policy identity, fresh/stale/unavailable reason |
| Supporting summary item ledger (same owner)             | Stable item ID, text, category, stance (`user-stated`, `endorsed`, `discussed-not-endorsed`), source IDs/versions and referent IDs, priority, expiry, supersession links, transform lineage; no raw transcript/tool archive                                                                 |
| Durable summary control                                 | Enabled, global privacy/control generations, latest source frontier, clear/disable cutoff, correction generation, manual overlays, local-day spend reservations, retry-not-before, running lease identity/expiry; never keys                                                                |

Global text is a deterministic rendering of validated items, not an independent
model essay whose provenance is guessed afterward. Proposal output is a bounded item patch: unchanged previous items are referenced by
ID, changed/new items supply source references, and removals require a disposition.
The server validates these against the admitted batch/previous item set, applies the
patch and renders the resulting dense text; output caps never justify silently
omitting unchanged items. Old items can be compressed/merged only with unioned dependency provenance.
A candidate with missing/unknown/deleted dependencies is rejected. Model semantic
faithfulness still needs evaluation; structural validation is not truth proof.
Supporting metadata is bounded: at most 256 active items, 32 total transitive source
references per item (8192 across the active set); flatten/deduplicate lineage within
that bound, otherwise evict the whole item explicitly. A nested lineage pointer is
not a way to hide unbounded metadata. Old revisions are not an indefinite hidden text archive: retain
current text and currently pinned privacy-valid snapshots only; retire unpinned
text. Keep compact non-content revision/disposition metadata for diagnostics.
Source journal/index retention follows existing source lifetime and checkpoint
needs, with no second transcript. Tombstones store IDs/generations only, no deleted
text, embeddings or reversible content hashes.

Global synthesis consumes **previous valid global items/text + new eligible completed
turn deltas**. It does not ingest conversation compact text, its own injected global
text, title text, tool payloads, debug traces or prior provider prompts. Same-chat
compaction consumes local continuity only. A source turn is globally processed once;
previous summary is state, never a new source. Explicit user selections resolve
against the immediately **preceding** assistant options in that conversation,
not the freshly generated reply. Discussion retains “considered/rejected X because
Y,” not an assertion that the user chose an assistant suggestion. No chain-of-thought
or inferred diagnosis is retained.

Priority order: current explicit corrections/manual preferences and live constraints;
endorsed goals/decisions with concise rationale; rejected/tried approaches with
reason; open questions; useful temporary plans; unendorsed discussion last.
Expired/superseded/duplicate/low-value items leave the rendered summary first.
Temporary plans require an explicit date or default seven-day expiry (default-derived
expiry at most 60 days without explicit renewal); undated open questions reconfirm after 30 days.
Stable preferences/decisions get a 180-day review cue, not fabricated expiry;
context cap may evict them visibly by priority, never silently invert their meaning.
Keep a correction's dependency/supersession marker until the old source is removed
or safely covered; do not let an older duplicate revive the old value. If mutually
conflicting user statements have no causal correction/clear priority, retain the
conflict as unresolved, not choose by wall-clock timestamp. Whole items are evicted,
not string-truncated mid-negation; item disposition counts explain bounded loss.

### Ordering, atomic publication and recovery

Assign a separate monotonic `sourceAdmissionSeq` when the user message/turn is
persisted; the clear transaction records its maximum committed value, including
incomplete turns. A later completion carries that original sequence, so a pre-clear
turn cannot evade the cutoff by finishing late. Source edits retain admission
identity and increment version; they cannot manufacture post-clear eligibility.
Assign `eventSeq` from a DB monotonic sequence **inside the same transaction** as
assistant persistence + completed-turn linkage. User persistence alone is not a
completion. H writes the journal regardless of summary On/Off; the completion's
control snapshot records summary eligibility false while Off, without blocking chat.
Summary source admission is distinct from this local journal write. Sequence order is commit order across conversations, not request time,
wall clock, random ID or provider completion start. A late answer receives a later
sequence; equal timestamps and backdated imports cannot create holes. Edits append
a new version/invalidation event and never mutate an event already consumed.
Aborted/unanswered turns are recorded as such without globally extracting an
unanswered user prompt. A valid limitation/incomplete-evidence answer that passed
completion admission and was persisted is a completed conversation turn, with failed
evidence explicitly non-authoritative. Completeness means the local atomic commit,
not guaranteed final network receipt: a disconnect before commit leaves an unanswered
turn; a disconnect/crash after commit does not erase its completed journal event. Overlapping same-conversation turns serialize or
reject against a conversation revision before they can create an ambiguous chain.

One foreground summary writer per selected DB: short lease with unique job ID,
30-second expiry and 5-second heartbeat, plus final transactional CAS. No network
await holds a SQL transaction. Admission snapshots parent revision, frontier range,
source versions, model/config/capability, privacy/control/correction/manual generations
and a cost reservation. A batch admits at most 20 completed turns/8000 input tokens,
including previous state. It takes a contiguous journal interval; every event has
an explicit disposition: represented, unchanged/duplicate, filtered, expired,
aborted or deliberately evicted by bounded priority. Deferred events are not
acknowledged. If one event cannot fit, stop before it; mark oversized/unavailable
and require a minimized explicit user edit/review, not silent frontier skipping.

Publication transaction rechecks lease, all captured generations/source versions,
enabled state, parent revision, frontier and manual revision, then commits **items,
rendered text, checkpoint/dispositions and spend settlement together**. A checkpoint
cannot advance independently or past unaccounted completed work. New arrivals after
the captured upper bound remain backlog. No long transcript rescan in routine work.

| Boundary / event                                 | Required result                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash before assistant/outbox commit             | Neither completed assistant nor completion event visible; saved user may remain incomplete                                                      |
| Crash after completion commit, before scheduling | Journal survives; next active foreground admission discovers backlog                                                                            |
| Crash during generation/before publication       | No checkpoint advance; lease expires, reserved cost remains conservatively charged if outcome unknown                                           |
| Crash after publication/before acknowledgment    | Revision/checkpoint already committed; restart/dedup sees event dispositions, no second application                                             |
| Duplicate delivery or stale writer               | Unique event identity + CAS reject double effect; discard stale result                                                                          |
| Parent/manual conflict                           | Discard, reload once and requeue latest state; maximum one conflict reschedule per active admission cycle, then surface contention and back off |
| Delete/edit/clear/disable during generation      | Generation/control mismatch rejects late publication; cancellation best effort, never deletion proof                                            |
| Corrupt checksum/count/unknown record version    | Mark unavailable and refuse new-path consumption/writes; preserve bytes for compatible recovery, never reset cursor or parse best effort        |
| Shutdown/restart                                 | Cancel owned work, retain journal/checkpoints; no promise a provider stops billing on abort                                                     |

## 4. Foreground scheduling, provider selection and cost isolation

The completion path writes only local completion/outbox metadata synchronously.
After answer delivery, the existing outer response/lifecycle adapter may request
admission. It does not await generation or perform paid preflight. A provider
promise that never settles cannot hold NDJSON done/JSON completion. Admission
failure leaves backlog and an honest stale/unavailable status. Title `after()`
work stays independent; under the T0272 amendment titles share the explicit summary
model while extraction settings remain preserved/inactive for ordinary chat.

Proposed foreground policy: one coalesced pending wake-up and one running job per
DB, no unbounded timer/work queue. Admit after four new completed turns or 2000
eligible Unicode scalars, or after two active minutes of backlog. Debounce ten
seconds after completion, minimum 30 seconds between jobs. While an app is active,
check due work at startup and every 30 seconds, not on passive memory list/status
reads. Two minutes is a scheduling target **only** when foreground, enabled,
capability/credits/network available; overdue work reports stale. Closing the app
stops work; no login item, daemon, remote service or claim of closed-app freshness.
Each foreground admission processes one bounded batch; additional backlog gets a
later wake-up, respecting spend/lifetime caps, never an infinite drain loop.

Summary model selection is an **explicit text-generation selection independent of chat/extraction** (shared with future titles under the T0272 amendment),
default unselected/Off on migration. Offer configured provider identities through
the established private-key owner, with no new credential store. Operator chooses
an inexpensive exact model with approved capability/price profile; do not assume
`luna` identifies a provider/model, silently reuse chat/extraction/title, purchase a
service, substitute accounts/routes, download a model or start Ollama. Cloud export
warning and routing review remain. Select once at admission; later key/catalog
changes affect later jobs, while disable/privacy cancellation invalidates publication
of already admitted jobs. Keys exist only in the established immutable admitted
private snapshot, never journal/status/provenance.

Concrete proposed caps: 15-second absolute generation deadline including parsing,
8000 total input tokens, 2048 output tokens, no tools, SDK automatic retries disabled.
Maximum estimated USD 0.01 per attempt and USD 0.10 per local civil day (at most ten
admitted attempts/day as a second cap). Reserve worst-case reviewed input/output
price before calling; unknown prices refuse cloud admission. Local models use the
attempt/token/time caps with zero provider charge, not unlimited CPU. Ambiguous
billing consumes its reservation until explicit reconciliation; never assume an
aborted request was free. Model/profile changes cannot reset the durable budget.
Daily rollover uses a persisted day/high-water accounting boundary so clock rollback
cannot replenish the same day. Chat budgets/billing remain separate and unaffected.

On confirmed transient network/5xx failure, permit **one** later attempt after
60 seconds plus bounded 0–15s jitter; subsequent failures back off five minutes and
surface degraded state. Invalid output/auth/missing model/unsupported role or unknown
price is not a transient retry. Changed backlog does not clear a provider failure
circuit. Explicit operator retry requires the same caps. Parse closed bounded item
output, validate policy/provenance/N/token limits; malformed/over-budget output is
not partially published. No different provider or deterministic fabricated summary
fallback. Last privacy-valid summary remains usable (label stale); absent/invalid
summary means no cross-chat memory, not unavailable chat. Embeddings are never called
by new history/global-summary paths, even if optional Ollama embeddings are offline.

## 5. Privacy, revision adoption and user controls

### Pinning and urgent invalidation

Prospective T0281 amendment: at each turn's atomic admission, after existing busy
exclusion, adopt latest available privacy-valid global revision or null. No routine
Refresh, panel mutation or provider wait. Preserve the captured snapshot throughout
that request; ordinary publication waits until the next admission. Restarted chats
also adopt at next admission. Explicit compaction/compatibility Refresh remain
internal supported boundaries. Cross-turn prefixes can change; no cache-billing
claim. Prior history stays source-owned, never copied as new global evidence.
Immediate privacy/Off/source/manual invalidation below remains unchanged.

Every use and publication checks durable privacy/control/correction generations,
not merely a revision number or in-memory boolean. Deletion, source edit, clear,
manual correction and Profile correction advance the relevant generation in the
same local transaction as their mutation. Conservative initial design invalidates
**all** global/compact/active derivative snapshots for a privacy event, rather than
claim selective removal from free text. Important corrections force boundary
adoption/recomputation before the next turn; no new global publication is needed
to honor a current correction. Profile itself remains separately authoritative.
Explicit source/manual/Profile edits have deterministic invalidation. For natural-
language corrections, the ordinary chat turn may emit source-linked supersession
metadata, validated and committed with its completed-turn event; no extra classifier
call or confirmation loop is introduced. Recognized important corrections advance
correction generation at that commit, even if synthesis is unavailable. The latest
user text outranks old memory in its own request regardless. Interpreting arbitrary
language is not deterministic proof: ambiguous corrections require clarification,
and an explicit Memory Edit/Forget is the immediate guaranteed cross-chat control.
Correction discovered later by synthesis advances generation on publication; until
then status must not promise that unprocessed conversation changes are fresh.

Before generation, before each side-effect tool, before assistant persistence and
before final delivery, compare captured generations. On mismatch, cancel generation,
stop new tool actions, suppress undelivered answer and disclose interruption. Already
rendered chunks cannot be recalled; clear the app's active display/cache for deleted
content and explain that any already sent provider context cannot be unsent. Persist
only a safe interruption marker, never the now-invalid generated answer. Previously
committed plan writes are not rolled back or repeated; report exact save outcome
without the deleted source content and require a fresh read. A late job/answer is
never allowed to repopulate deleted text or an invalid pin. Cache reuse loses.

### Scope table

These are target semantics for **new derivatives**; legacy deletion changes require
explicit UI scope and separately tested compatibility, not silent widening.

| User action                                                    | New summary/history derivatives                                                                                                                                                       | Originals / other domains                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete one message / edit source (future message-edit control) | Advance privacy generation; remove old-version inputs and invalidate dependent global/compact/pins; edited new version can become eligible only under current rules                   | Delete/edit exact source only; other transcript and Profile remain. Current app lacks a general message-edit API; this is future work, not an existing control claim                                                               |
| Delete chat / clear its history                                | Same invalidation; tombstone completion/source IDs, no automatic re-import                                                                                                            | Exact chat removed. Current semantic only `kind=conversation` scoped deletion preserved unless explicitly expanded; saved preferences remain visibly separate                                                                      |
| Clear global summary / Forget learned context                  | Invalidate text/items/manual overlays/pins and cancel jobs; record clear cutoff covering **all persisted source through the clear transaction**, including incomplete pre-clear turns | Transcripts/Profile/Garmin/legacy vectors retained; no historical replay or pre-clear late answer resurrection. Future new turns may create memory if enabled                                                                      |
| Disable processing                                             | Advance control generation; cancel/reject jobs, stop summary use and new source admission; pins unavailable while Off                                                                 | Preserve stored summary/source/legacy data. Re-enable may restore privacy-valid prior text, but events completed while Off are excluded unless explicitly selected for bounded import; chat/title remain independent               |
| Edit summary                                                   | Validate minimized manual items and source/expiry scopes; manual revision + correction generation; re-render within N, invalidate pins before next use                                | Explicit manual overlay wins over synthesis for matching item/key until removed/expired; generated jobs cannot overwrite it. Free text with unresolvable scope is a standalone user-authored item, not false transcript provenance |
| Clear chat and Profile                                         | Invalidate all new derivatives, set cutoff and remove source-owned references                                                                                                         | Preserve actual current legacy memory exclusions and saved plan documents unless UI explicitly includes them; explain those surviving stores. Do not claim “all memory erased”                                                     |
| Delete Garmin data                                             | Invalidate fresh grounding and all new derivatives conservatively; never rebuild metrics from assistant text                                                                          | Existing Garmin scope only; source transcripts/plan/Profile/legacy records, external tokens/keys remain separate. No widening to unrelated tables                                                                                  |
| Provider key/model change                                      | Future admission uses new snapshot; no fallback; disclose saved/active difference                                                                                                     | Not deletion of data already exported or provider logs; interrupted active work keeps its admitted snapshot except privacy/disable refusal                                                                                         |

Manual items pass the same structure, Unicode, size and source-authority checks as
generated items; neither has a content-pattern veto. Deleting a source invalidates a manual item if it is
bound to that source. Standalone manual items are removed by summary clear/delete
of the item; if they might encode deleted material and safe independence cannot
be proven, invalidate rather than resurrect. Off is not Clear. Legacy memory,
chat/title processing and Profile are separately named, not one misleading switch.

Deleting one summary item advances privacy generation and creates an ID-only
suppression record for that item's exact source-version lineage, so an older job,
import or incremental merge cannot recreate it from the same sources. Delete does
not delete the transcript. A newly stated explicit user preference may create a
new item with new source identity; unrelated later chat cannot silently re-admit
the forgotten lineage. Suppression survives restart/rebuild until that source is
deleted or an explicit reviewed re-import changes the choice; stale manifests cannot
override it.

### Minimized inputs, rebuild and erasure limits

Global input is at most the eligible latest user text plus a bounded prior-assistant
referent needed for an explicit selection/correction, reduced to practical concepts
before any summary-provider request. Native credentials/configuration and raw
Garmin/tool payloads are not summary sources. User-authored discussion mentioning
those concepts, medical topics, paths or URLs is not excluded or rewritten by
patterns. Quoted instructions stay untrusted data, never policy or action authority.
Explicit no-save, missing/ambiguous referents and source restrictions still exclude
whole inputs with a disposition. Same-chat visible assistant continuity is not an
unrestricted global archive. Current chat boundaries on normalized Garmin evidence
remain unchanged.

Exceptional rebuild is separate from routine incrementality: invalidate all old
text, keep no stale usable pin, and reconstruct only from independently validated
surviving item provenance or explicitly selected safe source turns under the same
bounds/caps. If merged lineage includes a deleted source or is incomplete, drop
that whole item and dependent text; do not ask a model to “forget this substring.”
No automatic unlimited all-chat reread after deletion/corruption. If the selected
safe frontier cannot be reconstructed within a bounded resumeable import, keep
no-memory and request explicit review/rebuild. Rebuild never imports pre-clear/Off
content without a new visible selection; tombstones/cutoffs win over restored items.

App-owned stored text, pinned snapshots and caches are invalidated locally. Minimal
ID-only tombstones/checkpoints survive to prevent resurrection; deletion compacts
away deleted provenance text/digests. Existing debug traces may contain private
context: any future derivative export/logging must exclude raw text and the owning
slice must inventory/invalidate app-owned content caches/traces, not claim DB deletion
erases every log. Provider retention, user exports and operator backups are outside
local erasure guarantees. Restoring an older backup can restore old content and old
tombstones: require explicit offline recovery/reconciliation before enabling new
summary use, never claim a generation stored in the same restored DB prevents that.
No provider deletion API, backup scan or automatic private-file mutation is authorized.

### Inspectability

Memory UI shows dense saved text, manual overrides, revision/source category/count,
as-of/frontier, configured N/model, enabled versus active state, pinned revision for
the selected chat, latest revision available, projection omissions, and fresh/stale/
unavailable/Off with fixed reason codes. Offer Inspect, Edit, Delete item, Clear,
Disable, Refresh active chat and explicit bounded historical import. Show exactly
which stores each destructive action affects. Native configuration distinguishes
draft/saved/active and restart-only topology from live shared-key updates; preserve
existing private commit/acknowledgment semantics. No key, private setting path,
transcript excerpt, prompt, vendor error or raw source content in status telemetry.
Source links may open existing local owned messages; deleted sources cannot be
recovered via provenance UI. Never probe providers merely to read status.

## 6. Compatibility, rehearsal and activation

### Inventory and preservation

| Current state                                                                                                                | Compatibility decision                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`, `conversation`, grounding JSON, monotonic process timestamps, title-attempt tombstones                            | Preserve originals/visible history. New turn/version journal is additive; old messages are not retroactively declared complete from time/role alternation                                                       |
| `semantic_memory`: vectors/model/text/status/source IDs, optional expiry                                                     | Preserve bytes and controls. No re-embedding, dimension mixing, blind provider switch or automatic deletion. New path never ranks these vectors                                                                 |
| `trainer_memory` and lazy semantic legacy migration marker                                                                   | Preserve originals/markers; new importer is independent, idempotent and must not accidentally invoke old embedding migration on status/import reads                                                             |
| Profile, general/original/latest weekly plan/review, `app_metadata` including `ai.chat_model.choice`                         | Independent authority and persistence; no rewrite or seed of chat preference by summary setup                                                                                                                   |
| Native settings v3, retained v2/v1, `selectionCompatibility`, original-v3 archive; activation v3 with older frames supported | New explicit versioned summary configuration must preserve originals and existing extraction/title/embedding fields. Do not overwrite unsupported records or let an old parser silently ignore privacy controls |
| Shared OpenAI/DeepSeek/OpenRouter private slots, optional loopback Ollama                                                    | Reuse native private snapshot owner only. No key readback/new secret file; unknown saved versions refuse, never become blank-install authority                                                                  |
| Conversation delete, bulk chat/Profile clear, Garmin delete, Memory edit/delete/clear/disable                                | Add new derivative invalidation atomically to named scope; preserve documented legacy exclusions or obtain scoped approval for a changed user-facing scope                                                      |

### Bounded one-time import

Default: no historical provider processing. Existing chats remain browsable; new
history can use a safe bounded local segment without global import. On explicit
selection, freeze source inventory/version and deletion generations on a backed-up
disposable copy first. Prefer source-backed user items; deduplicate legacy/semantic
copies by origin reference and normalized concept, not vector proximity. Choose
current Profile/manual correction over older preference; do not blend conflict or
use a recent migration timestamp as user intent. Provenance-less legacy items are
listed for manual review, excluded from automatic synthesis/export. Expired,
deleted, no-save and unendorsed assistant-derived records stay excluded.

Use immutable `(sourceKind,id,version)` import IDs and durable pending/processed
manifest, not timestamp cursors. Legacy transcript completeness is uncertain: only
explicitly confirmed user/assistant pair linkage or visible reviewed selection is
eligible; do not fabricate it. Maximum 200 selected turns or 100000 Unicode scalars
per import selection, batches of 20/8000 tokens, ten attempts and the same USD 0.10
daily cap; stop at cap, persist resume position and explain remaining selection.
No unbounded repeated rescans. Cancel/disable pauses without checkpoint skipping;
revalidate all versions/generations on resume. Repeated import is idempotent;
source edits/deletes invalidate old manifest entries. Clear cutoffs/tombstones cannot
be overridden by a stale manifest. Broader import/export needs a new explicit choice.

### Rehearsal, primary gate and rollback

Each storage-owning slice must select the exact target, obtain a WAL-consistent
online backup, verify integrity/schema and preserve original settings. Rehearse
additive migration, interruption/resume, source deletion, unsupported versions,
new writes and old-build refusal on a disposable populated **synthetic** copy via
the existing finite smoke recipe; no new fixture framework. Record schema/status,
counts/checkpoint integrity and original fingerprints, never raw rows/keys. Desktop
ordinary startup/Use existing must remain non-migrating. Primary schema upgrade,
activation or restart needs separately scoped explicit operator approval; a source
PR merge is none of these.

Before new writes, source revert plus compatible preserved DB/settings is possible.
After new journal/summary/control writes, older builds that do not enforce privacy
must refuse the new format/compatibility fence; do not rely on them ignoring additive
tables. Migration introduces that fence through existing schema/settings admission.
Use compatible newer build/forward fix; an explicit offline restore creates a separate
reconciled target and must account for post-backup user data and deletion state.
No automatic downgrade, copy-back, destructive vector cleanup or old-settings fallback.
If compatibility fencing cannot be demonstrated, activation is blocked, not deferred
to cleanup. Embedding retirement is a separately approved final integration choice,
not an automatic consequence of source delivery.

### Independent slices and activation states

Labels H, S and I below are **non-executable design data**, not tickets, successors,
consent or worker launches.

| Slice                                             | Owns interface/storage and complete delivery                                                                                                                                                                                                                                                   | Independent evidence/data obligations                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H — role history and local compaction             | Chat-owned neutral `ConversationSegment`/ordered request input, token allocator, local compactor; DB conversation owner owns completion/version journal and segment transaction. Summary port `readPinnedRevision` may return absent/disabled; no global producer dependency                   | History/adapter/tool provenance/budget/compaction unit and serialized-transport contracts; chat JSON/NDJSON regressions; actual native long-follow-up/overflow/restart evidence, inspected captures where visual. Additive journal/segment migration + existing-history rehearsal/back-sync or explicit target no-op; own synthetic rows/cleanup receipts and source PR                   |
| S — global producer and independent selection     | Memory-owned `readSummaryStatus`, `admitSummaryWork`, `publishSummaryCAS`, source eligibility, item ledger/checkpoint, privacy/control invalidation; uses conversation journal through a read port. Native outer owner adds separate selection/private projection, no title/extractor redirect | Incremental/order/fake-clock/cost/deletion/CAS/crash tests + real SQLite atomicity and settings compatibility; native foreground/quit/restart/status/independent selection, actual configured provider only with explicit scope. Own additive storage/settings rehearsal, bounded import/back-sync/no-op and task-created cleanup; producer remains Off/no consumer by default; source PR |
| I — pins, controls and explicit legacy transition | Integrates ports, per-use generations and UI; source-lifecycle owner atomically binds delete/clear/edit scopes; no new general coordinator. Activates only reviewed exact capabilities                                                                                                         | Its own UI/control/privacy/route tests plus integrated native multi-chat/refresh/deletion/in-flight/provider-outage and cache/usage evaluation. Own explicit populated-copy import/rehearsal, approved primary activation/back-sync or honest blocker, inspected UI captures and task-created cleanup. Legacy retirement needs explicit scoped approval; source PR                        |

| Delivered / activated state                           | Safe usable behavior                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neither new slice active                              | Existing history and semantic memory unchanged                                                                                                                                               |
| H active, old memory                                  | Role-preserving local continuity/compaction; old vector retrieval remains a fresh turn-scoped lower-authority input, not pinned global truth. Label legacy use and respect existing controls |
| S delivered without H                                 | Producer/selection stays Off; legacy tables/status unchanged. It cannot invent the missing journal or require an unpublished H to keep ordinary chat usable                                  |
| S active with journal, no new consumer                | Only after explicit rehearsal/selection; inspectable summary produced but not injected into chat; user sees “not used by chat.” No silent duplicate old+new retrieval                        |
| Consumer delivered, S absent/disabled/unknown version | Null summary, explicit no cross-chat-summary status, normal local conversation remains usable; unknown format refused, never fallback to deleted snapshot                                    |
| H+S+I active                                          | One privacy-valid pinned projection per segment, background incrementality, explicit adoption/control behavior; old vectors preserved but not simultaneously consumed as a duplicate source  |
| Rollback / forward fix                                | Disable new work/use under generation fence; preserve journal/DB/settings. Use compatible build or explicit reconciled backup, never start an unsafe older writer                            |

H and S can develop pure contracts/logic in parallel only after agreeing the journal,
source-version/generation and absent-port contracts above. H owns journal DDL and
completion/deletion transaction integration; S consumes it and owns summary DDL.
Serialize migration numbering, DB lifecycle edits, native settings/activation protocol
and merges. Do not activate S until journal and invalidation hooks actually ship.
Shared file paths alone do not forbid parallel work; incompatible storage/privacy
semantics do. I is not a postponed testing bucket: each slice must be safe, tested,
smoked where applicable, data-compatible and independently delivered first.

## 7. Review and activation gates

| Decision / risk                                     | Disposition and required proof                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role fidelity versus cache                          | Preserve roles/authority first; serialized request tests before activation; cache unsupported is explicit unknown, not a reason to flatten policy/history                                |
| Model IDs, C/O, tokenizer, pricing and remote cache | Source defaults are not live facts. Exact route capability/pricing review and authorized native/provider measurements remain future gates                                                |
| Compaction/global drift                             | Provenance + priority + authored repeated-round scenarios; no self-echo; reject ungrounded candidate refs; semantic quality still needs evaluation                                       |
| Deletion and arbitrary manual prose                 | Conservative global/pin invalidation and no-memory fallback; provenance-safe bounded rebuild only; uncertain independence means exclusion                                                |
| Sensitive/export expansion                          | T0283 authorizes removal of cross-chat prose patterns, including medical topics; native/private input access, unrestricted assistant/tool export and new paid services remain unapproved |
| Migration/activation/retirement                     | Additive rehearsal and compatibility fence first; separately approved exact primary target/restart/legacy deletion, not inferred from this design or PR                                  |
| Background lifecycle                                | Foreground only, coalesced bounded work and durable source journal; no closed-app freshness guarantee                                                                                    |

Acceptance A–G maps to sections 2, 3, 4, 5, 6 and
[authored scenarios/evaluation](memory-redesign-acceptance.md). Design review must
walk state transitions as well as topic coverage. Documentation validation cannot
certify model quality, privacy implementation, migrations, caching or native behavior.

## 8. Delivery and evidence boundary for T0268

Documentation-only source PR; no runtime/tests/scripts/schema/settings implementation,
provider call, model download, private transcript/settings/DB inspection, app launch,
migration/backfill, primary restart/install/release or successor creation. Native
smoke and screenshots: **not applicable — no app behavior or visual surface changed**.
Data back-sync: **no-op — no schema/data/runtime change**. App-data cleanup: **no-op —
no app/test rows created**. Dependency install and textual docs checks are not native
smoke. No release-note fragment is needed for an unimplemented proposal; navigation
must explicitly say proposed. Each future slice retains the actual validation,
smoke, data target/cleanup and delivery duties above; this PR waives none of them.
