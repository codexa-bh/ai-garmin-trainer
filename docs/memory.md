# Trainer memory without embeddings

Ordinary Trainer chat uses [conversation history](conversation-history.md) and a
stable cross-chat memory pin on every configured OpenAI, DeepSeek, OpenRouter or
loopback Ollama chat route. Non-Luna routes retain their existing local-history
behavior; including memory does not enable general replay/compaction support.
It no longer retrieves or ingests semantic/vector facts. No embedding key, Ollama
embedding daemon, vector service, model download or extractor fallback is required.
Optional explicitly selected Ollama **chat** remains independently operator-managed.

This describes source behavior, not an installed-app activation receipt. Existing
schema19/20 installations require separately approved schema21 migration and a
compatible build. Source delivery never authorizes primary DB/settings changes,
private historical export, installation or restart. See the [accepted contract](memory-redesign-contract.md)
and [evidence obligations](memory-redesign-acceptance.md); tests, native observations
and real-provider semantic quality are distinct evidence.

## Configuration

Native Settings → Memory exposes:

- **Remember across chats**, default Off; stops summary use/new processing without
  deleting stored data or disabling automatic titles.
- **Memory and automatic chat-title model**, default Unselected, lists the configured
  catalog with provider/exact-model labels. It is independent of Trainer selection.
  A smaller, cheaper model is usually sufficient. Missing keys or an edited/removed
  selected entry stay unavailable until explicitly corrected; no fallback. Local
  configuration does not certify provider/model support.
- **Memory size (characters)**, default6000 Unicode scalars, integer1000–20000.

Summary, title and local compaction work have no application-imposed spending or
attempt caps, model-capacity/tokenizer prerequisites or token-count preflight.
The operator chooses the exact model; provider capacity/capability errors surface
without switching models or clipping memory. Larger memory can cost more. Known
usage estimates, historical USD reservations and unpriced attempts are distinct;
unknown cost is not zero or an invoice. Disable stops new summary work.

Minimized eligible user context may leave the device through the selected cloud
provider's existing native private-slot owner; Ollama remains loopback-only. No renderer key readback or new secret file is added.
Save preserves native revisions/archives and original compatibility fields. Model,
N and processing topology stay pending until explicit quit/reopen. Live shared-key
updates retain their existing acknowledgment/captured-work rules. Unchanged saved
On does not override an immediate Trainer Disable.

Settings shows draft versus saved startup configuration, not running readiness.
Technical/legacy disclosures, executable-path editors and the memory-status button
are absent; complete saved compatibility/override fields still round-trip through
native validation, including failure/reload/adoption. The retained setup-only native
`read_memory_status` command remains fixed summary metadata, not memory content,
provider probing or proof of selected-chat consumption. No automatic UI read replaces
its removed button. Trainer → Memory retains saved content and immediate controls.

## Stable memory and visible controls

Trainer **Memory** opens with **What your trainer remembers**: complete saved item
text, meaningful stance/temporal qualification and **Add memory**, with Edit, Forget
and Source & details on each item. Off retains saved content. Manage memory holds Clear. One Update from chat history
journey owns all/selected-conversation review; obsolete archive and selective-import
screens are absent. Existing interrupted imports offer contextual explicit cancellation
there, never automatic reset or replay. Technical/cost
dashboards and per-chat snapshot maintenance are removed. Settings owns model/size;
privacy, uncertain cost and replacement consequences appear at paid-action confirmation.
“Saved memory available” describes stored content, not complete history coverage or
proof that a particular answer consumed it.

At each turn's atomic admission, after busy exclusion, the chat adopts latest
available privacy-valid saved memory or null, including after rebuild/manual edit
and across restart. No per-chat Refresh is needed. No provider wait is added:
background processing may still be pending. The admitted snapshot is immutable
through planner, tools, synthesis and delivery; an ordinary publication waits for
the next turn. Immediate privacy/Off/Forget/Clear/source/manual invalidation still
revokes unsafe admitted work. Panel/history reads do not adopt or generate memory.
Single small completed turns wake foreground processing after a two-second debounce;
ordinary backlog drains in finite serialized jobs. Full memory is used or admission
refuses; no silent clipping or new route capability. Changing prefixes between
turns can affect caching; no billed-cache saving is guaranteed. Internal consumption
metadata and the compatibility Refresh API remain diagnostic, not routine UI.
Memory is included on each configured chat route without tokenizer qualification
or a second projection ceiling. The provider receives policy, tools, fresh input
and full sealed memory and may refuse capacity; the app does not guess a vendor
limit or silently drop memory. Non-Luna routes keep ordinary local-history behavior
and receive the pin in a separately framed lower-authority user-data message,
including after tool exchanges. Internal completed-answer use observations require
a matching revision; holding a pin alone is not proof of consumption.

Pins are untrusted user-derived continuity, not policy, current measurements or
permission to save a plan. Current corrections/Profile and fresh tool evidence
outrank them. Source links open local conversations, never reconstructed deleted
transcripts. Summary generation is foreground-only, bounded and incremental; neither
JSON nor NDJSON answer completion awaits its provider or legacy extraction.

- **Edit / Add memory:** structurally validated, bounded source-linked overlay
  or honestly standalone manual source. Manual lineage wins over later generated
  patches. There is no content-pattern veto or topic rewriting for generated or
  manual cross-chat memory. User prose (including URLs, paths, medical topics,
  key-like examples and quoted instructions) stays untrusted data, never authority
  to access native secrets/files/tools. Actual source/no-save/privacy controls remain.
- **Forget item:** removes it and suppresses its exact source versions, not the
  original transcript. Later new explicit statements have distinct source identity.
- **Clear summary:** removes summary/manual/pin derivatives and records a cutoff
  including incomplete pre-clear turns. Future new turns may create memory.
- **Disable / Enable:** Off revokes use and admission while retaining stored data.
  Enable requires already-active qualified native configuration. Off completions
  are not silently imported.
- **Retry:** preserves reservations and unknown costs, changes no model or cutoff,
  and does not synchronously call a provider.

Action-specific feedback distinguishes saved, Off, unknown and reconciled results.
Destructive confirmations name their consequences and default to Cancel. Editors
have labelled text, Save/Cancel and explicit dirty-discard protection; subviews and
resulting item rows receive focus, and Tab stays inside the sheet.
Actions carry expected revision/privacy/control/manual generations. Stale/busy/
unknown effects require reload/review, never automatic mutation replay. The UI
hides the prior projection while mutating and reloads the selected transcript after
commit so revoked summary-dependent debug copies are not retained in active state.
Streaming interruption removes the uncommitted assistant display. Already displayed
or exported content cannot be recalled.

## Preserved legacy records and explicit historical transition

Legacy semantic facts/vectors, trainer-memory records and migration markers remain
in SQLite. Their native configuration fields remain preserved but inactive/hidden;
ordinary chat/title/status reads neither invoke that adapter nor lazily migrate it.
These records are not active memory and have no ordinary archive view. Content
inspection no longer queries or transports their excerpts. No automatic deletion,
vector conversion or re-embedding occurs; retained maintenance APIs are not the
ordinary chat path.

The retained compatibility import API admits only eligible source-backed completed Off
turn versions after the authoritative cutoff; its obsolete ordinary selection screen
is removed in favor of Update from chat history. Selection is reviewed, capped at200
turns/100000 source scalars, and sealed with privacy/control/manual/cutoff authority.
It uses the existing summary writer in finite batches of at most20, without a
tokenizer/capacity prerequisite or hidden daily summary budget. Pause/cancel retain progress and unknown cost; changed authority
requires a new review, not stale resume. Routine frontier is separate. No startup
backfill, inferred role pairs or migration timestamp grants export.

Unproven/unlinked legacy entries and expired/relative-time historical claims,
suppressed and already-imported source versions are excluded from automatic import.
They remain preserved for separately authorized maintenance; old temporary prose is not rebased
to today. Original records are preserved. Actual private selection/export/retirement
requires independently approved scope.

### Rebuild from chat history

**Update from chat history** opens a separate local review with included and excluded
user-message counts, human explanations, configured provider/model, explicitly
unknown pre-generation cost and preservation/replacement effects. **Review and update**
opens the final **Start update** confirmation bound to that exact inspection; changed
history or selection requires a new review. Opening/back/cancel never starts work.
Running, cancellation, complete, interrupted/invalidated and unknown-effect states
remain distinct. Active progress is observed automatically without loading/layout churn,
broad disabling, generation or mutation. Connection failure keeps clearly marked
last-known state and reconnects to the same operation; **Retry connection** only reads.
Terminal success, failed validation/provider, interruption, cancellation and changed
review remain visible until an explicit new review, never a disguised automatic retry. It regenerates
useful durable coaching context from admitted originals through the existing
summary engine, not old generated noise. Finite internal batches stage privately;
only a complete validated result replaces generated memory. Manual overlays and
originals remain; next admitted turns automatically adopt available valid memory.
Cancel, interruption, invalid output, stale authority or capacity refusal cannot
partially publish. Candidate generation receives exact rendered-budget and field
constraints, including stance/category framing and newlines across kept/new items.
Closed bounded invariant diagnostics supplement historical coarse rejection records;
no raw rejected output, source text or arbitrary vendor error is stored. Status reload reconciles the same operation without replaying
Start or unknown costs. Keep the app open; no background full rebuild is promised.

Schema22 conservatively fenced pre-existing unlinked originals whose relationship
to earlier Clear operations cannot be proved. Schema23 preserves that floor and
adds a separately recorded future-Clear floor, initially zero (no invented audit
history). Choose All retained conversations or selected conversations, then explicitly
include older conversations needing permission. Local review binds that scope;
final confirmation explains that things once cleared may be remembered again where
old clearing cannot be reconstructed. Known forgotten sources and recorded clears
remain excluded, including assistant context and its originating user. Old bare
Start, startup, incremental work and passive reads never obtain legacy authority. Post-fence unlinked originals retain
honest message/time/hash provenance, not fabricated completed turns. Suppressed,
no-save, unresolved, oversized and unsupported sources are disclosed. No-save requests and
assistant context cannot grant endorsement or plan-save permission. Off/unselected/
missing capability/empty/over-limit preflight refuses rather than enabling or
substituting a model. See [exact bounds, authority and semantic evidence limits](cross-chat-summary.md#explicit-rebuild-from-chat-history).
Source delivery grants no primary migration, private export, paid test or installation.

## First-prompt chat titles

Future automatic titles use the **same explicitly selected summary model**, not
chat/extraction selection. Summary Off does not disable title processing. Unselected,
unsupported, missing-key or exhausted capability retains the prompt excerpt.
The existing first-message/manual-title/clear/delete tombstones and Next `after()`
lifetime remain. No historical retitling or retry queue is added.

Title-only source input retains explicit no-save controls and is bounded to2000 characters;
the3000ms deadline, no tools/retries and supported stateless controls remain.
There is no token-count/output-cap, pricing prerequisite, daily count or monetary
admission cap. Captured keys/configuration survive awaits; manual titles and
first-message/deletion tombstones remain authoritative. Durable attempt receipts
and usage are recorded once; old reservations remain intact. Missing counters or
prices are unknown, never zero cost or billed savings.

## Backup, restore, and reset

Use a WAL-consistent SQLite online backup for an active database, or an explicitly
stopped/verified target; never copy an active main file alone. Preserve native
settings and compatibility archives through their existing owner. Schema21 and
`SUMMARY_CONTRACT_VERSION=2` fence incompatible older readers; startup/Use existing never migrate.
After new writes/deletions, prefer a compatible forward fix. An older backup needs
explicit offline reconciliation of subsequent data and tombstones, never blind
copy-back or downgrade.

Summary Clear/Forget do **not** erase transcripts, Profile, Garmin, saved plans,
legacy stores, provider logs or backups. Existing domain deletion scopes remain
separate. New summary-dependent diagnostic copies are revoked with derivative
authority; original visible answers and pre-existing unmarked grounding are preserved.
No “all memory erased” claim is made. Full scheduling, storage and limits are in
[cross-chat summary](cross-chat-summary.md).
