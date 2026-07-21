# Architecture

## Boundaries

- `src/lib/db`: Drizzle schema, explicit SQLite schema versioning, migration integrity checks, profile, confirmed-memory, chat, Garmin data, and deletion repositories.
- `src/lib/diagnostics`: allowlisted source-beta doctor/preflight reporting and redaction canaries.
- `src/lib/garmin`: pinned stdio-only Garmin MCP boundary, normalization, checkpoints, and sync orchestration.
- `src/lib/ai`: provider registry, grounded context selection, non-medical prompts, Profile/recent-chat/Garmin/confirmed-memory separation, deterministic reliability fixtures, streaming chat, and profile extraction.
- `src/app`: local no-auth loopback UI, sync controls, chat, profile, and deletion routes.

The app stores normalized Garmin facts plus a local-only `garmin_raw_payload` archive of redacted Garmin connector/activity-detail payloads where available. Credential, token, auth, cookie, command, environment, and path-like fields are redacted before storage and before analysis-bundle exposure. Source-beta startup uses `npm run start:local`, which binds the production Next.js server to loopback by default; LAN/public exposure is unsupported.

## Trainer chat tool orchestration

`/api/chat` uses the configured model as a bounded planner over provider-visible trainer tool definitions. Tool definitions do not execute inside the AI SDK call: the server validates one selected tool call, executes at most two sequential Garmin/local tools, and passes only bounded server-authored prior-step evidence into a fresh follow-up planner or no-tool synthesis call. The route no longer runs chat-action regex branches for sync, status, ranking, verification, analysis, refresh, availability, or detail slices.

Ordered tool evidence is persisted in the existing grounding JSON as additive `toolSteps` while the primary `toolEvidence`/`grounding.tool` compatibility field remains available for current API/UI consumers. Garmin facts, activity identities, ranking rows, detail status, sync status, normalized slices, and generated-analysis manifests remain server-authored. For ad hoc analytics, `runGeneratedGarminAnalysis` builds an explicit bounded bundle from normalized tables plus redacted raw payloads, validates/runs Python in an isolated local subprocess (`python3 -I -S`, no secret environment, safe builtins, static import/name denial, timeout, stdout/result caps), and accepts only bounded JSON ranking results whose Garmin IDs exist in the bundle. After successful tool execution, the model may produce a final user-facing trainer answer from bounded server-authored evidence; deterministic tool rendering remains the fail-closed fallback for rejected, failed, invalid, provider-error, empty-synthesis, or budget-exhausted paths. The ordinary transcript shows synthesized prose plus only a generic local-data marker, while detailed summaries/privacy/tool-step metadata stay in API and stored grounding rather than the visible message body.
