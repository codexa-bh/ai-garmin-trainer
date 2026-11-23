# Design choices and separation of concerns

This app is a local-only Garmin trainer. Its core design choice is simple:

the model reasons, SQL retrieves bounded local facts, math computes bounded transformations, and application code enforces safety boundaries.

Application code must not quietly become the coach by embedding product-level training rubrics, demand formulas, sport preferences, or ranking weights. If a user asks for criteria, the model should choose and explain criteria from the available evidence and tools. Code may provide guardrails, schemas, limits, validation, deterministic failure text, and generic math primitives; it should not hardcode the product answer.

## Main design principles

### Local-first and private by default

- The sole supported product launcher is the macOS ARM64 Tauri app supervising its single-user loopback Next.js/Node backend; standalone browser support is retired.
- The user's Garmin Personal API key stays outside the trainer renderer: it is entered only in trusted local native Settings, stored in the native owner-private settings file, passed to the owned backend as a startup capability and never exposed to the trainer/model/HTTP APIs. The app never collects Garmin email/password/MFA ([authority: T0351](https://github.com/codexa-bh/ai-garmin-trainer/blob/main/docs/garmin-auth.md)). Provider keys stay in a native owner-private plaintext file with metadata-only UI reads. Folder `0700`/file `0600` restrict access, not encrypt it: same-user/privileged processes and backups can read it. Legacy Keychain access occurs only after explicit setup adoption; originals remain intact, with private re-entry after denial and no automatic retry.
- The app stores normalized local data and avoids exposing secrets, filesystem paths, auth/session rows, raw FIT dumps, connector handles, or environment values to the model/trainer UI. Local native Settings shows editable non-secret DB/settings, not saved keys or token contents. Old unofficial-connector paths remain inert compatibility state; a new Garmin key is a draft until Save/Finish and applies only at reopen, never a running account switch.
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
- enforcing capability-specific side-effect rules (direct planning-document writes follow actual user direction; other tools retain explicit-intent requirements);
- formatting bounded evidence summaries.

Deterministic code is not appropriate for silently deciding that one fixed demand formula, sport grouping, or weighting scheme is “the” generic trainer answer. The narrow weekly KPI exception executes only explicitly agreed closed numeric points rules from stored measurements: no app-chosen weights, inferred qualification, prose parsing or bonus generation. Reviewed awards remain authoritative; automatic-containing totals are provisional, pure read results, not saved assessments.

## Mechanical feature ownership

The backend now has a reviewed per-file feature/layer inventory and a separate
**type-inclusive ownership graph**, in addition to the existing runtime graph.
Domain depends on domain; applications depend on inward contracts/applications;
adapters implement those ports; composition binds adapters; HTTP invokes composed
use cases. A type-only infrastructure import is still an ownership inversion,
not an acceptable way to avoid runtime lint. The narrow existing schema-only Zod
owners remain accepted; provider/DB/framework types do not become domain contracts.
See the [role/port/lifetime inventory](architecture/backend-roles.md#enforced-backend-roles-and-composition-inventory)
and [mechanical rules and limits](project-guardrails.md#featurelayer-ownership-runtime-and-erased-contracts).

Explicit UI ownership prevents new backend helpers outside the usual folders from
escaping coverage, without introducing unrelated UI layering rules. Role entries
are review decisions, not permission to relabel policy as infrastructure. Existing
scope-aware capability checks, runtime cycles, client/server, storage/AI and pure
math enforcement remain independent and blocking. No application code executes
inside the checker. Static analysis does not prove arbitrary loader/capability
flow, external package purity, privacy or coaching semantics.

## Main components and responsibilities

See [component responsibilities](component-responsibilities.md).

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
