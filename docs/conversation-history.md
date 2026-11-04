# Conversation replay and bounded local compaction

This describes the source implementation, not an installed-app upgrade or primary
DB activation. The [accepted redesign contract](memory-redesign-contract.md) retains
independent evidence/activation obligations; [integrated memory](memory.md) documents
the current consumer, controls and explicit historical transition.

## Supported path and independent states

New, durably linked conversations can use role-preserving replay when the explicit
Trainer selection is **OpenAI `gpt-6-luna` on Responses**. This does not select a
model, acquire credentials, change the shared summary/title selection or substitute an
account. Other models retain the existing bounded legacy context; a requested new
replay operation on an unqualified adapter refuses rather than flattening roles.
JSON and stream completion include bounded `conversationContext` metadata naming
active/legacy/limited mode and its fixed reason. This is not provider readiness.

Previously unlinked messages remain browsable with legacy context. Migration does
not invent completed pairs or import old chats. A new chat establishes linked
history; display paging and conversation selection remain separate.

The [summary owner](cross-chat-summary.md) owns global generation/configuration and
foreground scheduling. Conversation-owned schema20 freezes/seals latest summary or
null at explicit creation and adopts only at Refresh/deliberate compaction. Exact
accounting measures the entire newly adopted memory without the former independent
2048-token projection ceiling, without changing the stored global revision. Existing
sealed old projections remain unchanged until explicit Refresh/adoption. Ordinary publication/restart preserves the pin. Legacy semantic retrieval
and awaited post-answer ingestion are removed; no embedding or summary-provider
wait is part of answer completion. Optional unqualified routes retain bounded local
context, not vector retrieval.

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
derivatives atomically; current correction completion alone gets its updated receipt.

## Accounting and limits

The exact Luna profile is documented by [OpenAI's model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
and [pricing](https://developers.openai.com/api/docs/pricing), rechecked 2026-11-04:
1,050,000 context and 128,000 output tokens; standard USD0.10 input/USD0.50 output
per million, with separately priced cache writes. These are published facts, not
funding, latency or remote-availability evidence.

The non-memory app allocation remains32768 total,4096 output reserve,1639 safety
margin, **27033 input tokens**. The input allocation adds only the sealed pin's
exact measured memory tokens, capped at the qualified model context minus the
unchanged4096 output/1639 safety reserves. Memory does not consume H's existing
history allocation or become new compaction source; no vendor-maximum history
allocation is enabled. Exact total admission still includes policy/tool/schema and
fresh-tail overhead and refuses genuinely impossible requests without silent clipping. Fresh user/grounding/current tool input is also
bounded to 8192 tokens. Exact counts use the documented
[Responses input-token endpoint](https://developers.openai.com/api/docs/guides/token-counting)
on post-SDK model input, policy and tool definitions, with the same admitted
origin/credentials and deadline. Full-input, fresh-tail and base/prefix allocation
counts precede dispatch. No local Luna encoding is guessed; Unicode and tool
framing are counted by that model's endpoint. Missing/invalid/failed counts refuse
inference; SDK retries are disabled on this path.

Compact when history reaches 80 percent of its current allocation or the whole
request would overflow. One boundary processes one oldest contiguous batch (at
most twenty completed turns) plus previous **conversation-only** compact state,
retaining at least two exact recent pairs. No global snapshot/current tool payload
is new compaction source. Generation has no tools, a 30-second total abortable,
monotonic deadline (explicit T0269 operator override after measured five-second live timeouts), 8192 serialized input/2048 output tokens and no automatic retry.
The rendered compact is independently counted at at most 2048 tokens and bounded
to 6000 UTF-16 units. Closed item/source validation rejects missing/unknown source
references, malformed, unsafe and overlong output; this is not a semantic-quality
certificate.

The existing pure memory exclusions screen sources and outputs. A generic explicit
negative such as “not for a diagnosed condition” is not a personal diagnosis; only
that generic negative is exempted during source screening (M09). Other sensitive
clauses still refuse, and compact output has no medical-screening exemption.
No new global assistant/tool archive or sensitive retention is authorized.

Reserve USD0.01 before each attempted compaction, at most USD0.10 and ten attempts
per local day. Unknown outcomes remain charged against that reservation; restart,
model changes and clock rollback do not replenish it. No discounted/cache-hit
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

Delete/clear/source edits, Profile correction and memory control/edit/deletion
invalidate new derivatives atomically through existing owners/triggers. Clear
also acts when its old data scope is empty. Compact text/fingerprints are cleared,
active source admissions become stale, and late work cannot recreate a deleted
conversation. Source transcripts, legacy-vector deletion exclusions, saved plan
documents and external credentials keep their existing separate scopes.

Check admission before/after token preflight, tool execution, persistence and
final delivery. On invalidation suppress undelivered prose; report only names of
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

Desktop startup/Use existing remains non-migrating and now requires schema21.
Explicitly rehearse additive20/21 changes on an authored populated schema19/20 backup
first; historical18/19 migration bytes are unchanged. Originals,
legacy vectors, Profile, plan/settings/key fields are not converted/backfilled.
Older schema19/20 desktop admission refuses schema21; after new writes use a compatible
forward fix or separately reconciled restore, not an unsafe older writer or copy-back.
Source delivery never authorizes primary migration, activation, restart or release.

`conversation-replay.test.ts` captures actual locked SDK serialized requests with
fake transport; `summary-pin.test.ts` additionally combines SQLite pins, planner/
synthesis serialization, publication/reopen stability and Refresh. `conversation-history.test.ts` exercises real SQLite order,
rollback/CAS/reopen/privacy/spend and deterministic multi-round compaction. These
prove structural/persistence/request contracts, not real Luna quality, billing or
Garmin behavior. Native artifact/lifecycle evidence and separately authorized
actual provider/tool/compaction evidence must be reported with their exact limits;
keyless/mocked success is never a real-service certificate.
