# Blocking project guardrails

[Validation](validation.md) owns setup and execution profiles. After pinned setup, `npm ci && CI=true npm run validate` is comprehensive local validation; push `validate:ci` omits the production build. Checks do not rewrite source. Fix formatting explicitly with Prettier, pinned rustfmt or Ruff; type generation/build create ignored output.

## Lint selection

ESLint 9 uses Next 16 core-web-vitals/React hooks, TypeScript recommended, no explicit `any` and no unused variables (underscore arguments are intentional). SonarJS 4 blocks identical functions/branches/conditions, overwritten elements, extra arguments, ignored returns, inverted boolean checks, collection-size misuse, redundant jumps and use of empty returns. Duplicate-string and cognitive-complexity are not selected: repeated vocabulary need not duplicate knowledge, and there is no measured numerical complexity budget. This grants no baseline/debt waiver.

## Typed asynchronous work

TS/TSX application, tests and tooling use the actual tsconfig project. `no-floating-promises` (`ignoreVoid:false`), `no-misused-promises` including JSX/void callbacks, and `await-thenable` are errors. JS/MJS/CJS are untyped. Await/return promises for sequencing; background work needs a meaningful rejection handler, not bare `void` or empty catch. `async/no-void-promise` also rejects concise-arrow promise erasure, not synchronous void expressions. UI final rejection boundaries expose sanitized unexpected-failure status, not response bodies. SQLite stays synchronous.

`CI=true npx vitest run tests/guardrails.test.ts` exercises real configured lint with successive overlays/imported types. Its long-lived API disables automatic single-run inference so overlays remain current; production CLI retains the optimization. Cold project setup has 30 seconds in `beforeAll`; probes retain five-second timeouts. Setup failure still fails. Lint needs no generated Next files; typecheck generates them.

## Architecture boundaries

The direct ESLint rule gives editor feedback; `npm run architecture` is the authoritative TypeScript-resolved graph:

- Client runtime closures cannot reach DB, Garmin connector/import, environment or provider capabilities. Pure helpers and erased client contracts are allowed.
- Storage cannot reach AI runtime/SDKs; plain type contracts and normalization/persistence dependencies are allowed.
- Runtime cycles, including self-cycles, fail anywhere in `src`; tests/tooling are not runtime roots.
- Bounded math may import verified pure local helpers only. Its whole closure excludes DB/filesystem/network/process/environment/connector/code execution. Scope-aware ambient checks cover process/fetch/globals/browser network/require/eval/Function; lexical shadows are legal. External packages, Node builtins and assets are opaque, not pure-helper exceptions.

Resolution follows aliases, extensions/indexes and canonical identities. Imports/re-exports, literal dynamic import, unshadowed require and TS import-equals are analyzed. Explicit erased declarations contribute no **runtime** edges; mixed/inferred type usage is conservative, so use `import type`/`export type`. Missing locals fail. Nonliteral loaders/out-of-closure modules fail inside constrained closures. Existing Next CSS/static assets are leaf edges, never math helpers. The checker executes no application module.

This is not package-internal, arbitrary alias or object/prototype/callback capability-flow analysis, a filesystem sandbox, or proof of privacy/coaching semantics. Review aliased loaders and passed capabilities. Feature-specific dependency suites additionally check type-inclusive inner closures; [SQL](architecture/analytics-and-local-data.md) and [AI](architecture/ai-and-chat.md) map their runtime/adapter tests.

### Feature/layer ownership (runtime and erased contracts)

`scripts/backend-roles.mjs` explicitly classifies every backend file as domain, application, adapter, composition or delivery, with separate presentation ownership. Unreachable/unclassified source fails too; folders outside lib/api are no escape. New files require reviewed ownership, not suppression. Operational scripts remain outer entrypoints with lint/Knip/type/test coverage.

Allowed edges:

- Domain/plain contracts → domain.
- Application/ports → domain or application, including another feature's use-case contract.
- Adapter → domain, application or adapter.
- Composition/compatibility facade → domain, application, adapter or composition.
- HTTP delivery → domain, application, composition or delivery, never concrete adapters.

Ownership includes erased imports/exports, mixed imports, import-type expressions and TS import-equals, transitively. Erased cycles are not runtime cycles. Unknown/unresolved/nonliteral modules, assets and external packages (including their types) fail in inner closures. Only existing exact Zod imports in `ai/tool-contracts` and `training-plan/snapshot` are exceptions, not blanket package purity. Delivery permits `next/server` and its existing erased AI UI message type, not direct SQL/provider SDKs. Inner ambient restrictions still apply.

Role assignment needs review: do not label policy an adapter to pass. Graph diagnostics give source/line/target witnesses. `architecture-graph`, `guardrails` and `backend-composition` tests cover graph/editor rules and lazy route composition, not arbitrary capability-flow/security proof.

## Knip

Both full-project and production Knip 6 modes block. Production does not count tests as consumers. Framework routes, desktop/OAuth helpers, native bootstraps and package/workflow/Python-invoked tools are individually modelled entrypoints in `knip.json`; orphan helpers are not blanket entries. Ollama remains externally managed.

Knip detects unused files/exports/types/dependencies and missing direct dependencies, not arbitrary dynamic reachability/security. JS/MJS is analyzed but not typechecked. Narrow `@public` reasons may model supported dynamic consumption; a test-only consumer never justifies public status, baseline or debt list. Generated/dependency/coverage/local-data/token folders and `next-env.d.ts` are excluded; credentials/private copied data never belong in fixtures.

Investigate framework/dynamic/CLI use, then remove real dead code or fix ownership. Keep test-only helpers in tests; delete test-only product code while preserving production-entry coverage. Model a genuinely missed dynamic entry narrowly with reason/regression coverage. Retiring a supported contract requires a scope decision. No blanket ignores, debt lists, file-level suppressions or hotspot limits to avoid remediation.

## Rust

Rust **1.98.0** rustfmt checks the whole crate, including Windows source, without compilation. Locked all-target Clippy denies warnings, `dbg_macro`, `todo` and `unimplemented`; assemble current resources first. Nightly macOS runs it after assembly and before native tests; it replaces separate cargo check there. Hosted Clippy is post-merge/macOS-only: Windows formatting is not Windows compilation/lint proof.

Fix findings in code. Retain existing narrow allows; new allows require a genuinely incorrect finding, smallest item and reason. Deny flags stay in quality commands, not Cargo-wide `warnings=deny`.

## Python

`scripts/python-quality-requirements.txt` pins Ruff **0.17.5** and Vulture **2.16** for local/CI/nightly. Wrong/missing tools fail. Tracked-file format/lint covers all Python, including tests/runners; product bundles none. Ruff uses Python 3.12, single quotes, 100 columns and explicit F/E4/E7/E9 rules; no extra families/typechecking are claimed.

Vulture scans non-test tracked Python at confidence 60; tests supply neither definitions nor usage. Its analysis-only dynamic model names standard HTTP/thread callbacks/attributes and the documented external `densify_scenario` entrypoint, with reasons, and never executes. Name matching proves no reachability/absence of dead code.

Trace qualified/dynamic access and side effects before deleting. Use the same narrow dynamic-contract rules as Knip; never retain test-only code as public. Only line-level `# noqa: E402` with a reason after deliberate sys.path setup is allowed. Mechanical formatting stays separate from hand fixes and uses AST comparison ignoring only docstring whitespace.

## Runtime remediation and verification

[Dashboard](architecture/dashboard.md) owns Effect Events, persistent request owners, generation guards and navigation behavior; [backend roles](architecture/backend-roles.md#conversation-titles-and-selection) owns durable selection. Focused UI/hydration tests and applicable real smoke accompany behavior changes. Developer checks themselves do not migrate/backfill, deploy/release or add telemetry; ordered migrations remain authoritative.
