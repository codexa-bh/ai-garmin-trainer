# Local runtime and optional providers

← [Installation guide](../README.md#installation)

After first setup, use these existing local-only runtime options. They do not authorize LAN/public hosting or deployment.

## Direct OpenAI/DeepSeek switching

The defaults are `AI_MODEL=gpt-6-luna` and `DEEPSEEK_MODEL=deepseek-flash`; explicit model overrides remain supported. Keep exactly one provider assignment active in ignored `.env.local`, for example:

```dotenv
AI_PROVIDER=auto
# AI_PROVIDER=openai
# AI_PROVIDER=deepseek
AI_MODEL=gpt-6-luna
DEEPSEEK_MODEL=deepseek-flash
```

Auto remains DeepSeek-first, using OpenAI only when no valid DeepSeek key is configured, not after a remote failure. To select a provider explicitly, comment the active assignment and uncomment its alternative. An explicit provider without its matching key fails closed. Preserve existing credentials/unrelated settings; never copy them into tracked files. Direct OpenAI requires a privately configured `OPENAI_API_KEY` and paid API/model access independently of a Codex subscription; subscription tokens are not supported.

OpenAI uses the existing Responses adapter for Luna function calling, including structured trainer completion. No Chat Completions fallback, model substitution, reasoning override or new orchestration retry is introduced. Explicit OpenAI/DeepSeek also selects the existing memory extractor when enabled; embeddings remain independently configured. Doctor verifies configuration, not account entitlement or live tool reliability. Validate exact-model coaching, grounded SQL/math and missing-evidence responses on loopback before changing a working selection. Leave the working provider active if the new model cannot be validated.

Official references checked 2026-10-21: [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and [DeepSeek models/pricing](https://api-docs.deepseek.com/quick_start/pricing). DeepSeek recommends `deepseek-flash`, then served by DeepSeek-V4.1-Flash-1017. An alias is not proof of a particular backend revision or future availability.

Saving env settings does **not** update an already-running app. A separately authorized rebuild/restart is needed for production; do not restart an unrelated/primary process merely to smoke a worktree. Use a task-owned alternate loopback process with a disposable populated DB copy for chat/memory writes. Source/config rollback restores only the relevant provider/model lines, preserving current credentials and unrelated settings. No schema migration or data back-sync is needed for these defaults.

## Opt-in OpenRouter chat

Set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` in ignored `.env.local`. The initial model is `nvidia/nemotron-3.5-lightning:free`. Chat and guarded tools use `https://openrouter.ai/api/v1/chat/completions`; the key stays server-side. Auto selection remains DeepSeek-first/OpenAI-fallback and ignores OpenRouter keys. Missing/placeholder keys fail closed; no paid model or alternate provider is substituted on failure.

OpenRouter receives the same bounded chat/Garmin context as the selected chat provider. Review its account privacy/routing settings before use. Free-model availability, rate limits and tool support can change; doctor reports configuration presence, not remote readiness. The initial Nemotron free model can repeat otherwise successful read-only tool calls and reach the execution limit instead of answering, especially on explicit tool-directed requests. Existing execution limits remain enforced and return a truthful fallback; a successful smoke is not a reliability guarantee. Validate with a bounded loopback chat/tool request. For temporary tests use task-local ignored configuration, restore the prior provider afterward, and retire temporary credentials.

OpenRouter is **chat/tools only**: extraction continues through configured DeepSeek/OpenAI (or deterministic fallback), and embedding configuration is unchanged. There is no OpenRouter extraction or embedding route, model catalog UI, or cross-provider runtime failover.

## Local restart modes

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
