# Local validation and smoke checklist

After [tool setup](#local-tool-setup), run `npm ci && CI=true npm run validate`. PR/main Ubuntu `validate:ci` checks formatting, lint/dead code, architecture, both Knip modes, fresh types and Vitest/Python tests; full validate adds Next build. Required hosted checks must **succeed on exact PR head** before merge; pending/skipped/neutral is not success. [Guardrails](project-guardrails.md) owns individual rules.

## Local tool setup

Pin Node 22.23.4, Python 3.12, Rust 1.98.0 and requirements-file Ruff/Vulture. Put Python environment outside checkout (managed disposable scratch), activate before npm:

```bash
python3.12 -m venv '/absolute/outside-checkout/python-quality'
. '/absolute/outside-checkout/python-quality/bin/activate'
python3 -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: --no-deps -r scripts/python-quality-requirements.txt
rustup toolchain install 1.98.0 --profile minimal --component rustfmt --component clippy
export RUSTUP_TOOLCHAIN=1.98.0
export PATH="$(dirname "$(rustup which cargo --toolchain 1.98.0)"):$PATH"
```

Checks never install/rewrite; missing tools fail. Keep actual Cargo/rustc/environment unchanged through build/smoke, not unrelated Homebrew tools. Rustfmt includes Windows; hosted Clippy is post-merge macOS only. Python/JS analysis is not typechecking.

## Windows x64 job

[Windows](windows.md#on-demand-execution) owns manual-only selected-SHA Server 2025 execution/build/tests/installed scenario; PR/push never allocates it. Only [six masked synthetic images plus manifest](windows.md#installed-app-scenario-and-narrow-evidence-exception) get three-day upload; default-off release export is separate. Alpha stays unsupported; Server evidence does not qualify Windows 11/ARM, trusted input/full chrome/default onboarding/real integration/older upgrades/source-CLI migration. [Release](release.md#dual-platform-candidate-and-publication-procedure) owns candidate qualification. Before expensive preparation, the [rendered disclosure preflight](release.md#rendered-disclosure-preflight) checks explicit current Windows notes and baseline/schema context.

### Windows timing and comparison

Actions run/job/step UTC timestamps cover queue, setup, dependencies, contract tests, resource assembly, JS/native tests, full build/NSIS, package/verify, backend, installed scenario and eligible artifact handling. Measure creation-to-complete verdict separately from summed actual job duration; neither is the sum of nested helper spans. Source/run/attempt, image/toolchain and cache/workload differences belong beside every comparison. Include failed attempts, original failures and retries, not just the fastest green runs.

The existing release timing owner additionally observes source snapshots, build context, producer inventory, member listing, extraction, extracted and producer inventory/hashing, installed admission/capture/replacement and final preservation. Windows build/package/verify/installed invocations print safe `timingObservation` JSON in job logs; only fixed stage names, parent, UTC/outcome/error-class and monotonic duration are reported, never private paths/environment/diagnostics. Private records remain local. Failed/interrupted/incomplete and unobserved spans are distinct from successful zero time. No timing is qualification and no timing log is added to an upload allowlist.

A representative bounded comparison freezes an instrumented baseline and a final candidate, repeats the same full workload on each, records operation counts and phase/whole-run/runner-cost variability, and discloses source/environment confounders and unsupported conclusions. A single historical observation is not an average or speed guarantee. Optimization must preserve current-byte verification, source/context, locking, failure refusal and final settlement; repeated calls alone do not prove redundancy.

The [separate manual development feedback path](windows.md#proposed-manual-development-feedback-path-design-only) is a maintained design only, not a fast release mode or implemented workflow. Full installed qualification remains unchanged.

## Change-gated native nightly

Nightly macOS runs 02:17UTC or manual main. Linux metadata gate allocates macOS for first/changed SHA; unchanged skips after an allocated attempt even failed/cancelled/timed-out, or carried successful unchanged decision. Preallocation cancellation is not attempt. Manual cannot force unchanged retry: inspect/repair/new revision. A skip is cost avoidance, not green.

Gate bounds history to 20 runs×20 jobs,10s/1MiB API responses and exact job identities; missing/malformed/denied history fails before allocation. Only gate has Actions-read, all Contents-read. Native checkout must match gate SHA despite main movement. ARM64 macos-15 verifies actual Darwin/arm64.

Full validation/reliability uses one Next build, assembly, locked warnings-denied all-target Clippy/native tests and one synthetic Goals Save/restart. No optimized package/full navigation/parallel/images/release/services/Keychain/dialog proof. Reproduce on dedicated ARM64 worktree, same inputs:

```bash
npm ci
CI=true npm run validate
npm run eval:reliability
npm run desktop:assemble
npm run lint:rust
rustup run 1.98.0 npm run desktop:test:native
rustup run 1.98.0 npm run smoke:quick -- --scratch '/absolute/canonical/private-task-scratch' --resources-ready
```

Assembler-only follows same-input successful build. Resources-ready verifies fingerprint/all hashes or refuses, never silently rebuilds; other commands retain full meaning. Superseded PR/ref runs cancel; nightly serializes without cancelling allocated work. Actions are pinned/installs locked. Only nightly/Windows npm tarball caches by lockfile, no Validate cache or cached node_modules/app/build/SQLite. [Owned disposition](smoke/ownership.md#preparation-reuse-and-owned-disposal) follows settlement/evidence; macOS images remain local. Record actual stages, not inferred later success.

### Deterministic checks and diagnostics

Use focused affected tests early; load-sensitive failures need affected file then normal-concurrency Vitest, not dropped assertions or enlarged timeouts. Trainer changes include real locked-SDK serialized wire checks for batching/prefix/counter presence, prior-visible preload/save/freshness regressions and long-turn trace storage/reload pressure. Native authored round/time comparisons remain distinct from separately authorized live subscription latency/cache/answer-quality proof. Real CLI refusal/DOM/byte-preservation tests remain meaningful boundaries.

```bash
npm run doctor -- --json
npm run db:status -- --json
npm run format
npm run format:rust
npm run format:python
npm run lint:python
npm run deadcode:python
npm run lint
npm run architecture
npm run knip
npm run typecheck
npm run test
npm run eval:reliability
npm run deps:evidence -- --output ./tmp/dependency-evidence.json
npm run build
```

Doctor/status/dependency reports need review before sharing. They prove local configuration/version/schema, not remote readiness; doctor reads no Garmin key/calls no service. Exclude credentials/provider URLs/prompts/GPS/raw data/vectors/env values.

## Individual snow split validation

```bash
npx vitest run tests/snow-splits.test.ts tests/snow-split-storage.test.ts tests/snow-backfill.test.ts tests/official-extra-sync.test.ts tests/garmin-extra-backfill-cli.test.ts
```

Add split-heart-rate/stored-split-heart-rate, activity-supplement and adjacent SQL/KPI/local-data/instruction tests for derived-HR or UI changes. [Field contract](garmin-extra-data.md) owns units/clock/support/coverage/backfill rules; tests own numeric edge fixtures, not a duplicate prose test inventory.

Run full ordinary plus [Snow runs](smoke/features.md#finite-authored-snow-runs), synthetic Sync and chat --extra-data. Compact capture selection may omit images, never actions/assertions; disclose omitted proof. Primary history still requires [full-range rehearsal/explicit go](garmin-extra-data.md#explicit-history-backfill).

## macOS desktop validation

[Desktop](desktop.md#validation-and-recovery) owns full commands and required actual setup/lifecycle/state proof. Native tests require assembled resources. Use unsigned current ARM64 bundle outside checkout on disposable populated state, not browser/dev-server readiness. Inspect required images; real integration unavailable remains explicit.

For changed DMG assembly/payload behavior, follow [release](release.md): cheap packaging/metadata/mock tests, ordinary build, mounted final-payload verification and ordinary --release-record smoke. Retain producer lock/identity through every boot. Release CLI/admission diagnostics and runbook-only changes that preserve assembly and launch behavior use executable non-publishing CLI/identity/payload/fake-provider contracts; they do not require launching an app or cutting a release. A routine version/notes-only cut follows the [release run card](release.md#release-cut-runbook), not repeated development QA over the prior-release range. Debug/probe is not ordinary payload proof; foundation grants no real tag/draft/upload/install.

[Smoke ownership](smoke/ownership.md) owns identity/reuse, full versus reviewed feature scope, independent pre-execution image selection, noninterference/preservation/settlement/disposal. Full/two-instance behavioral coverage does not require unrelated baseline PNGs; inspect selected changed-state originals, or justify Screenshot N/A with actual nonvisual assertions. [Catalog](smoke-commands.md) gives commands; [scenario references](dev-bridge.md#detailed-reference) give actual assertions/captures. Synthetic inputs need no personal consent; private/service inputs need exact current authority. Python smoke:test is contracts, not full execution; quick/nightly is intentionally narrow. Missing safe capability follows [before-use extension](smoke/protocol.md#task-needed-bridge-and-runner-extensions), never bypass or automatic ticket. Trusted dialogs/input need arranged operator window.

Markdown-table UI changes may deliberately use the [tables gallery](smoke/features.md#finite-synthetic-markdown-table-scenario); its twelve images are a recipe, not every task's image requirement. Documentation-only changes need formatting, links/commands and pinned consumers—not app screenshots merely because docs mention smoke.

### ChatGPT subscription proof boundaries

ChatGPT OAuth/transport/composition/settings tests plus native storage/broker/epoch/cancel tests cover authored mechanics. Returning authorization must reuse selected issued client **before** callback; known pending client retries versus unknown remote refusal remain distinct. No test borrows normal credentials. [Fictional Settings](smoke/settings.md#finite-chatgpt-settings-presentation) gives nine inspected images, not OAuth/inference. Shared lifetime changes need full ordinary plus affected chat/eligibility/summary. [Real service](chatgpt.md#verification-boundary) needs separate account/usage/data/window authority.

<a id="official-personal-api-reader-dormant"></a>

## Official Personal API reader

Official client/FIT/coverage/reader/mixed-provenance and composed-Sync tests cover wire/archive/normalization/SQLite with authored fixtures. [Synthetic Sync](synthetic-sync-smoke.md) exercises actual native official path. Neither proves account/device/rate-limit/terms behavior or uses a real key. Never use personal recordings as public FIT fixtures.

## Generated Next.js declarations

next-env.d.ts/.next are ignored framework output, never hand-edited/committed. Fresh npm ci then typecheck/validate runs next typegen before tsc; failure stops. Builds/assembly regenerate too. No browser server or restored tracked declarations needed.

## Task process guardrails

[Developer process](developer-process.md) owns same-task data reconciliation/cleanup/deferral. Live checks require separately authorized services/secrets and disposable populated state, not primary mutation authority:

1. Native chat/Profile loads without app sign-in; doctor flags non-loopback exposure.
2. Native [Garmin setup](garmin-auth.md), Save/reopen/explicit Verify, no secret/raw-error exposure or old connector mutation.
3. Finite approved live Sync, cancel/settle/restart/explicit Continue and passive no-replay/scope/finality/preservation. Product maxima are not test authority; no checkpoint reset/exhaustive backfill. Retired token runners refuse.
4. Targeted imported detail: normalized coverage or supported failure, archive redacted/in-memory FIT, interruption/repeat idempotence.
5. Exact configured provider on no-tool coaching/grounded SQL+same-turn math/reference/gaps with transparent criteria. Optional loopback Ollama is independently prepared; record bounded statuses/timing/redacted evidence, not hidden app rubric or model-only arithmetic.
6. Restart persistence/Profile edits and separately authorized chat/Profile, memory and Garmin deletion on copies under distinct [scopes](source-beta-readiness.md#local-data-lifecycle).

Deterministic tests remain usable without credentials but are not service proof. Validation grants no release/deploy or primary/unrelated-process control.
