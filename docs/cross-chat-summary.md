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
- Shared summary/title model: Unselected by default; choose a provider/exact-model
  entry from the existing catalog independently of Trainer chat. The selected
  OpenAI/DeepSeek/OpenRouter/loopback Ollama adapter is used without substitution.
  A smaller, cheaper model is usually sufficient. Titles retain a3000ms technical
  deadline, not an app-imposed token, attempt or monetary cap.
- Character limit: integer1000–20000, default6000 Unicode scalar values after
  CRLF→LF. Invalid surrogates/fractions/ranges refuse, without language normalization.

Explicitly review cloud export before enabling: minimized eligible user-derived
context and only necessary safe preceding assistant referents leave the app.
Native's existing selected-provider private slot supplies immutable admitted credentials;
keys never enter jobs/SQLite/status/renderer readback/new secret files. Settings
Save uses existing private revision/commit/archive safeguards. These fields are
**restart-only**: Save does not start processing or change an already running
engine. Catalog/shared-key live Save retains its existing narrower protocol;
key/catalog generation changes reject old summary publication. Missing keys, funding, network, selection or provider capability failures remain
explicit, never fallback. No tokenizer/capacity/pricing qualification is required.
Direct OpenAI uses store:false; other transports use their existing stateless
request construction without claiming OpenAI-specific retention controls.

Native v3 reuses allowlisted SUMMARY_MODEL: legacy `unselected`/`gpt-6-luna`, or
`{"version":1,"entryId":"entry_example","provider":"ollama","modelId":"Exact:tag"}`.
The exact saved entry/provider/model must still match the current catalog; an edit
or removal refuses until explicitly reselected. Legacy Luna intent survives even
when absent from a new catalog. Passive reads never rewrite intent. Older scalar
enums refuse JSON choices rather than downgrade. Native v3 preserves hidden `SUMMARY_CONTRACT_VERSION=2`
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
Source/resource admission never silently loses an event. Provider capacity failure
retains the frontier and requires ordinary explicit recovery; no guessed-token
batch clipping or model substitution is performed.
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

The provider adapter reuses exact existing model routes without token-count or
price/capacity qualification, output-token caps or model/account fallback. Direct
OpenAI pins store:false/no thread; tools and SDK retries are off for every purpose.
A60-second whole-operation deadline, bounded source batches and local result-size
validation remain. Provider context/capability failures are not repaired by clipping
sources or changing models. No tokenizer/vendor capacity is guessed.
Summary patches and titles request separate strict closed JSON output schemas through
the locked SDK. The actual request includes the serialized schema. Domain patches
still require keep/upsert/remove/coverage arrays. Summary transport now uses a
per-batch closed coverage object with one required reason for every exact admitted
source ID; no missing/foreign logical key or duplicate list entry is representable.
The adapter validates the entire object, then restores the unchanged domain array
in source order without inventing/filling dispositions. DeepSeek's locked SDK injects schema guidance in JSON compatibility mode; strict
local complete-result validation still applies. Unsupported/invalid output refuses
with no repair or fallback; domain coverage/lineage checks still apply. Domain validation still independently checks source
lineage, coverage, authority, expiry and character bounds; schema conformance is not
semantic approval, and unsupported structured output has no text/model fallback.
Cancellation bounds even a provider promise that ignores its signal. Provider logs,
provider-side retention and billing after cancellation are not controlled locally.

There are no application spending/attempt caps for summaries, titles or local
compaction. New attempts record no invented monetary reservation. Historical priced
reservations/unknown liabilities stay intact. For exact direct Luna only, complete
observed usage retains the published0.10-input/0.50-output-per-million estimate;
other prices remain unknown. Unpriced/missing-usage attempts are counted separately
from known USD reservations, never displayed as free or refunded. Estimates are not
invoices/cache savings. Restart, model changes and clock rollback erase no history. Confirmed5xx permits a later60–75-second
attempt; repeated failures back off five minutes under the same caps. Invalid/auth/
unknown/cancelled outcomes need explicit recovery, not an automatic replay. Expired
reserved leases remain conservatively charged and require explicit Retry. Actual
input/output/cached usage is recorded once from the single inference step; absent
counters stay null, never zero or a claimed invoice/cache saving.

Shutdown stops admission, aborts owned inference and removes the polling timer
within native's existing bounded drain. Closed app means no progress promise/daemon.
Restart retains backlog/checkpoint/attempt/cost facts and refuses blind uncertain replay.

## Stable pin, inspection, controls and privacy

Schema20 freezes a sealed summary/null snapshot transactionally at explicit New
chat; existing conversations acquire a compatible boundary at first admission.
Before qualified inference, exact token accounting measures the entire frozen
snapshot once, without an independent memory clipping ceiling. The whole request
adds that measured memory to its existing non-memory allocation and retains model,
output/safety and fresh-tail bounds. Genuine whole-request overflow reports capacity
rather than silently dropping meanings. The measured pin is sealed and survives
ordinary publication and restart; old already-measured projections (including their
old omissions) remain byte-stable until explicit adoption; neither rewrites latest S.
New chat and Refresh give pending activity at most eight seconds to catch up before
freezing only the available revision/null. A late publication never silently replaces
that pin; inspect pending/as-of/selected use and explicitly Refresh later if needed.
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
exports nor calls a provider. Pre-generation cost is explicitly unknown, not a finite worst-case quote or invoice.
There is no tokenizer/price prerequisite or app spending cap. Historical reservations,
observed usage, unpriced attempts, manual preservation and replacement semantics remain visible. Off, unselected,
missing native key/lifetime, empty selections and operation limits refuse Start;
no model/key/topology is enabled or substituted.

Schema22 adds only an original-message authority watermark and staged-operation
records. Old Clear cutoffs covered linked admissions, not unlinked originals.
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

Strict version1 commands add `rebuild-start` (`id`, reviewed `snapshot`) and
`rebuild-cancel` (`id`) under the existing expected revision/privacy/control/manual
CAS. The operation binds source inventory/content, authority and native boot/live
configuration generation. Same-ID reconciliation never starts another operation;
concurrent rebuild/import/writer starts refuse. Internal jobs reuse S's20-source
provider/lease/attempt-accounting seams, but start from an empty generated
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
Existing chat pins do not adopt ordinary rebuild publication automatically.

Authored semantic rubric (separate real-provider approval/evidence required):

| Authored case                                                            | Expected meaning / forbidden inference                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Noisy route talk plus repeated long-weekday failure caused by caregiving | Short-weekday constraint, why and scoped lesson; not weather/distance chatter     |
| Cycling versus hiking preparation correction                             | Preserve the explained distinction, not “never cycle”                             |
| Earlier evenings explicitly corrected to mornings                        | Current mornings; evenings historical, not simultaneous current preferences       |
| Assistant poles/bag offer, unresolved question, later bag rejection      | No endorsement until actual choice; retain rejection reason, not an invented goal |
| Isolated measurement/rewrite/obsolete monthly target                     | Exclude unless needed for a durable conclusion; unused capacity is preferable     |
| No-save, unsafe, suppressed or cleared history                           | No export/resurrection or plan-save permission                                    |

Current keyless ordinary smoke proves rendered preflight and missing-capability
Start refusal, not successful generation/progress/cancel or semantic quality.
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
