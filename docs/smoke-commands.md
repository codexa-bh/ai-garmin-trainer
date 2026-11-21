# Smoke command catalog

Use `npm run smoke:help -- list`, `search <literal terms...>` or `show <id>` to read only relevant entries. These operations read this file; they never prepare/build/launch. Titles mark mode and unusual effects. This is discovery, **not authority or automatic coverage selection**. Existing runner `--help` owns flag syntax.

Read the [playbook](dev-bridge.md) once. Below, `$scratch` is the allocator-returned canonical task root, `$bundle` the exact current physical ordinary bundle and `$selection` an explicitly prepared database-only selection. Run plain npm from the canonical physical task checkout; do not use private inputs unless separately authorized. Build requirements and resources follow [ownership](smoke/ownership.md). Detailed references are for changing/debugging the scenario, not routine cover-to-cover reading.

## prepare — Authored input preparation; no launch

`npm run smoke:prepare -- --scratch "$scratch"`

Creates exclusive synthetic SQLite/selection and provenance; no native build, account or personal input. `npm ci` required. Select the stdout JSON record with `prepared`, then use `<prepared>/selection.json`; resource disposition is a separate record. Pass task root, not evidence/disposable child. Optional private input requires current exact grant/provenance; never discover it. Prepared output survives immediate exit, not scheduled expiry. Preparation alone proves no app behavior. [Input contract](smoke-inputs.md).

## snow-runs — Ordinary authored individual snow run table and coverage

`npm run env -- python3 scripts/desktop/snow_runs_smoke.py --scratch "$scratch" --bundle "$bundle"`

Current ordinary ARM64 build and same physical source/tool environment required. Existing authored recipe flows through real SQLite/dashboard/HTTP/ActivityView: populated runs only, unknown, unsupported and preserved-after-failure states. Full two-instance baseline plus ten wide/narrow/local-scroll-end snow captures per instance; inspect originals and preservation/settlement receipts. Closed exact-cell masks, no private/service/trusted-input or installed-default-app proof. [Scenario](smoke/features.md#finite-authored-snow-runs).

## ordinary — Full ordinary synthetic native regression

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle"`

Build with `npm run desktop:build` first, same source/context. Authored input by default; two isolated nonactivating app copies prove navigation, Goals save/restart, admission/security and wide/narrow Trainer/Sync/Profile geometry. Inspect images and preservation/settlement receipts. Shared/native/mask or uncertain changes need full plus affected features. `--prepare-only` launches zero, not a pass. No real service, normal singleton or trusted-input proof. [Full contract and risk selection](smoke/ownership.md#ordinary-artifact-isolated-scenario).

## synthetic-sync — Ordinary authored Sync/import/cancel/discovery/finality

`npm run smoke:history -- --scratch "$scratch" --input-file "$selection" --bundle "$bundle" --synthetic-sync`

Use the [one-page build/run card](synthetic-sync-smoke.md): authored preparation, current full ordinary build and strict same-source history identity. Twelve operations exercise actual SQLite progression through the product's official reader against an authored loopback Personal API, plus the old-connection upgrade rehearsal; separate stopped 6/14 seeding proves presentation only. Add `--no-external-tools` (macOS) to deny the app Python/uv/uvx. No private key, Garmin or provider. Existing-data setup only, not blank onboarding. Inspect scenario/captures and unchanged-input/owned-shutdown results. [Scenario/bounds](smoke/sync.md#current-finite-synthetic-sync-scenario).

## history-setup — Ordinary keyless fresh/existing onboarding and history limits

`npm run smoke:history -- --scratch "$scratch" --input-file "$selection" --bundle "$bundle"`

Authored selection and current full ordinary build required. Exercises both genuine blank Create and populated Use existing, Finish, saved launch and optional history-limit Save/restart. Sync stays keyless idle; no account calls. Committed outputs retain their owner/lifetime. Inspect masked setup/idle captures; this is isolated synthetic-DOM, not normal singleton or trusted input. Historical `--token-input` and `--continuation-only` are **unavailable and refuse before private input access**. [Setup and separate real-service gate](smoke/sync.md#bounded-ordinary-history-setup-and-copied-token-sync).

## dependency-guidance — Ordinary authored missing/rejected/rate-limited/healthy connection presentation

`npm run smoke:history -- --scratch "$scratch" --input-file "$selection" --bundle "$bundle" --dependency-guidance`

Current ordinary build and authored input. Four stopped-run connection states against the owned fixture (no key, rejected key, rate limit, healthy); one Sync each, healthy explicitly cancelled; verify the closed stop reason, offline navigation and inspected wide/narrow connection help. No real key, network or private input. Cannot combine synthetic-sync/private/continuation scopes. [Finite contract](smoke/sync.md#finite-connection-recovery-evidence).

## composer — Ordinary keyless model choice and draft persistence

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --composer-footer`

Current ordinary build; authored catalogs only, no provider send. Full is default. Reviewed local-feature changes may additionally select `--smoke-scope feature --impact local-feature --impact-basis 'reviewed change'`; this is a human/agent impact judgment, not permission. Proves explicit choice/draft/restart and four inspected captures, not OS popup/trusted input. [Composer](smoke/ordinary.md#opt-in-composer-footer-evidence).

## eligibility — Ordinary mixed and empty keyless model catalogs

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --model-eligibility`

Implies composer. Both mixed eligible/missing-key and all-ineligible catalogs remain required even in feature scope. Verify unavailable intent/no fallback, replacement and restart; inspect six captures. No provider credentials, daemon or account. [Eligibility](smoke/ordinary.md#missing-key-eligibility-evidence).

## conversations — Ordinary authored create/rename/select/delete lifecycle

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --conversation-selection`

Current ordinary build; default preparer supplies the verified empty-chat variant, never clears borrowed input. Creates and deletes only two fixed run-attributed chats through real handlers. Actual restart/selection/sidebar geometry and inspected captures; synthetic confirmation is not native-dialog proof. Full default; reviewed local feature scope available. No provider send or primary data. [Conversation contract](smoke/ordinary.md#opt-in-conversation-selection-evidence).

## summary-lifecycle — Ordinary keyless Memory storage/recovery/controls

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --summary-engine --summary-part lifecycle`

Current ordinary build and finite authored seed. Exercises missing-key scheduling, parked diagnostic disclosure, one Retry, manual summary/preferences, Clear/Off and restart without real generation. Full default; reviewed summary-lifecycle scope may omit unrelated broad groups, never shared admission/settlement. Inspect required images; exact synthetic storage is not provider quality. Cannot combine composer/conversation. [Lifecycle](smoke/ordinary.md#keyless-summary-producer-lifecycle).

## summary-presentation — Ordinary fixed Memory/Densify/history presentation

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --summary-engine --summary-part presentation --summary-family densify`

Select `densify`, `overview` or `history` (repeatable); omitted family means all. Current ordinary build. Fixed renderer adapter proves production-hook/geometry states, not inference, actual acceptance persistence or engine progress. Mutations stay denied except the exact fixture-local actions. Inspect selected images; full/default or reviewed presentation scope retains its own coverage accounting. [Fixed contracts](smoke/ordinary.md#manual-densify-presentation-evidence-t0287).

## summary-native-copy — Opt-in real native responder; replaces system clipboard

Add `--summary-native-copy` to `summary-lifecycle`, never presentation-only. It deliberately replaces the clipboard with fixed authored text using owned WKWebView `selectAll:`/`copy:`; never reads/restores previous contents or uses global input. Explicitly select this effect. Current native/DOM/Python contracts and full two-instance plus affected Memory proof apply. Proves responder/equality, not hardware shortcuts/default menu. [Exact effect and refusals](smoke/ordinary.md#integrated-keyless-memory-controls).

## summary-settings — Ordinary keyless Memory catalog/history-limit Save/restart

`npm run smoke:summary:settings -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; fresh authored online copy, no keys/backlog/provider calls. Proves legacy scalar binding/Cancel/Save, independent summary identity, On/Off restart and required/cleared history dates while preserving legacy fields. Inspect all wide/narrow native Settings states. No primary or default-window activation. [Contract](smoke/settings.md#keyless-ordinary-summary-settings-round-trip).

## native — Debug synthetic navigation/Profile/Goals regression

`npm run smoke:native -- --scratch "$scratch"`

Builds/verifies production resources and debug host; no prebuilt ordinary bundle required. Two isolated copies, hydrated navigation, Goals save/restart and inspected sanitized Profile-subtree images. Defaults authored; optional private input uses exact grant/provenance. Debug HOME/config isolation differs from ordinary routing. Not ordinary-artifact, full-window, trusted-input or real-service proof. [Debug baseline](smoke/settings.md#run-the-representative-scenario).

## health — Debug synthetic Daily/Weekly/Monthly Health comparison

Add `--health-comparison` to `smoke:native`. Authored default supplies missing/partial/zero dates; private input needs exact authority and eligible coverage. May omit fixed rows only on new owned copies when the historical page has no gap, recorded separately. Captures preserve masks; authored Calories alone has exact finite unmasking. Inspect values/layout limitations. No ordinary artifact or real-service certification. [Health contract](smoke/settings.md#finite-daily-health-comparison-scenario).

## settings — Debug keyless Settings/catalog/provider-field presentation

`npm run smoke:settings -- --scratch "$scratch" --input-file "$selection"`

Authored selection; builds debug/resources unless verified `--resources-ready`. Real local-document actions cover Connect/later/cancel/Save/catalog/restart without login. `--provider-fields` uses only fixed fake keys; `--chatgpt-presentation` only fictional registration/models; `--dependency-guidance` fixed offline help. No real auth/MFA/adoption/picker/Finish or ordinary Settings grant. Inspect the chosen masked native states. [Mode/variant contracts](smoke/settings.md#closed-keyless-native-settings-smoke).

## live-settings — Debug synthetic live apply; owned fake loopback service

Add `--live-settings` to `smoke:settings`. Fixed fake keys/models and explicit owned `127.0.0.1:11435` fixture (exclusive bind or refusal), no real cloud/daemon. Proves catalog/key live acknowledgment, restart-only modal, captured old/new stream settings and absent-backend outcome. May stop only its exact owned backend; no PID/normal-app control. Inspect dialog/feedback images; synthetic wiring is not real provider readiness. [Exact live-settings contract](smoke/settings.md#finite-live-settings-evidence).

## chat — Ordinary authored chat/tool/persistence smoke

`npm run smoke:chat -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; finite owned loopback provider and synthetic hiking/HR/terrain data. Nine calls prove real JSON/NDJSON/tool evidence, persistence, continuation and fresh-boot history; inspect two native chat images. `--memory-curation` adds supplied memory/privacy/original-date import mechanics; `--activity-images` instead checks four actual server-rendered image parts; `--extra-data` instead proves five calls of default recovery-context/known-ID overview plus guarded describe/SQL/math over the additional Garmin evidence relations (non-visual). Those variants cannot combine. No real provider/Garmin or semantic-quality proof. [Current chat/variant contracts](smoke/features.md#finite-authored-ordinary-chat-proof).

## tables — Ordinary authored Markdown table layout

`npm run smoke:tables -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; synthetic plan/review/chat tables and Profile. Twelve wide/narrow/scroll-edge native captures plus contained/visible-header assertions. No personal input or provider. Exact canonical masks refuse unexpected cells; inspect actual images, not just booleans. [Table contract](smoke/features.md#finite-synthetic-markdown-table-scenario).

## terrain — Ordinary authored activity Terrain presentation

`npm run smoke:terrain -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; three fictional hikes/1,227 normalized points, no GPS/private/service. Real analyzer/UI, twelve wide/medium/narrow captures for supported/partial/capped grid and scrolling. Exact finite values/masks; not visible chart-highlight or real-service proof. [Terrain](smoke/features.md#finite-authored-terrain-presentation).

## activity-labels — Ordinary authored activity list/detail labels

`npm run smoke:activity-labels -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; three fictional strength/gravel/hiking summaries. Exact list/detail selection and wide/narrow captures, no arbitrary IDs/selectors or personal input. Inspect labels/containment; preserve originals and owned settlement. [Labels](smoke/features.md#finite-authored-activity-labels).

## weekly-kpis — Ordinary authored Training Plan/Progress presentation and Refresh

`npm run smoke:weekly-kpis -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; synthetic plans/notes/activities. Actual two-week Refresh and persistence, separate fixed score/gap/period/layout proof. `--automatic-points` selects declared-rule evidence; `--refresh-only` selects the documented smaller release-risk scope, not full presentation. Inspect selected captures and omitted coverage. No provider/primary migration. [KPI contract](smoke/features.md#finite-authored-weekly-kpis-t0319).

## weekly-kpi-chat — Ordinary authored KPI tool/chat wiring

`npm run smoke:weekly-kpi-chat -- --scratch "$scratch" --bundle "$bundle"`

Current ordinary build; exclusive named fake-provider scope and closed 14-call sequence. Tests establishment/adaptation/latest assessment/no-save/correction, rejected latest discovery then one save, automatic points and restart. API/tool/SQLite evidence is textual; KPI screenshots are a separate scenario. No real coach/reasoning claim. [KPI chat details](smoke/features.md#finite-authored-weekly-kpis-t0319).

## quick — CI-minimal debug synthetic Profile; not full regression

`npm run smoke:quick -- --scratch "$scratch"`

One synthetic Profile/Goals save/restart, no images or broad navigation/security/release proof. `--resources-ready` requires exact assembled source/inventory. `--llm-debug` explicitly adds four inspected subtree images and fixed WebView-local native-generated keys, not hardware/global input or active-window focus proof. Does not change routine nightly workload. [Quick/disclosure](smoke/settings.md#ci-only-synthetic-quick-scenario).

## release-audit — Static ordinary audit plus instrumented denial probe

`npm run smoke:release -- --scratch "$scratch" --input-file "$selection"`

After current ordinary build. Inventories actual ordinary bundle, then builds/launches a separate release-denial probe with no control/capture. This is not ordinary-artifact launch; use `ordinary` for that proof. No tag, publication, install, normal singleton or primary restart. Final DMG handoff uses separately selected `--release-record` on supported consumers. [Audit/transport](smoke/ownership.md#production-exclusion-and-required-artifact-evidence).

## windows — Restricted platform-specific installed Windows scenario

`npm run smoke:windows -- --help`

Use the [Windows runbook](windows.md#installed-app-scenario-and-narrow-evidence-exception), not macOS invocation recipes. Explicit manual hosted Windows qualification/install/uninstall has its own scope. Only six authored masked PNGs plus sanitized manifest have the three-day upload exception. No Windows 11, hardware-input, normal onboarding or real-service claim; release export is separate authority.

## composition — Source-backed ordinary synthetic semantic actions

`npm run env -- python3 scripts/desktop/ordinary_composition_example.py --scratch "$scratch" --bundle "$bundle"`

Current ordinary build, same npm/tool context. Example proves Trainer → Sync → Trainer navigation, **not Garmin reads**. Python `Scenario` / `run_scenarios` supports source-attributed assertions and compatible authored configurations without duplicating launch/settlement. No arbitrary loader, private/paid permission or sandbox claim. [Callable contract, dependencies and deadline](smoke/protocol.md#importable-guarded-compositions).

## real-garmin — Retired copied-token runner; no executable real-service recipe

`npm run smoke:history:live -- --help`

Refuses before private input: the product no longer reads token files. Real Personal API evidence needs separately authorized current authority, an operator-entered key and a reviewed finite official-key envelope; none exists yet. Historical `smoke:history --token-input` is also unavailable. [Independent gate](smoke/sync.md#independent-real-service-evidence-gate).

## real-provider — Restricted task-bound paid/private recipes; not reusable approvals

Commands: `smoke:conversation:live`, `smoke:summary:live`, `smoke:memory:live`, `smoke:memory:capacity`, `smoke:rebuild:live`, `smoke:t0284:summary`.

These may privately use the normal native OpenAI slot and spend money; the T0284 helper additionally uses specifically authorized actual-derived history. They are **not generic smoke recommendations**. Consult [restricted contracts](smoke/live.md) for exact T0269/T0270/T0272/T0274/T0276/T0284 authority, current qualified source/pricing, immutable claims and narrowly permitted continuation. Old presets/budgets/receipts and command flags are not new-task consent. Unknown spend is never refunded; no blind retry, private discovery or primary activation.
