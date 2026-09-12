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

Next.js routes and local UI shell.

Responsibilities:

- expose loopback-only app routes and API endpoints;
- accept chat/profile/sync/delete requests;
- render local UI state and user-facing messages;
- keep API responses bounded and compatible with current UI consumers.

Non-responsibilities:

- no coaching heuristics;
- no direct Garmin credential handling;
- no direct database schema ownership beyond route orchestration;
- no hidden analytics formulas.

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

### `src/lib/ai/providers.ts`

Provider selection and adapter boundary.

Responsibilities:

- choose the configured model provider;
- keep provider-specific wiring isolated;
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
- validate tool calls before execution; planner guidance avoids forbidden SQL tokens even as aliases (for example use `total_training_load`, not `load`), without relaxing validation or making terminal safety rejections retryable;
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

Bounded TypeScript math over same-turn SQL rows.

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

### `src/lib/ai/tools.ts`

Tool schema, validation, execution adapter, rendering, and grounding bridge.

Responsibilities:

- define provider-visible tool schemas and descriptions;
- validate tool inputs;
- route validated calls to server-owned implementations;
- preserve compatibility metadata for UI/API grounding;
- render bounded tool evidence for model synthesis and diagnostics.

Non-responsibilities:

- no hidden ranking policy;
- no obsolete tool exposure that encourages unsupported analysis paths;
- no raw secret/path/payload rendering.

### `src/lib/db`

Local SQLite schema and repositories.

Responsibilities:

- own normalized storage schema and migrations;
- persist activities, health, detail availability, chat, profile, confirmed memories, and deletion state;
- provide repository functions used by routes/tools;
- separate Garmin data from profile, memories, and chat state.

Non-responsibilities:

- no model prompting;
- no provider calls;
- no product-level coaching heuristics.

### `src/lib/garmin`

Pinned local Garmin connector boundary and normalization.

Responsibilities:

- run the reviewed Garmin MCP dependency over local stdio only;
- import and normalize selected Garmin data into app-owned SQLite rows;
- preserve checkpoints and detail availability;
- discard or redact sensitive raw connector fields according to the storage boundary.

Non-responsibilities:

- no web-exposed connector transport;
- no Garmin write-back;
- no password collection in the app;
- no coaching/ranking decisions.

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
