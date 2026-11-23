# Component responsibilities

This is the contract index behind [design choices](design-choices-and-boundaries.md). The [architecture area guides](architecture.md#area-guides) own wiring, resource lifetimes and test maps; this page records component-specific rules not covered there.

## Main components and responsibilities

### `src/app`

Next.js supplies the Tauri WebView UI and loopback HTTP delivery, not a standalone browser product or authentication boundary. Routes parse chat/Profile/Sync/deletion requests and keep responses bounded and compatible. They do not own coaching, credentials, schema or analytics formulas. [Dashboard ownership](architecture/dashboard.md#dashboard-ownership-and-lifetime) defines persistent hooks, conditional views and explicit cross-feature callbacks; navigation owns neither requests nor feature state. There is no global dashboard store, mega-hook, event bus or client import of server capabilities.

### Chat application and HTTP delivery

[Chat architecture](architecture/ai-and-chat.md#chat-execution-and-delivery) owns application factories, ports, composition and dependency tests. [Conversation history](conversation-history.md) owns reviewed replay, schema18 admission/completion and schema20 sealed summary pins; the following bounded transcript rules apply to the legacy/unqualified path.

`createChatContext` loads at most 40 history messages, a 6000-character transcript and 12 detail summaries. It selects whole messages without clipping and explicitly marks unavailable context. Request-time current date and prior failures are typed context, not keyword routing. Assistant text is unverified, lower-authority continuity. Counts/detail availability accompany bounded activities, Health, Profile, athlete/body facts, plan preview and clock. Semantic retrieval returns no results without opening its legacy store; qualified replay instead supplies a sealed summary pin. `ai/context.ts` consumes a narrow plan-preview contract, not a repository plan type.

Preparation admits/persists the user; generation returns an answer/progress but never persists an assistant. Completion synchronously persists the assistant and journal, then reloads history without awaiting legacy ingestion or summary work. Synchronous persistence gains no retry or extra async boundary. Selection runs before context reads and supplies a plain generation function, not an SDK model.

Conversation use cases have separate composition with no AI runtime. Storage owns timestamps, cursors, retitling and grounding serialization. Single deletion invokes one atomic adapter operation, then selects the most recent remaining conversation or creates a fallback and reloads the list. Bulk deletion belongs to [local-data lifecycle](architecture/analytics-and-local-data.md#local-data-application-and-adapters).

`api/chat/route.ts` parses GET/DELETE/POST; `delivery.ts` owns JSON/NDJSON DTOs, errors, debug visibility and stream lifetime. Both modes invoke the same application. Streaming chunks final prose, not provider tokens. It checks abort during final-answer deltas and immediately before completion, not during generation or after persistence. Disconnect does not cancel tool effects, roll back the user or undo a saved answer.

The historical prior-failure answer type remains readable but is not generated. Ordinary failure explanations receive previous-failure facts separately from current evidence. Normal JSON counts pre-answer context; failure JSON and stream done count reloaded history. Stream metadata hides debug traces; done/history respect the debug flag. Completion is not retried, and memory failure does not fail an otherwise completed chat.

Direct factories/dependency tests and production chat suites are mapped in the area guide; `conversation-application-wiring.test.ts` additionally covers malformed route behavior. Replay schema changes require the history guide's explicit migration rehearsal and compatibility fence, not a blanket no-op claim.

### `src/lib/ai/context.ts`

Builds bounded system context, separating Profile, memory, Garmin facts and transcript under [coaching/source-precedence rules](coaching-instructions-and-sources.md). It supplies safety framing, not ranking formulas, unbounded history, raw connector payloads or credentials.

### Complete current Training Plan evidence and maintenance

[Training Plan architecture](architecture/personalization-and-plans.md#training-plan-application-and-adapters) owns policy, synchronous ports and tests. The initial whitespace-compacted 2200-character preview is incomplete evidence. `getTrainingPlan` reads the singleton, validates the existing 32000-character/title limits and review metadata, and preserves Markdown. `training-plan/snapshot.ts` owns this contract; `ai/training-plan-evidence.ts` only renders it. Follow-up planning and action-disabled synthesis receive the latest complete read outside the ordinary 1800-character analytics cap, including budget wrap-up. Grounding stores metadata only; debug omits read content and save arguments.

Unsupported structural snapshots fail closed. User-authored path/key-like prose remains complete untrusted document data, not a credential read or native capability; do not censor patterns or overwrite with incomplete redacted text. Manual HTTP saves retain independent parsing/length/error rules and do not acquire the AI complete-read requirement.

Existing-plan tool writes require a complete snapshot seen by a **prior planner pass**, then current-snapshot comparison before synchronous persistence. The server receives that snapshot, not an intent grant. Mutually exclusive `edits`/`contentMarkdown` distinguish targeted editing from replacement. Exact unique non-overlapping edits apply to original text, preserving unmentioned content and omitted title. The planner chooses edits for targeted revision and full Markdown only for creation/whole-plan rewriting.

[Coaching write policy](coaching-instructions-and-sources.md#weekly-planning-and-review) governs direct General Plan/weekly/review saves, actual user direction including draft-only/no-save, ambiguity and untrusted embedded instructions. There is no proposal-wrapper prerequisite, consent classifier, second permission model, extra budget reservation or background write on age alone. This model policy is not deterministic protection against mistaken or injection-induced decisions. Legacy whole-message continuity above lets short confirmations refer to previous options/reasons without promoting assistant prose to facts.

Structural rejections explain the reason without raw errors; uncertain persistence asks for saved-state inspection before retry. No plan history, expanded SQL authority or Garmin write-back is implied.

### `src/lib/ai/providers.ts`

Constructs exact provider adapters from a configuration snapshot; [model settings](local-runtime.md) owns preference policy and the chat-only override. Vendor wiring must not change analytical meaning, access Garmin data or embed coaching rubrics. OpenRouter uses explicit chat-completions with bounded failures and no substitution; automatic selection remains DeepSeek-first/OpenAI-fallback. Ollama must be loopback. Chat routes stay separate from legacy DeepSeek/OpenAI extraction and independent embeddings; [summary/title configuration](memory.md) is also independent.

### `src/lib/ai/orchestrator.ts`

[AI architecture](architecture/ai-and-chat.md#ai-application-and-providertool-adapters) owns the plain generation/tool ports and provider adapter. Orchestration has no SDK, model, DB, connector or outer-composition dependency, including erased types. It owns sequential admission, raw-call parsing, prior-pass plan snapshots and the following budget/failure policy:

- At most 30 combined admitted provider/tool attempts, including failures and final synthesis; 20 is guidance, not a second hard limit. Every planning request includes a live budget snapshot counting that request first. Successful-tool quotas are retired.
- Reserve one provider attempt for action-disabled final synthesis with no exposed tools. Exploration/batch truncation cannot consume it. Count actual tool attempts separately from synthetic skipped-selection/budget diagnostics; those remain visible in grounding but are not executions.
- After a planner exception with executed evidence, use the admitted reserve once to explain facts and gaps. First-call failure without evidence returns immediately. Missing/malformed/failed/timed-out final synthesis produces bounded truthful prose, without another call, mandatory narrower follow-up or replayed effects.
- Envelope requests carry detailed paired native results plus a fresh status/handle index; legacy requests carry textual evidence. Unpaired non-execution diagnostics stay in context. Ordinary nonempty text with no pending calls finishes directly, without claim certification, a prose classifier or repair checker. Evidence accuracy and limitations remain model responsibilities.
- Keep logs out of final prose without rejecting valid explanations by evidence labels or JSON-looking prefixes. Exclude secrets, raw dumps and unsolicited SQL text. Fail closed when synthesis fails, preserving disclosure of independently successful writes.

No fixed demand/load/sport/ranking rubric or mutation outside validated tools belongs here. Planner guidance avoids forbidden SQL tokens even as aliases (`total_training_load`, not `load`), without relaxing validation or retrying terminal safety rejections.

### `src/lib/ai/tool-selection.ts`

Selection is synchronous and side-effect-free over extracted calls and readonly prior steps. Validate the **whole batch in provider order before** stable priority ordering or capacity truncation: the first invalid call rejects all calls, even beyond remaining capacity. Only successful prior steps influence priority; selection invents no prerequisites and does not filter by success counts. Repeated valid calls remain separate. Metadata describes the original batch; skipped counts include valid capacity-truncated calls.

Dependencies are neutral schemas/descriptions, execution policy, erased tool types and the rejected-step constructor in `tool-step-diagnostics.ts`. SDK wrapping belongs only to `provider-tool-definitions.ts`; no execution, handlers, provider, DB, connector or orchestrator back-import belongs in selection. The turn loop rechecks capacity before dispatch, counts failed admitted attempts, and retains separate successful/unsuccessful progress. [Tool execution architecture](architecture/ai-and-chat.md#turn-owned-tool-execution) maps direct and integrated tests, including three-execution mode.

### `src/lib/ai/sql-analysis.ts`

[Guarded analytics](architecture/analytics-and-local-data.md#guarded-analytical-policy-and-sqlite-execution) owns schema/admission, supplied execution ports, readonly SQLite lifetime and tests. Tools see only that facade, never DB/statement/path values. It describes allowlisted tables/columns and runs one capped SELECT/WITH; only success registers a same-turn math handle. Inspection accepts no arbitrary metadata SQL. Interactive elapsed timeout is not hard preemption.

Reject writes, PRAGMAs, comments, stacked statements, disallowed tables, auth/session/account data, raw payloads/FIT, unrestricted streams, secrets, paths, connector handles and environment/process/network access. No coaching/ranking formula, synthesis or destructive operation belongs here.

### `src/lib/ai/math-analysis.ts`

Pure bounded TypeScript transforms same-turn SQL rows: formula scoring, normalization, ordering/ranking, aggregation and summaries. Validate syntax and referenced numeric columns; preserve row/byte/output bounds. [Guardrails](project-guardrails.md#architecture-boundaries) governs verified pure local helpers, excluding opaque packages/loaders and DB/filesystem/network/process/environment/connector/arbitrary-script access throughout the closure.

Eligible column mismatches get bounded correction hints: formula/grouping use input fields, ordering uses transformed output fields. Omit values and sensitive-looking identifiers; return at most 16 ASCII names of at most 48 bytes each. Rejected attempts publish no handle. Eligible correction returns to fresh budgeted planning and discards stale batch tails; repeated unchanged failure without analytical progress ends in an honest limitation.

Math does not choose coaching, sport-demand, medical-response or training-load policy, and cannot access anything outside supplied same-turn rows.

### Explicit tool-runtime boundaries (`src/lib/ai/tool-*.ts`)

[Turn-owned execution](architecture/ai-and-chat.md#turn-owned-tool-execution) owns dispatch, context lifetime/isolation, evidence and their tests. Neutral schemas accept rich saved legacy calls while advertising minimal current model shapes; shared document bounds belong to `training-plan/limits.ts`, with the old entry retained only as a compatibility re-export. No plugin registry, service container or ambient setter is introduced.

Each turn explicitly passes its own handle context, cleared in `finally` without mutating returned evidence arrays or touching another turn. Successful SQL/math alone register handles; within-turn replacement/chaining remain supported. Evidence presentation has erased result imports and no execution capability; complete-plan evidence has the separate full-document/privacy contract above. Synchronous plan compare/edit/write gains no await. HTTP disconnect is not provider cancellation; overlap tests cover clearing, overwriting and consuming another turn's handles.

### `src/lib/db`

[Persistence owners](architecture/server-and-persistence.md#persistence-owners) owns the lazy connection, schema/migrations, repositories and deletion transactions. Feature applications own normalization and lifecycle selection; adapters own SQL/row decoding. Storage separates Garmin, Profile, memory and chat and supplies synchronous capabilities, never prompts/providers/coaching. Extracted owners do not import compatibility facades. [Bulk deletion](architecture/analytics-and-local-data.md#local-data-application-and-adapters) preserves its exact order/exclusions and reads counts only after commit.

### `src/lib/analytics/activity-dashboard-calculations.ts`

[Selected-activity calculations](architecture/dashboard.md#selected-activity-chart-and-route-calculations) owns timing, speed, signed grade, route filtering/bounds/sampling and tests. Two pure facades consume already selected ordered normalized rows; cohesive private helpers need no generic framework or per-helper service. Repository SQL/lap decoding, local-data read models/HR zones and HTTP labels/serialization remain outside. Preserve zero versus missing speed, window boundaries/duplicate points, full route bounds and sampling; add no measured-speed/GPS/summary fallback or coaching policy.

### `src/lib/garmin`

[Garmin architecture](architecture/garmin.md) owns fixed-origin official Personal API reading, import policy, normalization, checkpoints, detail availability and adapter lifetimes. Redact supported raw payloads through `raw-payload.ts` and the archive writer before local persistence; analytics uses normalized facts, not unrestricted archive access. No alternate endpoints/redirects/connector process, Garmin writes or coaching belongs here. Native Settings owns key entry/storage; the app collects no Garmin password. No DI container, ambient setter, generic persistence interface or second reader per invocation is introduced.

### `src/lib/memory`

[Personalization architecture](architecture/personalization-and-plans.md#personalization-application-and-adapters) owns summary policy/ports, SQLite CAS/seals/source/spend, provider transport and tests. [Memory](memory.md) and [summary protocol](cross-chat-summary.md) own visible lifecycle and privacy. Conversation continuity/pins/compaction remain chat-owned; Profile, Garmin facts and Trainer provider selection are not memory responsibilities.

Legacy vectors/lazy migration remain behind management for preserved-row operations, not ordinary chat or public ingestion/retrieval facades. Trainer preserved-record review uses direct bounded readonly SQL, not that lazy path. No re-embedding/export or stored-row/marker removal is implicit. Profile normalization has its own application and repository; retired proposal/confirm/reject/forget facades are not entrypoints. Shared summary/title selection is explicit, restart-only and independent of chat and summary On/Off; captured keys never substitute providers. Current corrections and authoritative evidence outrank memory, and readiness failures stay explicit.

### `src/lib/diagnostics`

Reports allowlisted environment/configuration readiness and source-beta dependencies, detects unsafe exposure/missing prerequisites, and redacts secrets. It neither reads credential/token contents, changes coaching nor performs destructive remediation.
