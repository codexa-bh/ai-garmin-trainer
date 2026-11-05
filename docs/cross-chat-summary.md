# Integrated incremental cross-chat summary

The source integrates the bounded producer with stable conversation-owned pins,
manual/Forget/Refresh controls, native shared summary/title configuration and
explicit reviewed historical transition. Ordinary chat no longer retrieves or
ingests legacy vector facts. [Conversation history](conversation-history.md)
remains usable without a valid summary. This is not an installed-app activation
or real-provider quality certificate: the [accepted contract](memory-redesign-contract.md)
and [scenario obligations](memory-redesign-acceptance.md) retain their evidence gates.

## Shared summary/title configuration, independent chat

Native Settings → Memory has three separate startup fields:

- Cross-chat summary processing: Off by default; independent title processing remains.
- Shared summary/title model: Unselected by default; currently only **OpenAI ·
  gpt-6-luna**, direct Responses, is qualified. No chat/extraction selector,
  embedding service, alternate provider or account is substituted. Titles have
  separate120-output/3000ms/USD0.001-per-attempt limits; see [memory](memory.md#first-prompt-chat-titles).
- Character limit: integer1000–20000, default6000 Unicode scalar values after
  CRLF→LF. Invalid surrogates/fractions/ranges refuse, without language normalization.

Explicitly review cloud export before enabling: minimized eligible user-derived
context and only necessary safe preceding assistant referents leave the app.
Native's existing private OpenAI slot supplies immutable admitted credentials;
keys never enter jobs/SQLite/status/renderer readback/new secret files. Settings
Save uses existing private revision/commit/archive safeguards. These fields are
**restart-only**: Save does not start processing or change an already running
engine. Catalog/shared-key live Save retains its existing narrower protocol;
key/catalog generation changes reject old summary publication. Missing keys,
funding, network, selection or reviewed capabilities are unavailable, not fallback.
DeepSeek/OpenRouter/Ollama construction alone does not qualify summary token,
price, output/stateless behavior; those summary routes currently remain unsupported.

Native v3 stores allowlisted scalars and hidden `SUMMARY_CONTRACT_VERSION=2`
through the existing owner on explicit Save. Older parsers reject the unknown
contract field instead of ignoring changed shared-title/privacy semantics;
original v1/v2 and original-v3 archive preservation remains unchanged. Existing
settings without these fields load Off/unselected. Unsupported settings are never
blank-install or downgrade authority. Preserve originals and use a compatible build.

## Incremental state and bounded foreground work

Schema19 consumes H's transactional completion journal. Assistant persistence and
completion eligibility commit together. Source-admission sequence and versions,
not timestamps or alternating old messages, define coverage. The migration defaults
Off and records a cutoff over existing admitted sources; it does not backfill or
export history. Completed events while Off are explicitly excluded after re-enable.
Aborted/incomplete turns are never promoted. A necessary preceding option referent
is separately bounded1200 scalars and screened; the newly generated answer and
unrestricted assistant/tool/compaction/summary text are not new global sources.

The existing native-app lifetime coalesces completion notifications at a short
two-second debounce; one small eligible turn is sufficient. A fixed identity-bound
startup/30-second recovery tick discovers retained backlog and expiry. There is
at most one running job and at least two seconds between dispatches. Arrivals during
a job remain pending and drain on the next finite job without another discovery cycle. Each job reads
at most20 new events plus the prior bounded ledger, not covered old transcripts.
Exact serialized token admission can shorten only an unconsumed suffix. A single
oversized event stops the frontier for explicit minimized review, never silent loss.
Passive list/status reads start no timers, providers, embeddings or legacy migration.
The chat completion path adds only synchronous local eligibility metadata; neither
JSON nor NDJSON awaits this engine or its provider/counting request.

A30-second unique writer lease with5-second heartbeat plus final transactional CAS
protects summary/items/transitive provenance, event/item dispositions, checkpoint
and committed attempt publication. Network work holds no SQL transaction. New
arrivals stay pending. Every source event has a disposition; output cannot omit
old items without an explicit fate or shed ancestor lineage through a replacement.
At most256 active items/32 flattened source references per item are allowed. Rendered
text distinguishes user-stated/endorsed/unendorsed material, rationale, alternatives,
corrections and temporary context. Structural validity is not semantic truth proof.

The direct Luna adapter counts the actual SDK-serialized Responses payload with
`/responses/input_tokens`, never characters/4 or an unreviewed tokenizer. It pins
`store:false`, no thread/previous response, explicit no reasoning/tools/fallback,
size-aware finite input/output envelopes, zero SDK retries and a60-second whole-operation deadline covering all counting and dispatch. For N1000/6000/20000, output allowances are36768/56768/112768 and input106304/146304/258304 tokens. These are conservative serialized text/metadata envelopes, not predicted usage or character/token ratios; exact counting still refuses oversized prior lineage/schema/source payloads before inference. The reviewed Luna context/output ceilings are1,050,000/128,000.
Summary patches and titles request separate strict closed JSON output schemas through
the locked SDK. Exact preflight includes the serialized schema. Domain patches
still require keep/upsert/remove/coverage arrays. Summary transport now uses a
per-batch closed coverage object with one required reason for every exact admitted
source ID; no missing/foreign logical key or duplicate list entry is representable.
The adapter validates the entire object, then restores the unchanged domain array
in source order without inventing/filling dispositions. Unsupported/invalid wire
output refuses with no fallback; domain coverage/lineage checks still apply. Domain validation still independently checks source
lineage, coverage, authority, expiry and character bounds; schema conformance is not
semantic approval, and unsupported structured output has no text/model fallback.
Cancellation bounds even a provider promise that ignores its signal. Provider logs,
provider-side retention and billing after cancellation are not controlled locally.

There is no daily summary attempt or spend ceiling. Before provider/preflight,
persist a conservative reservation from the finite input/output allowances at the
reviewed2026-11-04 standard Luna price basis: USD0.25 input (conservative12-hour
cache-write rate) and0.50 output per million. Report observed-token estimates at
standard undiscounted0.10 input/0.50 output separately from gross reservations and
outstanding unknown/legacy liabilities across all days. None is an invoice or a
cache-saving claim. Missing/partial usage and legacy flat reservations remain
unknown; historical attempts/spend are preserved. Day high-water, restart, model
changes and clock rollback never erase liabilities. Disable stops new summary work;
independent title and local compaction limits remain unchanged. Confirmed5xx permits a later60–75-second
attempt; repeated failures back off five minutes under the same caps. Invalid/auth/
unknown/cancelled outcomes need explicit recovery, not an automatic replay. Expired
reserved leases remain conservatively charged and require explicit Retry. Actual
input/output/cached usage is recorded once from the single inference step; absent
counters stay null, never zero or a claimed invoice/cache saving.

Shutdown stops admission, aborts owned inference and removes the polling timer
within native's existing bounded drain. Closed app means no progress promise/daemon.
Restart retains backlog/checkpoint/attempt/cost facts and refuses blind uncertain replay.

## Stable pin, inspection, controls and privacy

Schema20 stores sealed summary/null snapshots. Prospectively, each turn's atomic
admission replaces stale/null adoption with latest available privacy-valid memory,
after busy exclusion. Reads never adopt. Publication during a turn never swaps its
snapshot; the next admission adopts it without manual maintenance.
Before qualified inference, exact token accounting measures the entire frozen
snapshot once, without an independent memory clipping ceiling. The whole request
adds that measured memory to its existing non-memory allocation and retains model,
output/safety and fresh-tail bounds. Genuine whole-request overflow reports capacity
rather than silently dropping meanings. The measured pin is sealed and survives
ordinary publication and restart; already-measured projections remain byte-stable within the admitted request;
next-turn adoption never rewrites latest S.
Explicit New chat and the compatibility Refresh API retain their bounded catch-up,
but normal next-turn adoption adds no provider wait and needs no Refresh. A late
publication cannot replace a currently admitted snapshot. Cross-turn prefixes may
change; structural prefix identity is not a cache-billing guarantee.
Explicit Refresh compares summary authority and segment revision and refuses a
busy chat; deliberate local compaction adopts latest S inside its existing CAS.
Both planner and synthesis replay the pin as untrusted user data, not policy.

`GET /api/cross-chat-summary` is fixed metadata only: state/reason/revision/frontier,
pending count, character/item counts, shared model, enable state, N/as-of/spend and
expected revision/privacy/control/manual authority. Without a selected chat it
reports `usedByChat:false`. `?view=content&conversationId=<id>` separately returns
local items/manual IDs/source links, preserved legacy review, historical manifests
and the selected-chat pin; `usedByChat` reflects its measured qualified-route
projection, not a global toggle. `?view=native` is a smaller closed version1 native
status with no content. States distinguish Off, unselected, never-produced, stale,
unavailable and fresh. Corrupt/unknown state preserves bytes and refuses use/writes,
never resets the cursor.

Every public POST carries `version:1`, `expected:{revision,privacy,control,manual}`
and one closed action: `clear|disable|enable|retry`, `edit` (id/null and text),
`forget` (id), `refresh` (conversationId/segmentRevision), `import-create`
(sourceIds), or `import-pause|import-resume|import-cancel` (manifest id). Unknown/
extra/stale inputs refuse, with409 for contention/stale actions. Reads never probe
providers. Immediate Disable persists
across unchanged native startup configuration; explicit Enable can restore it only
when active native configuration is already On with the qualified model. It never
activates pending saved topology, resets spend or silently imports Off events.
Changing actual native topology is an explicit separate action. Off preserves stored text but forbids use/admission;
re-enable does not import Off events. Clear removes derived text and records an
all-source admission cutoff including incomplete pre-clear turns. It leaves original
messages/Profile/Garmin/legacy vectors/plans untouched. Retry preserves all spend/
unknown attempts and still enforces bounds; it never performs inference synchronously.
Manual edits use safety-validated source-linked or honestly standalone overlays,
which outrank generated patches sharing their lineage. Forget removes the item and
suppresses exact source versions; new explicit statements have new identities.
Manual/control generations reject stale writers, active answers and old pins.
Trainer hides uncertain projection state during mutation and reinspects after
commit; failed/unknown actions are never automatically replayed.

H's source edit/delete, Profile, semantic-control and Garmin invalidation generation
also invalidates all producer text and admitted jobs in the same transaction. No
substring-redaction erasure claim, stale revision fallback or automatic history
rebuild is made. Narrow explicit `Actually …`/`Correction:` source signals invalidate
S before synthesis; arbitrary-language correction detection is not guaranteed.
Later validated supersession advances the S control/manual generation. Every H
inference/tool/persistence/delivery guard checks captured authority, including null
pins. The completing correction receives only its own updated delivery receipt;
concurrent admissions remain invalid. Ordinary publication alone never revokes pins.
New summary-dependent debug copies are explicitly marked and removed on revocation;
original visible transcript and pre-existing unmarked grounding stay preserved.
Streaming errors remove uncommitted display; already exported/displayed content,
provider logs and backups cannot be recalled.

Temporary items default to seven days, open questions receive a30-day review cue,
stable decisions/preferences a180-day review cue. Expired items are omitted at use
and a due local maintenance publication can remove them without a provider call.
Whole-item dispositions preserve bounded loss without truncating negation. Unsafe
credentials/medical/raw/GPS/tool/injection candidates are excluded whole; the generic
M09 denial is minimized to “not for medical reasons,” not a positive diagnosis.

## Explicit historical transition

Reviewed selection freezes at most200 exact completed Off-turn versions /100000
source scalars after the current cutoff in a format1 sealed manifest. The same
foreground S writer, lease, size-aware exact token admission and20-source finite
batch process it, without a separate hidden daily summary budget. Separate import dispositions preserve routine incremental
frontier and exactly-once local publication. Pause/cancel preserve positions and
unknown billing; resume verifies the seal, disposition count, source versions,
privacy/control/manual generations, cutoff and suppression. Authority changes
require new review. No timestamps/role alternation fabricate old completion.

Legacy records remain bounded read-only review without lazy migration/embeddings.
Unproven, unsafe, expired/relative-time, suppressed and already-imported sources are
excluded from automatic processing; manual review remains available. Historical
expiry prose is not rebased to today. Imports retain original transcripts/facts/
vectors/markers and never activate automatically at startup. Private export and
actual legacy deletion remain separately approved operations.

## Explicit Rebuild from chat history

Memory now offers one compact local preflight and explicit **Start rebuild**.
Ordinary updates and rebuild share the actual future-coaching usefulness policy:
retain important context/reasons, scoped failed-approach lessons, significant
unresolved choices and explicit corrections; distinguish historical/current facts,
questions/commitments and assistant proposals/user endorsement. Useful meaning may
survive harmless noise. Incidental routes/weather, isolated measurements, one-off
requests and obsolete targets are not filler; empty/underfull memory is valid.
Instruction/schema/wiring tests are not proof of actual model selection quality.

Preflight paginates the full original conversation/message pool in250-row pages,
not the sidebar or200-row import window. It reports total/included/excluded chats,
user messages and separate unique assistant-context counts. User exclusion reasons
are exclusive; other message roles are not user sources. Local inspection neither
exports nor calls a provider. The displayed USD range is zero through a finite
conservative worst-case reservation (at most one request per included source), not
an exact token estimate/invoice. Exact SDK serialized admission still precedes each
request. A concise final confirmation names privacy/uncertain cost and manual preservation/
replacement consequences. Raw accounting, technical tables and per-chat snapshot
routes are not routine UI; internal receipts/status remain with their owners. Off, unselected,
missing native key/lifetime, empty selections and operation limits refuse Start;
no model/key/topology is enabled or substituted.

Schema22 added an original-message authority watermark and staged-operation
records. Schema23 adds only a known future-Clear floor initialized to zero, preserving
the original migration/floor, active summary/pin formats and historical receipts.
Old clearing remains uncertain, not retrospectively certified. Exact all/selected-chat
review plus explicit legacy inclusion can admit that uncertainty; known suppression,
recorded Clear and linked cutoff remain binding on sources and context ancestry. Old Clear cutoffs covered linked admissions, not unlinked originals.
Migration therefore fences all then-existing **unlinked** rows as unproven, rather
than treating button consent/timestamps as resurrection permission. Completed linked
sources still obey actual version/cutoff/suppression authority. Genuinely post-fence
unlinked originals can be admitted with their real IDs, speaker, stored millisecond
time, full content hash and screened chronological context. Equal-time/unsafe/
suppressed/unproven option referents fail closed. No completion events or historical
tool executions are fabricated. Assistant context is lower-authority, never user
endorsement; its original and originating-user ancestry follows derived items so
Forget/manual precedence cannot disappear. A forgotten unlinked original remains
suppressed across edits; a genuinely new message has a different identity.

Strict version1 commands include non-generating `rebuild-review` (`selection`),
`rebuild-start` (`id`, reviewed `snapshot`, optional `selection`) and `rebuild-cancel`
(`id`) under the existing expected revision/privacy/control/manual CAS. Selection
is exactly `{version:1,conversationIds:null|string[],includeLegacy:boolean}`:
null is all retained, a unique sorted ID set is selected chats; empty is non-ready.
Unknown/extra/duplicate/foreign inputs refuse. Bare old Start stays conservative.
New format2 operations seal selection and explicit inclusion intent into authority
JSON; format1 receipts remain readable without consent backfill. Same-ID requests
with different consent refuse; read/final publish revalidate the same inventory. The operation binds source inventory/content, authority and native boot/live
configuration generation. Same-ID reconciliation never starts another operation;
concurrent rebuild/import/writer starts refuse. Internal jobs reuse S's20-source
size-aware provider/lease/reservation seams, but start from an empty generated
candidate, not old generated memory. Maximum10000 admitted user sources/2000000
source-and-context scalars and a two-hour operation deadline are explicit refusal
bounds, not silent inventory truncation. Oversized single messages are disclosed
and excluded whole at16000 scalars. Cancellation/reopening/deadline/unknown effect
never automatically replays Start; a new explicit operation preserves prior costs.

Batches stage validated candidates and source dispositions without changing active
memory or pins. Only the complete candidate plus manual overlays, unchanged source/
control/config authority and valid capacity commits one replacement through the
existing writer transaction. The final transaction accounts for inventoried routine
completion coverage; it never labels excluded sources represented. Failures leave
old memory intact, except independent immediate Clear/Off/privacy revocation still
wins. Manual and privacy authority changes invalidate staging; candidate text is
scrubbed while bounded progress/provenance/accounting receipts remain. Completed
operations retain no duplicate generated-text history. Original messages, Profile,
Garmin, plans, legacy stores and gross/unknown liabilities are not rewritten.
Next admitted chat turns adopt available valid rebuild publication automatically;
a request already admitted retains its snapshot unless immediate privacy revokes it.

Authored semantic rubric (separate real-provider approval/evidence required):

| Authored case                                                            | Expected meaning / forbidden inference                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Noisy route talk plus repeated long-weekday failure caused by caregiving | Short-weekday constraint, why and scoped lesson; not weather/distance chatter     |
| Cycling versus hiking preparation correction                             | Preserve the explained distinction, not “never cycle”                             |
| Earlier evenings explicitly corrected to mornings                        | Current mornings; evenings historical, not simultaneous current preferences       |
| Assistant poles/bag offer, unresolved question, later bag rejection      | No endorsement until actual choice; retain rejection reason, not an invented goal |
| Isolated measurement/rewrite/obsolete monthly target                     | Exclude unless needed for a durable conclusion; unused capacity is preferable     |
| No-save, unsafe, suppressed or cleared history                           | No export/resurrection or plan-save permission                                    |

Current keyless ordinary smoke proves real manual lifecycle and rendered preflight/
missing-capability refusal. Fixed authored presentation separately covers selected
legacy review/final confirmation, populated/empty/Off/error/progress/result/recovery
states, never successful provider progression or semantic quality.
Real-SQLite supplied-generation tests prove staging/races/mechanics. Exact separately
approved native provider/model/export/cumulative-spend evidence is required before
claiming actual relevance selection or live consumption. Source delivery does not
install/activate the feature or migrate primary data.

## Compatibility and validation

Rehearse additive19→21 migration on an authored populated stopped online backup;
preserve transcript, Profile, normalized/legacy memory/settings and completion IDs.
No historical completion/summary backfill occurs. Journal/settings/summary/privacy/
checkpoint/spend behavior and reopen/integrity require explicit evidence. Ordinary
startup/Use existing is still non-migrating. Schema21 adds per-attempt reservation/basis/day columns without rewriting existing
pin payloads, historical usage or gross spend. Legacy reserved attempts gain exactly
their old USD0.01 liability with unknown original price/day basis; no refund/backfill.
Existing schema20 desktop admission refuses21;
after new writes use a compatible forward fix or an explicitly reconciled backup,
never a downgrade/reset/copy-back or unsafe older writer. Source delivery grants no
primary DB/settings access, migration, restart, install, release or activation.

Tests `summary-policy`, `summary-storage`, `summary-provider`, `summary-composition`,
`summary-pin`, `summary-import`, `summary-memory-ui`, `native-memory-smoke`
and `summary-seed` cover pure contracts, actual SQLite, synthetic real SDK transport,
independent admitted config, cancellations and recipe refusal. These are not remote
provider/semantic-quality certificates. The [finite keyless native scenario](dev-bridge.md#keyless-summary-producer-lifecycle)
proves actual independent selection, scheduled missing-key failure, durable backlog,
restart/no replay, Clear/Off and preserved originals on ordinary outside-checkout
artifacts. Its integrated control extension exercises manual Edit/Forget/Off/Enable/
Clear and owned restart with masked Memory captures. It does **not** prove successful
live synthesis, semantic answer quality or native Settings input.
Separately authorized opaque native provider use and a metered test envelope are
required for that stronger evidence; a dollar ceiling alone is not credential readback
or primary-state permission. The [finite authorized Luna summary recipe](dev-bridge.md#authorized-finite-luna-summary-integration)
adds task-specific opaque routing, immutable cumulative reservations and a credential-free
clone for restart/privacy checks; it is never a default or recurring test.
Inspect ordinary captures and state their masking limits.
Rejected proposals remain uncommitted. Attempt usage may include only a closed
structural rejection category (shape, prior item, upsert shape, lineage, stance,
expiry, value or coverage); no rejected provider text, arbitrary error or source
payload is retained for diagnostics. Source/old-item/lineage checks stay fail-closed.
No screenshot upload, private payload archive or recurring heavy CI is added.
