# Trainer memory without embeddings

Memory is **one generated summary plus separate authored preferences/restrictions**, not a transcript, measurement store or policy/save authority. Current corrections, Profile and fresh tool evidence outrank generated prose; authored preferences outrank it too. Ordinary chat does not retrieve/ingest legacy vectors.

This guide owns controls. [Summary protocol](cross-chat-summary.md) owns generation/privacy/storage; [conversation history](conversation-history.md) owns same-chat continuity.

## Configuration

Native Settings → Memory: Off / independent summary-and-title model Unselected / advisory 6000-character target. [Configuration contract](cross-chat-summary.md#shared-summarytitle-configuration-independent-chat) owns range, complete over-target text, credentials, capacity/usage and restart. A smaller model is often sufficient; context may leave the device. Missing capability never substitutes a provider. [ChatGPT](chatgpt.md) is supported without embeddings/API key; plan usage is not an API invoice.

Save then quit/reopen memory configuration. Native On does not undo immediate Trainer Disable; Off does not disable titles. Draft/saved is not active readiness. Paid tests require independent finite cumulative authority.

## Stable memory and visible controls

### Generated summary and editing

Show/Hide reveals complete saved text and generated-only scalar count; disclosure lasts for this app lifetime. Edit opens a full-window labelled scrolling editor with visible Save/Cancel. Standard native Edit menu/⌘A/⌘C applies, no separate copy control. Save replaces generated text under current-state comparison, not preferences; a later history update replaces it **including direct edits**.

### Densify summary

Optional paid rewrite, not routine upkeep—normal updates already consolidate. Any nonempty usable summary qualifies, not just oversized text. Model for this run defaults honestly to configured identity, even unavailable; explicit eligible selection is ephemeral and captures once. It changes no Settings/chat/title/routine preference; eligibility is not readiness/cost proof.

Only saved generated text/target is sent, not history/preferences. Saved text stays usable during review. Compare meaning and count, then Use shorter summary or Discard. Only valid nonblank strictly shorter output saves, even above target; equal/longer does not auto-retry. Resolve editor drafts/conflicting work first. Cancel cannot recall exports/costs; review expires after 10min or authority change, restart discards preview. Lost requests reconcile without replay. [Protocol](cross-chat-summary.md#explicit-manual-densification) owns publication/accounting and preserved preferences/progress/pins.

### Preferences, history update and removal

- Your preferences: Add/Edit/Save/Remove separate authored notes. Removal does not erase history or similar generated meaning everywhere.
- Update from chat history: locally review all/selected conversations, then explicit Start for that snapshot/export/cost/replacement. Keep app open; old summary remains until success unless privacy independently revoked it.
- Turn Off/On: retain content but stop use/admission; Enable needs active native config and does not import Off history.
- Manage → Clear saved memory: remove summary/preferences/pins and record cutoff including incomplete turns. Originals/other stores remain; future turns may learn again.

No generated cards/IDs/per-fact Forget promise. **Deleting chats/messages does not clear saved memory** and may leave deleted-source influence. Clear is removal. Deleted originals cannot be re-exported/replayed; affected pending work refuses. Other source edits may invalidate the whole generated summary; earlier-history coverage-loss warning persists until Clear/completed reviewed update, not new-only learning/manual editing. [Privacy](cross-chat-summary.md#stable-pin-inspection-controls-and-privacy) owns exact scopes.

### Progress and normal learning

Passive reads preserve drafts/focus/scroll/mounted content and never start/retry paid work. Pending is not running. Status distinguishes Off/empty/invalidated/running/complete/cancelled/interrupted/failed/unknown; Off content is not current usable memory. Confirmation defaults Cancel. Connection loss reconciles same operation without mutation replay.

Each turn freezes latest usable memory/preferences or null; ordinary publication affects the next turn, not the admitted pin. Privacy/Off/Clear/preference authority may revoke unsafe use. Exported/displayed data cannot be recalled. [Generation](cross-chat-summary.md#incremental-state-and-bounded-foreground-work) owns curation, source exclusions, failure and model-fidelity limits; non-retention is not a no-transmission guarantee.

### Paused summary recovery

Paused/provider failure differs from pending/running/timed retry. Retry summary processing schedules eligible work and may cost usage; it guarantees neither repair nor immediate completion. Panel open/disclosure/refresh/restart does not unpark/replay. Off/history-update precedence remains.

Provider failure details starts collapsed and exposes validated categories/stages/available timing/status/correlation/receipt observations only, not raw errors/traces. Observations are not root causes; historical missing details say not recorded. Only current relevant failure is shown; Retry/new outcome removes it from current view while historical metadata remains. Passive refresh preserves disclosure/drafts/focus/scroll.

## Preserved legacy records and explicit historical transition

Legacy facts/vectors/markers/settings/receipts remain inactive, not automatically migrated/re-embedded/exported. No archive/technical/per-chat-snapshot dashboard. [Reviewed compatibility import](cross-chat-summary.md#explicit-historical-transition) owns bounds, original dates and unknown-effect handling; availability is not consent.

### Rebuild from chat history

Review full retained pool, not sidebar page; choose all/selected conversations and optionally uncertain older history. Never override known Clear/no-save/suppression. Disclose incomplete/unsupported/oversized sources and missing dates/context. Regeneration starts empty, updates complete temporary draft per chunk and publishes only full success, preserving preferences. Failure/cancel/stale/unknown never publishes partial text or silently spends again. [Rebuild contract](cross-chat-summary.md#explicit-rebuild-from-chat-history) owns bounds and quality proof; processed counts do not prove every source represented.

## First-prompt chat titles

Independent summary/title model runs even with Summary Off. Missing/unselected/unsupported capability retains prompt excerpt. Existing first-message/manual-title/deletion tombstones and Next after() apply; no historical retitle/retry queue. Title-only legacy privacy guard, including weekly-review limitation, is independent of memory eligibility. Input≤2000 characters, deadline 3000ms, no tools/retries. No token/output/price/daily-spend gate; capture config across awaits, respect title authority, record usage once and preserve old reservations. Unknown usage is not zero cost.

## Backup, restore, and reset

[Compatibility](cross-chat-summary.md#compatibility-and-validation) owns explicit rehearsed exact-target migration and ambiguous-legacy refusal. Startup never migrates; source delivery does not activate DB or recover lost text. Preserve compatible backups/settings/archives; favor forward fix, not downgrade/copy-back. Clear/removal does not erase transcripts/Profile/Garmin/plans/legacy stores/provider logs/backups; no “all memory erased” guarantee.
