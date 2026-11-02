# Local runtime and optional providers

← [Installation guide](../README.md#installation)

Use the native Tauri app as the sole supported launcher. Configure it through **Settings** (native app menu) and native owner-private plaintext provider storage, never an env file. Same-user/privileged processes and backups can read the file; see [private storage/adoption/recovery](desktop.md#explicit-private-state-adoption). Field identifiers below also document the internal backend/retained CLI adapter; dotenv examples apply only to deliberately configured non-serving maintenance CLIs, not desktop onboarding. Save desktop changes then explicitly quit/reopen. See [installation](../README.md#installation); no LAN/public hosting or deployment is authorized.

## Direct OpenAI/DeepSeek switching

Native Settings manages up to 32 stable chat entries across OpenAI, DeepSeek, Ollama and OpenRouter: exact model ID and optional name. Several entries share one provider/key. There is no default control or removal/reassignment restriction. Catalog/keys/endpoints remain Save-for-next-launch only; Trainer remembers one explicit choice within the activated catalog.

The legacy/internal fields below remain independent extraction/title compatibility inputs, not an editable global chat selector. These maintenance CLI equivalents are not loaded by desktop:

```dotenv
AI_PROVIDER=auto
# AI_PROVIDER=openai
# AI_PROVIDER=deepseek
AI_MODEL=gpt-6-luna
DEEPSEEK_MODEL=deepseek-flash
```

Legacy auto was DeepSeek-first, then OpenAI by configured key, never remote-failure recovery. One-time compatibility captures only that determinable prior exact identity, or no selection when indeterminate. Explicit legacy provider intent remains even without its key. Preserve existing credentials/unrelated settings; never copy them into tracked files. Direct OpenAI requires a privately configured `OPENAI_API_KEY` and paid API/model access independently of a Codex subscription; subscription tokens are not supported.

OpenAI uses the existing Responses adapter for Luna function calling, including structured trainer completion. No Chat Completions fallback, model substitution, reasoning override or new orchestration retry is introduced. Preserved legacy cloud policy/model inputs select extraction and automatic titles independently; new catalog/chat choices never retarget them. Embeddings remain independently configured. Doctor verifies configuration, not account entitlement or live tool reliability. Validate exact-model coaching, grounded SQL/math and missing-evidence responses on loopback before changing a working selection. Leave the working provider active if the new model cannot be validated.

Official references checked 2026-10-21: [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and [DeepSeek models/pricing](https://api-docs.deepseek.com/quick_start/pricing). DeepSeek recommends `deepseek-flash`, then served by DeepSeek-V4.1-Flash-1017. An alias is not proof of a particular backend revision or future availability.

Saving native Settings does **not** update an already-running app; env edits never configure desktop. Quit/reopen the native app to apply saved settings; rebuild only for source changes. Do not restart an unrelated/primary process merely to smoke a worktree. Use a task-owned native launch with a disposable populated DB/config/token copy for chat/memory writes. Source/config rollback restores only the relevant provider/model lines, preserving current credentials and unrelated settings. No schema migration or data back-sync is needed for these defaults.

## Runtime trainer model preference

Chat's compact **Model** selector (accessible name **Trainer model**) lists only locally eligible activated entries, including multiple models per provider and keyless eligible Ollama. Labels include provider and literal actual ID, even when friendly names repeat. Missing-key cloud entries are absent from the choices. An unavailable selected identity retains its warning and a disabled placeholder, never silently selecting the first eligible entry. Deliberate replacement is required; there is no Default/reset action. New configurations remain unselected even with one eligible row. Empty or entirely ineligible catalogs disable selection and explain native Settings plus quit/reopen remediation. Local eligibility is not entitlement, funding, installed-model or remote readiness; GET/PATCH never probes providers.

The single-user per-selected-DB choice uses additive existing `app_metadata` key `ai.chat_model.choice`: strict JSON v1 with `status: selected` plus opaque `entryId`, or `status: unselected|unresolved`. Presence is authoritative; corrupt/unknown records refuse without overwrite or legacy fallback. Initialization atomically inserts only if absent and rereads the committed winner before use. Storage failure never serves an in-memory fallback.

Compatibility runs once: nonempty v2 exact ID (including unavailable/deleted intent); otherwise, only if v2 is absent, original `gpt-6-luna`/`deepseek-flash` maps through a unique exact provider/literal match; otherwise the prior determinable validated default (including old empty-v2 reset); otherwise processed no selection. Invalid/unresolved prior intent remains unavailable, never provider-only substitution. Originals `ai.chat_model`/v2 remain byte-for-byte unchanged. Native Save retains original catalog/DB compatibility before removal; it is used only for its matching DB. Later catalog/default changes never reseed processed choices. No schema/normalized-data migration or copy-back is introduced.

Each new trainer turn reads and captures the selected model before asynchronous context construction. Saving affects subsequent turns without restarting; planner/synthesis in an already-running turn keep their captured model. Memory extraction remains env-selected and embeddings independent. Chat/Profile/Garmin deletion does not clear this app-owned preference.

`GET /api/model-settings` returns version-3 bounded `options`, `selected`, `status`, `available` and safe optional unavailable explanation, without default/effective/source distinction. `PATCH` accepts exactly `{ modelId: <eligible activated entry identity> }`; null/reset, unknown/extra fields, unknown IDs, malformed input and missing-key choices are rejected before writes. A corrupt or now-unconfigured choice fails closed, never silently falls back; choose an available replacement explicitly. Provider errors do not change the preference. Reads and successful saves return authoritative snapshots; use **Retry model availability** in chat to refresh after failures, or return to chat to revalidate. Keys, raw stored invalid values and upstream/storage errors are not returned.

Saving this preference survives reload/restart but does not hot-reload native Settings/private provider storage. Adding/removing credentials still needs native quit/reopen on the approved target. Rollback requires a compatible build and retained originals; never delete/downgrade authoritative current metadata to force legacy resurrection; no primary restart, data copy-back, public hosting or deployment is implied.

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

Add one or more OpenRouter entries in the normal native catalog, and explicitly save its shared provider key in the private settings file. Maintenance CLI equivalents are `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL`; desktop never reads those from env files. The initial model is `nvidia/nemotron-3.5-lightning:free`. Chat and guarded tools use `https://openrouter.ai/api/v1/chat/completions`; the key stays server-side. Auto selection remains DeepSeek-first/OpenAI-fallback and ignores OpenRouter keys. Missing/placeholder keys fail closed; no paid model or alternate provider is substituted on failure.

OpenRouter receives the same bounded chat/Garmin context as the selected chat provider. Review its account privacy/routing settings before use. Free-model availability, rate limits and tool support can change; doctor reports configuration presence, not remote readiness. The initial Nemotron free model can repeat otherwise successful read-only tool calls and reach the execution limit instead of answering, especially on explicit tool-directed requests. Existing execution limits remain enforced and return a truthful fallback; a successful smoke is not a reliability guarantee. Validate with a bounded loopback chat/tool request. For temporary tests use task-local ignored configuration, restore the prior provider afterward, and retire temporary credentials.

OpenRouter is **chat/tools only**: extraction continues through configured DeepSeek/OpenAI (or deterministic fallback), and embedding configuration is unchanged. OpenRouter catalog entries route exact IDs through the existing chat-completions adapter. There is no OpenRouter extraction/embedding route or cross-provider runtime failover. A saved runtime catalog preference overrides trainer chat until explicitly reset.

## Local desktop mode

The [macOS ARM64 desktop app](desktop.md) bundles Node and a production Next service, adopts explicit private state references and owns only its backend/connector descendants. It neither calls source bootstrap/restart nor starts/pulls external Ollama/Python. Quit before explicit source CLI migration against the same DB; status/doctor remain readonly. Source and desktop preserve provider preferences, NDJSON/title behavior and separate memory readiness; browser-only active selection is not imported.

## Native development and restart

```bash
# Supported app development: assembled production backend plus native dev host.
npm run desktop:dev
# Production: quit, rebuild, then open the unsigned ARM64 app.
npm run desktop:build
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
```

Both use the Tauri-supervised ephemeral loopback service. Development has **no HMR**: quit and rerun to rebuild frontend/backend edits. Config-only edits need native quit/reopen. There is no browser mode, restart port override, listener scanner or service-killing fallback. Native quit stops only its owned descendants; it does not own external Ollama or older source processes.

Prepare optional Ollama separately: use `OLLAMA_HOST=http://127.0.0.1:11434 ollama serve` in your managed terminal, then `OLLAMA_HOST=http://127.0.0.1:11434 ollama pull nomic-embed-text` for embeddings (or your configured model/origin). Chat model preparation is separate. Desktop never starts/stops that daemon or pulls models. Check readonly doctor/memory readiness; unavailable embeddings degrade memory, not offline views. Increase `MEMORY_TIMEOUT_MS` for slow cold loads only when appropriate. Stop external services only after identifying ownership and other consumers.

For recovery use [desktop validation and compatible-revision rollback](desktop.md#validation-and-recovery); never restore standalone browser support or silently migrate/downgrade primary data.
