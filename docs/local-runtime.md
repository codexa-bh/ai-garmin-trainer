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

## Runtime trainer model preference

Settings → **Trainer model** lists only the configured fixed choices: DeepSeek Flash (`deepseek-flash`, `DEEPSEEK_API_KEY`) and GPT-6 Luna (`gpt-6-luna`, `OPENAI_API_KEY`). One configured key shows one choice; neither shows a disabled control and explanation. Blank/placeholder keys are absent. Loading/saving Settings never probes accounts or makes paid provider requests. Configuration does not certify entitlement, funding or availability.

The single-user app-wide preference is stored in existing `app_metadata` under `ai.chat_model`. No migration/backfill is needed. Absent/empty metadata means the original env selection, including explicit/custom/Ollama/OpenRouter models; the UI reports that inherited identity rather than relabeling it. A saved catalog choice overrides chat provider/model exactly, not env model overrides. **Reset to configured default** clears only this preference (empty metadata sentinel), not credentials or unrelated settings.

Each new trainer turn reads and captures the effective model before asynchronous context construction. Saving affects subsequent turns without restarting; planner/synthesis in an already-running turn keep their captured model. Memory extraction remains env-selected and embeddings independent. Chat/Profile/Garmin deletion does not clear this app-owned preference.

`GET /api/model-settings` returns safe options, saved selection, effective identity/source/availability and a bounded unavailable explanation; `PATCH` accepts `{ modelId: "deepseek-flash" | "gpt-6-luna" | null }`. Unknown IDs, malformed input and missing-key choices are rejected before writes. A corrupt or now-unconfigured saved choice fails closed, never silently falls back; choose an available replacement or reset explicitly. Provider errors do not change the preference. Reads and successful saves return authoritative snapshots; reopen Settings to refresh after failures/credential changes. Keys, raw stored invalid values and upstream/storage errors are not returned.

Saving this preference survives reload/restart but does not hot-reload `.env.local`. Adding/removing credentials still needs a separately authorized normal server reload. Rollback is reset or source revert; no primary restart, data copy-back, public hosting or deployment is implied.

## Trainer prompt caching and token diagnostics

Trainer requests share one policy/context composition across providers. Coaching,
completion and purpose-specific rules precede freshly rebuilt dates, Profile,
memory, transcript, weekly status, budgets and current-turn evidence. Context is
not cached locally; deletion, corrections and date rollover remain immediate.
Tool definitions/order and planner versus terminal-only synthesis stay unchanged.

Provider contract checked **2026-10-21**, with `ai` 7.0.29,
`@ai-sdk/openai` 4.0.15 and `@ai-sdk/deepseek` 3.0.11:

| Direct provider           | Cache behavior and application choice                                                                                                                                                                                                                                                                                                                                                          | Reporting and limits                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI `gpt-6-luna`       | At least 1,024 visible input tokens; breakpoint-based reuse. The adapter marks the end of stable policy and uses explicit-only, default 30-minute writes, avoiding writes of the changing suffix. This option is capability-allowlisted to current `gpt-6-luna`, `gpt-6-astra`, `gpt-6.1-sol`; custom/older models keep compatible defaults. No routing key or extended retention is selected. | Reads and writes are distinct classes. The guide describes 128-token read reporting; record actual provider counts, not locally rounded estimates. Expiry, routing, model/settings/tool changes and prefix changes can cause misses. A breakpoint never guarantees reuse. |
| DeepSeek `deepseek-flash` | Automatic best-effort disk caching, persisted complete prefix units, common-prefix detection and fixed intervals for long inputs. No OpenAI caching parameters.                                                                                                                                                                                                                                | Reports `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, not cache writes. Construction takes seconds; eviction is usually hours to days. Current guide does not promise a universal minimum size or interval.                                                       |

Sources: [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[DeepSeek caching](https://api-docs.deepseek.com/guides/kv_cache).
OpenAI standard USD/million tokens on that date: Luna ordinary input **0.10**,
read **0.01**, 30-minute write **0.125**, 12-hour write **0.25**, output **0.50**.
A 12-hour minimum is not a deletion deadline; this app does not opt into it.
The [DeepSeek pricing URL](https://api-docs.deepseek.com/quick_start/pricing)
returned first-call documentation during verification, so the measurements below
make no DeepSeek monetary claim.

With private debug traces enabled, each recorded provider call has optional
`tokenUsage`: `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`,
`uncachedInputTokens` (ordinary input excluding reads and reported writes), and
`outputTokens`. Provider/model identity belongs to the containing turn snapshot.
Missing is unknown, not zero; writes are never inferred from misses. The adapter
checks raw field presence because installed SDK adapters fill some absent fields
with zero, but never retains that raw usage object. Only one SDK call's usage is
counted, not both steps and aggregates. Historical traces remain readable; no
turn total is advertised because traces cap calls and may have unknown coverage.
Existing debug privacy restrictions still apply; token diagnostics add no prompts,
health data or provider payloads. Cache misses never trigger extra generation.

### Observed local comparison (not a savings guarantee)

Bounded disposable-DB app smoke used the same models and coaching/follow-up
requests before and after the change:

| Luna coaching + follow-up | Calls |  Input |  Read |  Write | Output | Estimated input USD |
| ------------------------- | ----: | -----: | ----: | -----: | -----: | ------------------: |
| Before                    |     2 | 19,219 |     0 | 19,213 |    291 |         0.002402225 |
| After                     |     2 | 19,248 | 6,379 |  6,379 |    276 |         0.001510165 |

This pair's input estimate is **37.1% lower**, calculated from separate ordinary,
read and write classes at the rates above; output, discounts and invoice-level
charges are excluded. The first new request wrote 6,379 stable tokens; the
follow-up read those tokens despite changing date/history. Across coaching,
follow-up, SQL/math analytics and unavailable-evidence scenarios, Luna observed
165,854 reads out of 309,993 input tokens across 27 calls (53.5%), versus zero
reads before. Variable analytical paths make aggregate cost differences
observational, not a controlled cache-only effect.

DeepSeek already reused prefixes: the first/second planner reads were 1,536/1,536
before and 1,536/3,840 after; later analytical calls read 6,784 tokens. Baseline
follow-up needed an extra synthesis and failed completion validation, while the
new follow-up completed in one call, so a whole-turn savings percentage is not
attributable to caching. Both new analytical scenarios produced grounded sport
counts and an executed-math total after rejected invalid-column attempts; missing
pack/surface evidence stayed unavailable, not invented. Long/redundant analytical
paths remain possible under the unchanged execution budget. An independent memory
extraction request returned HTTP 400 on both revisions; it is excluded from
trainer cache success and remains an unresolved auxiliary-provider limitation.
Mocked wire/prefix tests establish deterministic eligibility, not billing savings.
No database migration, model-selection change, deployment or release is required;
source revert rolls back this behavior.

## Opt-in OpenRouter chat

Set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` in ignored `.env.local`. The initial model is `nvidia/nemotron-3.5-lightning:free`. Chat and guarded tools use `https://openrouter.ai/api/v1/chat/completions`; the key stays server-side. Auto selection remains DeepSeek-first/OpenAI-fallback and ignores OpenRouter keys. Missing/placeholder keys fail closed; no paid model or alternate provider is substituted on failure.

OpenRouter receives the same bounded chat/Garmin context as the selected chat provider. Review its account privacy/routing settings before use. Free-model availability, rate limits and tool support can change; doctor reports configuration presence, not remote readiness. The initial Nemotron free model can repeat otherwise successful read-only tool calls and reach the execution limit instead of answering, especially on explicit tool-directed requests. Existing execution limits remain enforced and return a truthful fallback; a successful smoke is not a reliability guarantee. Validate with a bounded loopback chat/tool request. For temporary tests use task-local ignored configuration, restore the prior provider afterward, and retire temporary credentials.

OpenRouter is **chat/tools only**: extraction continues through configured DeepSeek/OpenAI (or deterministic fallback), and embedding configuration is unchanged. There is no OpenRouter extraction or embedding route, selectable OpenRouter catalog entry, or cross-provider runtime failover. A saved runtime catalog preference overrides trainer chat until explicitly reset.

## Local desktop mode

The [macOS ARM64 desktop app](desktop.md) bundles Node and a production Next service, adopts explicit private state references and owns only its backend/connector descendants. It neither calls source bootstrap/restart nor starts/pulls external Ollama/Python. Quit before using the source commands against the same DB. Source and desktop preserve provider preferences, NDJSON/title behavior and separate memory readiness; browser-only active selection is not imported.

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
