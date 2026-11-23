# Architecture: AI, chat execution and tools

Part of [architecture](../architecture.md). Product reasoning/source policy belongs to [coaching instructions](../coaching-instructions-and-sources.md); provider selection belongs to [local runtime](../local-runtime.md).

## AI application and provider/tool adapters

`ai/orchestrator.ts` consumes plain `TrainerOrchestrationPorts` for generation and admitted tool execution. `ai/composition.ts` binds the selected provider through `provider-generation.ts`; `tool-composition.ts` binds feature capabilities. Inner policy has no SDK, storage, connector, environment or outer-composition dependency, including erased types.

The loop owns raw-call parsing, sequential admission, prior-pass plan snapshots and **actual attempts**: hard limit 30 combined provider/tool calls, soft target 20, with one action-disabled synthesis reserve. Failures count; skipped-selection diagnostics do not. Each planning request counts itself before rendering remaining capacity. There are no successful-tool quotas. Recheck capacity before dispatch and never replay effects during wrap-up.

After a planner failure with executed evidence, the reserve may explain supported facts and gaps once. A first-call failure without evidence returns immediately. Missing, malformed, failed or timed-out synthesis falls back to bounded truthful prose without another call, preserving disclosure of successful writes. Planner SQL guidance avoids forbidden aliases (`total_training_load`, not `load`) without weakening admission or making safety rejections retryable.

The provider adapter preserves native action-tool options and ordinary text results. Each call owns a 180000ms AbortController timer, cleared on settlement. HTTP disconnect does not cancel provider/tool effects. Memory configuration remains independent.

### Ordinary chat answers and evidence

Nonempty text with no pending action calls finishes normally. Mixed text/actions still execute validated actions. Empty/malformed output is a provider failure, not a failed evidence certificate. Final synthesis exposes no tools; unexpected calls never execute. There is no prose classifier, second judge, claim certificate or automatic repair loop. Accurate numbers, faithful prose and disclosed missing/ambiguous/failed/partial/truncated evidence remain model responsibilities; lookup metrics need no duplicate SQL for invented claim references.

On conversation-envelope routes, paired native results are the sole detailed step evidence; fresh context contains only status/successful-handle indexes and unpaired diagnostics. Complete General Plan and weekly documents retain bounded native carriers and untrusted-document framing. Earlier pairs remain historical; the latest General Plan and last two successful weekly reads keep their applicability. Legacy routes use textual evidence. An index alone proves no measurement, coverage or write authority. Debug/history remain separate, and historical diagnostics are not revalidated or rewritten.

### Activity numbers and optional images

`getActivityDashboard` reads one known imported ID through local-data composition. Numerical default includes no GPS, raw streams, charts, refresh or focused-UI dependency. Shared projections preserve UI units/nulls/speed fallback. Separate normalized grounding adds signed battery delta, source-distinct list/FIT cadence/stride, historical lap HR buckets and five snowboard split types, with independent coverage. Supplementary detail caps are 20 laps × 8 buckets; at the 100-row dashboard source cap the lap source total is unknown. Complete HR-zone provenance precedes optional lap/terrain sections. Terrain coverage remains independent of valid summary/HR facts.

Explicit unique `panels` chooses heartRate/elevation/speed/route images from the same captured input. The resvg-wasm adapter reuses chart calculations and offline map projection; route geometry is never implicit and discloses no tiles/topography, sampling and attribution. It uses macOS Helvetica/Menlo, no bundled/downloaded fonts. Panels are 960×540, at most 1 MiB each/four panels; above 100,000 chart samples report `render_input_limit`, not silent clipping. A separate identity line fits full 64-character IDs. Missing input/render/model support leaves usable numbers and per-panel unavailability. Finite detailed evidence bypasses the generic 1800-character preview.

Turn context owns image bytes separately from steps/debug/history and clears references/bytes in `finally`, including invalidation. Already exported SDK/provider copies cannot be recalled. Later turns must request images again. Capture metadata binds activity, source hash, UTC instant and panel; currentness checks bracket async work. No durable media store exists.

`provider-activity-images.ts` is the exact support inventory: direct OpenAI Responses gpt-4o/gpt-4o-mini/gpt-4.1 entries and loopback Ollama llava/llama3.2-vision base or `:latest`. This is adapter support, not readiness certification. Unreviewed identities (including gpt-6), custom tags, DeepSeek and OpenRouter are unsupported; no probing/fallback. Image-bearing Responses requests use `store:false`; error echoes become fixed safe errors, not a guarantee of external retention. Responses carries native PNG parts; Chat Completions uses paired call/results plus one labelled current-turn user image message. Numbers have one detailed carrier on both native and legacy routes. Serialized-request tests do not prove live interpretation.

## Chat execution and delivery

Flow: `route → delivery → chat/composition → chat/turn`. Factories consume feature ports; composition binds adapters without opening storage/selecting providers at import time. Request-time model/config selection precedes context reads. [Conversation history](../conversation-history.md) owns reviewed replay, journal/segment transactions, compaction and summary pins.

Legacy context selects whole messages without clipping: at most 40 messages, 6000 transcript characters and 12 detail summaries. Unavailable context is explicit; assistant text is lower-authority continuity. Current date and prior failures are typed context, not keyword routing. Counts, bounded Garmin/Profile/body/plan facts and clock are separate sources. Semantic retrieval supplies no results without opening its legacy store.

Preparation atomically admits the user/source. Generation returns answer/progress, never an assistant write. Completion synchronously links assistant and journal, then reloads history without awaiting legacy extraction or global-summary work. Privacy/currentness checks stop stale work and final delivery, including summary manual/control/expiry authority even for null pins. Owned failure releases admission. Revocation removes marked summary-dependent debug copies while preserving original visible answers and legacy grounding; a completing correction receives only its own updated receipt.

`delivery.ts` owns DTOs, debug visibility and JSON/NDJSON. Streaming chunks final prose, not provider tokens; abort is checked during deltas and immediately before completion, not after persistence. Disconnect neither rolls back the user nor undoes effects/saved answers. Normal JSON counts pre-answer context; failure JSON and stream done count reloaded history. Stream metadata hides debug, while done/history honor the flag. Completion is not retried; memory failure does not undo a completed answer. Historical prior-failure shapes remain readable but new explanations use ordinary generated answers.

Conversation routes use separate composition without AI runtime for history/paging/create/rename/delete. Storage owns timestamps, cursors and grounding serialization. Deletion calls one synchronous transaction, then selects the newest remaining conversation or creates a fallback and reloads. Missing-target deletion still cleans matching conversation-derived memory only; bulk scopes are [local-data-owned](analytics-and-local-data.md#local-data-application-and-adapters).

## Turn-owned tool execution

`tool-contracts.ts` owns strict Zod schemas/defaults and neutral descriptions. Minimal model shapes and rich legacy-call parsing stay distinct; only `provider-tool-definitions.ts` wraps SDK tools. Selection validates the entire batch in provider order **before** priority sorting/truncation: one invalid call rejects all, including beyond capacity. Only successful prior steps affect priority; repeated valid calls stay separate. Original-batch metadata and skipped-capacity counts are retained. Selection imports no execution/orchestrator capability.

Each turn explicitly passes one `TrainerToolExecutionContext` through typed dispatch and disposes it in `finally`. Successful SQL/math alone register handles; within-turn replacement/chaining is allowed. Disposal releases references without mutating returned arrays or touching another turn. Math receives rows, not the owner/repository. Dispatch sanitizes exceptions; `tool-evidence.ts` renders/redacts/grounds but cannot execute anything. Complete-plan evidence follows [its separate contract](personalization-and-plans.md#training-plan-application-and-adapters). Plan compare/edit/write is synchronous; no singleton context, ambient setter or plugin container.

Verification entry points: `ai-application`, `ai-dependencies`, `provider-generation`, `chat-application`, `chat-dependencies`, `chat-delivery`, `chat-boundaries`, `chat-route`, `tool-selection`, `tool-selection-orchestration`, `tool-runtime-ownership`, `tool-boundaries` and `trainer-request-evidence` tests. Supplied-port tests complement real SQLite/production wiring and overlapping-turn tests; the [ownership graph](../project-guardrails.md) checks erased dependencies too.
