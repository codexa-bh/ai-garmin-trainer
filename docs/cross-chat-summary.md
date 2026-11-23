# Integrated automatic cross-chat summary

One complete generated text plus separate authored preferences, not a model-managed ledger. [Memory](memory.md) owns controls; [conversation history](conversation-history.md) owns same-chat continuity. Structural validity is not semantic-quality certification.

## Shared summary/title configuration, independent chat

Defaults: Off / Unselected /6000 generated Unicode scalars. Select exact provider/model independently of Trainer. On/model/target are restart-only; catalog/shared-key live Save keeps its narrower acknowledgment/captured-snapshot rules. Off does not disable titles. Missing identity/key/capability/capacity never substitutes a provider.

Target range 1000–20000 is **advisory**, not an output ceiling or allocation shared with preferences. Complete valid larger text remains unchanged through storage/edit/import/rebuild/pins; lowering target does not truncate. Malformed/extra/unfinished/invalid-scalar output still refuses; independent provider/sealed-storage envelopes remain. No application spend/attempt/output-token cap, tokenizer/price qualification or second memory projection ceiling. Paid tests need credible finite cumulative authority; historical reservations/unknown liabilities/observed usage are not invoices or refundable retry budgets.

Native admits immutable provider identity; no credentials enter jobs/SQLite/renderer. [ChatGPT](chatgpt.md) uses protected owner/broker and compatible streaming, no API key/embedding/counting preflight; plan/credit usage is not API-priced billing. Currentness loss prevents publication without replacement request. Direct OpenAI is store:false/no threads/tools/SDK retries; other transports retain their own honest retention limits.

## Incremental state and bounded foreground work

Stored generated value is `{version:2,text:string}`. One strict `{summary:string,exclude:number[]}` request consumes complete prior generated text, eligible new user/context prose and current Profile; it learns/corrects/consolidates in one pass. Preferences are independent, not generation input or generated-source records. No item IDs/keep-remove ledger/citation graph/ancestry repair/second judge. Densify returns `{summary}`; titles `{title}`; old exact-edit support is internal compatibility.

Select durable user-specific value from prior **and** new input, merge duplicates and prune stale/low-value prose. Preserve essential qualifications/negation/uncertainty/time scope on selected facts; current Profile/corrections/fresh evidence outrank stale prose. Questions/proposals are not commitments. Do not archive activity/KPI calculations, plan tables, generic advice or assistant save/mistake claims. Useful numerical commitments/dated facts may remain. Underfull or empty ordinary summary is valid; target is not a quota. Relevance omission changes summary, not privacy exclude.

Examples: retain 25-minute availability/weekend strength commitment, not ride tables; retain a user's controlled-effort choice, not the preceding calculation; “could two sessions work?” is unchosen; afternoon preference replaces morning. Unrelated input should not erase useful prior constraints. All-excluded privacy input instead requires exact prior text, even if cluttered.

Identical output processes sources without new-learning claims. Invalid/refused/unfinished output preserves prior/pending sources and actual usage without replay. Valid but lossy output can pass; supplied-output tests prove mechanics, not fidelity. Captured Profile values are compared at publication separately from privacy authority.

### Source eligibility and privacy decisions

Code owns completion/selection/identity/frontier/counts; processed does not mean represented in a sentence. Hard eligibility/restrictions/Off/cutoffs apply before transmission. Lower-authority preceding assistant context is bounded 16000 scalars; missing/oversized/restricted context must not erase independent user meaning. The same model request interprets document no-write versus memory privacy; no English intent parser. Eligible privacy prose can reach the provider: non-retention is not no-transmission.

`exclude` contains unique zero-based positions in frozen input, not arbitrary source IDs/history-erasure authority. Reject malformed/foreign decisions. All excluded requires exact previous text; mixed omission is model-dependent. Same-batch assistant context identifies its originating input position and must be ignored when that origin is excluded. Publication/staging atomically seals exact-source and stable-message restrictions, surviving hash edits/restart and blocking routine/import/rebuild/context reentry. Staged exclusions survive later failure/cancel without publishing a partial draft. Own staged exclusions are recognized during continuation; unrelated concurrent restrictions stale the operation.

Fresh answers/tools/debug/compaction/old summary are not new global sources. Rebuild alone admits separately bounded authentic context. URLs/paths/key-like words/quoted instructions remain untrusted prose, not pattern censorship or secret/file/tool authority. Historical controls have separate erasure scope.

### Scheduling and publication

Routine/import jobs take≤20 sources; rebuild≤40/chunk. One draft request per batch, no hidden word/percentage ceiling, forced target termination, clipping, source narrowing or smaller-payload retry after capacity/refusal. Two-second debounce and serialized backlog use ordinary native lifetime; passive reads start no provider/timer/rebuild, completion only journals eligibility. No closed-app daemon promise.

Routine deadline 300s plus launcher 2s; writer lease 30s/heartbeat 5s. Final transactional CAS checks source/config/privacy/control/manual/Profile, parent revision/frontier. Network holds no SQL transaction. Commit complete text/frontier/dispositions/attempt settlement atomically; later arrivals remain pending and preferences untouched. Unknown/cancel/invalid/auth requires explicit recovery, not replay. Existing transport 5xx backoff never fabricates publication. Shutdown abort is best-effort; remote cost/retention may continue.

Closed provider diagnostic metadata may accompany existing attempt JSON without replacing usage or inventing tokens. Status projects at most one relevant current attempt matching policy/config/control/privacy/revision/reason; malformed/old/unrelated details remain absent. Processing distinguishes inactive/running/parked/finite retryAt/eligible; parking sentinel never becomes a date. Explicit Retry clears current reason/timing, not historical details/accounting. Native's narrower status remains unchanged.

## Stable pin, inspection, controls and privacy

Atomic chat admission adopts latest usable generated text/preferences or null after busy exclusion. Version 2 pins freeze separately framed lower-authority fields through planning/tools/synthesis/delivery; ordinary publication does not revoke them, next admission adopts latest. Full memory is not clipped to another cap. Pin holding is not completed-answer consumption; compatibility Refresh is explicit busy/CAS-guarded, not routine upkeep.

**Ordinary message/conversation deletion does not clear published memory.** It invalidates source/history freshness and affected pending/staged work, not summary/preferences/frontier/surviving pins. Row-local SQLite triggers/lifecycle implement this across rollback/restart. Deleted-source influence may persist; Clear is removal. Bulk Chat/Profile reset and other source edits/derived-memory changes remain genuine revocations.

Genuine privacy invalidation empties the whole generated summary and revokes unsafe captured use/export, preserving independent preferences. Erasing nonempty text sets durable `coverageLost`, retained through new-only updates/Retry/restart/manual edits until Clear or completed reviewed history update. No precise per-source subtraction or stale fallback. Controls/preferences revoke captured authority and marked derived debug copies; original visible transcript/legacy grounding remain. Exported/displayed data/backups/provider logs cannot be recalled.

Ordinary corrections and changed/no-op/timestamp-only Profile saves preserve unrelated summary/pins/local compacts. Captured Profile change separately stales chat/publication; no global erasure cascade. Clear/Off/preference/source-edit authority remains independent. Temporal qualifications live in prose, not item-expiry maintenance.

### Local debug revisions

Keep at most 50 committed generated revisions and 50 metadata-only source-deleted/memory-revoked events for **explicit local SQLite debugging only**. No runtime chat/generation/import/rebuild/status consumer. Revision rows bind parent/time/kind/model/generations and typed source-domain metadata in the committing transaction; no failed/stale/staged candidate or duplicate settlement. Never archive preferences.

Source deletion/update and direct summary save purge prior payloads (save retains only its new text); Clear removes all rows/events; Off retains them. Purging history does not remove active-summary influence, SQLite pages/backups or external logs.

Inspection returns one stored generated value plus preferences; compatibility items is 0/1, not cards/ledger. Corrupt/unknown state preserves bytes and refuses use/write. Reads never generate/adopt/publish. Version 2 commands require revision/privacy/control/manual CAS: edit-summary replaces generated text; edit/forget change **preferences only**, not per-fact generated erasure. Clear removes generated/preferences/pins and records cutoff including incomplete admissions. Off retains records/stops use; Enable needs active native config and never imports Off history. Retry preserves costs/no synchronous inference; v1 writers refuse.

## Explicit manual densification

Version 2 request/accept/discard/cancel uses opaque ID, never renderer candidate/count authority. Optional request model is exact version 1 catalog choice or subscription version 2 including registrationId; omission keeps configured default even unavailable. Reject removed/remapped/ineligible/extra input without fallback. Picker is readonly/ephemeral, never changes Settings/Trainer/title/routine choice.

Capture generated text,target,model/credentials and all currentness once; send only summary, not Profile/history/preferences/new sources, with no tools/retries/fallback. Ordinary updates already consolidate; overshoot/passive reads never trigger Densify. Prompt selects useful meaning before compressing and may remove low-value stats/obsolete details/advice/repeated caveats, but cannot invent facts/resolve uncertainty. Saved summary is its only evidence.

One process-owned candidate expires within 10min or currentness/privacy/config loss. Use existing writer/heartbeat/cancel/attempt accounting with empty source list/distinct purpose. Durable identity prevents restart replay; same ID/different intent refuses. Preview processes no sources; settled review holds no writer lease and routine publication can stale it. Cancel/unknown keeps liability, no refund/retry; manual failure does not poison routine controls.

Accept reacquires exclusion and revalidates candidate/original currentness transactionally. Only nonblank valid **strictly shorter** text publishes; changes revision/hash/time, not manual authority/preferences/frontier/dispositions/source completion. Existing pins stay frozen. Shorter/structurally valid is not fidelity or billing certification.

## Explicit historical transition

Retained reviewed completed-Off import freezes≤200 source versions/100000 scalars, processes 20-source batches through the same writer and owns separate frontier/sealed dispositions. Preserve original sources. Include authoritative original user and available assistant Unix-ms dates independently of generation clock; unknown dates stay unknown and reviewed user dates are required. Relative claims remain historical; temporal words alone do not exclude independent meaning. Availability is not consent/replay. Pause/cancel/stale/unknown requires review, not auto-resume. Legacy vectors/markers/settings stay inactive without re-embedding/export.

## Explicit Rebuild from chat history

Review paginates full retained pool, not sidebar/import window. All/sorted selected conversations and uncertain-legacy inclusion are sealed to exact snapshot. Permission never overrides recorded Clear/suppression/no-save/context restrictions; conservative old and known future-Clear floors remain distinct.

Explicit Start is idempotent for the same identity/snapshot; changed/different consent refuses. Writer/import/rebuild exclusion and native identity apply. Bounds:10000 user sources,2000000 source/context scalars, two-hour operation. Whole messages>16000 or unsupported/ambiguous sources are disclosed, never clipped. Cost may be unknown, not zero/product budget.

Start from empty generated draft; next chunk receives complete previous draft. **Only full final success publishes once**, accounting reviewed completion without claiming every source represented. Preferences survive; regeneration replaces direct summary edits, disclosed before Start. Failure/cancel/reopen/deadline/stale/unknown never replays Start or publishes partial text. Scrub staged derivatives while retaining bounded progress/provenance/accounting/original failures; arrivals after review stay pending.

Quality is independent of coverage: useful decisions/constraints/reasons, honest time/negation/uncertainty, no proposal-as-endorsement or filler. Underfull is valid. Real-history acceptance requires every included source, meaningful final output, private qualitative inspection and next-turn composition proof; partial-first 20/synthetic/transport-only evidence is not equivalent.

## Compatibility and validation

Startup/Use-existing never migrate. Separately authorize exact DB/settings, preserve backups, rehearse populated/actual-derived online copies with integrity/FKs/idempotent reopen/original/accounting preservation, then controlled migration. Older readers refuse new schemas; use compatible forward fix, never downgrade/blind copy-back.

Relevant transitions: schema 24 carries complete text into v2/separate preferences, invalidates incompatible pins and interrupts staged work without refunds/invented completion. Only proven standalone authored notes map losslessly; source-linked/ambiguous manual edits and corrupt/unsupported records refuse transactionally. Schema 25 removes obsolete correction/Profile erasure triggers without transforming stored rows. Schema 27 separates deletion versus memory authority, adds coverageLost/debug tables and recreates triggers without inventing old revisions/recovering lost text. Earlier restrictions/Clear floors/usage/originals remain authoritative. Detailed migration DDL/rehearsal history belongs in migrations/tests/Git, not this guide.

Policy/provider/storage/rebuild/import/pin/UI/migration tests cover CAS/leases/concurrency, source/privacy/no-save, unknown effects, Unicode and preferences. Native ordinary smoke covers actual controls/restart/presentation/isolation. Fixed fixtures, real lifecycle, service success and private semantic inspection are different proof classes. Inspect relied-on images locally; never publish private source/summary excerpts or captures.
