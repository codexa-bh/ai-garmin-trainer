# Smoke protocol and runner extension contracts

[Playbook](../dev-bridge.md) · [Commands](../smoke-commands.md) · [Shared ownership](ownership.md)

## Importable guarded compositions

Compose existing ordinary commands/read-only waits with source-backed `def scenario(run)`, not copied lifecycle code:

```bash
npm run env -- python3 scripts/desktop/ordinary_composition_example.py \
  --scratch <canonical-task-root> --bundle <canonical-physical-ordinary-app>
```

This example asserts Trainer → Sync → Trainer, **not Garmin reads**. Run from physical source under `npm run env --` to preserve build environment. Imported consumers resolve `scripts/desktop` inside Python; changing PYTHONPATH/PATH changes build identity and may refuse reuse.

### Declaration and execution contract

`Scenario(label, scenario, configuration, expected, evidence, dependencies=())` declares unique lowercase alphanumeric/hyphen/underscore identity, actual assertions, evidence/limits and explicit helpers/data. Configuration is exactly keyless/composer/summary and must be compatible across the invocation. No callable certifies its own impact, grants private/paid access or adds native permissions.

`run_scenarios` owns preparation, lock/admission, observer, partial runs, launches/restarts, preservation, receipts and settlement. Shared/unknown impact needs full regression plus affected compositions; default CLI remains full. Selected exercises may vary, never ownership safeguards. Composer uses actual restart; Densify fixtures reset to actual inspection and do not prove persistence.

Execution is synchronous, main-thread POSIX: default 600 seconds, explicit timeout >0 through 1800. No nested run, competing timer or concurrent source/dependency/cache mutation. Owner handles SIGTERM/timer and restores handlers/umask. Unknown effect, cancellation or assertion failure unwinds once without mutation retry; later scenarios are not-run. Secondary shutdown/archive failures preserve original failure attribution. Assertions alone are not scenario success; receipt/preservation/settlement must succeed. Prepare-only launches zero.

Source declarations bind bytes/origin/inode/mode and fresh-compiled function identity; opaque closures/defaults/lambdas refuse. Recheck before allocation, each boot/scenario and finalization; changed/aliased/hardlinked sources refuse. This is reproducibility, not a Python sandbox. New helpers still affect builds under the [classifier](ownership.md#ordinary-build-identity-and-current-driver-reuse). Receipts bind assertions/selected-omitted scope/boots/captures; inspect each relied-on original image. Textual navigation assertions may justify no screenshot.

## Narrow protocol and result semantics

`dev_bridge.rs` owns closed transport/results; `isolated_run.rs` ordinary admission; legacy `smoke_config.rs` debug/probe isolation. Native installs `debug/smoke.js` only for admitted runs, not packaged UI/default launch. Environment alone cannot enable control.

### Transport and privacy

- Authenticated `GET /identity` returns fixed run/source/native/copy/origin/diagnostic identity, **not readiness**.
- `POST /command` carries UUID request/run IDs and finite command, exact loopback Host, bearer and `X-Smoke-Run`; ordinary adds exact boot. Reject browser Origin/Sec-Fetch-Site; no CORS. Capability never enters URLs/argv/logs/receipts.
- Result-only permission is restricted to admitted trainer window/origin; Settings/auth gains none. Native binds run/boot/window/origin/pending request and validates closed keys/enums/booleans/action correspondence. No arbitrary JSON/text, selectors, geometry or capture paths. Debug Settings uses a separate native completion.
- One request at a time; request/result max 16KiB, total read 2s, no duplicate/chunked framing,4096 IDs/run, renderer deadline 5s; PNG 4s/4MiB. Late/duplicate/unknown callbacks cannot settle newer requests.
- Capture requests fresh screen updates with bounded background compositor delay, never activation. Validate PNG framing/dimensions and publish exclusive 0600 files atomically under run screenshots, never overwrite.
- Correlated `ok:true` means renderer completion. HTTP 409 is action/assertion failure,400 malformed command,403 access/framing,504 deadline. **Timeout means unknown effect, not rollback**: no blind mutation retry. Only bounded readonly observation may poll before a fresh explicit action.

### Closed semantic surfaces

For operator-authorized macOS naming inspection only, an authenticated current ordinary run may send `presentNaming` with no fields. Native changes only that owned process to regular activation and shows/focuses its Trainer window; it returns only `ok`. Default launches and debug runs have no route. Quiet smoke never sends it. The caller must retain original admission, artifact/input preservation and owned settlement, and separately inspect native window/menu captures and the Dock-facing runtime name. This command grants no operator-app, private-data, global-input, install or OS-permission authority.

Shared navigation/Profile controls and Goals operate only on exact visible enabled hydrated targets and run-authored Goals. Ordinary supports documented fixed viewport/capture/feature actions; Sync/historySettings require explicit history scope. Debug alone supports finite Health/disclosure, Enter/Space WebView-local keys and native keyless Settings. Those debug modules compile out of ordinary, whose native/renderer gates reject them.

On macOS, ordinary-only `about` accepts exactly `action: open|observe|capture|close|escape|repository|licence`. It checks the concise About/Settings/Quit menu entries, operates only the admitted local About window and compares rendered metadata with NSBundle plus the artifact's recorded Git provenance, and hrefs with the native fixed destinations. Observation returns closed booleans; capture contains only public About content. Quiet smoke never activates links. The two browser actions require the operator-authorized `presentNaming` route to have made that instance a Regular AppKit application; Accessory/unknown policy refuses them. Explicit human link activation in the local About window remains available. Existing run/boot/request admission, duplicate refusal and five-second unknown-effect deadline apply; renderer callbacks cannot settle these native-local results. Close/Escape use local DOM actions, not trusted keyboard input or OS menu clicks. Run full baseline plus the finite scenario with `npm run env -- python3 scripts/desktop/about_smoke.py --scratch <canonical-task-root> --bundle <canonical-ordinary-app>`. Inspect its About PNG; presented/browser evidence remains separate from quiet smoke.

On macOS, ordinary-only `windowGeometry` accepts exactly `action: observe|arrange`. Observe returns native outer frame/work area/display ID in AppKit logical points; Arrange sets one fixed 900×650 outer frame at a bounded work-area offset, without activation or global input. Results originate on the native main thread, never renderer callbacks. Existing request/boot/run/window admission and five-second unknown-effect deadline apply. Trainer-only `captureView` preset `native` uses the existing privacy mask at the current bounded viewport without resizing. Fixed presentation viewport overrides suspend geometry persistence for that boot; Arrange explicitly resumes normal tracking.

Run the finite geometry composition with the required shared-native full baseline from the physical checkout:

```bash
npm run env -- python3 scripts/desktop/geometry_smoke.py --scratch <canonical-task-root> --bundle <canonical-ordinary-app> --full
```

It checks initial usable outer height, native move/resize and settled quit/fresh-boot restoration, then fixed narrow viewport isolation across another boot. Inspect its initial/restored PNGs alongside native observations. Current attached-display evidence does not prove physical multi-monitor/scaling changes or trusted drag input; native model tests cover unavailable display arrangements.

No arbitrary selector/text/path/key/login, general scrolling/eval/invoke, state injection, proxy or shutdown endpoint. Fixed authored adapters are permitted only in their documented scopes. Ordinary observations are bounded view/readiness/saved booleans; debug may add fixed Health/disclosure booleans and three equal-length boolean arrays ≤128 entries. Unknown fields/text/inconsistent shapes refuse. Dates/private values remain inside renderer; no transcripts/trace text/credentials escape. DOM actions and native-generated WebView keys are not hardware/global input.

## Task-needed bridge and runner extensions

Safe finite extensions are expected within authorized implementation/validation; a missing command alone does not require another ticket or establish a permanent feature ban. Existing task exclusions, private authority and human/safety gates still bind.

### Before-use contract and validation recipe

1. Identify missing proof and current delivered/overlapping ownership; unpublished work is not delivered.
2. Define finite actions/inputs/closed results, exact run/boot/window/origin/request admission, deadlines/cancellation and unknown-effect handling. No broad discovery or private readback.
3. Update implementation/contracts together. Test positive and unknown/extra/private/wrong/stale/late/duplicate cases, isolation, mask restoration and shutdown. Refused actions remain unsupported until validated; never weaken guards or retry until green.
4. Before using evidence, pass affected native/controller/DOM/runner tests, then sufficient current macOS build/artifact/changed-path smoke. Isolate mutable builds; add no recurring heavy fixture environment by default.
5. Use owned noninterfering copies: WAL-consistent backups, authored fixtures and least-privilege native routing. Preserve originals with bounded integrity/provenance. Never target operator singleton/focus/pointer/global input, replace HOME to evade admission, leak private content, automate key acquisition or enable debug in default production.
6. Retain source/artifact/results, original failures and inspected images/limits; settle live handles/endpoints/leases before attributed cleanup. State unavailable ordinary/integration proof honestly; alternatives are not automatic equivalents.

### Planning examples, not newly implemented commands

- Settings: extend finite native actions with mode-specific denial and Save-next-launch tests, not arbitrary fields/adoption/pickers/Finish. Debug subtree evidence is not ordinary wizard/trusted input.
- Sync: finite start/cancel/continue with checkpoint/deadline/partial-commit/restart/no-duplicate coverage. Navigation is not execution; real service needs the [official-key gate](sync.md#independent-real-service-evidence-gate). Retired copied-token routes refuse.
- Real keys: separately authorized operator-entered native key, bounded readonly official requests, no credentials in command/results/logs, original fingerprints and actual normalization proof. Never discover/reuse another task's key or bypass refusal.

### Keep evidence classes distinct

Debug/local-native keys, static release audit, instrumented denial, ordinary isolated launch, installed app and real service prove different things. Bind actual artifact/mode, inspect masks and disclose hidden/repositioned regions. None implies hardware input, default singleton/focus, login/MFA or integration authority. Missing proof stays unavailable unless relevant equivalence is demonstrated.
