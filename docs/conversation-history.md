# Conversation replay and bounded local compaction

[Integrated memory](memory.md) documents the current consumer, controls and explicit
historical transition.

## Supported path and independent states

New, durably linked conversations can use role-preserving replay when the explicit
Trainer selection is **OpenAI `gpt-6-luna` on Responses**, or an explicitly available [ChatGPT subscription](chatgpt.md) account/model using its compatible streaming adapter. This does not select a
model, acquire credentials, change the shared summary/title selection or substitute an
account. Other models retain the existing bounded legacy context; a requested new
replay operation on an unqualified adapter refuses rather than flattening roles.
JSON and stream completion include bounded `conversationContext` metadata naming
active/legacy/limited mode and its fixed reason. This is not provider readiness.

Previously unlinked messages remain browsable with legacy context. Migration does
not invent completed pairs or import old chats. A new chat establishes linked
history; display paging and conversation selection remain separate.

The [summary owner](cross-chat-summary.md) owns global generation/configuration and
foreground scheduling. Conversation-owned schema20 seals latest summary or null. At each turn's atomic
admission, after busy exclusion, it now adopts latest privacy-valid available memory
without a manual Refresh or provider wait. Ordinary publication cannot replace an
in-flight snapshot; immediate privacy still revokes it. Exact
accounting measures the entire newly adopted memory without the former independent
2048-token projection ceiling, without changing the stored global revision. Sealed projections remain unchanged during an admitted turn. Restart preserves
stored bytes; next admission replaces stale/null adoption. Cross-turn prefixes can
change and carry no billed-cache guarantee. Legacy semantic retrieval
and awaited post-answer ingestion are removed; no embedding or summary-provider
wait is part of answer completion. Optional unqualified routes retain bounded local
context, not vector retrieval.

Subscription replay/compaction retains complete client-side history, developer policy and exact namespaced local tool call/result identities. It uses no stored-conversation continuation, API-key fallback or unsupported token-count preflight. Observed usage remains separate from plan/credit billing; unavailable counters are unknown. Existing Luna/API-key accounting below is not silently applied to subscription. Unlinked legacy browsing/context and privacy/source/CAS rules remain unchanged.

## Requests and authority

Planner and final synthesis have separate stable policy/tool identities. Each
request serializes stable server policy/tools, untrusted segment/local compact
state and completed **user and assistant** messages in journal order. Fresh date,
Profile, normalized data and current user input follow that prefix.
Current-turn native calls/results retain actual call IDs, execution status and
bounded server-owned evidence. Historical tool envelopes are not reconstructed
from prose or grounding JSON, and actions are never replayed for pairing.

Assistant prose/compact text are continuity, not measurements, system policy,
endorsement or save permission. Current corrections and fresh verified execution
retain precedence. Existing complete-read, conflict, side-effect-attempt, terminal
claim and final-answer-reserve guards still apply. Stable-prefix identity is
proved separately for equivalent purposes/routes; it is not billed cache savings.
Refresh, compaction, policy/model incompatibility, expiry and privacy/source/control
changes are boundaries. Manual edits/Forget/Clear/Off invalidate pins and compact
derivatives atomically. Ordinary correction prose does not erase memory or revoke other
turns. Actual Profile values are captured at admission and compared before effects and
delivery; a changed value rejects stale work, while saved derivatives and no-op/timestamp
saves remain intact.

## Accounting and limits

**Policy:** no application-imposed spending/attempt
caps, output-token caps or tokenizer/model-capacity qualification. Full frozen memory
is supplied to all configured chat routes; non-Luna routes retain their prior local
history rather than gaining general replay. Provider capacity errors remain explicit,
never silent clipping or fallback. Old measured token counts and monetary reservations
are historical metadata, not admission gates. Compaction still processes one bounded
source batch and preserves source validation/CAS/cancellation/timeouts/local storage
bounds; counting is not a prerequisite. Historical token allocations, price tables and counting-preflight arithmetic remain in Git history, not current admission rules.

One compaction boundary processes the oldest contiguous batch of at most twenty completed turns plus previous **conversation-only** compact state, retaining at least two exact recent pairs. Global memory/current tool payloads are never new compaction sources. Generation has no tools or automatic retry and a 30-second total abortable monotonic deadline.
Current generation returns strict `{summary:string}` continuity with no topic blacklist,
negation exception, item count/text/source-ID certificate or6000-character ceiling.
The existing65536-unit serialized transport envelope and the same finite opaque-text
storage envelope bound local allocation, not meaning or a target length. Malformed,
empty, invalid-Unicode and oversized output refuses without clipping. Application journal
order and the selected contiguous covered-through interval remain outside model output.
The prompt preserves speaker attribution, decisions/reasons, uncertainty, corrections
and original option numbering. Shape cannot prove any of that meaning was retained.
Medical/token-budget/GPS/path/fictional-key/quoted-policy discussion remains untrusted
text, not native credential, filesystem, tool or save authority. No new historical tool
archive is created. Existing sealed opaque JSON-lines compacts remain readable under the
same storage/policy identity; no migration silently clears them.

New compaction attempts retain durable attempt history without a monetary reservation
or daily attempt/spending gate. Old reservations and unknown liabilities are preserved;
restart, model changes and clock rollback do not erase them. No discounted/cache-hit
assumption is needed. Compaction does not request explicit cache writes, but no
claim that provider caching/retention is disabled is made. Responses uses
`store:false`, no server conversation/previous-response identity and explicit
non-reasoning mode; [provider logs/cache retention](https://developers.openai.com/api/docs/guides/your-data)
remain outside local erasure guarantees.

For bounded local materialization, a snapshot reads at most 4096 completed turns
and 512 KiB visible source text; serialized counting payloads are at most 1 MiB.
These are application resource limits, not token ratios or vendor context claims.
Overflow never sends a silently truncated snapshot. User and visible assistant
storage retain the existing 12000 UTF-16-unit bound: oversized/invalid user input
is rejected before message persistence, and oversized generated prose becomes an
honest limitation before display instead of a truncated successful answer.

## Durable state, failure and privacy

Schema18 adds `conversation_turn` source-admission/version/completeness records,
transactional completion event order, `conversation_segment`, shared derivative
privacy generation and independent compaction-spend reservations. Assistant and
completion linkage commit atomically; equal timestamps are not cursors. Aborted
or user-only records never become completed compaction source. A new authorized
process epoch recovers its predecessor's incomplete admission after the existing
exclusive DB-writer safeguards; same-process overlap refuses. Completion and
compare-publication are idempotent, and the compact, boundary, revision and sealed
publication fingerprint change together without network inside a SQL transaction.
Unknown format/checksum/count/version state is unavailable and preserved.

Delete/clear/source edits and memory control/edit/deletion invalidate new derivatives
atomically through existing owners/triggers. Schema25 removes Profile/correction-prose
erasure triggers; value-based currentness rejects stale Profile work independently. Clear
also acts when its old data scope is empty. Compact text/fingerprints are cleared,
active source admissions become stale, and late work cannot recreate a deleted
conversation. Source transcripts, legacy-vector deletion exclusions, saved plan
documents and external credentials keep their existing separate scopes.

Check admission around tool execution, persistence and final delivery. On invalidation suppress undelivered prose; report only names of
actual completed side effects, without deleted content, and never replay them.
Already committed writes/displayed chunks or exported context cannot be recalled.
JSON abort before commit leaves an incomplete source; disconnect after local
commit does not erase the completion event or certify network receipt.

Timeout, unsafe/invalid output, unavailable accounting/provider, quota, conflict
or oversize retains the last privacy-valid segment. Continue only if the complete
request still fits; otherwise preserve transcript and return explicit bounded
capacity/retry/New chat guidance. `conversationContext` carries only fixed
publication/failure reason, segment boundary/revision/frontier, consumed summary
revision or revoked marker, input ceiling and accounting basis—never source text,
keys, paths or raw provider payloads. New summary-dependent debug copies are removed
on authority revocation; original answers/pre-existing grounding stay preserved. There is
no hidden history eviction, provider fallback, unbounded retry or permanent busy
admission after owned failure/abort.

## Migration and evidence

Desktop startup/Use existing requires the current schema without migration; [desktop schema upgrades](desktop.md#schema-upgrades) owns the stopped-target, backup, rehearsal and activation procedure. [Memory compatibility](cross-chat-summary.md#compatibility-and-validation) owns schema25's removal of four erasure triggers with stored rows/compacts preserved. Historical schema18–21 migration bytes remain unchanged, not current activation authority. Originals, legacy vectors, Profile, plans and settings/keys are not converted/backfilled by replay. After new writes use a compatible forward fix or separately reconciled restore, never an older writer or blind copy-back.

`conversation-replay.test.ts` captures actual locked SDK serialized requests with
fake transport; `summary-pin.test.ts` additionally combines SQLite pins, planner/
synthesis serialization, publication/reopen stability and Refresh. `conversation-history.test.ts` exercises real SQLite order,
rollback/CAS/reopen/privacy/spend and deterministic multi-round compaction. These
prove structural/persistence/request contracts, not real Luna quality, billing or
Garmin behavior. Native artifact/lifecycle evidence and separately authorized
actual provider/tool/compaction evidence must be reported with their exact limits;
keyless/mocked success is never a real-service certificate.
