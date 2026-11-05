# Trainer memory without embeddings

Ordinary Trainer chat uses [conversation history](conversation-history.md) and, on
the qualified OpenAI `gpt-6-luna` Responses route, a stable cross-chat summary pin.
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
- **Memory and automatic chat-title model**, default Unselected. Only reviewed direct
  OpenAI `gpt-6-luna` is supported; chat choice remains separate. No model/account
  fallback is substituted.
- **Memory size (characters)**, default6000 Unicode scalars, integer1000–20000.

Enabled summary processing has no daily attempt/spend ceiling. Larger memory can
cost more. Memory separates observed-token estimates, conservative size-aware
reservations and all-day unknown/legacy liabilities; these are not invoices. Disable
stops new summary work. Independent title and local compaction limits are unchanged.

Minimized eligible user context may leave the device through the existing native
OpenAI private-slot owner. No renderer key readback or new secret file is added.
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
its removed button. Trainer → Memory retains the actual pin and immediate controls.

## Stable memory and visible controls

Trainer **Memory** opens with **What your trainer remembers**: complete saved item
text, meaningful stance/temporal qualification and **Add memory**, with Edit, Forget
and Source & details on each item. Off retains saved content. Manage memory holds
Clear, Review earlier sources and read-only Older saved records. How memory works &
costs separates observed-token estimates, reservations and unknown liabilities;
Technical details retains exact configuration, revision, frontier and admission data.
No model/size editor duplicates native Settings.

**View chat memory** distinguishes the latest stored summary from the selected chat's
actual saved snapshot, whole-item omissions, measured token count and qualified-route
eligibility; it never claims that an answer already used the latest saved text. New chat and Refresh give pending activity up to eight seconds
to catch up, then freeze only the available revision or null. Single small completed
turns wake native foreground processing after a two-second debounce; ordinary backlog
automatically drains in finite serialized jobs. A later publication does not replace
that pin, including before the first message. Full newly adopted memory is measured
without the former2048-token projection ceiling; total serialized request admission
adds measured memory to the existing non-memory allocation while reserving output,
safety, tools and fresh input. Impossible requests report capacity rather than clip.
Existing sealed projections/omissions remain unchanged until explicit adoption.
Restart retains the exact pin. **Update this chat** and deliberate local
compaction are explicit adoption boundaries. Refresh refuses busy/stale actions.
Unsupported chat routes keep ordinary local behavior without semantic retrieval.

Pins are untrusted user-derived continuity, not policy, current measurements or
permission to save a plan. Current corrections/Profile and fresh tool evidence
outrank them. Source links open local conversations, never reconstructed deleted
transcripts. Summary generation is foreground-only, bounded and incremental; neither
JSON nor NDJSON answer completion awaits its provider or legacy extraction.

- **Edit / Add memory:** bounded safety-validated source-linked overlay
  or honestly standalone manual source. Manual lineage wins over later generated
  patches. No unsafe diagnosis/secret/raw/location bypass.
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
Manage memory → **Older saved records** is read-only local review,
not active memory. No automatic deletion, vector conversion or re-embedding occurs.
Retained legacy maintenance APIs are not the ordinary chat path.

Manage memory → **Review earlier sources** offers only eligible source-backed completed Off
turn versions after the authoritative cutoff. Selection is reviewed, capped at200
turns/100000 source scalars, and sealed with privacy/control/manual/cutoff authority.
It uses the existing summary writer in batches of at most20 with finite size-aware
exact serialized input/output allowances, without a hidden daily summary budget. Pause/cancel retain progress and unknown cost; changed authority
requires a new review, not stale resume. Routine frontier is separate. No startup
backfill, inferred role pairs or migration timestamp grants export.

Unproven/unlinked legacy entries, unsafe or expired/relative-time historical claims,
suppressed and already-imported source versions are excluded from automatic import.
They remain visible for explicit manual review; old temporary prose is not rebased
to today. Original records are preserved. Actual private selection/export/retirement
requires independently approved scope.

### Rebuild from chat history

**Update from chat history** opens a separate local review with included and excluded
user-message counts, human explanations, configured provider/model, a labeled
conservative cost range and preservation/replacement effects. **Review and update**
opens the final **Start update** confirmation bound to that exact inspection; changed
history or selection requires a new review. Opening/back/cancel never starts work.
Running, cancellation, complete, interrupted/invalidated and unknown-effect states
remain distinct. **Check update status** only reads; it never replays Start. It regenerates
useful durable coaching context from admitted originals through the existing
summary engine, not old generated noise. Finite internal batches stage privately;
only a complete validated result replaces generated memory. Manual overlays and
originals remain, and existing chat pins still require explicit Refresh/adoption.
Cancel, interruption, invalid output, stale authority or capacity refusal cannot
partially publish. Status reload reconciles the same operation without replaying
Start or unknown costs. Keep the app open; no background full rebuild is promised.

Schema22 conservatively excludes pre-existing unlinked originals whose relationship
to earlier Clear operations cannot be proved. Post-fence unlinked originals retain
honest message/time/hash provenance, not fabricated completed turns. Suppressed,
unsafe, oversized and unsupported sources are disclosed. No-save requests and
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

Title-only input is safety-filtered, at most2000 characters and2048 measured tokens;
output at most120 tokens,3000ms deadline, no tools/retries/provider persistence.
Captured keys/configuration survive awaits. A separate durable reservation admits
at most USD0.001 per attempt,100 attempts/USD0.10 per local day; backward clocks,
restart/model changes and unknown outcomes do not replenish it. Actual usage is
recorded once; unknown counters are not zero or billed savings.

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
