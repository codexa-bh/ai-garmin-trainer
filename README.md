# AI Garmin Connect Trainer

Local-only, single-user private trainer MVP for importing Garmin Connect history and chatting with a grounded, evidence-based fitness coach.

## Quick start

1. Install Node 22+ and Python tooling capable of running `uvx`.
2. Copy `.env.example` to `.env.local` and fill in local secrets/provider keys. `AI_PROVIDER=auto` is DeepSeek-first and falls back to OpenAI when no valid DeepSeek key is configured; placeholder example keys are treated as missing. No local app sign-in, Google OAuth client, or allowlist is required for normal loopback use. Do not commit `.env.local`, SQLite files, backups, or Garmin token directories.
3. Run `npm run doctor` and fix any failed preflight checks. Doctor reports environment/config/database/provider/Garmin auth-state presence without printing secret values, token contents, prompts, precise GPS streams, or raw connector payloads.
4. Authenticate Garmin out of band with the pinned connector: `garmin-mcp-auth` (or the equivalent command provided by `Taxuspt/garmin_mcp` at commit `2974244bfda1595b00836b3f942f579ec2d6f7d6`). Keep the `.env.example` `GARMIN_MCP_ARGS` shape, including `--with mcp==1.23.1`; MCP SDK 2.x is incompatible with this reviewed connector commit. The app never asks for the Garmin password. Current connector auth writes OAuth state to its default `~/.garminconnect/garmin_tokens.json`; the app verifies that file exists without reading token contents.
5. Optional semantic memory: configure embedded SQLite semantic memory using `docs/memory.md`. The no-paid local path is `MEMORY_EMBEDDING_PROVIDER=ollama` with `nomic-embed-text` pulled into loopback Ollama; OpenAI-compatible embeddings use the existing `OPENAI_API_KEY` contract, not a separate memory-only API key. Leave `MEMORY_ENABLED=false` to run without semantic memory.
6. Optional local developer diagnostics: leave `LLM_DEBUG_TRACES=false` for normal use. Set it to `true` only in a private loopback development session to persist bounded per-assistant-message LLM/tool orchestration traces and inspect them from Settings; traces may include private normalized Garmin/chat/tool context.
7. Run `npm run bootstrap:local` for the production-style loopback bootstrap/start path. It performs locked dependency preparation when needed, checks whether the SQLite schema actually needs migration before invoking `npm run db:migrate`, ensures configured loopback Ollama memory is ready without installing system software, builds, runs doctor, and starts or reuses the verified loopback app. Manual recovery remains `npm ci`, `npm run db:status -- --json`, `npm run db:migrate` when needed, `npm run build`, then `npm run start:local`. Use `npm run dev` only for maintainer development.

## Design reference

See `docs/design-choices-and-boundaries.md` for the main design choices, app component responsibilities, and separation of concerns between AI reasoning, guarded SQL, bounded math, local storage, Garmin import, and UI/API routes. See `docs/coaching-instructions-and-sources.md` for the coaching evidence, limitations, product-policy distinction, and instruction maintenance contract.

## Validation

Run `npm run validate` for formatting, linting, type checking, tests, and production build. Additional source-beta evidence commands are `npm run doctor -- --json`, `npm run db:status -- --json`, `npm run bootstrap:local -- --prepare-only`, `npm run eval:reliability`, and `npm run deps:evidence -- --output <path>`.

## Safety and privacy

- The configured AI provider handles medical-domain responses without an additional app-authored response restriction; diagnosis and treatment content is still excluded from durable personalization memory.
- Local app access has no sign-in gate and is supported only on private loopback/localhost; do not expose it on LAN, public hosts, tunnels, or deployments.
- Garmin access is local-only through stdio to a pinned unofficial connector; HTTP transport and connector write operations are not used.
- The trainer sees app-normalized summaries and bounded current-turn SQL/math or detail-tool evidence; it never sees Garmin credentials, token/auth/cookie fields, connector config, environment values, filesystem paths, unrestricted raw payloads, or unrestricted stream dumps.
- Profile, active chat transcript, Garmin facts, and embedded semantic memory are separate concepts. The active chat transcript carries same-chat continuity up to a safe context budget, and New chat resets that short-term context. Memory uses guarded model-assisted extraction by default with deterministic fallback and server-side validation; it stores concise user-derived cross-session facts/preferences/corrections/temporary plans only after completed persisted turns, can be inspected/edited/deleted/cleared/disabled, may intentionally create no entry for low-value turns, and is lower authority than current corrections, active transcript, Profile, and Garmin/tool evidence.
- Clear chat/profile, clear semantic memory, and Garmin deletion are separate controls; disconnect Garmin and delete normalized Garmin records/checkpoints only for a clean reconnectable Garmin state. See `docs/source-beta-readiness.md` and `docs/memory.md` for backup, restore, export, reset, uninstall, dependency-evidence, and support artifact boundaries.
