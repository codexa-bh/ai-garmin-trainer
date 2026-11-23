# Smoke protocol and runner extension contracts

[Playbook](../dev-bridge.md) · [Commands](../smoke-commands.md) · [Shared ownership/build/evidence](ownership.md)

## Importable guarded compositions

A source-backed Python `def scenario(run)` composes existing ordinary `run.command`/bounded read-only `run.wait`, without central flags or copied lifecycle code. Runnable example:

```bash
npm run env -- python3 scripts/desktop/ordinary_composition_example.py \
  --scratch <canonical-task-root> --bundle <canonical-physical-ordinary-app>
```

It asserts **Trainer → Sync → Trainer, not Garmin reads**. Run from physical source under `npm run env --` to preserve the `desktop:build` tool environment. For imported consumers insert resolved `scripts/desktop` into `sys.path` inside Python; adding `PYTHONPATH` or using a different PATH changes build-context identity and correctly refuses reuse. `composer_scenario()` and `densify_scenario()` in `ordinary_smoke` are existing migrated consumers of `run_scenarios(scratch=…, bundle=…, scenarios=(…), impact=…, impact_basis=…)`.

### Declaration and execution contract

- `Scenario(label, scenario, configuration, expected, evidence, dependencies=())`: unique lowercase letter/digit/hyphen/underscore label, never broad/full label; nonempty tuple of actual assertion descriptions, not transport successes; evidence describes images/limits or justified no-image. Configuration is exactly `keyless|composer|summary`, compatible across the invocation. Authors own assertions/reviewed impact, not lifecycle. No implicit fixture/private/paid authority, script loader or native permission; callables cannot certify their own impact/full coverage.
- Owner configures resources once, prepares existing synthetic input, holds ordinary verification, enrolls partial runs, starts observer, owns launches/restarts/final settlement/receipts. Every boot retains source/context/fixture admission, original preservation, noninterference and shutdown. Security/Goals/navigation/capture/parent-death **exercises** are selectable coverage, not optional infrastructure. Shared/unknown impact requires `full=True` plus affected compositions. CLI defaults full simultaneous regression; existing flags/imports/subclasses and stricter paid/private contracts remain.
- Composer reuses assertions with genuine restart, exact choice/fresh origin/boot/stale-capability refusal; full CLI keeps Goals/Profile restart. Densify reuses summary preparation, independent wide/closed-sheet family entry, fixed fixtures, reset to actual inspection and failure-preserving close. It proves fixed presentation, not inference or acceptance persistence; lifecycle is separate.
- `run_scenarios` is synchronous, main-thread POSIX. Default whole invocation **600 seconds**, explicit `timeout` **>0 through 1800**. Owns SIGTERM/timer, refuses competing timers, restores handlers/umask. No nesting or concurrent source/dependency/cache mutation. Assertion/unknown timeout/cancel unwinds once with no mutation retries; later scenarios remain not-run. Shutdown/observer/input/finalization errors preserve original failure plus secondary attribution.
- `assertionsPassed` covers selected assertions only; `scenarioPassed` requires preservation/settlement. Receipt-write failure fails invocation; existing archive/disposition owner can independently fail. `prepare_only=True` launches zero, no pass; borrowed/standalone/prepare-only retention/expiry promises stay unchanged.
- Declarations bind current source bytes/origin/inode/mode, expected assertions and explicit external helper/data dependencies. Loaded function code must equal fresh compilation; opaque closures/defaults/lambdas refuse. Repository dependencies still bind through source/context. Recheck before allocation, every boot/scenario and finalization; changed/unavailable/aliased/hardlinked source refuses. Reproducibility, **not a Python sandbox**. Classifier unchanged: new example/summary files need current ordinary build; moving code does not make it external-only.
- Receipts bind source/assertions, per-run/not-run groups, selected/omitted proof, starts/restarts and capture boot/state. Inspect/register each relied-on original image separately; navigation can use actual textual-state assertions without screenshots. Evidence is keyless synthetic DOM/isolated native, not trusted input/service/normal singleton/installed/default-window proof.

## Narrow protocol and result semantics

Owners: `src-tauri/src/dev_bridge.rs` (closed transport/results for separately admitted debug/ordinary), `isolated_run.rs` (ordinary admission), legacy `smoke_config.rs` (debug/probe HOME/keyless policy only). Native-installed `src-tauri/debug/smoke.js` stays outside packaged UI resources. Ordinary contains supported controller code but default launch never installs/manages/grants it; enabling env alone cannot activate control.

### Transport and privacy

- Authenticated `GET /identity`: schema/run/source/native PID/app/copy/origin and fixed diagnostic booleans, **not readiness**.
- `POST /command`: `{requestId,expectedRunId,command}`, UUID identities, exact `Host: 127.0.0.1:<port>`, bearer and `X-Smoke-Run`. Ordinary also requires exact `expectedBoot`, bound into callbacks. Capability stays private config/client memory/header, never argv/URL/logs/receipts. Reject every browser Origin/Sec-Fetch-Site; no CORS.
- Only admitted trainer origin/window receives result-only permission (`allow-isolated-result` ordinary; legacy debug grant debug-only), no remote Settings/auth permission. Callback binds run/boot/window/origin/bound/exact pending request; native validates closed keys/enums/booleans/action correspondence, never arbitrary JSON/text. Ordinary Goals must equal run sentinel. Capture selector/geometry/path cannot be caller-supplied. Debug Settings uses separately typed bounded native completion, no trainer result permission.
- One request at a time; **16 KiB** request, **2-second total read**, no duplicate/chunked framing, **4096** unique IDs/run; **5-second** renderer deadline, **16 KiB** result; PNG **4 seconds / 4 MiB**. Unknown fields/commands refuse. Late/duplicate/unknown callbacks cannot complete newer requests.
- Snapshot requests screen updates to flush masks/navigation/resize rather than cached prior view. Retain bounded compositor delay for background throttling; never require foreground activation. Validate complete PNG framing/dimensions; atomically publish exclusive `0600` temp into run `screenshots/`, never replace existing capture.
- Correlated `{requestId,result:{ok:true,…}}` means renderer completion. HTTP **409** action/assertion failure, **400** malformed command, **403** access/framing, **504** deadline. **Timeout = unknown effect, not rollback**; nonzero client, no blind mutation retry. Only bounded read-only readiness/observe polling; inspect retained state before fresh explicit action.

### Closed semantic surfaces

**Surface → Scope and result boundary**

- **Shared:** `observe`; exact main/back/Profile-close/save/reload clicks; **synthetic Goals only** input/assert. Hidden/disabled/ambiguous/private/prehydration targets refuse before dispatch.
- **Ordinary:** Fixed viewport/capture presets, finite tables and opt-in composer/conversation/summary/authored feature actions documented in their references; composer capture requires canonical synthetic state. Boolean-only `sync` only in explicit history scope. Native-local `historySettings` requires that scope, never trainer callback.
- **Debug only:** Profile `capture`, finite Health actions, synthetic `captureDebug`, outer **LLM debug traces**/**First LLM trace** clicks, fixed **Enter/Space** `debugKey`. `settings` dispatch uses exact admitted legacy Config and local-document completion. Debug Settings/Health/disclosure/native-input/setup modules compile out of ordinary; native/renderer ordinary guards reject them.

No arbitrary selector/path/key/credential/login, general scroll/select/eval/invoke, state injection, HTTP/filesystem/process proxy or shutdown. Supported fixed authored adapters are only their exact documented scopes.

Ordinary observations contain fixed view/navigation/headings/readiness/saved booleans. Debug adds fixed Health mode/readiness/navigation/missing/partial booleans, optional disclosure booleans and **three same-length boolean arrays ≤128 entries**. Unknown keys/text, inconsistent shapes/bounds or mismatched results refuse natively. Remembered Health dates stay in debug bootstrap. No copied values/transcripts/trace text/credentials leave renderer. Clicks/Goals/Health are synthetic DOM; optional debug keys are WebView-local native-generated events, never hardware/global. Ordinary uses neither debug keys nor debug Health/Settings.

## Task-needed bridge and runner extensions

Safe bounded extensions are **expected within authorized implementation/validation**. A missing supported command/input alone does not require another ticket/operator stop or permanent Settings/Sync/token ban. Today's allowlist is not a feature ceiling. This grants no Start/credentials/other-task ownership; explicit exclusions/safety/human gates remain. Resolve material scope/behavior ambiguity rather than broadening the controller.

### Before-use contract and validation recipe

1. Name changed behavior/missing proof; inspect delivered capabilities and overlapping task/PR ownership. Coordinate smallest nonduplicating change; unpublished work is not delivered.
2. Specify finite semantic actions/private inputs/sanitized bounded results through existing owners, with exact admission/run/boot/window/origin/request, deadlines/cancel/unknown-effect handling. No arbitrary automation, broad discovery or private read-back.
3. Update contract/implementation together; extend allowlist/validators and positive/negative coverage for unknown/extra/private actions, wrong/stale/late/duplicate ownership/results, isolation, mask restoration and shutdown. Rejected action stays unsupported until validated; no ignored refusals, weakened/skipped guards or retry-until-green.
4. **Before evidence use**, run native/controller/DOM/runner contracts, then sufficient affected aggregate/macOS build/artifact/changed-path smoke. Worktree-isolated build state/exact identity; risk-appropriate coverage, no new recurring heavy CI/fixture environment.
5. Use only isolated owned noninterfering disposable state: WAL-consistent populated backups, authored synthetic keys/fixtures, least-privilege native provider routing; preserve DB/settings/provider/key/token originals with bounded integrity/count/provenance. Never target operator singleton/process/focus/pointer/global input, replace HOME to evade admission, expose credentials/raw DOM/transcripts/payloads, automate Garmin key creation, bypass permissions or leak debug control into normal production.
6. Retain exact source/artifact/scenario/results, original failures, inspected sanitized images/limits; verify live handles/endpoints/leases settle. Capture evidence before attributed cleanup/expiry. Required ordinary/integration proof remains; name unavailable proof and strongest safe alternative without claiming equivalence, using normal task disposition.

### Planning examples, not newly implemented commands

- **Settings:** reuse keyless debug Connect/later/cancel/Save. Extend only missing finite action/boolean intent through native Settings with mode-specific denial/Save-next-launch tests. No arbitrary values/adoption/pickers/first-run Finish; ordinary baseline excludes debug Settings. Private authority, OS permission or ambiguous behavior is a genuine gate; subtree/synthetic proof is not trusted input/ordinary wizard.
- **Sync:** finite start/cancel/continue through existing owners, bounded status/checkpoints; cover deadlines, partial commits, cancellation/completion, restart/idempotence, no duplicate/unknown-effect retry. Navigation is not execution. Real coverage needs the separately authorized [official-key envelope](sync.md#independent-real-service-evidence-gate); retired copied-token routes refuse. Unavailable auth/network/ambiguous routing constrains integration, not deterministic development.
- **Real-key integration:** a separately authorized official-key envelope with an operator-entered key, required bounded read-only official requests, no key/token text in commands/results/logs, original fingerprints and actual native API/normalization outcomes. Not key acquisition, discovery or reuse of another task's key; refused credentials/ownership cannot be bypassed.

### Keep evidence classes distinct

Debug/instrumented and native-generated local keys prove only their scopes, not hardware input. Static audit/instrumented release denial is not ordinary launch. Actual unmodified outside-checkout ordinary evidence binds build/mode; isolated success/open PRs imply no default-singleton/focus/settings capability. Inspect masked/subtree PNGs and state hidden/repositioned limits. Real Garmin/provider evidence records authorized service and original preservation separately; retired copied-token routes provide no current executable proof. Unavailable login/MFA/default-window/integration remains unavailable unless relevant equivalence and limits are demonstrated.
