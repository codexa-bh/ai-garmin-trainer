# Design choices and separation of concerns

The model reasons, SQL retrieves bounded local facts, math computes bounded transformations, and application code enforces safety. Code must not quietly become the coach through fixed training rubrics, sport preferences, demand formulas or ranking weights. The model chooses and explains criteria from evidence; code supplies schemas, limits, validation, deterministic failures and generic primitives.

## Main design principles

### Local-first and private by default

[Desktop](desktop.md) owns the supported macOS ARM64 launcher, single-user loopback backend, private plaintext settings and explicit original-preserving adoption. File permissions restrict access, not encryption or same-user/privileged processes/backups. [Garmin connection](garmin-auth.md) owns native key entry, draft/Save/reopen activation and startup capability delivery; the app collects no Garmin email/password/MFA. [Local runtime](local-runtime.md) owns provider selection. Keys, tokens, auth/session rows, raw FIT, filesystem paths, connector handles and environment values do not enter model/trainer context; native Settings may show editable non-secret configuration, never saved secrets.

Public hosting, LAN access, non-loopback Ollama, multi-user tenancy, Garmin write-back and production operations are outside the local MVP. Standalone browser support is retired; legacy connector paths are inert compatibility state, not a live account-switch mechanism.

### AI reasoning over tools, not hidden formulas

The model decides whether evidence is needed, selects safe tools, and synthesizes server-executed results. The server validates and executes. A formula such as “demand score = duration + elevation + calories” may demonstrate generic math, or appear in an explicitly labelled fail-closed fallback, but must not become primary open-ended coaching behavior.

### Guardrails are code; coaching judgment is model reasoning

Code owns SQL allowlists/read-only admission, row/byte limits, same-turn handles, formula syntax, execution budgets, provider failures, redaction and canonical source/calculation instructions. The model chooses relevant metrics, explains their relevance, acknowledges gaps, compares challenged criteria and adapts to sports without a hidden fixed rubric. [Coaching instructions](coaching-instructions-and-sources.md) owns those reasoning rules and source precedence.

### Data evidence beats prior prose

Prior assistant answers are not Garmin authority. Disputed rankings, sport inclusion, activity identity or criteria require current local SQL/math/reference evidence, not repetition of generated prose. Cite server-executed facts and distinguish missing/weak evidence.

### Determinism is for safety, not product ranking

Deterministic rejection, failure explanations, bounded evidence formatting and capability-specific side-effect checks are appropriate. Direct planning-document writes follow actual user direction; other tools keep their explicit-intent requirements. Code must not silently choose a generic demand formula, sport grouping or weighting scheme.

The [weekly KPI exception](weekly-kpis.md) executes only explicitly agreed closed numeric points rules over stored measurements: no app-selected weights, inferred qualification, prose parsing or generated bonuses. Reviewed awards prevail; automatic-containing totals are provisional read results, not saved assessments.

## Mechanical feature ownership

[Backend roles](architecture/backend-roles.md#enforced-backend-roles-and-composition-inventory) maps per-file ownership; [guardrails](project-guardrails.md#featurelayer-ownership-runtime-and-erased-contracts) owns allowed edges, type-inclusive enforcement and limits. Erased infrastructure types still invert an inner dependency. Explicit UI coverage prevents unclassified backend helpers outside usual folders; it adds no unrelated UI layering policy. Do not relabel policy as an adapter to pass checks. Runtime cycles/capability checks remain independently blocking; static analysis neither executes application code nor proves arbitrary capability flow, external-package purity, privacy or coaching semantics.

## Main components and responsibilities

See [component contracts](component-responsibilities.md) and [architecture area guides](architecture.md#area-guides).

## Supported analytics flow

1. Inspect schema only when table/column confirmation is needed.
2. Retrieve bounded candidates/fields with read-only SQL.
3. Use bounded math only beyond SQL sorting/grouping needs.
4. Explain chosen criteria and cite results.
5. If challenged, run a safe revised pass and explain the trade-off.

Execution guardrails reject unsafe operations; they do not certify the model's chosen rubric as sound.

## Explicit anti-patterns

Do not hardcode a generic demand score or silently weight sports/metrics. Do not force snowboarding, skiing, hiking, running or cycling into unexplained ranking behavior. Missing HR/calories/training effect is an evidence limitation, not a product judgment. Do not expose generated Python/arbitrary scripts for normal analytics, return raw `Tool step` logs as answers, substitute assistant prose for fresh facts, or hide policy in tests the model cannot inspect/explain.

## When deterministic examples are acceptable

Clearly labelled formulas may test generic syntax, validation or rendering. An example becoming the default answer to real prompts belongs in model guidance or user-visible criteria selection, not hardcoded application behavior.
