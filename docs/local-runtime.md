# Local runtime and optional providers

← [Installation](../README.md#installation) · [Settings](settings.md)

[Desktop](desktop.md) owns sole Tauri launcher, private state and activation: catalog/shared keys live after acknowledgment; other settings require explicit quit/reopen. Internal/maintenance env names below are **not desktop env-file onboarding**. No public/LAN hosting.

## Direct OpenAI/DeepSeek switching

Add exact model IDs in Settings and select one in Trainer. [Catalog](desktop.md#private-document-and-catalog) owns validation. OpenAI API needs its own key/paid model access, independent of ChatGPT credits. Maintenance-only equivalents:

```dotenv
AI_PROVIDER=auto
# AI_PROVIDER=openai
# AI_PROVIDER=deepseek
AI_MODEL=gpt-6-luna
DEEPSEEK_MODEL=deepseek-flash
```

Legacy auto is DeepSeek-first/OpenAI-by-key, not failure recovery. One-time compatibility captures exact determinable intent; explicit missing-key intent remains unavailable. Never track credentials. OpenAI Luna uses Responses, no Chat Completions/model/reasoning/retry fallback. Legacy extraction/embedding and shared summary/title selection are separate.

Doctor/live acknowledgment proves configuration/activation, not funding/entitlement/tools. Before replacing a working provider, validate exact-model coaching/SQL/math/gaps on owned loopback copies; retain working choice if unverified. [Save uncertainty](desktop.md#save-and-live-activation) requires reconciliation, not primary/unrelated process restart. Rollback only relevant inputs, preserving credentials; no schema/back-sync needed. Provider aliases do not guarantee backend revision/future availability.

## ChatGPT subscription

[ChatGPT](chatgpt.md) owns registration/consent/models/broker/epochs/recovery. Choices stay explicit; no API key/count endpoint/pricing multiplication/fallback. Token-only rotation preserves identity; disconnect/permission/entitlement loss fences old work. Direct-provider cache presets below do not apply.

## Runtime trainer model preference

Accessible **Trainer model** lists eligible activated entries, provider/literal IDs ignoring old names; subscription uses its safe display label/exact registration identity. Missing-key cloud entries are omitted, keyless Ollama eligible. Eligibility is not remote readiness. GET/PATCH do no probes.

Unavailable saved choice remains warning/disabled placeholder; empty/ineligible catalog disables selector with Settings/activation/Retry guidance. No Default/Reset/first-option/provider-only substitution, even with one eligible model. Returning to chat refreshes availability.

Selected DB key `ai.chat_model.choice` is strict v1 selected+entryId or unselected/unresolved. Presence is authoritative; corrupt/unknown refuses overwrite/legacy fallback. Insert-if-absent then reread committed winner; storage failure supplies no in-memory substitute. One-time precedence:

1. Preserve nonempty exact v2 identity, even unavailable/deleted.
2. If v2 absent, uniquely map original Luna/DeepSeek literal provider/model.
3. Otherwise determinable validated prior default (including old empty-v2 reset), or processed no selection.

Keep original legacy bytes. Frozen [native compatibility](desktop.md#key-intent-and-choice-compatibility) seeds only matching original DB once; later catalog changes never reseed. Deletion scopes do not clear preference.

Each turn captures model/config **before context awaits**; new selection affects future turns only. Live key rotation/clear never substitutes cloud provider; startup embedding/topology remains separate. Bounded DTO-v3 GET returns options/selected/status/available/safe explanation, no secrets/default/effective-source hierarchy. PATCH accepts exactly `{modelId:<eligible identity>}`; null/reset/extra/malformed/unknown/missing-key refuses before writes. Subscription adds permission/registration availability. Errors preserve choice and hide raw records/upstream/storage errors. Successful responses are authoritative snapshots; native notifications revalidate without interrupting streams. Recover compatibly, not by deletion/downgrade.

## Trainer prompt caching and token diagnostics

Stable policy, including deterministic allowlisted analytical names/types/units/joins and essential source/coverage caveats, precedes fresh dates/Profile/memory/transcript/planning preloads/budgets/evidence. Schema capability is not live availability or measurements; explicit discovery remains available for uncertain details and fresh coverage. No local context cache: corrections/deletion/date rollover remain immediate.

- Direct OpenAI allowlist Luna/Astra/Sol marks stable-policy end and requests explicit-only default 30-minute writes. Compatible defaults elsewhere; no routing key/extended retention. Visible-input threshold 1024, provider read reporting in 128-token increments. Prefix/model/settings/tool/routing/expiry changes can miss; breakpoint is no reuse guarantee.
- DeepSeek uses automatic best-effort disk prefix caching, no OpenAI options. Hit/miss counters do not report writes; construction/eviction vary, no universal interval/minimum promised.

Check current [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)/[pricing](https://developers.openai.com/api/docs/pricing) and [DeepSeek caching](https://api-docs.deepseek.com/guides/kv_cache). Historical prices/benchmarks belong in Git, not a current savings guarantee. Retention minimum is not deletion deadline; app does not opt into extended retention.

Private per-call diagnostics record monotonic generation elapsed milliseconds, outcome and available input/read/write/uncached/output counts. Time excludes foreground/tool preparation and includes failed generation attempts; historical missing timing stays unknown. Missing counters are unknown, not zero; misses imply no writes. Check observed single-step wire presence before SDK aggregate/default zeros, retain no raw usage object, count one call rather than steps plus aggregate. Chronological compact metadata survives storage pressure for the unchanged 30-execution envelope; verbose text/arguments/results yield first within the 24,000-character grounding limit. Truncation remains explicit. Historical caps/unknown coverage forbid invented turn totals. [Trace privacy](settings.md#cross-chat-memory-and-debug-traces) applies. Cache misses never trigger generation.

### Observed local comparison (not a savings guarantee)

Historical observations remain in Git/PRs. Variable analytical paths confound whole-turn savings; mocked wire tests prove eligibility, not monetary benefit or service readiness.

## Opt-in OpenRouter chat

Explicit catalog/key only; maintenance names AI_PROVIDER=openrouter/OPENROUTER_API_KEY/OPENROUTER_MODEL are not desktop env input. Initial `nvidia/nemotron-3.5-lightning:free` uses fixed HTTPS chat-completions route at openrouter.ai/api/v1. Auto ignores its key; absent/placeholder/failure never substitutes paid provider/model. Saved choice changes only by explicit replacement.

Review privacy/routing before transmitting bounded chat/Garmin context. Free availability/rates/tools vary; doctor is configuration only. Repeated readonly calls may exhaust budget and return truthful fallback—smoke is no reliability guarantee. Validate bounded owned request, keep temporary config ignored and retire test keys/restore choice. Legacy extraction stays separate DeepSeek/OpenAI/deterministic path, embeddings independent; explicit summary/title is not legacy extraction.

## Local desktop mode

[Desktop](desktop.md) owns immutable bundle, selected-DB admission/descendant lifetime and existing-data recovery. No source bootstrap/browser-selection import/Ollama management. Quit before separately approved migration; doctor/status are readonly.

## Native development and restart

```bash
npm run desktop:dev  # production resources/native host, no HMR
npm run desktop:build
open 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/AI Trainer for Garmin Connect.app'
```

Quit before rebuilt reopen; config-only startup changes need reopen, not rebuild. No browser mode/port override/listener scanner/service-killing fallback. Manage Ollama independently, e.g. `OLLAMA_HOST=http://127.0.0.1:11434 ollama serve`; legacy embeddings may use `ollama pull nomic-embed-text`, separate from chat preparation. Ordinary memory needs no embeddings; legacy degradation need not block offline views. MEMORY_TIMEOUT_MS may help appropriate cold loads. Inspect ownership/other consumers before stopping external services.
