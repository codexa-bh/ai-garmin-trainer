# Architecture

The supported product is a macOS ARM64 Tauri app with a private single-user loopback Next.js/Node backend, not a standalone browser app or hosted service. The model reasons; SQL retrieves bounded facts; pure math transforms them. UI composition owns neither coaching, persistence nor credentials. [Design choices](design-choices-and-boundaries.md) explains this division; [guardrails](project-guardrails.md) defines enforcement and its limits.

## Desktop runtime boundary

Native `src-tauri/src/{main,supervisor,settings,private_store,keychain,chatgpt,onboarding}.rs` owns private settings, explicit adoption, backend/window identity and process lifetime. `scripts/desktop/{assemble.mjs,settings.ts,config.ts,http-policy.ts,runtime.ts}` owns locked resources, validation and private activation. The existing Next custom-server API preserves routes, NDJSON and `after()`; desktop is not a second domain backend.

[Desktop](desktop.md) owns private-file permissions, original preservation, activation/live projection, explicit reopen, leases, initialization, recovery and schema compatibility. [Garmin connection](garmin-auth.md) and [ChatGPT](chatgpt.md) own credentials; the renderer never receives them. Desktop never loads user env files; CLI env loading stays separate. Native owns only its process group, not external Ollama/listeners; immutable bundle resources are separate from selected private state.

Setup-only `read_memory_status` uses the supervisor's exact live port/nonce and fixed `/__desktop/memory-status`, delegating only to `/api/cross-chat-summary?view=native`. Native validates a bounded closed enum/boolean DTO: active configuration/producer metadata, no content/private errors/provider request. It is not a generic bridge or legacy memory list/health call. Normal Settings has no diagnostic button/result/timer or automatic invocation; status triggers neither probe nor migration.

`db/desktop-preflight.ts` admits existing current-schema/integrity-checked files without migration; `db/writer-ownership.ts` owns cooperative leases and macOS open-file checks; `connection.ts` remains the lazy SQL owner. Explicit fresh initialization is outer infrastructure: `scripts/desktop/initialize.ts` migrates in-memory SQLite and returns bounded serialized bytes. Native onboarding owns eligibility, private parent descriptors, exclusive staging/publication/lease, identity and commit-aware retry. It never opens a selected existing file writable for migration. DB/settings/auth commit and backend readiness remain distinct. Desktop verifies its adoption overlay after Next's env reset and the selected DB lease before readiness. Native and `desktop-runtime.test.ts` cover these boundaries.

[Smoke playbook](dev-bridge.md) routes ordinary-artifact admission, debug/probe-only capabilities, native control/capture and evidence classes. [Protocol](smoke/protocol.md) owns finite grants, default-launch exclusion and task-needed extensions; [Settings smoke](smoke/settings.md) owns debug-only Settings/input variants. These are current mode-specific limits, not a permanent feature ban. Default trainer receives no IPC grant; only explicitly admitted smoke gets its correlated-result exception. External navigation is refused.

## Dependency and data flow

```text
page → TrainerDashboard → persistent feature hooks + conditional views
                            ↓ fetch / NDJSON
HTTP delivery → composition → application ports → storage adapters → SQLite
                                  ↓
                        provider + validated tools
                                  ↓
                      same-turn SQL handles → pure math
Garmin composition → official HTTPS reader → normalized imports
context ← Profile + Garmin facts + local replay + sealed summary pin
```

[Runtime and ownership graphs](project-guardrails.md#architecture-boundaries) check client/server, storage/AI, pure-math and layer dependencies plus runtime cycles. They are not a filesystem sandbox or proof of privacy.

## Area guides

Read the changed area's owner, not every guide:

- [Backend roles, composition and resource lifetimes](architecture/backend-roles.md)
- [Dashboard, selected-activity charts/routes and terrain](architecture/dashboard.md)
- [Server, persistence and raw payloads](architecture/server-and-persistence.md)
- [AI providers/tools, chat and turn-owned execution](architecture/ai-and-chat.md)
- [Guarded SQL/math and local data](architecture/analytics-and-local-data.md)
- [Garmin application and official reader](architecture/garmin.md)
- [Personalization, weekly plans and Training Plan](architecture/personalization-and-plans.md)
- [Component-specific contracts and responsibilities](component-responsibilities.md)
