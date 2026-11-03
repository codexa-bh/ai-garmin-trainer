# Incremental cross-chat summary producer

This source slice produces an inspectable bounded summary **not used by chat**.
It does not pin/inject global memory, replace legacy semantic retrieval, import
old chats, retire embeddings, or activate/migrate/restart an installed app.
[Conversation history](conversation-history.md) remains independently usable.
The remaining integrated UI/pinning/import work in the [redesign contract](memory-redesign-contract.md)
is not implemented by this producer.

## Independent configuration

Native Settings → Memory has three separate startup fields:

- Cross-chat summary processing: Off by default, independently of legacy memory.
- Independent summary model: Unselected by default; currently only **OpenAI ·
  gpt-6-luna**, direct Responses, is qualified. No chat/extraction/title selection,
  embedding service, alternate provider or account is substituted.
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

Native v3 stores the new allowlisted scalar fields through the existing owner.
Older parsers reject the unknown fields instead of ignoring privacy controls;
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

One native-app lifetime polls a fixed identity-bound route at startup/every30 seconds.
It coalesces due work: four new eligible turns,2000 scalars, or two active minutes
of backlog; ten-second debounce and minimum30 seconds between jobs. Each job reads
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
8000 input/2048 output tokens, zero SDK retries and15-second whole-operation deadline.
Cancellation bounds even a provider promise that ignores its signal. Provider logs,
provider-side retention and billing after cancellation are not controlled locally.

Reserve USD0.01 before any provider/preflight attempt, at most10 attempts/USD0.10
per local civil day with persisted day high-water accounting. Model changes/restart/
clock rollback do not replenish spend. Confirmed5xx permits a later60–75-second
attempt; repeated failures back off five minutes under the same caps. Invalid/auth/
unknown/cancelled outcomes need explicit recovery, not an automatic replay. Expired
reserved leases remain conservatively charged and require explicit Retry. Actual
input/output/cached usage is recorded once from the single inference step; absent
counters stay null, never zero or a claimed invoice/cache saving.

Shutdown stops admission, aborts owned inference and removes the polling timer
within native's existing bounded drain. Closed app means no progress promise/daemon.
Restart retains backlog/checkpoint/attempt/cost facts and refuses blind uncertain replay.

## Inspection, controls and privacy

`GET /api/cross-chat-summary` is fixed metadata only: state/reason/revision/frontier,
pending count, character/item counts, independent model, enable state and spend.
It always reports `usedByChat:false`. `?view=content` separately returns local
lower-authority items/text for inspection, never as public telemetry. States distinguish
Off, unselected, never-produced, stale, unavailable and fresh; corrupt/unknown
versions preserve bytes and refuse use/writes rather than resetting the cursor.

Closed POST controls are `{"action":"disable"}`, `{"action":"clear"}` and
`{"action":"retry"}` and `{"action":"enable"}`. Reads never probe providers. Immediate Disable persists
across unchanged native startup configuration; explicit Enable can restore it only
when active native configuration is already On with the qualified model. It never
activates pending saved topology, resets spend or silently imports Off events.
Changing actual native topology is an explicit separate action. Off preserves stored text but forbids use/admission;
re-enable does not import Off events. Clear removes derived text and records an
all-source admission cutoff including incomplete pre-clear turns. It leaves original
messages/Profile/Garmin/legacy vectors/plans untouched. Retry preserves all spend/
unknown attempts and still enforces bounds; it never performs inference synchronously.
Free-text/manual edits and item-forget/import controls are not implemented here;
unsupported POST shapes refuse. The manual/control generation seam rejects stale
jobs, not a claim of an installed full editor.

H's source edit/delete, Profile, semantic-control and Garmin invalidation generation
also invalidates all producer text and admitted jobs in the same transaction. No
substring-redaction erasure claim, stale revision fallback or automatic history
rebuild is made. Narrow explicit `Actually …`/`Correction:` source signals invalidate
S before synthesis; arbitrary-language correction detection is not guaranteed.
Later validated supersession advances the S control/manual generation. No global
consumer exists, so ordinary publication cannot mutate H's serialized active prefix;
future integration must bind its consumer to current generations, never revision alone.

Temporary items default to seven days, open questions receive a30-day review cue,
stable decisions/preferences a180-day review cue. Expired items are omitted at use
and a due local maintenance publication can remove them without a provider call.
Whole-item dispositions preserve bounded loss without truncating negation. Unsafe
credentials/medical/raw/GPS/tool/injection candidates are excluded whole; the generic
M09 denial is minimized to “not for medical reasons,” not a positive diagnosis.

## Compatibility and validation

Rehearse additive18→19 migration on an authored populated stopped online backup;
preserve transcript, Profile, normalized/legacy memory/settings and completion IDs.
No historical completion/summary backfill occurs. Journal/settings/summary/privacy/
checkpoint/spend behavior and reopen/integrity require explicit evidence. Ordinary
startup/Use existing is still non-migrating. Schema18 native admission refuses19;
after new writes use a compatible forward fix or an explicitly reconciled backup,
never a downgrade/reset/copy-back or unsafe older writer. Source delivery grants no
primary DB/settings access, migration, restart, install, release or activation.

Tests `summary-policy`, `summary-storage`, `summary-provider`, `summary-composition`
and `summary-seed` cover pure contracts, actual SQLite, synthetic real SDK transport,
independent admitted config, cancellations and recipe refusal. These are not remote
provider/semantic-quality certificates. The [finite keyless native scenario](dev-bridge.md#keyless-summary-producer-lifecycle)
proves actual independent selection, scheduled missing-key failure, durable backlog,
restart/no replay, Clear/Off and preserved originals on ordinary outside-checkout
artifacts. It does **not** prove successful live synthesis or native Settings input.
Separately authorized opaque native provider use and a metered test envelope are
required for that stronger evidence; a dollar ceiling alone is not credential readback
or primary-state permission. Inspect ordinary captures and state their masking limits.
No screenshot upload, private payload archive or recurring heavy CI is added.
