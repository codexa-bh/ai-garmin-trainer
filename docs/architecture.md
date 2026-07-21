# Architecture

## Boundaries

- `src/lib/db`: Drizzle schema, explicit SQLite schema versioning, migration integrity checks, profile, confirmed-memory, chat, Garmin data, and deletion repositories.
- `src/lib/diagnostics`: allowlisted source-beta doctor/preflight reporting and redaction canaries.
- `src/lib/garmin`: pinned stdio-only Garmin MCP boundary, normalization, checkpoints, and sync orchestration.
- `src/lib/ai`: provider registry, grounded context selection, non-medical prompts, Profile/recent-chat/Garmin/confirmed-memory separation, deterministic reliability fixtures, streaming chat, and profile extraction.
- `src/app`: local no-auth loopback UI, sync controls, chat, profile, and deletion routes.

The app stores normalized Garmin facts only. Raw connector payloads are transformed in memory and discarded after upsert. Source-beta startup uses `npm run start:local`, which binds the production Next.js server to loopback by default; LAN/public exposure is unsupported.

## Trainer chat tool orchestration

`/api/chat` uses the configured model as a bounded planner over provider-visible trainer tool definitions. Tool definitions do not execute inside the AI SDK call: the server validates one selected tool call, executes at most two sequential Garmin/local tools, and passes only compact server-authored prior-step summaries into a fresh second planner call. The route no longer runs chat-action regex branches for sync, status, ranking, verification, analysis, refresh, availability, or detail slices.

Ordered tool evidence is persisted in the existing grounding JSON as additive `toolSteps` while the primary `toolEvidence`/`grounding.tool` compatibility field remains available for current API/UI consumers. Garmin facts, activity identities, ranking rows, detail status, sync status, and normalized slices remain server-authored; provider prose is discarded in favor of deterministic rendering after tool execution.
