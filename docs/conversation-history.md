# Conversation replay and bounded local compaction

[Memory](memory.md) owns controls; [cross-chat summary](cross-chat-summary.md) owns global generation and foreground scheduling. Replay is conversation-local, not another global-memory engine.

## Supported path and independent states

New durably linked conversations support role-preserving replay for explicitly selected OpenAI `gpt-6-luna` Responses or an available [ChatGPT subscription](chatgpt.md) model through its streaming adapter. Nothing selects/acquires/substitutes a model, account or summary/title configuration. Other models retain bounded legacy context; an unqualified replay adapter refuses rather than flattening roles. JSON/stream `conversationContext` reports active/legacy/limited mode and fixed reason, not readiness.

Unlinked history remains browsable with legacy context; migration invents no completed pairs or old-chat import. A new chat establishes linked history, independently of display paging/selection.

Atomic turn admission, after busy exclusion, adopts the latest privacy-valid memory or null without manual Refresh/provider wait. The full projection is frozen for that turn: ordinary publication cannot replace it, but immediate privacy revokes it. Restart preserves stored bytes; next admission replaces stale/null adoption. There is no 2048-token projection ceiling, vector retrieval or awaited post-answer ingestion. Prefixes may change between turns; stable bytes do not guarantee billed cache savings.

Subscription retains complete client-side history, developer policy and exact namespaced local call/result identities. No stored-conversation continuation, API-key fallback or unsupported token-count preflight. Observed usage is separate from plan/credit billing; absent counters remain unknown. API-key accounting is not silently applied to subscription.

## Requests and authority

Planner/final synthesis have separate stable policy/tool identities. Requests serialize server policy/tools, untrusted local compact state and completed user/assistant pairs in journal order, followed by fresh date/Profile/data/current input. Current tools retain actual call IDs, status and bounded server evidence, including distinct IDs for repeated tool names in multi-call plans. Foreground planning preloads remain labelled fresh server context, never fabricated call/result pairs; [AI execution](architecture/ai-and-chat.md#chat-execution-and-delivery) owns their completeness and guarded-save authority. Historical tool envelopes/actions are never reconstructed or replayed from prose.

Assistant/compact prose is continuity, not measurements, policy, endorsement or save permission. Fresh verified execution/current corrections take precedence; existing complete-read/conflict/attempt/final-reserve guards remain. Refresh, compaction, model/policy incompatibility, expiry and privacy/source/control changes break prefix equivalence. Manual edits/Forget/Clear/Off atomically invalidate pins/derivatives; ordinary correction prose does not erase memory or revoke other turns. Profile values captured at admission are compared before effects/delivery: changed values reject stale work, while stored derivatives and no-op/timestamp saves survive.

## Accounting and limits

There are no application monetary budgets, daily compaction-attempt quotas, output-token caps or tokenizer/capacity admission gates. The separate bounded orchestration loop remains [AI-owned](architecture/ai-and-chat.md#ai-application-and-providertool-adapters). Full frozen memory reaches configured routes; non-Luna routes do not thereby gain general replay. Capacity errors are explicit, never silent clipping/fallback. Historical counts/reservations remain metadata, not admission gates; local source validation/CAS/cancellation/timeouts/storage bounds still apply.

One compaction processes the oldest contiguous batch of at most 20 completed turns plus previous conversation-only compact state, retaining at least two exact recent pairs. Global memory/current tools are not sources. Generation has no tools/retry and a 30-second total abortable monotonic deadline.

Output is strict `{summary:string}` continuity: no topic blacklist, source-ID/item-count certificate or 6000-character ceiling. The 65536-unit serialized transport/opaque-storage envelope bounds allocation, not meaning or a target length. Empty, malformed, invalid-Unicode or oversized output refuses without clipping. Application journal order/covered interval stays outside model output. Prompts preserve speakers, reasons/decisions, uncertainty/corrections and option numbering; shape cannot certify semantic preservation. Medical/GPS/path/fictional-key/quoted-policy text grants no native authority. Existing sealed JSON-lines compacts remain readable without silent migration/clearing or a new historical tool archive.

Attempts remain durable; old reservations/unknown liabilities survive restart, model changes and clock rollback. There is no cache discount assumption or explicit cache-write request. Responses uses `store:false`, no server conversation/previous-response identity and non-reasoning mode; [provider logs/cache retention](https://developers.openai.com/api/docs/guides/your-data) remain outside local erasure guarantees.

Snapshots cap at 4096 completed turns and 512 KiB visible text; serialized counting payloads at 1 MiB. These are local resource limits, not token ratios. Overflow never sends truncated history. User/visible-assistant storage caps at 12000 UTF-16 units: reject invalid/oversized input before persistence; oversized generated prose becomes an honest limitation, not truncated success.

## Durable state, failure and privacy

Storage atomically links assistant/completion order, segment boundary/revision and publication fingerprint; equal timestamps are not cursors, and user-only/aborted records are not completed source. An authorized process epoch may recover its predecessor's incomplete admission only after exclusive-writer safeguards; same-process overlap refuses. Completion/publication are idempotent, without network inside SQL transactions. Unknown format/checksum/count/version remains preserved and unavailable.

Deletion/source edits/memory controls invalidate derivatives atomically, including Clear on an empty old scope. Compact text/fingerprints clear, admissions become stale, and late work cannot recreate deleted conversations. Schema25 removes Profile/correction-prose erasure triggers; value currentness still rejects stale Profile work. Transcript, legacy-vector, plan and external-credential deletion scopes remain separate.

Check admission around tools, persistence and delivery. Suppress revoked undelivered prose; disclose only names of actual completed effects without deleted content, never replaying them. Committed writes/displayed chunks/exported context cannot be recalled. Precommit abort leaves incomplete source; disconnect after commit neither erases completion nor proves network receipt. Revocation removes new summary-dependent debug copies, not original answers/pre-existing grounding.

Failure/timeout/conflict/unsafe output/oversize retains the last privacy-valid segment. Continue only if the whole request fits; otherwise preserve transcript and offer explicit capacity/retry/New chat guidance. Metadata exposes fixed reasons/boundary/revision/frontier, summary revision or revocation, ceiling/accounting basis—not text, keys, paths or provider payloads. No hidden eviction, fallback, unbounded retry or permanent busy state after owned failure/abort.

## Migration and evidence

[Desktop schema upgrades](desktop.md#schema-upgrades) owns stopped-target backup/rehearsal/activation; startup/Use existing never migrate. [Summary compatibility](cross-chat-summary.md#compatibility-and-validation) owns trigger removal with rows/compacts preserved. Historical schema18–21 bytes are not activation authority; replay does not backfill originals, vectors, Profile, plans or keys. New writes require a forward fix or separately reconciled restore, not an older writer/blind copy-back.

`conversation-replay`, `summary-pin` and `conversation-history` tests cover serialization, SQLite order/CAS/privacy/reopen and compaction. They prove structure/persistence, not live provider quality, billing or Garmin behavior. Report native and separately authorized real-service evidence with its own limits.
