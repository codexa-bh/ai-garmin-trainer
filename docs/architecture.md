# Architecture

The supported product is a source-built macOS ARM64 Tauri app with a private,
single-user supervised loopback backend, not a standalone browser app or hosted service.
The model reasons; server-owned SQL retrieves bounded facts; bounded math transforms
those facts. UI composition does not own coaching policy, persistence or connector
credentials. See [design choices](design-choices-and-boundaries.md) for the reasoning
and [project guardrails](project-guardrails.md) for enforced dependency boundaries.

## Desktop runtime boundary

`src-tauri/src/{main,supervisor,settings,private_store,keychain,chatgpt,onboarding}.rs` owns native private file settings (including the user's Garmin Personal API key), explicit read-only legacy Keychain adoption, a single verified backend/window and owned-process lifecycle. `scripts/desktop/{assemble.mjs,settings.ts,config.ts,http-policy.ts,runtime.ts}` owns locked resources, shared allowlisted validation and private activation; the Garmin key becomes a process-owned capability (`src/lib/garmin/connection.ts`), never environment. Desktop never loads user env files; retained CLI env loading remains separate. Provider values from the owner-private plaintext document reach only the owned backend over its private activation/liveness pipe; ordinary operations never access Keychain; the Garmin key never reaches trainer/model/HTTP context. Atomic versioned private documents and explicit all-slot adoption preserve legacy settings/Keychain originals. Old unofficial-connector token paths remain inert compatibility metadata, never forwarded to the backend; ordinary Save projects only catalog/shared chat keys through a fixed authenticated owned-backend endpoint after private commit, and Garmin key changes apply only at explicit reopen. See [settings contract](desktop.md). It retains loopback HTTP delivery through the existing Next custom-server API, preserving routes/NDJSON/`after()`, not a new domain backend. Only setup may call settings native commands; default remote trainer has no IPC grant, with the explicitly admitted result-only exception below. Setup-only `read_memory_status` uses the supervisor's exact live port/nonce and fixed `/__desktop/memory-status` resource; native validates a closed bounded enum/boolean DTO. This delegates only to `/api/cross-chat-summary?view=native`, not legacy list/health calls or a generic HTTP bridge. Status returns only active summary configuration and producer metadata, never content/private errors or a provider request. Normal Settings has no diagnostic button/result/timer and does not invoke this command automatically. No provider probe or migration is triggered. External navigation is refused.

Native smoke uses `src-tauri/src/{isolated_run,dev_bridge,dev_capture}.rs` for supported ordinary-artifact admission and shared closed control/capture, while legacy `smoke_config.rs` stays debug/probe-only. The fixed native-installed `src-tauri/debug/smoke.js` bootstrap uses production Next and rendered semantic actions, not state injection or a second application server. Ordinary admission pins private run state/lifetime ownership and verifies actual artifact/resource/source plus fresh native boot/capability identity before control; settings, DB validators/writer leases and the supervisor remain authoritative. Only its exact owned trainer origin receives a correlated-result grant, never settings/auth. Default launches install no bootstrap/bridge/grant despite supported code being present. The owned Python/Swift runner copies unmodified ordinary bundles outside checkout, leaves HOME unchanged and records hydrated save/restart plus fixed geometry-preserving redacted capture. Separately, debug-only `setup_smoke.rs`/`debug/setup-smoke.js` retain finite keyless local Settings/native-completion capture with exact safe run-local Save/defaults, not a new renderer IPC grant. Native credentials/MFA/adoption/pickers/Finish are refused in either admitted mode. Debug also retains finite Health range/capture and synthetic LLM disclosure actions; `dev_input.rs` sends only Enter/Space directly to the owned non-key WebView, never global/hardware input. All added Settings/Health/disclosure command variants and native-input/setup modules compile only with debug assertions. Ordinary native/renderer gates reject them and omit their observations; debug metadata receives closed bounded native schemas. Debug and launch-only release-denial observations remain distinct, not ordinary launch certificates. See [smoke protocol/ownership/evidence](dev-bridge.md) and its [expected task-needed extension recipe](smoke/protocol.md#task-needed-bridge-and-runner-extensions). These are present implementation limits, not a permanent Settings/Sync/token feature ban; extensions must preserve native ownership, finite mode-specific admission and default-launch exclusion before use.

`db/desktop-preflight.ts` is an infrastructure adapter: existing-file/current-schema/integrity admission without migration. `db/writer-ownership.ts` is the shared source/desktop cooperative lease and macOS open-file check; `connection.ts` remains the sole lazy SQL owner. Desktop verifies the adoption overlay survives Next's env reset and its selected DB lease before readiness. Explicit first-run fresh initialization is an outer desktop adapter, not ordinary connection/admission: `scripts/desktop/initialize.ts` runs current migrations on in-memory SQLite and returns bounded serialized bytes. Native `onboarding.rs` owns fresh eligibility, private parent descriptors, exclusive staging/publication/target lease, exact identity and commit-aware retry. No selected file is opened writable for migration; ordinary existing-data preflight is unchanged. DB/private-settings/auth commits and backend readiness are distinct. Resource assets stay immutable; selected private state stays outside the bundle. Native owns only its process group, not external Ollama/listeners. See [desktop](desktop.md) for failure, interruption, schema/rollback and provenance details; `desktop-runtime.test.ts` and native Rust tests cover the new boundaries.

## Dependency and data flow

```text
page → TrainerDashboard shell → persistent feature hooks + conditional views
                                  ↓ fetch / NDJSON
API routes → application orchestration → repositories → SQLite
                     ↓                       ↑
             provider adapters       Garmin importer ← official Personal API reader (HTTPS)
                     ↓
             validated tool dispatch → SQL result handles → bounded pure math

context ← Profile + normalized Garmin facts + local replay + sealed summary pin
```

Runtime client closures cannot reach database, connector or provider capabilities.
DTOs are client contracts, not imports of server implementations. Storage cannot
import AI runtime code. The graph gate rejects runtime cycles and verifies the
pure math closure; it is not a general filesystem sandbox or proof of privacy.

## Area guides

Read only the area you are changing:

- [Backend roles and composition inventory](architecture/backend-roles.md)
- [Dashboard ownership, selected-activity charts/routes and terrain sections](architecture/dashboard.md)
- [Main server, persistence owners and raw-payload boundary](architecture/server-and-persistence.md)
- [AI providers/tools, chat execution and turn-owned tool execution](architecture/ai-and-chat.md)
- [Guarded analytical SQL/math and local-data use cases](architecture/analytics-and-local-data.md)
- [Garmin application and official Personal API reader](architecture/garmin.md)
- [Personalization, weekly plans and Training Plan](architecture/personalization-and-plans.md)
