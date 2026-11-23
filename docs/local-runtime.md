# Local runtime and optional providers

← [Installation](../README.md#installation) · [Settings](settings.md)

Tauri is the sole launcher. [Desktop](desktop.md) owns private storage, adoption, lifecycle and activation: only catalog/shared chat keys apply live after acknowledgment; other settings need quit/reopen. Field identifiers below describe internal adapters and deliberately configured non-serving maintenance CLIs, not desktop env-file onboarding. No LAN/public hosting or deployment is authorized.

## Direct OpenAI/DeepSeek switching

Use native Settings to add exact model IDs, then select one in Trainer. [Catalog/storage](desktop.md#private-document-and-catalog) owns entry limits and validation; [Settings](settings.md#catalog-and-provider-controls) explains the controls. Direct OpenAI needs a private API key and paid API/model access, independently of ChatGPT subscription credits.

Legacy/internal extraction/title compatibility inputs remain separate from chat selection. Maintenance equivalents (never loaded by desktop):

```dotenv
AI_PROVIDER=auto
# AI_PROVIDER=openai
# AI_PROVIDER=deepseek
AI_MODEL=gpt-6-luna
DEEPSEEK_MODEL=deepseek-flash
```

Legacy auto chooses DeepSeek first, then OpenAI by configured key; it is not remote-failure recovery. One-time chat compatibility captures determinable exact intent or no selection. Explicit provider intent survives a missing key. Preserve credentials/unrelated values; never put them in tracked files.

OpenAI uses Responses for Luna function calling and structured completion, without Chat Completions fallback, model substitution, reasoning override or extra orchestration retry. Legacy extraction/title inputs and embeddings remain independent. Doctor proves configuration, not entitlement/tool reliability. Before replacing a working selection, validate exact-model coaching, grounded SQL/math and missing-evidence answers on a task-owned loopback launch with disposable populated state; keep the working provider if the new one cannot be validated.

References checked 2026-10-21: [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [DeepSeek models/pricing](https://api-docs.deepseek.com/quick_start/pricing). DeepSeek recommended `deepseek-flash`, then served by DeepSeek-V4.1-Flash-1017; aliases do not prove backend revision or future availability.

Live acknowledgment proves activation, not remote readiness. [Save/recovery](desktop.md#save-and-live-activation) owns saved/not-applied and unknown outcomes. Never restart unrelated/primary processes to smoke a worktree. Provider-default rollback restores only relevant inputs while preserving current credentials; it needs no schema migration or data back-sync.

## ChatGPT subscription

[ChatGPT](chatgpt.md) owns official native system-browser sign-in, consent, registration/model discovery, refresh, disconnect, privacy and proof boundaries. Catalog/model and summary/title choices remain explicit. Its public Responses stream and namespaced tools use no API key, unsupported counting preflight, pricing multiplication or fallback. Token rotation preserves admitted identity; disconnect, permission loss or entitlement change invalidates affected work. The cache presets below do not apply to subscription requests.

## Runtime trainer model preference

The **Model** selector (accessible name **Trainer model**) lists locally eligible activated entries. API-key/Ollama labels are provider / literal ID, ignoring legacy names; subscription labels use account ordinal and unique account-model display name, otherwise slug. Opaque registration/model identity remains exact. Missing-key cloud choices are omitted; eligible keyless Ollama remains. Local eligibility never proves entitlement, funding, installation or remote readiness; GET/PATCH do not probe providers.

Unavailable selection retains a warning and disabled placeholder. Empty/ineligible catalogs disable selection and explain Settings, confirmed live activation and **Retry model availability**. There is no Default/Reset, first-option substitution or provider-only remapping; new configurations remain unselected even with one eligible entry. Returning to chat also revalidates availability.

The per-selected-DB `app_metadata` key `ai.chat_model.choice` holds strict JSON v1: `status: selected` with opaque `entryId`, or `status: unselected|unresolved`. Presence is authoritative; corrupt/unknown records refuse overwrite and legacy fallback. Initialization inserts only if absent and rereads the committed winner. Storage failure never serves an in-memory substitute.

Compatibility runs once, in order:

1. Preserve nonempty v2 exact ID, including deleted/unavailable intent.
2. Only when v2 is absent, map original `gpt-6-luna`/`deepseek-flash` through a unique exact provider/literal match.
3. Otherwise use a determinable validated prior default (including old empty-v2 reset), or processed no selection.

Invalid/unresolved intent stays unavailable. Original `ai.chat_model`/v2 bytes remain unchanged. [Native compatibility preservation](desktop.md#key-intent-and-choice-compatibility) binds original catalog to its DB; later catalog/default edits never reseed processed choices. No schema/normalized-data migration or copy-back occurs.

Each new turn captures its model before asynchronous context construction. Saving affects future turns; running planner/synthesis retains its snapshot. Extraction/title topology remains boot-selected, with live credential rotation/clear but no alternate-cloud substitution; embeddings retain independent startup topology. Chat/Profile/Garmin deletion does not erase this preference.

`GET /api/model-settings` returns bounded version-3 `options`, `selected`, `status`, `available` and safe optional unavailable explanation, with no default/effective/source distinction. `PATCH` accepts exactly `{ modelId: <eligible activated entry identity> }`. Null/reset, extra fields, malformed/unknown IDs and missing-key choices refuse before writes. Subscription permission/model/registration availability is checked separately. Errors never change preference; responses expose no keys, raw invalid records or upstream/storage errors.

Successful saves/reads return authoritative snapshots. Native live catalog/key changes preserve unavailable/deleted choices; secret-free notifications revalidate metadata without interrupting streams. Recover using a compatible build and retained originals, never deletion/downgrade to resurrect legacy metadata.

## Trainer prompt caching and token diagnostics

Providers share one composition: stable coaching/completion/purpose rules precede freshly rebuilt dates, Profile, memory, transcript, weekly status, budgets and current-turn evidence. Context is not locally cached, so deletion, corrections and date rollover remain immediate. Tool order and planner/terminal-only synthesis are unchanged.

Contracts checked 2026-10-21 with `ai` 7.0.29, `@ai-sdk/openai` 4.0.15 and `@ai-sdk/deepseek` 3.0.11:

- **OpenAI Luna:** caching starts at 1,024 visible input tokens. The adapter marks the stable-policy end and requests explicit-only, default 30-minute writes, avoiding the changing suffix. This capability is allowlisted to `gpt-6-luna`, `gpt-6-astra`, `gpt-6.1-sol`; other models keep compatible defaults. No routing key or extended retention is selected. Reads/writes are distinct; the guide describes 128-token read reporting, but record actual counts, not rounded estimates. Expiry, routing, model/settings/tools and prefix changes can miss; breakpoints guarantee no reuse.
- **DeepSeek Flash:** automatic best-effort disk caching persists complete prefix units with common-prefix detection and fixed intervals for long inputs. No OpenAI options are sent. It reports `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, not writes. Construction takes seconds and eviction usually hours–days; no universal minimum/interval is promised.

Sources: [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching), [pricing](https://developers.openai.com/api/docs/pricing), [DeepSeek caching](https://api-docs.deepseek.com/guides/kv_cache). OpenAI's dated standard USD/million rates were ordinary input 0.10, read 0.01, 30-minute write 0.125, 12-hour write 0.25, output 0.50. A 12-hour minimum is not a deletion deadline; the app does not opt in. DeepSeek's pricing URL returned first-call documentation during verification, so no monetary claim was established.

Private traces may record per-call `tokenUsage`: `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `uncachedInputTokens` (excluding reads/reported writes), `outputTokens`. Identity belongs to the containing turn. Missing means unknown, not zero; misses never imply writes. The adapter checks raw presence because SDK defaults can insert zeros, but retains no raw usage object. Count one SDK call, not both steps and aggregates. Historical traces remain readable; capped calls/unknown coverage prevent advertised turn totals. Diagnostics add no prompts/health/provider payloads; [trace privacy](settings.md#cross-chat-memory-and-debug-traces) still applies. Cache misses never trigger extra generation.

### Observed local comparison (not a savings guarantee)

Historical before/after measurements remain in Git/PR history. They are observations, not a current billing or reliability contract: variable analytical paths confounded whole-turn savings, mocked wire tests prove eligibility only, and an auxiliary extraction HTTP 400 was outside trainer-cache success. No guaranteed savings or new remote-readiness claim follows.

## Opt-in OpenRouter chat

Add exact OpenRouter catalog IDs and explicitly save its shared private key. Maintenance equivalents are `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`; desktop never reads them from env files. Initial model: `nvidia/nemotron-3.5-lightning:free`. Chat/tools use `https://openrouter.ai/api/v1/chat/completions`; keys stay server-side. Legacy auto ignores OpenRouter keys. Missing/placeholder keys refuse; failure never substitutes a paid model/provider.

OpenRouter receives bounded chat/Garmin context. Review account privacy/routing first. Free availability, rate limits and tool support change; doctor proves configuration only. The initial Nemotron can repeat successful readonly calls until the execution limit, especially for tool-directed prompts; limits return a truthful fallback, and smoke is no reliability guarantee. Validate with a bounded loopback chat/tool request. Temporary tests use ignored task-local configuration, restore prior selection and retire temporary credentials.

The OpenRouter adapter routes exact catalog IDs through Chat Completions. Legacy extraction remains configured DeepSeek/OpenAI or deterministic fallback, embeddings remain independent, and there is no cross-provider failover. The separately selected [summary/title route](settings.md#cross-chat-memory-and-debug-traces) is not legacy extraction. A saved Trainer choice persists until explicitly replaced, not reset.

## Local desktop mode

[Desktop](desktop.md) owns bundled Node/Next, explicit state references, selected-DB admission and descendant-only lifecycle. It does not call source bootstrap/restart, import browser selection or manage Ollama. Quit before separately approved source migration; doctor/status remain readonly. NDJSON/title behavior and separate memory readiness are preserved.

## Native development and restart

```bash
# Rebuilt production resources plus native dev host; no HMR.
npm run desktop:dev
# Quit, rebuild source changes, then open the production bundle.
npm run desktop:build
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Garmin Trainer.app'
```

Both use the supervised ephemeral service. There is no browser mode, restart port override, listener scanner or service-killing fallback. Config-only startup changes need quit/reopen, not a rebuild.

Manage optional Ollama separately, for example `OLLAMA_HOST=http://127.0.0.1:11434 ollama serve`. The legacy embedding example is `OLLAMA_HOST=http://127.0.0.1:11434 ollama pull nomic-embed-text` (or your configured origin/model); chat preparation is separate. Ordinary memory no longer requires embeddings; retained legacy readiness may degrade without affecting offline views. Adjust `MEMORY_TIMEOUT_MS` for slow cold loads only when appropriate. Identify ownership and other consumers before stopping external services. [Desktop recovery](desktop.md#validation-and-recovery) never restores browser support or silently migrates/downgrades primary data.
