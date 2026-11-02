# Isolated programmatic native smoke

Routine smoke uses the **real macOS ARM64 Tauri/WebView** through explicit native admission. Prefer the ordinary-artifact isolated scenario below when ordinary artifact/layout evidence is required; debug and default CI quick retain their narrower contracts. No browser launcher, Vite/HMR, fake backend, global OS mouse/keyboard events, Accessibility, Apple Events, Screen Recording, activation or focus restoration is used. Only the separately opt-in debug disclosure scenario forwards fixed Enter/Space NSEvents directly to its owned non-key WebView, never the OS queue; ordinary mode rejects those controls. Ordinary product setup/singleton behavior remains independent. Baseline ordinary control excludes setup/settings/auth. The separately scoped finite history-setup scenario below adds keyless first-run/optional-limit controls; all admitted scenarios still refuse private credentials/auth, pickers and legacy adoption. The separate keyless debug Settings route below uses native local-document completion, not a trainer grant. These are delivered capabilities, not permanent feature bans; see [task-needed extension policy](#task-needed-bridge-and-runner-extensions).

## Ordinary-artifact isolated scenario

Build once from final reviewed inputs with `npm run desktop:build`. Then:

```bash
npm run smoke:ordinary -- --scratch '/absolute/canonical/private-task-scratch' \
  --task-id T0252 \
  --bundle '/absolute/checkout/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
```

Input defaults to the [finite authored synthetic recipe and supported preparer](smoke-inputs.md), requiring no personal input or approval. Scratch must already be canonical, owned and `0700`; insecure inputs are never chmodded/adopted. Optional private selection retains exactly `database` in bounded `0600` single-link JSON, with explicit current `--grant-file` and `--provenance-file` checks before private consumption. An applicable standing grant survives task changes; missing/revoked/expired/mismatched authority refuses that private route without fallback. Never discover normal settings/env/keys/tokens.

For Pivan/E0007, the selected workspace's `epics/E0007-ai-garmin-connect-trainer/content/private-smoke-fixture-inventory.md` owns approval/retention policy. Discovery is not consent or readiness; no actual private grant is supplied by this documentation. The [input contract](smoke-inputs.md#explicit-private-route) owns CLI/serialization and one-off compatibility, not a general permission service.

The runner online-backs up the selected input into two exclusive `ordinary-<UUID>` roots, copies the **unmodified ordinary bundle** outside checkout and verifies every inventory byte. No binary, Info.plist, bundle identity or packaged resource is replaced. It directly launches each owned child with `--isolated-smoke-run <root/launch.json>`; capability is private, not argv/env/URL/log output. `--prepare-only` records independent copies/provenance with zero launches, not smoke success.

Native admits strict schema-v1 descriptor/source/resource/artifact identity before framework state, plugins or windows. It pins private root/subdirectory identities, holds an exclusive lifetime run-directory lock, normally requires existing compatible file-backed v2/v3 settings/run-local DB and keeps ordinary DB preflight/writer leases. Only the explicit history-setup scope below admits genuinely absent run settings and, for Create new, a genuinely absent DB with native-owned identity binding. The fixed run-config v3 file takes authority when present; invalid newest state refuses rather than falling back to v2/v1 or normal settings. Manual native Save retains current catalog/revision validators and run DB/token confinement; the baseline runner prepares compatible keyless v2, not automatic migration. Derived config, app-data, trainer/setup WebView storage and temp stay in the run; HOME is unchanged. Optional selected tokens must be a separately prepared run-local copy. It never imports saved provider keys or provisions login. Invalid intent fails nonzero without normal singleton/config fallback. Same-root live owners refuse; restart requires reaped ownership, settled endpoints/DB lease and a fresh native boot. Before every admitted boot the runner pins its original private root, acquires the namespace lease and atomically publishes a fresh capability over only its known private descriptor; replaced/aliased roots/descriptors refuse without adoption. Prior-boot bearer access and stale boot requests are rejected, including after abrupt parent death. Default launch still uses normal settings/singleton and installs **no** controller/bootstrap/result grant; second-instance arguments never retarget an existing process.

Two authenticated release-native/source/artifact/boot/selected-copy identities and actual hydrated renderer round trips precede navigation, synthetic Goals save and owned restart/persistence. Cross-run, browser, wrong boot, duplicate and private-control rejection are exercised. Capture covers fixed Trainer/Sync/Profile views at wide 1280×850 and narrow 420×850 logical viewports. Masks hide everything by default and reveal only reviewed static labels/controls and this run's saved synthetic Goals. Geometry is preserved: no Profile repositioning or resize/reflow is used. Restoration is unconditional with a bounded renderer expiry. PNGs are local-only, not uploaded; **read/inspect every required image** and record what it verifies. Blank masked areas conceal transcripts, copied facts, paths, diagnostics and private inputs. This is redacted layout evidence, not full unmodified-window or trusted OS-input certification.

The baseline is keyless. No real provider/Garmin success is implied; separately provisioned run-native settings and explicit token copies are required for available real integration checks through the verified owned backend. Never read back keys, copy normal settings, generate env files or automate sign-in/MFA. Existing debug, quick and release-probe regressions remain independent. Focus is sampled every 10ms without activation/restoration; absence of a live operator instance must be disclosed, not manufactured. Only live child handles authorize shutdown; verify native reaping, backend/control endpoints and DB/run lease settlement. Copies/Goals stay task-attributed until scratch expiry; no primary mutation/copy-back or worktree disposal.

## Bounded ordinary history setup and copied-token Sync

```bash
npm run smoke:history -- --scratch <canonical-private-task-scratch> \
  --input-file <private-database-only-selection.json> --bundle <current-ordinary-app> \
  --token-input <explicit-private-token-selection.json>
```

This reuses the delivered unmodified outside-checkout ordinary bundle, pinned namespace/boot/capability, online backup, observer and owned shutdown owners. The optional descriptor `historySetup` admits only `create-new` or `use-existing`. Both require genuinely missing run-local v1/v2/v3 settings for the first run; invalid or legacy state never becomes blank-install authority. Create requires an absent exact run DB, refuses collisions, and binds publication identity only from the native onboarding owner's verified `OwnedDatabase`; external appearance/replacement refuses. Existing requires the compatible populated copy. Genuinely absent settings select the private-file owner's current v3 destination. Committed v3 settings retain authority and support explicit restart; newest-file presence still wins, including invalid newest state. Filename/version conflicts remain errors, never a compatibility fallback. History mode also requires a retained runner stdin pipe: EOF/error/unexpected data self-stops only that instance and its owned backend, never a process recovered from a saved PID. The observer retains its own runner pipe and self-stops on owner loss. Ordinary preflight, initialization, revision and no-overwrite safeguards remain authoritative; default launches and baseline ordinary control gain no new grant.

The closed `historySettings` actions are `open`, `observe`, `createNew`, `useExisting`, `next`, `finish`, `save`, `automatic`, `legacyLimit`, `capture`, `close`. Selection must match native descriptor scope. Read-only `observe` may report a missing/loading local document with `windowReady:false`; the runner must verify `windowReady:true` before its single Open action. Wrong/foreign document routes still refuse, and listener identity alone is not window or form readiness. A backend origin/hydrated page can precede completion of native startup's Settings hide. Clients wait for native `runtimeReady` (the service owner lock has settled); Settings additionally reports actual `windowVisible`, and hidden-window mutations refuse. CSS visibility alone is not native window visibility. Finish accepts only the pinned DB, unchanged keyless catalog/default fields and provider intents, and blank history. Existing Save permits only the fixed `2024-01-01` compatibility limit or automatic blank; other settings remain unchanged/defaulted. This is a finite compatibility fixture, not an arbitrary date/input API. The controller clicks the product's real Use exploration limit control: Automatic leaves its date inactive; Limited activates a required date. It never disables validation itself. Browser constraints for the selected mode and all other active fields remain authoritative. Native local-document completion returns strict bounded booleans plus nullable `setupFailure`: at most 512 bytes of native-owned compile-time static error text, never renderer/vendor payloads. Failed Finish is retained immediately without an automatic retry. No trainer callback/settings grant, arbitrary path/value/eval, authentication/MFA, adoption or picker action is added.

The scenario exercises both actual wizard paths without a date, Finish into hydrated Trainer, saved direct launch, optional-limit Save with unchanged running backend, explicit restart, clearing the limit and restart. Geometry-preserving setup captures hide paths, keys, connection/status/review text and every unrelated surface. A fixed semantic scroll selects Data/Review/history controls; no layout reconstruction or global input is used. Masks restore on capture failure/success and bounded expiry. These are actual ordinary isolated-mode synthetic-DOM/visible-control proofs, not normal singleton/focus or hardware-input certification.

The history-scoped ordinary closed `sync` command adds only `observe`, `start`, `cancel`, `continue`, `refresh` through existing visible Sync controls. Duplicate/disabled/hidden/private/extra-field targets refuse. Its exact result contains `ok`, `running`, `paused`, `completed`, `failed`, `startEnabled`, `cancelEnabled`, `progressStarted` booleans, never log text, raw replies or copied values. Start completion means the semantic click completed, not that import settled; observe durable/server ownership before another action. Cancellation waits for the real active claim to settle and explicitly refreshes summary before continuation. Unknown effects are never mutation-retried.

`--token-input` is optional and never discovered. It selects an owner-private canonical directory and known `garmin_tokens.json`/optional `garmin_tokens.base64` files via a 0600 single-link JSON `{tokenDirectory,tokenFiles,purpose:"T0238 private copied-token smoke only"}`. Preparation pins the source directory, opens known no-follow/nonblocking regular private single-link files, bounds reads and checks stable identity; copies exclusively to the admitted private run `tokens` root. Only this run's own keyless settings are authored while stopped. Normal settings/provider keys are never read/copied. Original token hashes and original DB logical integrity are verified afterward; connector refresh may affect only the copy. No fresh login, MFA, original rotation, raw payload retention or copy-back.

For a separately selected stopped copy with an existing discovery checkpoint, `--continuation-only` performs exactly one explicit continuation (at most 96 attempts/180 seconds), with no repeated Cancel/start batch. It requires explicit copied tokens, refuses an active/missing checkpoint before dispatch, and retains before/after safe aggregates plus progress/settled captures on failure as well as success. This finite mode can finish the remaining authorized invocation after a validated changed-content repair; it grants no budget reset or blind retry.

Default real smoke performs one immediately cancelled run and two explicit finite continuations: at most 288 remote-operation attempts/540 seconds combined, 96 attempts/180 seconds per invocation and 30 seconds per operation, never exact Garmin HTTP counts. Record bounded normalized/checkpoint/status evidence and inspect actual progress/cancel/continued captures separately. Each completed progress/cancel stage retains private source/boot/capture evidence immediately; overall failure remains failure and preserves partial captures/cancellation observations rather than losing them when a continuation refuses. Without a token input, the runner captures only keyless idle Sync after setup/restarts, never starts an account request. Sync masks reveal only reviewed static controls and empty-direct-text ancestor containers needed by WebKit's scroll compositor; private descendants remain independently hidden, and direct ancestor text refuses with restoration. These idle captures cannot certify active/cancel/continuation states. Missing/expired auth, rate limits and network failure remain real failures/limits, not automatic login/retry authority. Keyless success does not certify Garmin. New fresh DBs exist only to exercise the required genuine wizard in task scratch; this is not a persistent fixture framework or recurring CI enrollment.

## Opt-in composer-footer evidence

Add `--composer-footer` to `smoke:ordinary` for the finite keyless footer scenario. It
prepares only run-native v3 settings with two fixed synthetic Ollama catalog entries
(one long friendly/provider/exact-ID label), leaving originals and the existing v2
run configuration intact. No new DB seed, provider/daemon request or live credentials.
The ordinary-only `composer` command accepts only `observe`, `draft`, `choose`,
`reset`, `keys`, with no caller input/ID/key/selector. It uses a fixed run-ID draft,
actual React selection and Default handlers, and synthetic DOM Enter/Space on the
selector. Boolean-only results describe readiness, single-control/DOM order, real
viewport fit, draft/node identity, saved/default choice and key-no-send observation;
no copied text or model identity is returned. These keys are **not native-generated,
trusted or hardware input**; active-window routing/focus styling remains uncertified.

The runner verifies saved/reset metadata through its verified owned backend and
unchanged saved chat data, then captures saved-long-label and reset-default states
at the existing wide/narrow presets using `captureView` with fixed `view:composer`.
The mask reveals only validated known synthetic catalog/draft, static heading/Model/
Send/Default and fixed Saved text at their real geometry. All copied conversations,
transcripts, facts, diagnostics and unknown values remain hidden. Capture requires the
canonical synthetic state, with normal restoration/expiry on every outcome. Inspect
actual images separately. Error/loading layout remains deterministic coverage when
not exercised natively; no provider send/streaming or trusted keyboard claim follows.
Copies/preferences/draft/Goals/images are task-attributed and scratch-expiry deferred.
Default ordinary/debug/quick scenarios gain no extra workload or privileges.

#### Missing-key eligibility evidence

`--model-eligibility` implies composer-footer evidence, leaving the baseline scenario
unchanged. The existing two run-owned copies instead receive fixed keyless v3
catalogs: two eligible synthetic Ollama entries plus four missing-key cloud entries
(two OpenAI, one DeepSeek, one OpenRouter), and four cloud entries only. Both have
an unavailable cloud default and an initially saved matching identity. Preparation
seeds only the exclusive disposable copy before boot and refuses an existing
legacy/v2 model preference; original input and v2 settings remain unchanged. No
provider call, private input or Settings/auth grant is added.

The same closed actions prove hidden saved choices, explicit eligible replacement
(mixed run only) and reset to an unavailable default. Draft/reset may operate on a
canonical disabled zero-choice control; choose/keys still refuse it. Three additional
boolean results (`catalogKnown`, `unavailableChoice`, `noEligibleChoices`) expose no
IDs, labels, keys or copied content. Native exact-field/type/mode validation and all
existing run/boot/origin/request/time bounds remain binding. Unknown/extra actions,
caller values and noncanonical catalogs/placeholders refuse.

Mixed hidden-saved/replacement/unavailable-default and all-ineligible saved/default
states each receive wide/narrow `composer` captures (ten total). Masks additionally
reveal only generic unavailable placeholders and exact fixed safe key/empty guidance;
all other unknown/copied text stays hidden, with unconditional restoration/expiry.
The runner verifies full authoritative eligibility/default metadata, exact saved/reset
identity and unchanged chat fingerprints. This proves native control/DOM option
omission, not OS popup rendering, trusted input, real provider/Garmin readiness or
normal-singleton behavior. Inspect every actual PNG. All run-only preferences,
drafts, Goals and captures remain task-attributed and scratch-expiry deferred.

### Opt-in conversation selection evidence

T0250 adds `--conversation-selection` to `smoke:ordinary` for approved populated
copies with **no existing chats**. The ordinary-only `conversation` command accepts
only `observe`, `open-menu`, `open-history`, `settle-history`, `new`, `menu-new`, `rename-new`,
`title-first`, `title-second`, `save-title`, `menu-first`, `menu-second`,
`choose-first`, `choose-second`, `delete-first`, `delete-second`; no caller
ID/title/selector/input. Each command performs one synchronous rendered action;
runner-owned bounded read-only RPCs observe React/DB reconciliation before the
next action. No pending renderer callback waits for its own React updates.
It uses real New chat, rename, history/drawer and delete handlers with two fixed
run-attributed labels (`T0250-first/second-<run UUID without dashes>`, under the
normal title limit). Unknown/copied conversation labels refuse the scenario.
Results contain only closed action/readiness/presence/selection/empty-history
booleans, not IDs, titles, timestamps or transcript content. Failures expose only
closed admission/history-toggle/history-opening/creating/created/menu/rename/saving stage labels; readiness adds only fixed history geometry/toggle/menu/rename booleans. History actions
and captures require a geometrically visible, expanded sidebar/drawer; zero-width
or offscreen DOM presence is not visible UI evidence. Observations include only
bounded sidebar left/right/width geometry in addition to the fixed booleans.
Nonactivating WebKit can freeze a drawer CSS transition; `settle-history` finishes
only that explicitly opened sidebar's existing finite transform/width/padding
transitions at their real CSS endpoints. It never overrides styles, forces a
hidden state, takes focus or waives geometry checks. Captures therefore show settled
actual layout, not animated-motion/trusted-input certification.

Delete supplies a synchronous synthetic **yes only to the exact task-created
conversation confirmation**, restoring the original confirm function in `finally`.
This is not native dialog/trusted-input certification. Navigation and rename are
synthetic DOM actions. Native run/boot/origin/request admission, five-second result
deadline, unknown-effect/no-mutation-retry and owned shutdown remain unchanged.
Renderer observation waits are bounded; runner readiness waits are read-only.

The finite scenario proves non-creating empty startup, two explicit creations,
older-row selection, away/back navigation, quit/relaunch on a fresh native origin,
restoration, non-active/active/delete-last behavior and absence of fixed-default
resurrection. Read-only checks target only the verified run copy. Fixed
`captureView:conversation` wide/narrow masks reveal only static history controls
and validated run-synthetic rows at real geometry; copied dates, transcript and
all other surfaces stay hidden. Inspect every PNG. Chat metadata/copy-only rows,
Goals and captures are task-attributed and scratch-expiry deferred, never copied
back. No provider send, credentials, new fixture system, primary state or recurring
CI workload is introduced. Native/DOM/runner positive and negative contracts must
pass before using the scenario as evidence.

## Finite synthetic Markdown-table scenario

For presentation-only table work, use the existing fresh current-schema synthetic
seed rather than requesting personal populated fixtures:

```bash
npm run smoke:tables -- --scratch '/absolute/canonical/private-task-scratch' \
  --bundle '/absolute/checkout/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
```

Build the final same-input ordinary artifact first. This finite runner extends the
existing `ci:seed --markdown-tables` mechanism with one synthetic Profile, one
assistant message containing reordered six-column and ordinary three-column tables,
and current-week plan/review documents. No private input, environment discovery,
provider/Garmin call or new fixture environment. Default CI/quick/ordinary workloads
are unchanged. One unmodified outside-checkout ordinary bundle uses the existing
source/resource/artifact/run/boot/renderer admission, online-copy, private storage,
nonactivation observer, Goals save/restart and live-handle shutdown owners.

Ordinary-only `tables` accepts exactly `surface: plan|review|chat|chat-simple` and
`edge: start|end`. It verifies exact canonical synthetic cell matrices and bounded
inline structure, scrolls only that real table into view/to its contained edge,
and returns fixed enums plus booleans for compact line layout, prose wrapping,
containment, scrolling, cell presence, reached edge and header visibility inside
the actual ancestor/viewport clipping bounds. Navigation scrolls only user-scrollable
table ancestors, never overflow-hidden panel ancestors via scrollIntoView. Ordinary `observe` adds a
boolean `tablesReady`, never document text. `captureView` adds only `view: tables`:
a previously selected, still-canonical table is revealed through the existing
hide-by-default geometry-preserving mask. Its ancestor containers are revealed only
when all direct text nodes are whitespace, preventing WebKit hidden-scroller
compositing omission while every sibling/other child remains independently hidden;
non-whitespace direct ancestor text refuses rather than exposing it. Unexpected/private/ambiguous content,
wrong view/mode/fields or missing selection refuse; existing run/boot/origin/request,
timeout/unknown-effect, restoration/expiry and capture bounds remain unchanged.
No arbitrary text/selector/script/path, settings/auth grant or private readback.

Twelve actual native PNGs cover each surface at wide, narrow-start and narrow-end.
Inspect each separately. Capture files and original boolean observations survive
geometry failures; no mutation is blindly retried. Canonical copies are under
task scratch `screenshots/`. Synthetic seeds/copies/documents/Goals/images/logs are
attributed and deferred to scratch expiry, never copied back/uploaded. This proves
ordinary isolated native rendering on synthetic documents, not provider generation,
private-data integration, default singleton/settings or trusted hardware input.
Use focused seed/DOM/native/runner contracts before this scenario; do not substitute
a quick Profile pass or offscreen WebKit probe for changed-path native evidence.

## Run the representative scenario

This **debug-only** command now defaults to representative authored synthetic input; its native scenario/admission scope is unchanged.

Prerequisites: `npm ci`, supported Node/Rust/Xcode tools, Python 3 and canonical private task scratch (Pivan: `pivan-harness task-scratch path "$PIVAN_TASK_PATH" --create`; use a fresh `0700` child if needed, never adopt insecure input). External providers, Garmin tokens, Keychain and Ollama are unnecessary and never invoked. No real-integration certification follows.

```bash
scratch='/absolute/canonical/private-task-scratch'
npm run smoke:native -- --scratch "$scratch" --task-id T0252
```

See [local smoke inputs](smoke-inputs.md) for recorded UTC anchor, no-launch preparation and optional exact private standing/one-off authority. No personal-input selection or repeated ticket-only consent is required for the synthetic route.

The command assembles production Next/Node resources and builds a debug native host under a worktree-local preparation lock. It hashes tracked, staged/unstaged and untracked nonignored source inputs and refuses changes during preparation/execution. Build/test caches are worktree-local; never share mutable state across worktrees. It copies the prepared executable to scratch and uses it for two simultaneous uniquely owned native instances. A run directory/endpoint is never reused or stolen. `--prepare-only` exercises private online-backup/provenance preparation with **zero launches**; it is not smoke success.

The runner:

1. Creates fresh owner-private UUID directories with independent config/HOME/temp/WebView profile, capability, DB and output. Uses SQLite online backup, compares whole logical fingerprints/counts and integrity, and preserves the prepared seed/original. Fresh synthetic schema is created only by the preparer; selected existing input is never migrated.
2. Validates exact run/source/build/app/PID/selected-copy/backend origin plus a read-only **hydrated renderer** round trip. Listening/native Ready/HTTP 200/server-rendered HTML alone are insufficient. A DOM-only readiness marker is set by the normal dashboard effect; no feature state is read/injected.
3. Navigates Trainer → Activities/Health/Training Plan/Sync → Trainer, then Profile & data without provider/sync/deletion actions. Inputs only a synthetic `T0231-smoke-<UUID>` Goals value via React-compatible DOM events, saves through the existing Profile owner and verifies other copied Profile fields unchanged. Quits/relaunches the same owned copy, checks new native PID and persisted Goals through rendered UI, then verifies the other fields again.
4. Captures an actual own-WKWebView PNG after fixed temporary sanitization hides every private copied surface except Profile heading/saved badge, synthetic Goals and Save/Reload controls. This is explicitly a **sanitized Profile subtree**, not a normal full-window screenshot or layout-fidelity/native-input certificate. Never upload/commit images. Read/inspect each required image and record scenario/source/hash/visible-state analysis separately from capture success; Pivan tasks use `pr-smoke-assets` after inspection.
5. Retains live child handles, stops/reaps only owned processes on success/error/interruption, and verifies backend/bridge endpoints and the copy writer lease settle. Receipts/PIDs never authorize later kills. No broad name-based process kill, operator restart, primary cutover, Keychain reset or worktree disposal.

A read-only Swift observer samples frontmost PID/pointer every 10ms and refuses commands if an owned native process became frontmost. Pointer variation can be normal operator activity and is reported separately; sampling cannot exclude shorter transitions. The app is Accessory/nonfocused/nonactivating and uses incognito WebViews. This is routing/lifecycle isolation, not a sandbox against arbitrary same-user code.

## Closed keyless native Settings smoke

`npm run smoke:settings -- --scratch <canonical-task-scratch> --input-file <private-explicit-db-selection.json>` reuses the same online-backup, source/build, nonactivation observer and live-handle shutdown owners. `--resources-ready` verifies exact same-source assembled resources rather than rebuilding the backend. This is a debug-only changed-surface scenario, not ordinary-artifact or live-login certification.

The authenticated closed `settings` command has only `open`, `observe`, `connect`, `later`, `save`, `cancel`, `capture`, `captureIntro`, `close` actions. Native creates its own nonfocused incognito local setup document. A fixed bootstrap drives actual semantic controls; native WKWebView completion returns a strict bounded boolean DTO directly, with no new renderer IPC/result grant. The trainer still has no settings/auth privileges. No arbitrary input/value, selector, script, path or invoke is accepted. Observations exclude copied text/control values/secrets/paths.

Admitted runs permit only the exact keyless online-backup DB, Ollama, disabled memory and automatic blank or fixed compatibility history plus unchanged catalog defaults filled by the real form. Native Save rejects keys, token selections and nondefault path/tool/model/endpoint changes. Authentication/MFA, Keychain adoption, native pickers and first-run Finish are explicitly refused for admitted smoke even in local setup. Connect only reveals the form; no credentials are entered or login/sync started. The scenario verifies Connect/later/cancel, manual-control absence, real Save-next-launch with the current backend unchanged and exact-scope restart.

`captureIntro` reveals only the verified static Settings H1 and two approved introductory paragraphs at their unchanged geometry; unexpected text, nested elements, hidden/overflowing notices or an ineffective privacy mask refuse. Every other element (including status, paths and all form values) is hidden. The mask restores on native success/failure and independently expires after five seconds. The runner captures the intro initially and after Save/restart; this proves only debug keyless existing-installation copy, not ordinary/default Settings, first-run or trusted input. It accepts no selector/value/text input or private readback and retains exact debug-run/window/document admission and closed native boolean completion.

Other captures contain sanitized **actual Garmin Settings subtrees**, repositioned for bounded visibility, with all copied state and credential input values hidden. They are not full-window layout/trusted-input evidence. Native restores sanitization after capture success/failure. Read/inspect images and record local helper evidence; never upload. Online copies/settings/logs/images are task-attributed and expiry-deferred, originals fingerprint-verified, with no primary mutation/copy-back. Real login/MFA remains privately operator-entered only in a separately arranged safe native window; this controller cannot exercise it.

## Finite Daily Health comparison scenario

Add `--health-comparison` to the same populated-copy `smoke:native` command to
exercise Previous/Next/Latest seven-date pages, Daily/Weekly/Monthly switching,
range preservation through away/back, and fixed narrow (420×900) and wide
(1280×900) own-window captures. The selected input must include older eligible
Health history: at least fourteen eligible source dates with partial coverage in
the historical page. Missing prerequisites refuse rather than claiming coverage.
The supported default synthetic recipe supplies missing/partial/zero cases. Existing
input gaps are preserved without extra omissions. Only when the historical page
has no gap, the opt-in scenario omits one fixed-position row from each newly created
owned online copy, preserving at least one partial record. A private preparation
receipt distinguishes existing gaps from copy-only omissions; neither is invented
as evidence about personal data. Repeated/live-copy preparation is refused. No
primary discovery or additional durable fixture environment is introduced.

The closed `health` command accepts only these actions: `daily`, `weekly`,
`monthly`, `previous`, `next`, `latest`, `remember-range`, `assert-range`,
`capture-wide`, `capture-narrow`. Range identity stays inside the renderer;
observations expose only fixed mode and readiness/navigation/missing-record/
partial-record booleans. Readiness checks the real fifteen chart cards, each with
seven date-associated exact-value buttons, against the seven source-context dates. Both
native and renderer reject unknown action/field/selector/date/viewport inputs.
Fixed capture cases resize only the admitted owned window, never activate it.

Health captures hide everything by default and reveal only fixed static Health
controls/card chrome and chart grid lines. Source dates, values, plot marks/ticks,
coverage, HRV context and unexpected descendants stay hidden in place, retaining
actual geometry and scroll layout; placeholders mark hidden readouts/date buttons.
They do not reposition/reconstruct the comparison or prove masked exact values;
synthetic DOM associations cover those. Inspect actual PNGs and record privacy,
layout/overflow, source/hash and these limits. `health-scenario.json` records real
scenario/capture outcomes, not image inspection or ordinary-artifact evidence.
Existing Profile scenario, production exclusion, unknown-effect/no-retry and
owned-handle shutdown constraints are unchanged.

## CI-only synthetic quick scenario

`npm run smoke:quick -- --scratch <canonical-owner-private-task-scratch>` reuses
the delivered `Run` admission/client/lifecycle and exact keyless settings. It
creates one fresh UUID synthetic seed through existing migrations and typed Profile
schema, verifies current schema/integrity and the real settings validator, then
uses an independent online backup. No operator database/env/token/Keychain is read.
It drives only Profile & data Goals save through the ordinary UI, quits/relaunches
the same owned state and asserts persistence plus unchanged other Profile fields.
It retains authenticated source/native/backend/hydrated renderer and shutdown
receipts. Existing sentinel protocol is reused; no new native command or production
bypass is added. Seed/copy Goals are CI synthetic and expire with scratch/runner.

One instance, no capture, full navigation matrix, parallel/security/release suite,
real integrations or trusted native input. Missing/aliased/reused/escaping scratch
or seed, wrong architecture, readiness/save/restart/cleanup failure is nonzero, with
no fallback to user state or blind mutation retry. Existing `smoke:native` retains
two representative run copies, navigation and capture with synthetic default; quick does not narrow it.
The explicit `--resources-ready` option verifies same-source resource inventory for
[one-build full nightly reproduction](validation.md#change-gated-native-nightly).

### Opt-in synthetic LLM disclosure evidence

`npm run smoke:quick -- --scratch <canonical-owner-private-task-scratch> --llm-debug`
extends the existing seed with exactly two saved synthetic assistant turns (one
trace and one missing-trace fallback). Default quick/nightly remains Profile-only;
this opt-in adds no private database selection or recurring CI workload. The normal
resource-ready option retains its exact-source/inventory checks.

The scenario observes native closed/open/inner-open/outer-close/remount states,
actual descendant visibility, native list-item marker, focus and focus-visible.
Fixed Enter/Space events are sent directly to the owned non-key WKWebView after
focusing only its outer debug summary. A trusted DOM key receipt and resulting
state plus continued nonactivation are checked; these are **native-generated local
events, not hardware input**, and never certify OS dialogs or global keyboard routing.
An intentionally non-key WebView has `document.hasFocus() === false` and suppresses
`:focus`/`:focus-visible` even with its summary as `activeElement`. The receipt
records `activeWindowFocusCertified: false`; actual active-window focus-ring evidence
remains separate. Never activate the app or fabricate a focus style to obtain it. No activation or global
posting occurs; a key/frontmost instance refuses rather than taking over.

Four actual WKWebView PNGs show default-closed, outer-open/inner-closed, independent
inner-open and Profile-reopened states. The sanitizer exposes only the debug card,
repositioned on an opaque background; it is subtree evidence, not normal full-window
layout fidelity. Before capture it verifies the complete fixed synthetic content
and structure, refusing private/unexpected previews, JSON or nodes. Observations
return only booleans/expanded-state arrays, never trace text. Inspect each image;
`debug-disclosure.json`/quick receipt retain source/state/capture/keyboard provenance.
Seed/copy/Goals/trace data expire with task scratch and are never copied back.
Ordinary-artifact launch, private data/integrations and hardware-input evidence
remain independent; this path grants no settings, secret or general eval controls.

## Task-needed bridge and runner extensions

Safe, bounded task-needed smoke-bridge/runner evolution is **expected and wanted** as part of ordinary authorized implementation and validation. A missing command or supported input alone is not a reason for a separate ticket, an operator stop or a categorical Settings/Sync/token ban. A closed allowlist describes today's implementation contract, not an immutable feature ceiling. This policy grants no Start, credential access or other task's ownership/permissions; explicit task exclusions and independent safety/human gates still bind. Material scope or intended-behavior ambiguity needs resolution, not a permissive controller.

### Before-use contract and validation recipe

1. Name the task's changed behavior and exact missing evidence. Check delivered source/artifact capabilities and overlapping task/PR owners; coordinate the smallest nonduplicating change. Do not assume unpublished work is delivered or silently adopt it.
2. Design the smallest finite semantic actions, explicit private inputs and bounded sanitized result schemas through the existing native/application owners. Specify admission, exact run/boot/window/origin/request ownership, deadlines, cancellation and unknown-effect handling. No arbitrary selector/script/eval/invoke/proxy, broad input/path discovery, private value readback or generic automation framework.
3. Update the documented contract and implementation together. Extend the explicit allowlist, input/result validators and relevant positive/negative regressions: unknown/extra/private actions, wrong origin/run/boot/request, stale/late/duplicate results, admission/isolation denial, privacy/capture restoration and owned shutdown. A currently rejected action remains unsupported until that reviewed extension passes; never ignore a refusal, weaken assertions, skip guards or retry mutations until green.
4. Validate the extension **before using it for task evidence**: focused native/controller/DOM/runner contracts first, then sufficient affected aggregate, macOS build/artifact and real changed-path smoke. Use isolated worktree-local build state and verify exact resource/source identity. Choose impact-appropriate coverage; this recipe adds no recurring heavy CI or new fixture environment.
5. Run only owned, isolated, noninterfering instances on disposable private state. Use WAL-consistent populated online DB backups, private token copies when authorized and least-privilege provider routing through native owners. Preserve original DB/settings/provider/token bytes and record bounded integrity/count/provenance comparisons. Never target an operator singleton/process, take focus/pointer/global input, replace HOME to evade admission, log/read back credentials or expose raw private DOM/transcripts/payloads. No unattended fresh login/MFA, permission bypass or debug-control leakage into normal production execution.
6. Retain exact tested source/artifact/scenario, command results, original failures, inspected sanitized captures and evidence limits. Verify only owned live handles/endpoints/leases settle; capture evidence before attributed-data cleanup or expiry deferral. Required ordinary-artifact and integration evidence remains required. If it is unavailable, name the missing proof and strongest safe alternative without claiming equivalence; use the task's normal gate/disposition, not an adjacent pass.

### Planning examples, not newly implemented commands

| Task-needed gap                             | Bounded extension and evidence plan                                                                                                                                                                                                                                                                                     | Genuine stop or limit                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings control missing from smoke         | Reuse delivered keyless debug `smoke:settings` Connect/later/cancel/Save first. For another changed control or ordinary-mode gap, add only its finite semantic action and bounded intent/boolean observation through native Settings, with mode-specific validator/denial/Save-next-launch regressions.                 | Current keyless actions do not implement arbitrary values, adoption, pickers or first-run Finish; ordinary control excludes Settings. Stop before private-state authority, OS permission or ambiguous behavior changes; synthetic/subtree evidence does not certify trusted input or ordinary wizard behavior. |
| Sync progress, cancellation or continuation | Add finite start/cancel/continue actions through existing Sync/application owners on an owned populated copy; expose only bounded progress/status/checkpoint summaries. Cover deadlines, partial commits, cancel-versus-completion, restart/idempotency and no duplicate/unknown-effect retry.                          | Navigation to Sync is not execution evidence. Real connector coverage needs an explicitly selected authorized token copy; unavailable auth/network and ambiguous primary/copy routing constrain that integration, not safe deterministic implementation.                                                       |
| Copied-token real integration               | Extend runner preparation/admission where needed for an explicitly selected private token copy and required bounded read-only connector operations; keep token contents out of commands/results/logs and preserve original fingerprints. Exercise actual native-owned API/normalization and record high-level outcomes. | This is not unattended acquisition of fresh email/password/MFA, saved-key discovery or permission to rotate an original store. Missing credentials or refused ownership/permission cannot be bypassed; real login remains privately operator-entered in a separately safe native window.                       |

### Keep evidence classes distinct

- **Debug/instrumented host:** proves only its admitted scenario; synthetic DOM events are not trusted/hardware input. WebView-local native-generated keys have their own documented limits.
- **Static ordinary-artifact audit** and **launch-only instrumented release-denial probe:** exclusion/denial evidence only, not an actual ordinary outside-checkout launch.
- **Actual unmodified ordinary outside-checkout artifact:** record its exact build and launch mode. The supported admitted isolated mode above has its own contract and negative tests; further modes/capabilities cannot be inferred from open PRs. Isolated-mode success alone does not prove normal singleton/focus/config behavior.
- **Masked/subtree capture:** inspect the actual PNG and state what visible geometry/behavior it verifies and what masking/repositioning prevents it proving; capture success alone is not a pass.
- **Real copied-token/provider integration:** record actual authorized service use and preserved originals separately from keyless, synthetic or mocked success. Unavailable real login/MFA, normal-window or integration proof stays explicitly unavailable unless the relevant equivalence and limits are demonstrated.

## Narrow protocol and result semantics

`src-tauri/src/dev_bridge.rs` shares closed transport/result validation for the independently admitted debug and supported ordinary modes; `isolated_run.rs` owns ordinary admission. Legacy `smoke_config.rs` and its HOME/keyless policy remain debug/probe-only. Native-installed `src-tauri/debug/smoke.js` stays outside packaged UI resources. The ordinary binary contains the supported controller, but default launches never install it, manage bridge state or grant a result callback. An enabling environment alone cannot activate ordinary control.

- `GET /identity`: authenticated schema/run/source/native PID/app/copy/origin plus fixed renderer-diagnostic booleans. Does not imply readiness.
- `POST /command`: `{requestId,expectedRunId,command}`. UUID request/run identities, exact `Host: 127.0.0.1:<port>`, bearer capability and `X-Smoke-Run` are mandatory. Ordinary requests also require exact `expectedBoot`; result callbacks bind that same native boot. Capability stays in private config/client memory/header, never argv/URL/logs/receipts. Every browser Origin/Sec-Fetch-Site is refused; no CORS grant.
- Shared closed actions: `observe`; finite boolean-only `sync` actions above only in explicit ordinary history scope; exact main navigation/back/Profile-close/save/reload clicks; **synthetic Goals only** input/assert. Ordinary adds fixed `setViewport`/`captureView` presets plus the finite synthetic table and opt-in composer/conversation actions above (composer captures require canonical synthetic state). Debug alone retains Profile `capture`, finite `health` actions above, synthetic `captureDebug`, outer **LLM debug traces**/**First LLM trace** clicks and fixed **Enter**/**Space** `debugKey`. Debug-only `settings` dispatch uses its exact admitted legacy Config and native local-document completion, never the trainer callback. Debug Settings/Health/disclosure variants and their native input/setup modules compile out of ordinary release; ordinary native/renderer guards reject those debug controls. The separate native-local `historySettings` controller requires explicit ordinary history scope and never uses the trainer callback. No arbitrary selector/path/key, credential/login, general scroll/select/eval/invoke, state injection, HTTP/filesystem/process proxy or shutdown. Hidden/disabled/ambiguous/private/prehydration targets refuse before dispatch.
- Ordinary observations retain only fixed view/navigation/headings/readiness/saved booleans. Debug alone adds fixed Health mode/readiness/navigation/missing-record/partial-record booleans and optional disclosure booleans/three same-length boolean arrays (at most 128 entries); unknown keys/text, inconsistent shapes/bounds and action-mismatched results refuse natively. Remembered Health dates remain inside the debug bootstrap, never results. No copied values/transcripts/trace text/private credentials leave the renderer. Clicks/Goals/Health are synthetic DOM events; opt-in debug keys are native-generated WebView-local events, never hardware/global input. Ordinary uses neither those keys nor debug Health/Settings actions.
- Only the exact admitted trainer origin/window receives its result-only permission (`allow-isolated-result` for ordinary; legacy debug permission remains debug-only). No remote settings/auth grant is added. Callback validates run/boot/window/origin, bound and exact pending request; native validates closed result keys, enums/booleans and command correspondence, never arbitrary renderer JSON/text. Ordinary Goals equal this run's sentinel. Capture selectors/geometry/paths are never caller supplied; debug subtree captures do not certify ordinary layout. Keyless debug Settings has independently typed bounded native completion and adds no renderer result permission.
- One request at a time; 16 KiB total request; two-second total read deadline; no duplicate/chunked framing; 4096 unique request IDs/run; five-second renderer deadline; 16 KiB callback result; four-second/4 MiB PNG bound. Unknown fields/commands refuse. Late/duplicate/unknown results cannot complete newer requests. Native snapshots explicitly request screen updates before capture so current privacy masks/navigation/resize are flushed instead of accepting a cached prior-view frame. Background animation frames can be throttled, so the bounded renderer compositor delay is retained rather than requiring foreground activation. Complete PNG framing and dimensions are checked; native publishes an exclusive 0600 temporary atomically without replacing an existing capture, confined to the run's `screenshots/`.
- Correlated `{requestId,result:{ok:true,...}}` means actual renderer completion. Failed assertions/actions return HTTP 409, malformed commands 400, access/framing denial 403, deadline 504. **Timeout means effect unknown, not rollback.** The client exits nonzero and never blindly retries mutation. Only bounded read-only readiness/observation may poll. Inspect retained state before any fresh explicit action.

## Production exclusion and required artifact evidence

After sufficient final validation and an ordinary unsigned ARM64 `npm run desktop:build`:

```bash
# Use the database-only selection produced by smoke:prepare (no personal input).
npm run smoke:release -- --scratch "$scratch" --input-file '/canonical/smoke-input-UUID/selection.json'
```

This inventories every file in the **actual ordinary bundled `.app`**, requires supported isolated admission/control markers and rejects precise legacy debug admission/grant/probe markers. Shared controller/callback code is intentionally present, not proof it is enabled on default launches. The command then separately builds an explicit `release-probe` executable. The latter changes only run-local paths/app identity/incognito/nonactivation and fixed denial observation. It has no listener/control/capture implementation or result callback. In a copied `.app` with read-only resources it supplies enabling environment, observes no endpoint and a fixed internal WebView request being denied (`command-not-found` or earlier ACL refusal). It reports that reason truthfully, reaps only its live child and verifies the original production artifact inventory unchanged. The unbundled release executable may now be the instrumented variant; ordinary `desktop:build` never enables the feature and its bundled app remains unchanged.

**Static audit plus launch-only-instrumented release denial is not ordinary-artifact launch.** Use `smoke:ordinary` for admitted unmodified outside-checkout ordinary-artifact evidence. Default no-argument app behavior still uses the focus-taking singleton and normal settings, and remains independent: never launch it against an operator singleton/config/primary data merely for certification. Native admission/default-routing regression tests do not claim a live ordinary-default UI certificate. Manual private settings/auth evidence still needs an explicitly arranged noninterfering operator window. Source delivery grants no signing/install/release/primary restart.

## Evidence and recovery

Keep original failed logs/observations alongside later repairs. Each private run retains provenance, native/readiness/failure/observation/scenario/restart/shutdown records and screenshots; the task receipt records original integrity and focus-sampling limits. Profile sentinels exist only in task-owned populated copies and are intentionally deferred to scratch expiry; never copy back. Schema/back-sync is a verified no-op for this finite local preparation seam, not a durable fixture system. See [developer process](developer-process.md) and the epic runbook.

Use `npm run smoke:test`, focused DOM tests and `npm run desktop:test:native` for cheap boundary regressions, then the normal aggregate/reliability/build/native gates and current real smoke. Do not repeatedly rebuild/rerun unchanged heavy inputs to wait for hosted CI. Recurring CI runs only the separately documented synthetic quick scenario, not this full private populated-copy/release suite.

Mouse/native input is a **last resort** for genuine OS-only behavior: trusted keyboard/mouse events, drag-and-drop, native dialogs or operator-entered sign-in/MFA. Arrange an explicitly owned safe instance and direct private input; the current bridge cannot drive or certify those operations. Keyless navigation/Profile smoke does not certify provider coaching, Garmin auth, sync, private provider-file settings/adoption, native dialogs or platforms not tested. Missing task-needed controls follow the [extension recipe](#task-needed-bridge-and-runner-extensions), not a permanent ban or an invented pass.
