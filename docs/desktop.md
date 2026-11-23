# Local macOS desktop runtime

Tauri owns a loopback Next.js service on **macOS Apple Silicon**. React, HTTP/NDJSON, Next `after()`, guarded tools, SQLite and Garmin import remain the application, not a remote website or Rust domain rewrite. Only local Settings receives settings/auth IPC; admitted isolated smoke has a correlated-result exception described in [smoke](dev-bridge.md).

[Release](release.md) owns unsigned/non-notarized packaging and publication. There is no auto-update, login item or background service. [macOS ARM64 is supported](source-beta-readiness.md#supported-boundary); [Windows x64 alpha](windows.md) is experimental and unsupported. Downloads/checksums are on [GitHub Releases](https://github.com/codexa-bh/ai-garmin-trainer/releases).

## Build and run

Use ARM64 macOS, Xcode/Command Line Tools, Rust/Cargo, Node 22/npm and Python 3.12 for developer build/validation scripts. The app bundles Node and needs no Python, uv or uvx. It never installs software/models or manages optional Ollama.

```bash
npm ci
npm run desktop:build
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
```

The bundle runs outside the checkout. `npm run desktop:dev` rebuilds the same production resources and opens the native development host: no browser server or HMR. Rebuild source changes; quit/reopen for startup-only settings. Tauri is the sole product launcher; retained maintenance/auth CLIs do not serve the app or configure desktop.

`custom-protocol` is enabled by default, allowing local Settings/error HTML without a backend. **Settings…** remains in the native menu; startup status is retained in memory to avoid listener races.

Build uses `--no-sign --no-binary-patching`, never codesign/notarization. Do not disable Gatekeeper or install/sign to bypass errors. Keep release stripping disabled: Homebrew Rust 1.98 proc-macro metadata failed with stripping (`E0463`).

The [change-gated nightly](validation.md#change-gated-native-nightly) reuses full validation's single backend build with assembler-only `desktop:assemble`, locked Rust checks/tests and synthetic debug `smoke:quick`. It neither packages an optimized release nor replaces ordinary-artifact/integration smoke. Use assembler-only immediately after a same-input production build; `desktop:resources` still builds then assembles.

### Reproducible resources

`scripts/desktop/runtime-inputs.json` pins Node 22.23.4 and official archive checksums for `macos-arm64` and `windows-x64`. Assembly admits only the native host's target and verifies archive, Node/SQLite ABI and launcher imports. Cargo/npm locks and exact Tauri versions pin other inputs.

Resources contain production standalone/static output, the production Next custom server, SQLite, launcher/Zod and ChatGPT OAuth helper. Excluded Next material includes source maps, declarations, development runtimes, docs, analyzer, unused `next/og` and optional sharp; images remain unoptimized. Garmin reader/FIT decoder are compiled into the server, not packaged Python or connector processes. Private env/data/keys/logs never enter the bundle.

[Redistribution](redistribution.md) owns licenses, notices and reviewed source/patch corpus. Required corpus files enter inventory/release verification; metadata alone grants no redistribution permission. Provenance v2 keeps the whole-source snapshot separate from conservative build-source/context identity. Full locked `desktop:build` emits the ordinary complete-inventory stamp; [driver reuse](smoke/ownership.md#ordinary-build-identity-and-current-driver-reuse) owns its external-path set and fail-closed checks. Rebuild legacy artifacts rather than relabel them.

Resources are immutable: no ISR disk flushing or image optimization, and bounded memory cache. Trusted configuration uses Next's standalone path and survives framework env reset; the custom server's direct `conf` is not forwarded to the router. Provider values never enter serialized build configuration. Private/WebView state stays outside the bundle. The supervisor discards incidental vendor/framework output and accepts only bounded allowlisted startup messages, not raw diagnostics.

## Explicit private-state adoption

Settings replaces env selection/loading. No old-pointer import, cwd/home/adjacent discovery or generic environment editor exists. Users re-enter supported values; originals remain unchanged for rollback.

**Create new database** is available only to a genuinely blank installation. Its visible unused destination is outside source/bundle; a custom destination needs an existing private parent. Authoritative migrations run in memory. Native writes, fsyncs, readonly-verifies and exclusively publishes bytes under a pinned parent descriptor/shared target lease. Existing files, sidecars, aliases and unknown leases are never replaced; no selected-file writable migration or initialization WAL occurs.

**Use existing data** accepts only a compatible DB at a canonical absolute path, never aliases, shell expansion, URLs or relative paths. The selected DB becomes writable: first quit other owners, evaluate on a disposable populated backup, and obtain separate primary-cutover approval. Ordinary startup and existing selection perform readonly schema/integrity checks before construction; missing, corrupt, old or unsupported databases refuse rather than initialize/migrate.

Source and desktop share `<database>.trainer-writer`; macOS also rejects another process holding the DB open, including older backends without a lease. Unknown/stale leases are never stolen. Inspect the exact owner; do not kill listeners or delete live leases to force admission.

### Private document and catalog

`settings-v3.json` in the canonical platform app-config directory for `com.codexa.garmin-trainer.desktop` stores `{version:3,fields,keys,chatCatalog,garminApiKey?}`. The Garmin key is distinct from OpenAI/DeepSeek/OpenRouter chat slots; older builds refuse it rather than drop it. Retired `GARMIN_MCP_*`/`GARMIN_FIT_*_COMMAND` fields and old token selections remain inert metadata, never editable or forwarded.

The version-1 catalog has at most 32 entries, opaque durable IDs (80 characters), literal model IDs (256) and optional legacy names (80). Names remain hidden but round-trip; malformed names, duplicate provider/model tuples and invalid compatibility inputs refuse. Trainer owns a separate DB-persisted explicit choice, not a catalog default; see [choice persistence](local-runtime.md#runtime-trainer-model-preference).

The directory must be `0700`; the file `0600`, current-uid, regular, single-link, bounded to 128 KiB and unaliased. Descriptor-bound reads, pinned no-follow traversal, exclusive staging/fsync and atomic rename protect publication. Insecure existing objects refuse, never chmod/adopt. Storage is **plaintext, not encryption**: same-user/privileged processes and backups can read it. Never put the document in logs, support, export or Git; it holds no Garmin email/password/MFA/token payloads.

Shared application validators/defaults and readonly DB checks precede changes. No connector transport/allowlist, port/origin/identity or arbitrary command/env controls are editable. Technical/executable editors are removed; complete legacy/extraction/embedding values and five executable overrides remain mounted hidden/inert and persist independently of visibility or disabled state. Optional Ollama chat stays independently configured. Debug traces are always enabled by tested policy, with no misleading off toggle.

### History and memory controls

**Garmin history → Limit how far back to import** reveals a required **Import from** date only when On. Off hides/disables the control; off/on drafts preserve its value, while Off-and-Save clears the limit. The literal YYYY-MM-DD editor manufactures no date (WebKit's empty native date input can paint today). Calendar/future validation preserves invalid saved text for correction. Valid dates load selected; invalid nonempty dates stay Limited until corrected/disabled; blank/missing dates select bounded automatic discovery after reopen. A limit does not prove remote inception.

Normal Settings offers provider-grouped Model ID Add/Remove rows, shared masked keys and no default/global-auto selector. Key controls stay mounted through row edits, duplicate/32-entry correction and failure reconciliation. Ollama's connection disclosure stays with its group. Memory offers processing On/Off, shared summary/title model and target N, independent of chat and preserved extraction inputs. Summary Off preserves records and immediate Trainer Disable; titles remain independent. [Settings](settings.md#cross-chat-memory-and-debug-traces) owns visible defaults and [memory](memory.md) the processing/privacy contract.

Setup-only `read_memory_status` is fixed and identity-bound to the owned backend. It returns version1 active summary metadata, never content, embedding health, probes or provider requests. Normal Settings has no status button/result/timer or replacement automatic reads. Draft/saved values are not active status; missing/stale observations mean unknown, not readiness.

### First-run commit and retry

Native captures genuine settings absence once; crashed, invalid or unsupported existing installations never gain first-run authority. Eligible **Finish and open Trainer** validates required provider configuration before creation, commits database/settings separately and uses owned-backend readiness in-session. No cloud probe, login, sync or fallback occurs. Native serializes duplicate operations.

Cancel/quit is bounded, not rollback: committed DB/settings and independent tokens remain saved. Explicit retry reconciles exact DB identity or, after settings commit, opens only committed configuration. After an interrupted DB-only commit and relaunch, explicitly choose the retained file as existing data.

Missing/corrupt/unsupported settings or unavailable required keys reopen sanitized actionable setup. Unknown versions are preserved, never overwritten/downgraded; use a compatible build, not deletion, permission relaxation or env fallback.

### Save and live activation

Ordinary **Save settings** commits privately before applying only catalog and all three shared key slots to the owned backend. Exact boot/generation/revision acknowledgment is required. Captured work retains its admitted snapshot; native never initializes or overwrites Trainer's choice. All other fields remain pending explicit quit/reopen against effective startup inputs.

- No backend, busy or refusal: saved/not applied.
- Deadline/disconnect: saved/live outcome unknown, not rollback or unchanged.
- Reload reconciles exact saved/active metadata without replay. Unresolved prior uncertainty refuses another write; invalid/stale/precommit failure preserves prior state.

Save returns `{message, restartRequired}`. A restart notice requires confirmed durable commit and an effective field changed by this Save that still differs from active startup. With an absent/busy backend, only confirmed changed fields require reopening. Default-equivalent round trips, repeated/live-only Saves with older pending state, and restoration to active values do not prompt. Uncertain commit/projection or failed metadata reload suppresses the notice but retains recovery warnings.

The labelled local modal focuses OK, contains Tab, dismisses with OK/Escape and restores focus; it never controls the app. Close/reload clears stale presentation. First-run Finish retains its same-session string result and no modal. Save provides no hidden restart, DB/account switch, Default/Reset, provider probe or fallback.

### Legacy settings and Keychain

Presence selects v3 before v2 before v1, even for corrupt, unreadable or aliased objects. Unknown/newer formats refuse overwrite/downgrade. Explicit v2 Save exclusively publishes v3 and indefinitely preserves v2 bytes; startup derives a readonly compatibility catalog. Explicit provider intent survives missing keys; legacy auto captures only determinable DeepSeek-first/OpenAI intent, not ongoing fallback. Catalog edits never rewrite extraction inputs or restart-only summary/title selection. Empty catalogs permit offline views with chat unselected; DB admission still applies, but inactive embeddings need no service/key.

With only v1, startup validates allowlisted fields and `SLOT/UUID` references without Keychain access, reports migration-required and opens setup. This is not blank-install authority. Startup, menu refresh, ordinary Save and Finish never query Keychain, even metadata.

**Adopt referenced Keychain keys once** reads only referenced accounts under `com.codexa.garmin-trainer.desktop.provider.v1`. macOS may ask permission; never bypass refusal or automate that dialog. Adoption serializes with settings/Finish/activation, resolves every unchanged slot, validates the complete existing-activation frame and exclusively publishes v3 with the reviewed catalog. Optional slots must resolve or be explicitly replaced/cleared. Partial retrieval is discarded, not omitted or automatically retried.

After denial, locked or missing values, privately replace/clear every configured legacy slot and choose **Save private re-entry without Keychain**. It makes no legacy reads; keyless v1 uses the same explicit action. Both paths preserve original v1 bytes and **all Keychain items indefinitely**, with no cleanup API, env import, broad enumeration, cloud probe or background adoption.

Cancel before publication preserves legacy authority. Rename is the commit/selection point; interrupted launch reconciles v3 without rereading Keychain. Postrename verification/directory-sync failure means **committed, durability uncertain**, not rollback/retry permission. Metadata revisions bind bounded file identity/mtime/ctime/size; whole-form save/adoption compares the loaded revision under serialization. Stale forms, including intervening key-only edits, require reload. Changed targets refuse; migration never overwrites existing v3. Preserve current and original inputs; recover with a compatible build/forward fix, not deletion or forced legacy fallback.

### Key intent and choice compatibility

Reads return fields/storage/slot status, never saved key values or account payloads. A password field's fixed mask indicates presence without inserting a secret/sentinel. Untouched/focused stays unchanged; typing/pasting creates replacement intent. Backspace/Delete against saved presence, or emptying its replacement, marks clear. An absent slot edited then emptied stays unchanged. Accessible status distinguishes configured, absent, pending replacement/removal and unavailable metadata.

Save, Finish, adoption and private re-entry share the converter. Submit/error/cancel/close clear replacement drafts without inventing deletion; retries need fresh entry. Failed refresh disables key editing and refuses writes. Intents affect only the active document. Precommit failure preserves prior bytes; activation follows the live subset above.

Before replacing old catalog inputs, Save retains immutable private `selectionCompatibility:{database,catalog}` for the original DB. First overwrite of old v3 exclusively archives exact bytes in `settings-v3-before-single-choice.json`; v1/v2 remain unchanged. Defaults are cleared, even when deleting the former default row. The renderer never sees the compatibility catalog; it seeds only the matching DB once, not a newly selected DB. Archive conflict or uncertain preservation refuses publication. Older builds reject the additive field: keep originals/current state and use a compatible forward fix. Source revert grants no private cutover.

### Private backend transport

Startup sends catalog metadata, chat keys and Garmin key in one bounded private stdin frame to owned Node. Activation v3 includes selection compatibility; old v2/v1 remain supported. No argv, secret environment, generated env file, URL or renderer readback carries it. The pipe remains open for parent liveness. Backend environment is an internal adapter; Garmin instead becomes a process-owned capability.

Live Save uses only authenticated `/__desktop/live-settings` POST/GET on the owned port. Browser Origin/Sec-Fetch requests refuse. The closed version1 projection has a 96-KiB limit, monotonic generations, two-second receive/three-second native deadlines and exact acknowledgment after atomic process-shared publication. Missing slots delete credentials, never retain ambient values. Garmin never travels live: native compares its startup fingerprint and marks changes pending reopen. Frozen compatibility remains startup-only; there is no whole-config reload.

Next env reset preserves the validated snapshot; changed DB/identity fails closed. Validated adoption sets umask `077` before runtime work, regardless of GUI launcher mask. Descendants create private files/directories; existing objects are never chmodded/adopted.

### Schema upgrades

Each additive schema is refused by older builds. Separately approve the exact DB/settings target, make and integrity-verify a WAL-consistent backup (SQLite online backup for active WAL), rehearse process-env migration on an independent populated disposable copy, stop every owner, then migrate the stopped target. Check integrity, foreign keys, version and preserved state before controlled reopen. [Data lifecycle](source-beta-readiness.md) owns the operational procedure. Recovery is a compatible forward fix or separately reconciled restore, never downgrade, an older writer or blind copy-back.

The selected DB retains conversations, Profile, memory, Trainer choice and general/original/latest weekly documents. Startup resolves saved conversation selection even outside the sidebar page, otherwise the stable most-recent row; empty startup creates nothing. Browser selection is not imported; explicit New chat creates a conversation. [Conversation history](conversation-history.md) owns schema18 replay/compaction, completion sequencing and privacy invalidation. Schema17 cannot read that version; deletion scopes remain separate.

## Optional ChatGPT subscription

[ChatGPT](chatgpt.md) owns OAuth/PKCE, registration/epoch identity, protected version2 companion storage, broker transport, refresh/disconnect and recovery. Returning authorization reuses the explicitly selected retained registration; new account/workspace is a separate choice. Protected pending registration survives restart, and unknown remote effects refuse fresh registration rather than replaying it. The guide also owns compatibility and operator-only [keep-one cleanup](chatgpt.md#keep-one-intended-connected-app).

Connection commit, catalog Save and backend acknowledgment remain distinct; explicit Save projects subscription availability. Unsupported records preserve originals and unrelated API-key/local routes. Ordinary admitted smoke stays credential-owner/broker-free; debug/release-probe binaries refuse real credential-owner creation altogether. Fictional presentation never authorizes sign-in.

## Integrations and GUI execution

The backend's cleared environment has system-only PATH `/usr/bin:/bin`. Garmin uses in-process read-only official HTTPS and FIT decoding, not external tools. [Garmin connection](garmin-auth.md) owns key creation, native Connect/Replace, masked intent, shape-only validation, startup-only delivery, explicit Verify and action-specific failures. Saved/offline views remain available without a working key. Old unofficial token files are never read, refreshed, moved or deleted.

Back/Cancel/close of Garmin entry discards its draft while preserving saved connection and provider drafts. A fixed native command opens Garmin's key-creation page; the app neither automates nor observes the browser. **Key saved** is configuration, not expiry/validity. Never paste keys into chat. [Garmin risk](garmin-risk.md) covers Personal API's individual-use boundary; smoke uses an owned authored stand-in, not real keys.

Cloud chat, memory extraction/embedding and Trainer choice are independent. Missing key/funding/model/network/auth never silently switches provider/account. Optional Ollama remains operator-owned. Debug traces can contain private context; [settings](settings.md#cross-chat-memory-and-debug-traces) owns their handling. Redacted local archives are not unrestricted model evidence.

## Lifecycle and local security

Native owns a fresh process group (Windows uses a [kill-on-close Job Object](windows.md#windows-mechanisms)) and ephemeral `127.0.0.1` backend. Private random readiness identity plus composition/selected-DB lease proof precede Trainer display; HTTP 200 is insufficient. Identity never enters a public URL. Foreign Origin/Host/cross-site requests refuse. Loopback is a single-user boundary, not isolation from same-user processes.

Only local setup receives settings/auth IPC. The fixed official ChatGPT usage destination is not a generic URL opener. Trainer/remote pages receive no settings/auth/native-action privilege; admitted smoke may return only correlated closed results. New windows/external navigation refuse. Second launch focuses the existing instance, ignores arguments and creates no second writer. Port zero coexists with unrelated listeners. Startup has a 90-second bound; failure opens settings without hidden retry.

Quit drains HTTP/Next work for at most five seconds; owned-group termination is bounded at eight. It stops only owned Node descendants, not unrelated listeners, Ollama or primary processes. Host death closes the pipe and bounds child termination. Cancellation is not rollback: saved turns/plans/checkpoints remain; generation/import/title work may be incomplete. Force-kill/power loss can leave a lease requiring exact ownership inspection. Relaunch reads persisted state.

## Validation and recovery

Use the [smoke playbook](dev-bridge.md) and [ownership contract](smoke/ownership.md) for actual isolated ordinary bundles, debug-only scenarios, inspected sanitized captures, private-input grants and disposal. Those owners distinguish synthetic presentation, actual lifecycle and separately authorized service evidence; missing capability follows the [before-use extension recipe](smoke/protocol.md#task-needed-bridge-and-runner-extensions), never a bypass.

For full desktop validation:

```bash
CI=true npm run validate
npm run eval:reliability
npm run desktop:build
npm run desktop:test:native
```

Fresh native tests need assembled resources; build first or run `desktop:resources`. Focused settings/UI/Python/native tests cover key intents, legacy adoption/re-entry, retired-field preservation, live/startup separation, atomicity, private protocol, Next reset, DB/origin/lease safety and connector/Python exclusion. Do not skip/weaken guardrails.

Actual unsigned ARM64 production smoke runs outside checkout on WAL-consistent populated copies. Exercise settings/preserved advanced inputs; save/reload and explicit legacy adoption/denial/re-entry; blank Create/Finish/relaunch and populated Use-existing; partial commit/cancel/retry; restart-required; admission/quit/relaunch; saved features; available real providers and authored official-path Garmin reads. Real-key evidence requires separate authority and operator entry; record unavailable evidence. Follow developer-process/epic cleanup and keep inspected sanitized screenshots local, uncommitted and unuploaded.

On failure, inspect settings version/privacy, explicit paths/storage status, readonly DB integrity/schema and exact owners. Rebuild missing resources/ABI on ARM64. Source diagnostics never read native settings/Keychain. Do not share private paths, credentials or raw vendor/framework logs. Rollback needs a compatible build and preserved compatible state/backups, not automatic downgrade, env import, browser fallback, reset or copy-back.
