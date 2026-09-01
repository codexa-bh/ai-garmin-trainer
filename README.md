# AI Garmin Connect Trainer

Local-only, single-user private trainer MVP for importing Garmin Connect history and chatting with a grounded, evidence-based fitness coach.

Source-control boundary: this source tree is backed by the private GitHub repository `https://github.com/eye1/ai-garmin-trainer` for source backup/collaboration only. That private remote does not change the local loopback runtime posture and does not authorize public hosting, LAN exposure, deployment, release, or beta invitation.

## Quick start

1. Install Node 22+ and Python tooling capable of running `uvx`.
2. Copy `.env.example` to `.env.local` and fill in local secrets/provider keys. `AI_PROVIDER=auto` is DeepSeek-first and falls back to OpenAI when no valid DeepSeek key is configured; placeholder example keys are treated as missing. For local chat, run `ollama pull qwen3.5:4b`, set `AI_PROVIDER=ollama`, and keep `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`; LAN/public Ollama endpoints are rejected. No local app sign-in, Google OAuth client, or allowlist is required for normal loopback use. Do not commit `.env.local`, SQLite files, backups, or Garmin token directories.
3. Run `npm run doctor` and fix any failed preflight checks. Doctor reports environment/config/database/provider/Garmin auth-state presence without printing secret values, token contents, prompts, precise GPS streams, or raw connector payloads.
4. Authenticate Garmin out of band with the pinned connector: `garmin-mcp-auth` (or the equivalent command provided by `Taxuspt/garmin_mcp` at commit `3610be6feed93088d85b0f35aba9d7d07c2505a7`). Keep the `.env.example` `GARMIN_MCP_ARGS` shape, including `--with mcp==1.28.1`; this exact MCP 1.x SDK constraint matches the reviewed connector dependency floor while avoiding MCP 2.x, which is incompatible with the connector's `mcp.server.fastmcp` import path. The app never asks for the Garmin password. Current connector auth writes OAuth state to its default `~/.garminconnect/garmin_tokens.json`; the app verifies that file exists without reading token contents.
5. Optional semantic memory: configure embedded SQLite semantic memory using `docs/memory.md`. The no-paid local path is `MEMORY_EMBEDDING_PROVIDER=ollama` with `nomic-embed-text` pulled into loopback Ollama; OpenAI-compatible embeddings use the existing `OPENAI_API_KEY` contract, not a separate memory-only API key. Ollama trainer chat is separate from memory extraction: when `AI_PROVIDER=ollama`, guarded memory extraction uses configured DeepSeek/OpenAI if available and otherwise falls back deterministically instead of sending extraction prompts to the local chat model. Leave `MEMORY_ENABLED=false` to run without semantic memory.
6. Optional local developer diagnostics: leave `LLM_DEBUG_TRACES=false` for normal use. Set it to `true` only in a private loopback development session to persist bounded per-assistant-message LLM/tool orchestration traces and inspect them from Settings; traces may include private normalized Garmin/chat/tool context.
7. Run `npm run bootstrap:local` for the production-style loopback bootstrap/start path. It performs locked dependency preparation when needed, checks whether the SQLite schema actually needs migration before invoking `npm run db:migrate`, ensures configured loopback Ollama memory is ready without installing system software, builds, runs doctor, and starts or reuses the verified loopback app. For repeat local work after dependencies/schema/build are already prepared, use `npm run restart:local` to stop any prior loopback server and restart the verified local server; if port `3000` is occupied, run `npm run restart:local -- --port 3001` or set `AI_GARMIN_RESTART_PORT=3001`. Manual recovery remains `npm ci`, `npm run db:status -- --json`, `npm run db:migrate` when needed, `npm run build`, then `npm run start:local`. Use `npm run dev` only for maintainer development.

## Repo orientation for future agents

Start with `docs/architecture.md` for the current file/route map, then read only the detailed docs that match the task:

- Chat coaching, provider selection including explicit loopback Ollama chat, tool orchestration, guarded SQL/math, and instruction updates: `src/app/api/chat/route.ts`, `src/lib/ai/*`, `docs/design-choices-and-boundaries.md`, and `docs/coaching-instructions-and-sources.md`.
- Garmin sync/import/detail/dashboard work: `src/app/api/sync/route.ts`, `src/app/api/activity-detail/route.ts`, `src/app/api/activities/[garminId]/dashboard/route.ts`, `src/lib/garmin/*`, and `docs/developer-process.md` for same-task data back-sync/cleanup expectations.
- Loopback UI, Activity Dashboard, Training Plan, chat/Profile/Memory controls, and deletion flows: `src/app/trainer-dashboard.tsx`, `src/app/style.css`, `src/app/api/training-plan/route.ts`, `src/app/api/profile/route.ts`, `src/app/api/memory/route.ts`, and `src/app/api/delete/route.ts`.
- Semantic memory/profile behavior: `docs/memory.md`, `src/lib/memory/*`, `src/lib/ai/context.ts`, and `src/lib/ai/profile.ts`. Memory remains user-derived and lower authority than current corrections, active transcript, Profile, and Garmin/tool evidence.
- Validation, live-smoke, diagnostics, and source-beta support artifacts: `docs/validation.md`, `docs/source-beta-readiness.md`, `docs/developer-process.md`, `src/lib/diagnostics/*`, and the scripts listed in `package.json`.

Keep future task context bounded: do not read every source file by default, do not duplicate guardrails across docs, and do not broaden the local-only/no-auth loopback boundary into LAN, hosted, public beta, deployment, or release assumptions.

## Design reference

See `docs/design-choices-and-boundaries.md` for the main design choices, app component responsibilities, and separation of concerns between AI reasoning, guarded SQL, bounded math, local storage, Garmin import, and UI/API routes. See `docs/coaching-instructions-and-sources.md` for the coaching evidence, limitations, product-policy distinction, and instruction maintenance contract.

## Validation

Run `npm run validate` for formatting, linting, type checking, tests, and production build. Additional source-beta evidence commands are `npm run doctor -- --json`, `npm run db:status -- --json`, `npm run bootstrap:local -- --prepare-only`, `npm run eval:reliability`, and `npm run deps:evidence -- --output <path>`. For task planning and handoff rules around same-task data back-sync and task-created smoke/test/mock data cleanup, read `docs/developer-process.md`.

## Safety and privacy

- The configured AI provider handles medical-domain responses without an additional app-authored response restriction; diagnosis and treatment content is still excluded from durable personalization memory.
- Local app access has no sign-in gate and is supported only on private loopback/localhost; do not expose it on LAN, public hosts, tunnels, or deployments.
- Garmin access is local-only through stdio to a pinned unofficial connector; HTTP transport and connector write operations are not used.
- The trainer sees app-normalized summaries and bounded current-turn SQL/math or detail-tool evidence; it never sees Garmin credentials, token/auth/cookie fields, connector config, environment values, filesystem paths, unrestricted raw payloads, or unrestricted stream dumps.
- Profile, active chat transcript, Garmin facts, and embedded semantic memory are separate concepts. The active chat transcript carries same-chat continuity up to a safe context budget, and New chat resets that short-term context. Memory uses guarded model-assisted extraction by default with deterministic fallback and server-side validation; it stores concise user-derived cross-session facts/preferences/corrections/temporary plans only after completed persisted turns, can be inspected/edited/deleted/cleared/disabled, may intentionally create no entry for low-value turns, and is lower authority than current corrections, active transcript, Profile, and Garmin/tool evidence.
- Clear chat/profile, clear semantic memory, and Garmin deletion are separate controls; disconnect Garmin and delete normalized Garmin records/checkpoints only for a clean reconnectable Garmin state. See `docs/source-beta-readiness.md` and `docs/memory.md` for backup, restore, export, reset, uninstall, dependency-evidence, and support artifact boundaries.
