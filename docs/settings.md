# Settings, model choice and memory options

Native **Settings** is available from the app menu even without a working backend. This guide explains the controls; [desktop runtime](desktop.md#explicit-private-state-adoption) owns storage, adoption, activation and recovery, [local runtime](local-runtime.md#runtime-trainer-model-preference) owns model selection, and [Garmin connection](garmin-auth.md) owns key handling.

## First run and Settings

A blank installation opens **Data → Provider → Connect Garmin or continue → Review**:

1. Choose **Create new database** at an unused destination, or **Use existing data** with a compatible SQLite database. Native proposes a private app-data destination outside the checkout. Custom destinations need an existing owner-private parent; use canonical absolute paths, not aliases, shell expansion or relative paths. Before selecting existing data, evaluate a WAL-consistent populated disposable backup. Existing selection/startup never creates or migrates a database; follow the [adoption and schema procedure](desktop.md#explicit-private-state-adoption) before primary cutover.
2. Add chat models and required keys. Keys are stored in an owner-private **plaintext** file, not encrypted. Saved values are never read back: the fixed mask means configured presence, not key length. Leave it untouched to keep the key, type/paste to replace, or press Backspace/Delete on the mask to mark removal on Save. [Legacy Keychain adoption and private re-entry](desktop.md#legacy-settings-and-keychain) are explicit actions, never automatic startup work.
3. Choose **Connect Garmin** or continue without it. Configured-provider chat and saved history work without Garmin.
4. **Finish and open Trainer** validates local configuration, commits the database and settings separately, and opens one verified backend. It does not prove remote readiness, probe providers, sign in or sync Garmin. On failure, read the commit state: saved resources are retained. **Retry opening saved Trainer** uses only committed configuration; if interruption preceded settings commit, explicitly select the retained database with Use existing data.

Desktop never imports env files or its retired configuration pointer. Originals remain unchanged. Invalid or unsupported saved settings do not grant blank-install authority.

### Catalog and provider controls

The catalog separates ChatGPT subscription, OpenAI API key, DeepSeek, Ollama and opt-in OpenRouter. Add/remove exact Model ID rows per provider; keys are shared per provider. Existing API-key/Ollama labels use provider / exact Model ID. Valid legacy names remain hidden compatibility metadata. There is no configured default, discovery or automatic fallback. Trainer requires an explicit choice, even with one eligible entry; [choice compatibility](local-runtime.md#runtime-trainer-model-preference) preserves prior exact intent.

- **ChatGPT subscription:** [Continue with ChatGPT](chatgpt.md) uses native system-browser authorization and account models, not an OpenAI key or borrowed Codex credentials. One active connection has explicit Switch account; legacy multiple connections require a one-time choice. Connection commit and catalog Save are separate; no paid fallback occurs.
- **Ollama:** manage its daemon and models separately. It has equal catalog prominence; its loopback endpoint remains Advanced.
- **OpenRouter:** explicitly opt in and review its [privacy/tool-reliability limits](local-runtime.md#opt-in-openrouter-chat).

Provider-key controls remain mounted through catalog edits and validation failures. Preserved extraction/embedding configuration and executable overrides have no normal technical editors or diagnostic status section.

### Save and activation

For an existing installation, **Save settings** commits privately, then live-applies only chat catalog and shared provider-key changes. Check the result: Applied, saved/not applied, or saved/live outcome unknown. **Reload** reconciles saved versus active state without replaying Save. The independently saved Trainer choice is preserved.

All other settings, including database, Garmin key/account, endpoints and memory, need explicit quit/reopen. A confirmed Save that changes effective startup-only settings still pending activation shows **Restart required**. Unchanged, repeated or live-only Saves do not repeat the dialog for older pending changes; restoring active values needs no notice. Dismissal never restarts the app. Ordinary Save never starts a backend or switches a live database/account. See the [activation contract](desktop.md#save-and-live-activation) for uncertainty and recovery.

## Garmin access in Settings

Create your own Personal API key in Garmin Connect → Settings → Personal API key, then choose **Connect Garmin** in native Settings, paste it and Save (first run: Finish). Quit/reopen to activate it. Keep the key out of chat, screenshots and issues. **Key saved** means stored configuration, not validity; **Sync → Garmin maintenance → Verify connection** is the explicit check. [Garmin connection](garmin-auth.md) explains replacement and action-specific failure recovery.

Older unofficial-connector installations show **Reconnect needed**; saved history and old token files remain untouched. Garmin never gates offline views or chat and is not contacted at startup. [Sync and Health](sync-and-health.md) explains imports; [additional Garmin data](garmin-extra-data.md) lists field coverage and explicit historical backfill.

Under **Garmin history**, **Limit how far back to import** reveals a required **Import from** date. No date is needed otherwise: explicit Sync discovers history in bounded batches. Turning the limit off and saving restores automatic discovery after quit/reopen. The [date-control contract](desktop.md#history-and-memory-controls) covers draft preservation and invalid dates.

## Trainer model selector

Chat's **Model** control (accessible name **Trainer model**) shows locally eligible activated entries. Missing-key cloud entries are omitted; eligible keyless Ollama remains. An unavailable selected identity stays visibly unavailable, never replaced by the first option. Configure models/keys in Settings, confirm live application, then **Retry model availability** if needed.

Selecting a model affects subsequent turns without restart; running work retains its captured configuration. The choice persists per selected database across reloads/restarts. There is no Default/Reset or silent substitution. Eligibility proves local configuration only, not funding, model installation or remote readiness. This control neither exposes keys nor changes the shared summary/title model. [Local runtime](local-runtime.md#runtime-trainer-model-preference) owns persistence, API and compatibility details.

**Profile & data** contains Profile, imported athlete/body facts, diagnostics and deletion. **Sync** owns verification, import-summary refresh and activity-detail maintenance; **Memory** is separate.

## Cross-chat memory and debug traces

Settings → Memory offers:

- **Remember across chats**, default Off. It controls processing, not deletion; saving On does not undo immediate Disable in Trainer → Memory.
- **Memory and automatic chat-title model**, default Unselected. Choose an exact catalog entry independently of Trainer chat; a smaller, cheaper model is usually enough. Minimized context may leave the device through it. Summary Off does not disable titles.
- **Generated summary target (characters)**, default 6000, range 1000–20000. This is advisory generated-text guidance, not a maximum; authored preferences are separate.

These settings require quit/reopen. [Memory](memory.md) and [cross-chat summary](cross-chat-summary.md) own editing, Densify review, Clear/Disable, regeneration, next-turn adoption, privacy, usage and migration rules. Ordinary chat does not use semantic vectors or require an embedding service; legacy records/configuration remain preserved without automatic export or lazy migration. Optional Ollama chat is independent.

Local debug traces are always enabled by tested policy, regardless of `LLM_DEBUG_TRACES`. Profile & data traces may contain private normalized Garmin/chat/tool context: keep them local and out of screenshots/support artifacts.
