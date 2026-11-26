# Smoke command catalog

Use `npm run smoke:help -- list`, `search <literal terms...>` or `show <id>`. Discovery reads this file; it never prepares/builds/launches or selects coverage/authority. Runner `--help` owns flags.

Read the [playbook](dev-bridge.md) once for setup, impact selection, image inspection and settlement. Below, `$scratch` is the canonical allocator-returned task root, `$bundle` the current physical ordinary ARM64 bundle, and `$selection` an authored database-only selection. Run plain npm from the physical task checkout, in the same build/run environment. Ordinary scenarios require `npm run desktop:build`; debug runners build/verify their own resources. Private input needs separate exact authority. All synthetic/debug results exclude real-service, primary-app and trusted-input proof unless explicitly stated. Linked scenario owners define assertions and captures; catalog summaries do not replace them.

## prepare — Authored input preparation; no launch

`npm run smoke:prepare -- --scratch "$scratch"`

After `npm ci`, exclusively prepares synthetic SQLite/provenance. Use the stdout record containing `prepared`, then `<prepared>/selection.json`; disposition is separate. Pass the task root, not a category child. Outputs survive immediate exit, not scheduled expiry. No runtime proof. [Inputs](smoke-inputs.md).

## snow-runs — Ordinary authored individual snow run table and coverage

`npm run env -- python3 scripts/desktop/snow_runs_smoke.py --scratch "$scratch" --bundle "$bundle"`

Full two-instance baseline plus snow captures prove populated/preserved tables, unsupported/unknown coverage and honest clock/zone/window limits through real SQLite/HTTP/UI. [Snow scenario and exact masks](smoke/features.md#finite-authored-snow-runs).

## ordinary — Full ordinary synthetic native regression

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle"`

Two isolated nonactivating copies exercise navigation, Goals save/restart, security and responsive geometry. Shared/native/mask or uncertain changes require full plus affected features. `--prepare-only` launches nothing and is not a pass. [Coverage and ownership](smoke/ownership.md#ordinary-artifact-isolated-scenario).

## synthetic-sync — Ordinary authored Sync/import/cancel/discovery/finality

`npm run smoke:history -- --scratch "$scratch" --input-file "$selection" --bundle "$bundle" --synthetic-sync`

Follow the [build/run card](synthetic-sync-smoke.md). Twelve operations use the official reader against an authored loopback Personal API, including old-connection upgrade; stopped 6/14 seeding proves presentation only. No private key, Garmin or provider. macOS `--no-external-tools` denies Python/uv/uvx. Existing-data setup, not blank onboarding. [Scenario](smoke/sync.md#current-finite-synthetic-sync-scenario).

## history-setup — Ordinary keyless fresh/existing onboarding and history limits

`npm run smoke:history -- --scratch "$scratch" --input-file "$selection" --bundle "$bundle"`

Blank Create and populated Use existing, Finish, saved launch and optional limit Save/restart; Sync remains keyless idle. `--token-input` and `--continuation-only` are unavailable and refuse before private input access. [Setup contract](smoke/sync.md#bounded-ordinary-history-setup-and-copied-token-sync).

## dependency-guidance — Ordinary authored missing/rejected/rate-limited/healthy connection presentation

`npm run smoke:history -- --scratch "$scratch" --input-file "$selection" --bundle "$bundle" --dependency-guidance`

Four fixture connection states, one Sync each, healthy explicitly cancelled. Verify stop reasons, offline navigation and wide/narrow help. Cannot combine synthetic-sync/private/continuation scopes. [Contract](smoke/sync.md#finite-connection-recovery-evidence).

## composer — Ordinary keyless model choice and draft persistence

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --composer-footer`

Authored catalogs, no send: explicit choice, draft/restart and wide/narrow normal- and short-height captures, not OS popup proof. Full default; reviewed local feature changes may select `--smoke-scope feature --impact local-feature --impact-basis 'reviewed change'`. [Composer](smoke/ordinary.md#opt-in-composer-footer-evidence).

## eligibility — Ordinary mixed and empty keyless model catalogs

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --model-eligibility`

Implies composer. Both mixed and all-ineligible catalogs remain required in feature scope: unavailable intent, no fallback, replacement/restart and six captures. [Eligibility](smoke/ordinary.md#missing-key-eligibility-evidence).

## conversations — Ordinary authored create/rename/select/delete lifecycle

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --conversation-selection`

Default preparation verifies an empty-chat variant, never clears borrowed input. Only two fixed run-attributed chats are created/deleted. Synthetic confirmation is not native-dialog proof. Full default; reviewed local feature scope available. [Conversation contract](smoke/ordinary.md#opt-in-conversation-selection-evidence).

## summary-lifecycle — Ordinary keyless Memory storage/recovery/controls

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --summary-engine --summary-part lifecycle`

Missing-key scheduling, diagnostic disclosure/Retry, manual edits, Clear/Off and restart; no real generation. Reviewed lifecycle scope may omit unrelated groups, never admission/settlement. Cannot combine composer/conversation. [Lifecycle](smoke/ordinary.md#keyless-summary-producer-lifecycle).

## summary-presentation — Ordinary fixed Memory/Densify/history presentation

`npm run smoke:ordinary -- --scratch "$scratch" --bundle "$bundle" --summary-engine --summary-part presentation --summary-family densify`

Repeat `densify`, `overview` or `history`; omission selects all. Fixed renderer adapter proves hooks/geometry, not inference, actual acceptance persistence or engine progress. Only exact fixture actions may mutate. [Presentation and scope](smoke/ordinary.md#manual-densify-presentation-evidence).

## summary-native-copy — Opt-in real native responder; replaces system clipboard

Add `--summary-native-copy` to lifecycle, never presentation-only. Explicit selection replaces the system clipboard with authored text using owned WKWebView `selectAll:`/`copy:`; never reads/restores previous contents or uses global input. Full two-instance plus affected Memory proof applies. Not hardware shortcuts/default menu proof. [Effect and refusals](smoke/ordinary.md#integrated-keyless-memory-controls).

## summary-settings — Ordinary keyless Memory catalog/history-limit Save/restart

`npm run smoke:summary:settings -- --scratch "$scratch" --bundle "$bundle"`

Fresh authored copy: legacy binding/Cancel/Save, independent summary identity, On/Off restart and required/cleared dates while preserving legacy fields. No keys/backlog/provider calls. [Settings states](smoke/settings.md#keyless-ordinary-summary-settings-round-trip).

## native — Debug synthetic navigation/Profile/Goals regression

`npm run smoke:native -- --scratch "$scratch"`

Two debug copies, hydrated navigation and Goals save/restart with sanitized Profile-subtree images. Optional private input requires exact grant/provenance. Debug HOME isolation is not ordinary routing or full-window proof. [Debug baseline](smoke/settings.md#run-the-representative-scenario).

## health — Debug synthetic Daily/Weekly/Monthly Health comparison

Add `--health-comparison` to `smoke:native`. Authored missing/partial/zero dates; authorized private input needs eligible coverage. Historical gap seeding is allowed only on new owned copies and recorded separately. Only authored Calories/Sleep stages have finite unmasking. [Health contract](smoke/settings.md#finite-daily-health-comparison-scenario).

## settings — Debug keyless Settings/catalog/provider-field presentation

`npm run smoke:settings -- --scratch "$scratch" --input-file "$selection"`

Debug resources build unless verified `--resources-ready`. `--provider-fields`, `--chatgpt-presentation` and `--dependency-guidance` use fake keys/registration/help only. No real login/MFA/adoption/picker/Finish or ordinary Settings authority. [Variants](smoke/settings.md#closed-keyless-native-settings-smoke).

## live-settings — Debug synthetic live apply; owned fake loopback service

Add `--live-settings` to `smoke:settings`. Exclusive owned `127.0.0.1:11435` fixture or refusal; fake catalog/keys, live acknowledgment, restart modal and old/new stream settings. May stop only its owned backend, not a PID or normal app. Not provider readiness. [Contract](smoke/settings.md#finite-live-settings-evidence).

## chat — Ordinary authored chat/tool/persistence smoke

`npm run smoke:chat -- --scratch "$scratch" --bundle "$bundle"`

Owned loopback provider proves JSON/NDJSON, tools, persistence and fresh-boot history. Mutually exclusive variants: `--memory-curation` for privacy/import mechanics; `--activity-images` for four rendered panels; `--extra-data` for nonvisual recovery/known-ID/SQL/math evidence. No semantic-quality claim. [Chat scenarios](smoke/features.md#finite-authored-ordinary-chat-proof).

## tables — Ordinary authored Markdown table layout

`npm run smoke:tables -- --scratch "$scratch" --bundle "$bundle"`

Synthetic plan/review/chat tables and Profile; twelve wide/narrow/scroll-edge captures and containment/header assertions. Masks refuse unexpected cells. [Table contract](smoke/features.md#finite-synthetic-markdown-table-scenario).

## terrain — Ordinary authored activity Terrain presentation

`npm run smoke:terrain -- --scratch "$scratch" --bundle "$bundle"`

Three fictional hikes: real analyzer/UI with supported/partial/capped grids and scrolling. No GPS/private service or visible chart-highlight proof. [Terrain](smoke/features.md#finite-authored-terrain-presentation).

## activity-labels — Ordinary authored activity list/detail labels

`npm run smoke:activity-labels -- --scratch "$scratch" --bundle "$bundle"`

Three fictional strength/gravel/hiking summaries with exact selection and wide/narrow labels/containment. No arbitrary IDs/selectors. [Labels](smoke/features.md#finite-authored-activity-labels).

## weekly-kpis — Ordinary authored Training Plan/Progress presentation and Refresh

`npm run smoke:weekly-kpis -- --scratch "$scratch" --bundle "$bundle"`

Actual two-week Refresh/persistence plus fixed score/gap/layout proof. `--automatic-points` adds declared-rule evidence; `--refresh-only` is a smaller release-risk scope, not full presentation. [KPI contract](smoke/features.md#finite-authored-weekly-kpis).

## weekly-kpi-chat — Ordinary authored KPI tool/chat wiring

`npm run smoke:weekly-kpi-chat -- --scratch "$scratch" --bundle "$bundle"`

Exclusive fake provider and closed 16-call sequence: preload-backed establishment/assessment/correction, adaptation with canonical recovery, no-save, read-only unavailable-version/empty-week evidence, automatic points and restart, plus one separate preloaded General Plan concurrent-edit rejection. Textual tool/SQLite evidence, not KPI screenshots or real reasoning. [KPI chat](smoke/features.md#finite-authored-weekly-kpis).

## quick — CI-minimal debug synthetic Profile; not full regression

`npm run smoke:quick -- --scratch "$scratch"`

One Profile/Goals save/restart, no images or broad regression. Verified `--resources-ready` requires exact source/inventory. `--llm-debug` adds four inspected subtree images and WebView-local generated keys, not hardware/global-input/focus proof. Nightly workload unchanged. [Quick](smoke/settings.md#ci-only-synthetic-quick-scenario).

## release-audit — Static ordinary audit plus instrumented denial probe

`npm run smoke:release -- --scratch "$scratch" --input-file "$selection"`

After ordinary build: inventories that bundle, launches a separate denial probe without control/capture. Not ordinary-artifact launch, tag/publication/install or primary restart. DMG handoff separately selects `--release-record` on supported consumers. [Audit](smoke/ownership.md#production-exclusion-and-required-artifact-evidence).

## windows — Restricted platform-specific installed Windows scenario

`npm run smoke:windows -- --help`

Follow the [Windows runbook](windows.md#installed-app-scenario-and-narrow-evidence-exception), not macOS recipes. Explicit hosted qualification/install/uninstall; only six authored masked PNGs and sanitized manifest have the three-day upload exception. No Windows 11, hardware-input, normal onboarding or real-service claim. Release export is separate authority.

## composition — Source-backed ordinary synthetic semantic actions

`npm run env -- python3 scripts/desktop/ordinary_composition_example.py --scratch "$scratch" --bundle "$bundle"`

Trainer → Sync → Trainer navigation, not Garmin reads. `Scenario` / `run_scenarios` shares launch/settlement for source-attributed assertions and compatible authored configuration; no arbitrary loader, private/paid permission or sandbox claim. [Callable contract](smoke/protocol.md#importable-guarded-compositions).

## real-garmin — Retired copied-token runner; no executable real-service recipe

`npm run smoke:history:live -- --help`

Refuses before private input; token files are retired. Real Personal API evidence needs separate current authority, an operator-entered key and a reviewed finite official-key envelope; none exists yet. [Independent gate](smoke/sync.md#independent-real-service-evidence-gate).

## real-provider — Restricted task-bound paid/private recipes; not reusable approvals

Commands: `smoke:conversation:live`, `smoke:summary:live`, `smoke:memory:live`, `smoke:memory:capacity`, `smoke:rebuild:live`, `smoke:t0284:summary`.

These can read the normal OpenAI slot and spend money; actual-history helpers also use authorized private history. Prior completed-task approvals, presets/budgets/receipts and flags are not new-task consent. Obtain explicit task-scoped spend/private approval and requalify source/pricing first. Unknown spend is not refunded; no blind retry, private discovery or primary activation.
