# AI Garmin Connect Trainer

Local-only, single-user private trainer MVP for importing Garmin Connect history and chatting with a grounded, evidence-based fitness coach.

Source-control boundary: this source tree is backed by the private GitHub repository `https://github.com/eye1/ai-garmin-trainer` for source backup/collaboration only. That private remote does not change the local loopback runtime posture and does not authorize public hosting, LAN exposure, deployment, release, or beta invitation.

## Quick start

1. Install Node 22+ and Python tooling capable of running `uvx`.
2. Copy `.env.example` to `.env.local` and fill in local secrets/provider keys. `AI_PROVIDER=auto` is DeepSeek-first and falls back to OpenAI when no valid DeepSeek key is configured; placeholder example keys are treated as missing. For local chat, run `ollama pull qwen3.5:4b`, set `AI_PROVIDER=ollama`, and keep `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`; LAN/public Ollama endpoints are rejected. No local app sign-in, Google OAuth client, or allowlist is required for normal loopback use. Do not commit `.env.local`, SQLite files, backups, or Garmin token directories.
3. Run `npm run doctor` and fix any failed preflight checks. Doctor reports environment/config/database/provider/Garmin auth-state presence without printing secret values, token contents, prompts, precise GPS streams, or raw connector payloads.
4. Set the one explicit `GARMIN_MCP_TOKEN_DIR` in `.env.local`, then use `npm run garmin:auth` in a private interactive terminal only when existing credentials cannot be reused. This env-aware command pins connector `3610be6feed93088d85b0f35aba9d7d07c2505a7` and `mcp==1.28.1`; keep the matching `.env.example` MCP args. Auth, MCP sync, FIT helpers and doctor use that same location without home-directory or inherited-variable fallback. The app never asks for the Garmin password. See [Garmin authentication setup and recovery](docs/garmin-auth.md) before migrating an existing store. Doctor checks only expected-file metadata, not token validity or expiry.
5. Optional semantic memory: configure embedded SQLite semantic memory using `docs/memory.md`. The no-paid local path is `MEMORY_EMBEDDING_PROVIDER=ollama` with `nomic-embed-text` pulled into loopback Ollama; OpenAI-compatible embeddings use the existing `OPENAI_API_KEY` contract, not a separate memory-only API key. Ollama trainer chat is separate from memory extraction: when `AI_PROVIDER=ollama`, guarded memory extraction uses configured DeepSeek/OpenAI if available and otherwise falls back deterministically instead of sending extraction prompts to the local chat model. Leave `MEMORY_ENABLED=false` to run without semantic memory.
6. Optional local developer diagnostics: leave `LLM_DEBUG_TRACES=false` for normal use. Set it to `true` only in a private loopback development session to persist bounded per-assistant-message LLM/tool orchestration traces and inspect them from Settings; traces may include private normalized Garmin/chat/tool context.
7. Run `npm run bootstrap:local` for the production-style loopback bootstrap/start path. It performs locked dependency preparation when needed, checks whether the SQLite schema actually needs migration before invoking `npm run db:migrate`, ensures configured loopback Ollama memory is ready without installing system software, builds, runs doctor, and starts or reuses the verified loopback app. For repeat local work after dependencies/schema are prepared, use the restart modes below. Manual recovery remains `npm ci`, `npm run db:status -- --json`, `npm run db:migrate` when needed, `npm run build`, then `npm run start:local`.

### Opt-in OpenRouter chat

Set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` in ignored `.env.local`. The initial model is `nvidia/nemotron-3.5-lightning:free`. Chat and guarded tools use `https://openrouter.ai/api/v1/chat/completions`; the key stays server-side. Auto selection remains DeepSeek-first/OpenAI-fallback and ignores OpenRouter keys. Missing/placeholder keys fail closed; no paid model or alternate provider is substituted on failure.

OpenRouter receives the same bounded chat/Garmin context as the selected chat provider. Review its account privacy/routing settings before use. Free-model availability, rate limits and tool support can change; doctor reports configuration presence, not remote readiness. The initial Nemotron free model can repeat otherwise successful read-only tool calls and reach the execution limit instead of answering, especially on explicit tool-directed requests. Existing execution limits remain enforced and return a truthful fallback; a successful smoke is not a reliability guarantee. Validate with a bounded loopback chat/tool request. For temporary tests use task-local ignored configuration, restore the prior provider afterward, and retire temporary credentials.

OpenRouter is **chat/tools only**: extraction continues through configured DeepSeek/OpenAI (or deterministic fallback), and embedding configuration is unchanged. There is no OpenRouter extraction or embedding route, model catalog UI, or cross-provider runtime failover.

### Local restart modes

```bash
# Default: rebuild the production bundle, then start on loopback
npm run restart:local
npm run restart:local -- --mode production --port 3000

# Development: skip the production build and automatically reload source changes
npm run restart:local -- --mode dev --port 3000
```

Production mode requires another rebuild/restart to pick up source edits. Development mode uses Next.js automatic reload; configuration changes may still require a restart. Both modes bind to `127.0.0.1`, stop only matching server processes owned by this repository/worktree, and verify HTTP readiness and listener ownership. Switching modes stops the prior server before starting (and, for production, rebuilding).

Before building/launching the app, both restart modes prepare **effective Ollama memory embeddings** using `.env.local` (process environment takes precedence) and the stored memory-disable preference. Disabled memory and non-Ollama embedding providers skip this step. Restart reads existing SQLite status only: it does not install dependencies, create/migrate the database, or run full bootstrap. Complete bootstrap first if the status check reports incomplete setup.

A reachable loopback daemon is reused. Otherwise the installed `ollama` CLI starts a detached daemon at `MEMORY_EMBEDDING_BASE_URL` (default `http://127.0.0.1:11434`); CLI operations target that same origin, overriding inherited `OLLAMA_HOST`. URLs with credentials, paths, queries or non-loopback hosts are rejected; automatic daemon start requires HTTP. A missing `MEMORY_EMBEDDING_MODEL` (default `nomic-embed-text`) is pulled visibly, potentially using network/disk; already installed models are not downloaded again. Success requires a real, valid embedding response as well as the app's HTTP/listener checks. This does not prepare Ollama chat models.

**Restart-started Ollama persists** after successful preparation, command exit and later app stops/restarts, including a subsequent app build/start failure. Its output appends to this worktree's ignored `logs/ollama.log`; review/rotate that local log as needed. Failed/cancelled preparation stops only the daemon started by that invocation; independently running daemons are never stopped. Bootstrap retains its session-owned daemon cleanup. No login service, desktop window or software installation is added. Raw `npm run dev` and `npm run start:local` remain unchanged.

If preparation fails, restart exits nonzero without launching the app. Install Ollama manually if absent, inspect the local daemon log, verify `MEMORY_EMBEDDING_BASE_URL`/`MEMORY_EMBEDDING_MODEL` and read-only `npm run db:status -- --json`, then retry. For manual daemon/model recovery, use `OLLAMA_HOST=http://127.0.0.1:11434 ollama serve` and `OLLAMA_HOST=http://127.0.0.1:11434 ollama pull nomic-embed-text`, substituting your configured loopback origin/model. Startup waits at least 15 seconds, each embedding probe uses `MEMORY_TIMEOUT_MS` (default 8000 ms), and a model pull is bounded at 15 minutes. Increase the embedding timeout for slow cold loads. Stop a persistent daemon only after identifying its exact PID/ownership and confirming no other app needs it; never use broad process kills.

If port `3000` is occupied by another repo/worktree, choose `--port 3001` or set `AI_GARMIN_RESTART_PORT=3001`; unrelated listeners are never killed. CLI port selection overrides that environment default. Equals-style options (`--mode=dev --port=3001`) also work; `--help` shows usage. Missing or invalid mode/port values fail before any restart actions.

## Repo orientation for future agents

Start with `docs/architecture.md` for the current file/route map, then read only the detailed docs that match the task:

- Chat coaching, provider selection including explicit loopback Ollama chat, tool orchestration, guarded SQL/math, and instruction updates: `src/app/api/chat/route.ts`, `src/lib/ai/*`, `docs/design-choices-and-boundaries.md`, and `docs/coaching-instructions-and-sources.md`.
- Garmin sync/import/detail/dashboard work: `src/app/api/sync/route.ts`, `src/app/api/activity-detail/route.ts`, `src/app/api/activities/[garminId]/dashboard/route.ts`, `src/lib/garmin/*`, and `docs/developer-process.md` for same-task data back-sync/cleanup expectations.
- Loopback UI, Activity Dashboard, Training Plan, chat/Profile/Memory controls, and deletion flows: `src/app/trainer-dashboard.tsx`, `src/app/style.css`, `src/app/api/training-plan/route.ts`, `src/app/api/profile/route.ts`, `src/app/api/memory/route.ts`, and `src/app/api/delete/route.ts`.
- Semantic memory/profile behavior: `docs/memory.md`, `src/lib/memory/*`, `src/lib/ai/context.ts`, and `src/lib/ai/profile.ts`. Memory remains user-derived and lower authority than current corrections, active transcript, Profile, and Garmin/tool evidence.
- Validation, live-smoke, diagnostics, and source-beta support artifacts: `docs/validation.md`, `docs/source-beta-readiness.md`, `docs/developer-process.md`, `src/lib/diagnostics/*`, and the scripts listed in `package.json`.

Keep future task context bounded: do not read every source file by default, do not duplicate guardrails across docs, and do not broaden the local-only/no-auth loopback boundary into LAN, hosted, public beta, deployment, or release assumptions.

## Daily-health freshness

Complete daily-health coverage does not mean final totals. Each sync refreshes today and yesterday on the existing UTC sync calendar. Within the inclusive 14-day trailing window, older complete dates refresh when any stats, sleep, or body-battery fetch evidence is missing or at least 24 hours old. Missing/partial trailing dates still retry every run; historical gap/repair and checkpoint backfill remain separate. This costs at most 42 trailing tool calls per sync, normally six for repeated complete data within 24 hours. Refreshes preserve prior non-null fields when Garmin omits them and accept valid zero/downward corrections. Delayed uploads outside the window may still require a targeted re-sync; source agreement does not prove finality.

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
