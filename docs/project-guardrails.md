# Blocking project guardrails

`npm ci && npm run validate` is the reproducible Node 22 local/private-CI path.
Validation runs Prettier, ESLint (zero warnings), the runtime architecture graph,
Knip, Next type generation and
strict TypeScript, Vitest, then the production build. Checks do not rewrite
source; type generation/build produce ignored framework output. Formatting fixes
are an explicit separate `npx prettier --write <files>` action.

## Lint selection

ESLint 9 uses Next 16 core-web-vitals (including React and React hooks),
TypeScript recommended, no explicit `any`, and no unused variables (underscore
arguments remain intentional). SonarJS 4 adds these blocking rules:

- `no-identical-functions`, `no-all-duplicated-branches`, `no-identical-conditions`
- `no-element-overwrite`, `no-extra-arguments`, `no-ignored-return`
- `no-inverted-boolean-check`, `no-collection-size-mischeck`
- `no-redundant-jump`, `no-use-of-empty-return-value`

Selection measured the pre-change baseline: ten selected SonarJS checks had no
findings; Next/hooks exposed five effect-state, seven dependency and fifteen
module-variable findings, all remediated. Duplicate-string (197 findings) was
not selected: repeated fixture/UI vocabulary is not necessarily duplicated
knowledge. Cognitive-complexity (25 findings at the plugin default) was not
selected: the project has no measured numerical complexity budget, and cohesion
is not a function-size contest. These are selection decisions, not a grandfathered
baseline or per-file debt waiver.

## Typed asynchronous work

All TS/TSX application, tests and tooling use the real `tsconfig.json` project.
`no-floating-promises` (`ignoreVoid: false`), `no-misused-promises` (including
void callbacks/JSX) and `await-thenable` are errors. JS/MJS/CJS remain untyped.
No generated Next files are needed for lint; typecheck still generates them.
Await or return promises when sequencing/propagation is intended. Background work
must attach a meaningful rejection handler, not an empty catch or bare `void`.
The small type-aware `async/no-void-promise` rule also rejects promise erasure in
concise arrow returns, which statement-oriented floating-promise checks miss.
It does not reject void applied to synchronous values. Dashboard event/effect
adapters preserve existing domain errors and cancellation; their final rejection
boundary reports a sanitized unexpected-failure status without response content.
Synchronous SQLite calls remain synchronous.

## Architecture boundaries

`architecture/boundaries` in `scripts/eslint-architecture.mjs` enforces direct
runtime dependencies in `src`:

- Modules with a `use client` directive cannot import database owners,
  Garmin `client`/`importer`/`mcp-config`, environment access or AI providers.
  Shared pure helpers and erased type imports remain available.
- Storage (`src/lib/db`) cannot import AI modules, `ai` or `@ai-sdk/*` at runtime.
  It can use type-only contracts, normalization and persistence dependencies.
  `npm run architecture` adds blocking transitive enforcement over first-party
  `src/**` runtime modules. Every client root and every storage module is checked
  through intermediate helpers/barrels, and runtime cycles (including self-cycles)
  fail anywhere in src. Diagnostics include a deterministic offending path/cycle.
  Tests/tooling are linted but are not runtime cycle roots.

Bounded `math-analysis.ts` may now import **verified pure local helpers**. Its
entire reachable runtime closure must remain free of database, filesystem,
network, process/environment, connector and code-execution capabilities. Shared
scope-aware `no-restricted-globals` policy checks ambient process, fetch, global
objects, browser network APIs, require, eval and Function in every reachable
helper; lexical shadowing remains legal. All external packages/Node builtins and
assets are opaque, not certified pure, and are rejected in the math closure.
No helper extraction is required merely to use this allowance.

TypeScript resolution follows the repository aliases, relative extension/index
resolution and canonical file identities. Shared AST visitors cover imports,
re-exports, literal import(), unshadowed require and TS import-equals. Explicit
erased type declarations/specifiers contribute no edges; mixed imports do.
Use explicit `import type`/`export type` for contracts: inferred type use is
conservatively treated as a runtime dependency. Missing local modules are errors.
Nonliteral loaders or modules outside the analyzable src closure fail closed in
constrained closures. Existing Next relative CSS/static assets are leaf edges,
never pure math helpers. No application module is executed by the checker.

This is **not** package-internal analysis, arbitrary-loader-alias or computed
object/prototype/callback capability-flow proof, a filesystem sandbox, or proof
of privacy/coaching semantics. Aliased loaders and capabilities passed as values
require review; do not rely on static checks alone for security. No arbitrary
external package is claimed pure. Direct rules retain quick editor feedback;
the aggregate gate must always include the graph. Regression tests exercise
real project-backed typed lint probes and positive/negative graph fixtures.

## Knip

`npm run knip` uses Knip 6 full-project analysis, including tests and JS/TS tooling,
with built-in Next, Vitest, ESLint and package-command entrypoint discovery.
It catches unused files/exports/types/dependencies and missing direct dependencies;
exports used only by tests are intentionally considered used. It is not a
production-only reachability proof. Framework page/route exports and CLI scripts
remain entrypoints, not dead code. `ollama` is the sole ignored binary: the local
bootstrap launches the independently installed application, not an npm package.
There are no unused-file/export/dependency debt lists.

Generated `.next`, dependencies, coverage, local `data`, Garmin token/connector
folders and `next-env.d.ts` are excluded from lint; Prettier retains its existing
local/generated exclusions. Secret files are not JS/TS analysis targets. Do not
put credentials or copied local data in source/test fixtures.

For a finding: confirm framework/dynamic/CLI usage, fix real unused code or an
ownership violation, then run the smallest focused test and aggregate validation.
If static analysis genuinely misclassifies a supported entrypoint, model that
specific entrypoint with a documented reason and a regression test. Do not add
blanket ignores, suppressions, baseline files or hotspot limits to avoid remediation.

## Runtime remediation and verification

Navigation effects use React Effect Events to read current handlers without
restarting requests when render-local functions change identity. Browser active
conversation selection is a hydration-safe external store with tab-local change
notifications, not an effect-maintained state copy. Chart selection and paging
are clamped during render; mode changes reset paging in their event handler.
Route changes reset map state before commit. These preserve existing UI contracts;
focused dashboard/hydration tests and local app smoke accompany the change.

No data/schema migration, backfill, deployment, release or new telemetry is part
of these developer checks. Removing unused exports does not remove internal
implementations still in use. The obsolete fresh-schema helper is removed;
existing ordered migrations remain authoritative and unchanged.
