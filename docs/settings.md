# Settings, model choice and memory options

Native Settings is available from the app menu even without a backend. [Desktop](desktop.md#explicit-private-state-adoption) owns storage/adoption/recovery; this page explains controls.

## First run and Settings

Blank installation: **Data → Provider → Connect Garmin or continue → Review**.

1. Create new DB at unused private destination, or select compatible existing SQLite. Use canonical absolute paths/private parents. Existing data becomes writable: rehearse a WAL-consistent populated copy and follow [adoption](desktop.md#explicit-private-state-adoption) before primary cutover. Startup never creates/migrates existing selection.
2. Add models/keys. Storage is owner-private **plaintext**, not encryption. Fixed key mask means presence, not saved value/length. Untouched keeps, typing replaces, Backspace/Delete on saved mask marks removal. [Legacy adoption/re-entry](desktop.md#legacy-settings-and-keychain) is explicit, never startup work.
3. Connect Garmin or continue without it; offline history/configured chat remains available.
4. Finish validates local config and separately commits DB/settings before owned readiness. No remote probe/sign-in/Sync. Failure does not erase committed resources; Retry opens committed config, or after DB-only interruption select retained file as existing.

No env-file/old-pointer import. Invalid/unsupported saved state is not blank-install authority; originals remain.

### Catalog and provider controls

Add/remove literal Model IDs grouped by ChatGPT subscription, OpenAI API, DeepSeek, Ollama and OpenRouter. Keys shared per provider, valid old aliases hidden/preserved. No default/first-option/fallback; explicit Trainer choice even with one eligible entry. [Runtime](local-runtime.md#runtime-trainer-model-preference) owns compatibility.

[ChatGPT](chatgpt.md) uses native browser authorization, retained-versus-new connection and independent credential/catalog commits, not API/Codex keys. Ollama daemon/models stay operator-managed with Advanced loopback endpoint. [OpenRouter](local-runtime.md#opt-in-openrouter-chat) is explicit opt-in with privacy/reliability limits. Catalog edits keep key controls mounted; old extraction/embedding/executable values remain hidden/inert, not normal technical editors.

### Save and activation

Save commits privately, then live-applies **only catalog/shared provider keys**. Inspect Applied/saved-not-applied/unknown. Reload reconciles without replay; Trainer choice is preserved. DB/Garmin/endpoints/memory need explicit quit/reopen. Restart-required notice appears for this confirmed Save's effective startup changes, not unchanged/repeated/live-only edits with old pending state or restoration to active values. Dismissal does not restart; Save never starts backend/live DB/account switch. [Activation](desktop.md#save-and-live-activation) owns uncertainty.

## Garmin access in Settings

Create key privately in Garmin Connect, enter via native Connect Garmin, Save/Finish and reopen. Never put key in chat/screenshots/issues. Key saved is configuration, not validity; Sync → Garmin maintenance → Verify connection is explicit check. [Connection](garmin-auth.md) owns replacement/recovery; legacy Reconnect needed leaves history/token files untouched. No startup contact/offline gating.

Garmin history → Limit how far back reveals required Import from date. Otherwise explicit Sync uses bounded automatic discovery. Off-and-Save/reopen restores automatic mode; [date rules](desktop.md#history-and-memory-controls) preserve drafts/invalid-date correction. [Sync](sync-and-health.md) owns progress; [extra data](garmin-extra-data.md) owns fields/backfill.

## Trainer model selector

Model (accessible **Trainer model**) lists eligible activated entries, omitting missing-key cloud and retaining eligible keyless Ollama. Unavailable saved choice remains warned, never replaced. Configure/confirm live apply, then Retry model availability. Selection affects future turns only and persists per DB; no Reset/default. Eligibility is not funding/install/readiness, exposes no keys and changes no summary/title choice.

Profile & data owns Profile/imported facts/debug/deletion; Sync owns verification/import/detail maintenance; Memory is separate.

## Cross-chat memory and debug traces

Defaults: Remember across chats **Off**, independent memory/title model **Unselected**, advisory generated target **6000** characters (1000–20000). Preferences are separate; target is not maximum. Save then reopen. Native On does not undo immediate Trainer Disable; Summary Off does not disable titles. Selected model may receive context; smaller is often sufficient.

[Memory](memory.md) owns controls, [summary](cross-chat-summary.md) protocol/privacy/usage. Ordinary memory needs no embeddings/vectors; legacy records/settings stay preserved, not automatically exported. Ollama chat remains independent.

Debug traces are always enabled regardless of LLM_DEBUG_TRACES and may contain private Garmin/chat/tool context. Keep local; never include in screenshots/support artifacts.
