# Design choices and separation of concerns

The model reasons; SQL retrieves bounded local facts; math transforms them; application code enforces safety. Code must not become the coach through fixed training rubrics, sport preferences, demand formulas or ranking weights.

## Main design principles

### Local-first and private by default

[Desktop](desktop.md) owns the supported macOS ARM64, private single-user loopback product and original-preserving adoption. Private plaintext permissions are not encryption or protection from same-user/privileged processes/backups. [Garmin connection](garmin-auth.md) owns native key handling without email/password/MFA; [runtime](local-runtime.md) owns provider selection. Secrets, auth/session rows, raw FIT, paths, connector handles and env values never enter trainer context. Native Settings may expose editable non-secret configuration, never saved secrets.

Hosted/LAN/multi-user operation, non-loopback Ollama, Garmin write-back and production operations are outside the local MVP. Browser support is retired; legacy connector paths are inert compatibility state, not account switching.

### AI reasoning over tools, not hidden formulas

The model chooses evidence and explains criteria; the server validates/executes. A formula such as “demand score = duration + elevation + calories” may demonstrate math or an explicitly labelled fail-closed fallback, not become primary open-ended coaching behavior.

### Guardrails are code; coaching judgment is model reasoning

[Guardrails](project-guardrails.md) owns allowlists, bounds, handles, syntax, budgets, failures and redaction; [coaching instructions](coaching-instructions-and-sources.md) owns metric relevance, source precedence, gaps and adaptation to sports. Validation does not certify a chosen rubric as sound.

### Data evidence beats prior prose

Disputed rankings, activity identity, sport inclusion or criteria need fresh SQL/math/reference evidence, not repeated assistant prose. Cite executed facts and disclose weak/missing evidence.

### Determinism is for safety, not product ranking

Deterministic rejection and capability-specific side-effect checks are appropriate. Planning-document writes follow user direction; other tools retain their explicit-intent requirements. The [KPI exception](weekly-kpis.md#declared-automatic-points) executes agreed numeric rules only: no inferred qualification, app-selected weights or prose-generated bonuses. Reviewed awards prevail; automatic totals are provisional reads, not assessments.

## Mechanical feature ownership

[Backend roles](architecture/backend-roles.md#enforced-backend-roles-and-composition-inventory) maps ownership; [guardrails](project-guardrails.md#featurelayer-ownership-runtime-and-erased-contracts) owns allowed edges and enforcement limits, including erased types and explicit UI coverage. Never relabel policy as an adapter to pass. Runtime cycles/capabilities remain independently blocking; static checks prove neither arbitrary capability flow, external-package purity, privacy nor coaching semantics.

## Main components and responsibilities

See [component contracts](component-responsibilities.md) and [area guides](architecture.md#area-guides).

## Supported analytics flow

Inspect schema when needed, retrieve bounded candidates with readonly SQL, use math beyond SQL sorting/grouping, then explain criteria/cite results. Challenges merit a safe revised pass with trade-offs, not a fixed ranking fallback.

## Explicit anti-patterns

No unexplained sport/metric weights, generic demand score, generated Python/arbitrary analytics scripts, raw tool-step answers, stale-prose evidence or hidden test-only coaching policy. Missing HR/calories/training effect is an evidence limitation, not a product judgment.

## When deterministic examples are acceptable

Label formulas used to test syntax/validation/rendering. An example becoming the default answer belongs in model guidance or visible criteria selection, not hardcoded behavior.
