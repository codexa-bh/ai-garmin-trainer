# Design choices and separation of concerns

This app is a local-only Garmin trainer. Its core design choice is simple:

the model reasons, SQL retrieves bounded local facts, math computes bounded transformations, and application code enforces safety boundaries.

Application code must not quietly become the coach by embedding product-level training rubrics, demand formulas, sport preferences, or ranking weights. If a user asks for criteria, the model should choose and explain criteria from the available evidence and tools. Code may provide guardrails, schemas, limits, validation, deterministic failure text, and generic math primitives; it should not hardcode the product answer.

## Main design principles

### Local-first and private by default

- The supported runtime is single-user loopback/local use.
- Garmin credentials and connector auth state stay outside the web app.
- The app stores normalized local data and avoids exposing secrets, filesystem paths, auth/session rows, raw FIT dumps, connector handles, or environment values to the model or UI.
- Public hosting, LAN exposure, non-loopback Ollama endpoints, multi-user tenancy, Garmin write-back, and production operations are outside the local MVP boundary.

### AI reasoning over tools, not hidden formulas

The trainer chat is intended to be model-driven within strict server boundaries:

1. The model decides whether local Garmin evidence is needed.
2. The model selects safe tools such as schema inspection, read-only SQL, and bounded math.
3. The server validates and executes those tools.
4. The model synthesizes a user-facing answer from server-authored evidence.

Hardcoded formulas such as “demand score = duration + elevation + calories” are not the app architecture. They may exist only as explicitly labelled examples, tests for generic math syntax, or fail-closed fallbacks when no model/tool answer is possible. They must not be the primary behavior for open-ended coaching questions.

### Guardrails are code; coaching judgment is model reasoning

Application code owns safety and correctness boundaries:

- read-only SQL validation;
- allowlisted tables and columns;
- result row/byte limits;
- same-turn result handles for math;
- formula syntax validation;
- tool-call count budgets;
- provider failure handling;
- privacy redaction and forbidden data classes;
- canonical coaching, source-precedence, and calculation instructions;

The model owns contextual judgment inside those boundaries:

- choosing relevant metrics for a user question;
- explaining why those metrics are appropriate;
- acknowledging missing or weak evidence;
- comparing alternatives when the user challenges the criteria;
- adapting criteria for different sports without code forcing a sport-specific rubric.

### Data evidence beats prior prose

Prior assistant answers are not authoritative Garmin evidence. If a follow-up disputes a ranking, sport inclusion, activity identity, or criterion, the app should verify with current local data through SQL/math or reference lookup. The final answer should cite evidence that came from server-executed tools, not from memory of prior generated prose.

### Determinism is for safety, not product ranking

Deterministic code is appropriate for:

- rejecting unsafe SQL or malformed math;
- returning concise failure explanations;
- preserving no-raw-tool-dump behavior;
- enforcing no side effects unless explicitly requested and safe;
- formatting bounded evidence summaries.

Deterministic code is not appropriate for silently deciding that one fixed demand formula, sport grouping, or weighting scheme is “the” generic trainer answer.

## Main components and responsibilities

### `src/app`

Next.js routes and local UI shell. The [current component map](architecture.md)
provides source/test entry points, dependency flow and operational references for
all component families. The shell composes persistent feature hooks under
`src/app/dashboard/` and conditional views; feature state and HTTP lifecycles are
not owned by navigation. Explicit shell callbacks coordinate sync → Health and
chat → memory/conversations/Training Plan. No replacement global dashboard store,
mega-hook, event bus or server imports are introduced.

Responsibilities:

- expose app routes and API endpoints under the operational loopback-only binding (routes are not an authentication boundary);
- accept chat/profile/sync/delete requests;
- render local UI state and user-facing messages;
- keep API responses bounded and compatible with current UI consumers.

Non-responsibilities:

- no coaching heuristics;
- no direct Garmin credential handling;
- no direct database schema ownership beyond route orchestration;
- no hidden analytics formulas.

### Chat application and HTTP delivery

`src/lib/chat/context.ts` receives `ChatContextPorts` through `createChatContext`
and loads bounded local context (40-message history,
6000-character transcript budget, eight semantic matches and 12 detail summaries)
and delegates prompt composition to `ai/context.ts`. It preserves request-time
current-date grounding and preceding Training Plan proposal continuity.

`src/lib/chat/turn.ts` exposes `createChatTurns(ChatTurnPorts)` and owns
preparation (user persistence), generation and completion as distinct operations. Generation returns an explicit generated or
previous-failure answer and optionally forwards existing progress callbacks; it
never persists an assistant. Completion synchronously persists the assistant,
awaits best-effort memory ingestion and reloads history. Neither owner imports
HTTP responses, stream controllers, route modules, storage owners, environment,
provider SDKs or memory singleton implementations, including type-only imports.

`chat/composition.ts` binds the existing adapters lazily. Request-time generation
selection runs before context reads and returns a plain generation function;
SDK model objects stay outside policy. Counts and detail availability are read
before awaited semantic search; activities, health, Profile, athlete/body facts,
plan preview and clock are read after it. No retries or new async boundaries are
introduced around synchronous persistence. The pure AI context formatter consumes
a narrow plan-preview contract rather than a repository-owned plan type.

`chat/conversations.ts` owns history/page and lifecycle use cases, composed
separately in `conversation-composition.ts` so conversation routes need no AI
runtime. `chat/contracts.ts` owns existing Date/null stored shapes and paging;
`conversation-policy.ts` owns ID validation and title normalization. Storage
retains timestamp generation, cursor encoding, retitling writes, grounding
serialization and the atomic single-delete transaction. The use case invokes
that one deletion operation, selects the most recent remaining conversation or
creates a fallback, then reloads the list. Bulk deletion remains outside this
feature and unchanged.

`src/app/api/chat/route.ts` owns request parsing and GET/DELETE/POST routing;
`delivery.ts` owns JSON/NDJSON DTOs, error disclosure, debug serialization and
stream lifecycle. Both modes call the same application operations. Delivery
checks streaming abort during final-answer deltas and immediately before calling
completion, not during generation or after persistence. Disconnect does **not**
cancel orchestration/tool effects, roll back the user, or undo a saved answer.
This is final-prose chunking, not provider-token streaming.

Intentional compatibility differences remain explicit: JSON alone requests a
fresh debug trace when completing a prior-failure explanation; streaming retains
prior grounding and omits metadata for that branch. Normal JSON counts pre-answer
context; failure JSON and stream done count reloaded history. Stream metadata
always hides debug traces, while done/history serialization honors the existing
flag. Completion is not retried. Memory failures do not fail an otherwise
completed chat.

`tests/chat-application.test.ts` exercises factories directly with supplied
ports, without infrastructure module mocks. `tests/chat-dependencies.test.ts`
checks the transitive type-inclusive closure over reviewed plain/pure modules,
with negative infrastructure/SDK/composition fixtures. Production wiring and
malformed conversation route behavior are covered by
`tests/conversation-application-wiring.test.ts` and
`tests/chat-boundaries.test.ts`; the latter characterizes both chat modes and
request-time ordering;
`tests/chat-delivery.test.ts` tests delivery against the application contract.
`tests/chat-route.test.ts` retains integrated real-orchestrator regressions.
No schema, stored shape, prompt, provider/tool policy or UI contract changes;
migration/back-sync is a no-op and source revert is sufficient rollback.

### `src/lib/ai/context.ts`

Builds the bounded trainer system context.

Responsibilities:

- assemble recent local facts, profile, confirmed memories, recent chat, and safety framing;
- keep profile, memories, Garmin facts, and transcript concepts separated;
- assemble dynamic user/Garmin context under the canonical coaching and privacy contract.

Non-responsibilities:

- no ranking formulas;
- no unbounded history dumps;
- no raw connector payload or credential exposure.

### Complete current Training Plan evidence and maintenance

The initial context labels the 2200-character whitespace-compacted preview as incomplete evidence. `getTrainingPlan` reads only the singleton document, validates the existing 32000-character/title limits and stale metadata, and preserves Markdown. `training-plan-evidence.ts` owns that narrow contract. Follow-up planner and tool-disabled final synthesis receive one latest complete read outside the ordinary 1800-character analytics cap, including budget wrap-up. Grounding stores only metadata; debug traces omit read content and save arguments. Unsupported/secret-bearing documents fail closed rather than masquerading as complete redacted evidence.

Existing-plan writes require a complete snapshot already seen by a prior planner pass and a current snapshot comparison before synchronous persistence. General transcript formatting continues to omit assistant claims. The chat application context separately supplies only the immediately preceding assistant reply (at most 4000 characters) as unverified Training Plan proposal continuity, never Garmin/measurement evidence, policy or independent permission. Oversized/missing proposals require clarification rather than guessing; historical assistant replies remain omitted. This narrow context is needed to resolve short confirmations without promoting assistant claims to facts. One conversation-aware planner owns semantic write intent: direct requests and clear current-user confirmation of an immediately preceding concrete proposal can save; ambiguous assent requires clarification. Review, criticism, suggestions, quoted/hypothetical or document-embedded instructions, explicit no-save requests, historical permission and staleness alone must not trigger persistence. There is no independent classifier, permission model call or extra budget reservation. These semantic rules are model policy, not deterministic protection against mistaken or injection-induced planner decisions; removing the second judge intentionally accepts that trade-off. The server receives only an optional complete prior-pass snapshot, not an intent grant. The existing mutually exclusive `edits`/`contentMarkdown` arguments distinguish targeted editing from full replacement without a redundant mode field. Exact unique, non-overlapping edits are applied to the original text; unmentioned text and omitted title are preserved mechanically. Choosing edits for targeted revisions and reserving full Markdown for explicit creation/whole-plan rewriting remain planner responsibilities. Rejections explain their structural reason without exposing raw errors; uncertain persistence advises inspecting saved state before retrying. Coaching judgments remain model-owned. No schema migration, plan history, expanded SQL access, or Garmin write-back is introduced.

### `src/lib/ai/providers.ts`

Provider selection and adapter boundary.

Responsibilities:

- choose the configured model provider;
- keep provider-specific wiring isolated;
- offer explicit OpenRouter chat/tools via the OpenAI-compatible chat-completions adapter, without changing DeepSeek-first/OpenAI-fallback auto selection;
- keep OpenRouter and Ollama chat separate from DeepSeek/OpenAI memory extraction and independently configured embeddings;
- expose bounded OpenRouter failure categories rather than upstream error text, with no automatic model/provider substitution;
- allow vendor changes without changing analytics semantics;
- reject unsupported non-loopback local-provider endpoints before chat wiring.

Non-responsibilities:

- no Garmin data access;
- no app business logic;
- no provider-specific coaching rubric.

### `src/lib/ai/orchestrator.ts`

Server-side tool orchestration for trainer chat.

Responsibilities:

- let the model select needed tools, executed sequentially;
- delegate deterministic batch selection and live successful-quota rechecks to `tool-selection.ts` before sequential execution; planner guidance avoids forbidden SQL tokens even as aliases (for example use `total_training_load`, not `load`), without relaxing validation or making terminal safety rejections retryable;
- enforce the shared execution policy: 30 combined admitted provider/tool attempts per turn, including failed attempts and explicit final synthesis; guide the model to finish within 20 without enforcing that soft target;
- send a live budget snapshot on every planning call, counting that call before rendering remaining capacity; successful schema/SQL/math quotas are separate, and failed queries do not consume those successful quotas;
- reserve one provider execution for tool-disabled final synthesis, stopping exploration/batches before they consume it; reuse current-turn evidence and distinguish verified facts, user statements, general coaching and missing evidence;
- count actual admitted tool attempts separately from synthetic skipped-selection/budget diagnostics; diagnostics remain visible in grounding but do not represent executed tools;
- route invalid/empty/failed/timed-out final synthesis to bounded truthful prose without another call or a mandatory narrower follow-up; wrap-up never replays side effects;
- pass only server-authored bounded evidence into follow-up planning/synthesis;
- prevent raw tool logs from becoming visible assistant prose;
- return fail-closed user-facing text when provider/tool synthesis fails.

Non-responsibilities:

- no fixed demand, training-load, sport-normalization, or ranking rubric as primary behavior;
- no provider-visible secrets, SQL text in final answers unless explicitly requested, or raw dumps;
- no direct connector or database mutation beyond validated tool execution.

### `src/lib/ai/tool-selection.ts`

Synchronous, side-effect-free selection over already extracted provider calls and
readonly turn snapshots. It validates the whole batch in provider order before
filtering, stable priority sorting or truncation: the first invalid call rejects
all calls, even beyond remaining capacity. Only successful prior steps influence
priority; selection neither invents prerequisites nor reserves successful quotas.
Repeated valid calls remain separate. Metadata describes the original batch,
while skipped counts include only eligible calls truncated by turn capacity.

Dependencies are the existing tool contracts/definitions, shared
`TRAINER_EXECUTION_POLICY`, erased tool types and `tool-step-diagnostics.ts` for
unchanged rejected-step construction shared with orchestration. The contracts'
SDK definition wrapper is not provider I/O. No execution context, tool handlers,
provider calls, database, connector or orchestrator back-import belongs here.

The turn loop retains raw-call parsing, provider I/O, mutable counts, actual-attempt
accounting, synthesis reserve, sequential execution, prior-planner-pass Training
Plan snapshots and non-replay/side-effect guards. It calls the same quota predicate
immediately before each execution, so an earlier same-batch success can exhaust a
quota; failed executions never consume successful-result quotas. Public limits,
diagnostic text/privacy, grounding and progress remain compatible.

`tests/tool-selection.test.ts` directly covers validation precedence, defaults,
ordering, repeated calls, quota/capacity edges, metadata and input preservation
without execution/provider mocks. `tests/tool-selection-orchestration.test.ts`
lowers only the test success quota to exercise real-loop live rechecks after
success/failure; existing orchestrator, plan and route tests protect integration.

### `src/lib/ai/sql-analysis.ts`

Read-only analytical SQL boundary over normalized local data.

Responsibilities:

- describe allowlisted analytical tables and columns;
- execute one bounded read-only `SELECT`/`WITH` query;
- reject writes, PRAGMAs, comments, stacked statements, disallowed tables, auth/session/account data, raw payload dumps, secrets, paths, connector handles, environment/process/network access, raw FIT data, and unrestricted stream dumps;
- return capped rows and a same-turn result handle for math.

Non-responsibilities:

- no product ranking formula;
- no hidden sports heuristic;
- no model synthesis;
- no destructive data operations.

### `src/lib/ai/math-analysis.ts`

Bounded TypeScript math over same-turn SQL rows. Pure local runtime helpers are
allowed only when the blocking architecture graph verifies their entire closure
against the same capability restrictions as this root. Opaque external packages
and loaders are not pure-helper exceptions. See [project guardrails](project-guardrails.md)
for the static enforcement boundary and its limits.

Responsibilities:

- compute generic transformations over already-returned SQL rows;
- support safe formula scoring, normalization, ranking/order, aggregation, and summaries;
- validate formula syntax and referenced numeric columns;
- keep row/byte/output bounds;
- operate without database, filesystem, network, process, environment, connector, or arbitrary script access.

Non-responsibilities:

- no app-authored coaching rubric;
- no fixed sport-specific demand score;
- no app-authored medical response policy or training-load authority;
- no access outside the same-turn SQL result set.

### Explicit tool-runtime boundaries (`src/lib/ai/tool-*.ts`)

- `tool-types.ts`: dependency-free names and call/step metadata contracts.
- `tool-contracts.ts`: unchanged provider descriptions, Zod schemas/defaults and
  parsed discriminated calls. No repository or connector runtime imports;
  `src/lib/training-plan-limits.ts` owns shared document bounds.
- `tool-execution.ts`: direct typed dispatch and sanitized exception boundary.
  `tool-analytics.ts`, `tool-local-data.ts` and `tool-training-plan.ts` own
  analytics, sync/reference/detail and complete-plan execution respectively.
  No plugin registry or service container; admission stays in the orchestrator.
- `tool-execution-context.ts`: one transient analytical handle map per invocation,
  required explicitly by execution. Successful SQL/math registers rows; rejected
  results do not. Within-turn name replacement and chained math are retained.
- `tool-evidence.ts`: bounded rendering, redaction and metadata-only grounding.
  Its result-type imports are erased; presentation cannot execute SQL, connector
  calls, writes or provider calls. Complete-plan evidence retains its separate
  full-document exception and sensitive-document rejection.

The orchestrator allocates the context before entering its turn body and disposes
it in `finally` on every exit. Disposal releases map references, not arrays held
by returned steps or final evidence. It never touches another turn, even for the
same conversation. Provider timeout and request-disconnect behavior are unchanged:
route disconnect is not new abort propagation into orchestration. Training Plan
snapshot authorization still comes from a **prior planner pass**; the synchronous
compare/edit/write section has no added await.

T0188 intentionally corrects the old global-map/reset concurrency behavior:
starting a second turn no longer clears, overwrites or exposes another turn's
handles. Controlled real-orchestrator overlap tests reproduced all three failures
before the fix. The subsequent responsibility extraction preserves provider
contracts, budgets, side-effect guards, failure prose and evidence shapes. See
`tests/tool-runtime-ownership.test.ts`, `tests/tool-boundaries.test.ts`, the
pre-extraction provider snapshot in `tests/ai-tools.test.ts`, and existing
orchestration/Training Plan regressions. No new coaching/ranking policy, schema,
backfill or release is introduced; source revert is the rollback path.

### `src/lib/db`

Local SQLite schema and repositories. Cohesive persistence owners are documented
in [the architecture map](architecture.md#persistence-owners): one lazy connection,
a conversation repository, a singleton Training Plan repository and an explicit
cross-domain conversation-deletion lifecycle owner. The latter preserves atomic
message deletion, soft deletion of semantic entries matching both conversation ID
and `kind = 'conversation'`, then conversation deletion—even for a missing target.
Saved/non-conversation memory and other domains are not its deletion authority.
The remaining mixed repository is deliberately deferred, not a generic storage
framework; extracted owners never import its compatibility facade. Source revert
is sufficient rollback because schema, SQL and stored shapes are unchanged.

Responsibilities:

- own normalized storage schema and migrations;
- persist activities, health, detail availability, chat, profile, confirmed memories, and deletion state;
- provide repository functions used by routes/tools;
- separate Garmin data from profile, memories, and chat state.

Non-responsibilities:

- no model prompting;
- no provider calls;
- no product-level coaching heuristics.

### `src/lib/analytics/activity-dashboard-calculations.ts`

Pure selected-activity display calculations, not coaching policy or data access.
Two facades compose chart timing/speed/grade and route filtering/bounds/sampling
from already selected, ordered normalized rows. Plain inputs/outputs and no imports
make the calculations directly testable without SQLite, configuration or connector
setup. Private helpers stay together because window and metadata behavior changes
together; no generic analytics framework or per-helper service layer is needed.

The repository retains SQL, response composition, laps and HR-zone ownership.
Existing timing thresholds, signed grade, zero-versus-missing speed, messages,
point ordering, full route bounds and sampling are preserved, including duplicate
points outside a selected grade window. No measured-speed, GPS or summary fallback
is added. See the [source/test boundary map](architecture.md#selected-activity-chart-and-route-calculations).

### `src/lib/garmin`

Pinned local Garmin connector boundary and normalization.

Responsibilities:

- run the reviewed Garmin MCP dependency over local stdio only;
- import and normalize selected Garmin data into app-owned SQLite rows;
- preserve checkpoints and detail availability;
- archive supported raw connector/detail payloads locally only after redaction via `src/lib/garmin/raw-payload.ts` and the repository archive writer; normalized facts remain the ordinary analytics contract, not unrestricted raw archive access.

Non-responsibilities:

- no web-exposed connector transport;
- no Garmin write-back;
- no password collection in the app;
- no coaching/ranking decisions.

### `src/lib/memory`

Owns embedded SQLite semantic retrieval, concise user-derived extraction,
independently configured embeddings, and inspectable/editable/deletable memory.
It does not own current conversation continuity, Profile, Garmin measurements or
provider chat selection. Current corrections and authoritative tool evidence take
precedence over memory. Readiness/configuration failures are explicit; no hidden
provider substitution or transcript archive is implied. See [memory](memory.md)
and the [source/test map](architecture.md).

### `src/lib/diagnostics`

Local source-beta diagnostics and readiness reporting.

Responsibilities:

- report environment and configuration readiness without printing secret values;
- support dependency/source-beta evidence;
- detect unsafe exposure or missing local prerequisites.

Non-responsibilities:

- no runtime coaching behavior;
- no credential/token content reads;
- no destructive remediation.

## Supported analytics flow

A typical open-ended analytics request should follow this shape:

1. The model asks for schema only if it needs column/table confirmation.
2. The model calls read-only SQL to extract bounded candidate rows and relevant fields.
3. The model calls bounded math only if computation is needed beyond SQL sorting/grouping.
4. The model explains the criteria it chose and cites the bounded results.
5. If the user challenges the criteria, the model can run another safe SQL/math pass with revised criteria and explain the tradeoff.

The app should not pre-decide the rubric in code. The app should make unsafe rubrics impossible to execute.

## Explicit anti-patterns

Do not add new code that:

- hardcodes “the” generic demand score;
- silently weights sports or metrics for an open-ended coaching question;
- forces snowboarding, skiing, hiking, running, or cycling into special ranking behavior without the model explaining why;
- treats missing HR/calories/training effect as a product judgment rather than an evidence limitation;
- exposes generated Python or arbitrary scripts for normal analytics;
- returns raw `Tool step` logs as the assistant answer;
- lets prior assistant prose substitute for fresh Garmin evidence;
- hides policy decisions in tests that the model cannot inspect or explain.

## When deterministic examples are acceptable

Examples in docs/tests may show formulas only to prove generic math syntax, validation, or UI rendering. They must be clearly examples, not app policy. If an example starts becoming the default answer for real user prompts, it belongs in model reasoning/prompt guidance or user-visible criteria selection, not hardcoded application behavior.
