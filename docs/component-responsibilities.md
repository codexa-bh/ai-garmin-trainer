# Component responsibilities

Start with [architecture](architecture.md). This index routes responsibilities to their owners; it is not a second architecture manual.

## Main components and responsibilities

### `src/app`

Tauri WebView UI and loopback HTTP delivery. [Dashboard](architecture/dashboard.md) owns persistent feature state and navigation; routes translate requests/results, not coaching, storage or credentials.

### Chat application and HTTP delivery

[Chat execution](architecture/ai-and-chat.md#chat-execution-and-delivery) owns preparation, generation, completion and transport. [Conversation history](conversation-history.md) owns replay and compaction.

### `src/lib/ai/context.ts`

Bounded source-separated context under [coaching/source-precedence rules](coaching-instructions-and-sources.md), not unbounded history or ranking policy.

### Complete current Training Plan evidence and maintenance

[Training Plan contracts](architecture/personalization-and-plans.md#training-plan-application-and-adapters) own complete prior-pass reads, exact edits, synchronous comparison and independent manual saves. [Coaching](coaching-instructions-and-sources.md#weekly-planning-and-review) owns write intent.

### `src/lib/ai/providers.ts`

[Local runtime](local-runtime.md) owns exact provider selection; [AI adapters](architecture/ai-and-chat.md) own generation and images. No Garmin access or coaching rubric belongs in providers.

### `src/lib/ai/orchestrator.ts`

[AI orchestration](architecture/ai-and-chat.md#ai-application-and-providertool-adapters) owns sequential tool admission, attempt budgets, evidence and synthesis.

### `src/lib/ai/tool-selection.ts`

[Turn execution](architecture/ai-and-chat.md#turn-owned-tool-execution) owns whole-batch validation, stable priority and capacity truncation.

### `src/lib/ai/sql-analysis.ts`

[Guarded analytics](architecture/analytics-and-local-data.md) owns SQL admission, bounded results and readonly execution.

### `src/lib/ai/math-analysis.ts`

[Bounded math](architecture/analytics-and-local-data.md#bounded-math) transforms same-turn rows; [guardrails](project-guardrails.md) checks its pure dependency closure.

### Explicit tool-runtime boundaries (`src/lib/ai/tool-*.ts`)

[Turn execution](architecture/ai-and-chat.md#turn-owned-tool-execution) owns context isolation, dispatch and evidence presentation.

### `src/lib/db`

[Persistence](architecture/server-and-persistence.md#persistence-owners) owns schema, SQL and transactions; feature applications own policy.

### `src/lib/analytics/activity-dashboard-calculations.ts`

[Dashboard calculations](architecture/dashboard.md#selected-activity-chart-and-route-calculations) own pure selected-row charts/routes, not coaching or data access.

### `src/lib/garmin`

[Garmin architecture](architecture/garmin.md) owns the official reader/import pipeline. [Garmin connection](garmin-auth.md) owns native key handling.

### `src/lib/memory`

[Personalization](architecture/personalization-and-plans.md) owns adapters; [memory](memory.md) and [summary](cross-chat-summary.md) own lifecycle and privacy. Conversation continuity stays chat-owned.

### `src/lib/diagnostics`

Allowlisted readiness/redaction reports, never credential contents, coaching or destructive repair. See [source readiness](source-beta-readiness.md).
