# Blocking project guardrails

`npm ci && npm run validate` is the reproducible Node 22 local/private-CI path.
Validation runs Prettier, ESLint (zero warnings), Knip, Next type generation and
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

## Architecture boundaries

`architecture/boundaries` in `scripts/eslint-architecture.mjs` enforces direct
runtime dependencies in `src`:

- Modules with a `use client` directive cannot import database owners,
  Garmin `client`/`importer`/`mcp-config`, environment access or AI providers.
  Shared pure helpers and erased type imports remain available.
- Storage (`src/lib/db`) cannot import AI modules, `ai` or `@ai-sdk/*` at runtime.
  It can use type-only contracts, normalization and persistence dependencies.
- Bounded `math-analysis.ts` cannot acquire runtime imports. It uses only
  same-turn rows, erased types and pure built-in operations. Scope-aware
  `no-restricted-globals` rejects ambient process, network, global-object and
  code-execution entrypoints; local shadowed identifiers are not capabilities.

The AST check resolves `@/` and relative paths (including normalized `..`),
static imports/re-exports, literal dynamic imports, unshadowed `require`, and TS
import-equals. Nonliteral loader paths in constrained modules fail closed.
Type-only declarations and inline type specifiers are allowed. Route handlers
retain legitimate server orchestration. The rule is **not** a transitive module
graph, arbitrary-loader-alias analysis, object/prototype capability analysis,
filesystem sandbox, or proof of privacy/coaching semantics. Review indirect
helpers and new capability surfaces as architecture changes; do not rely on lint
alone for security. Tests exercise both allowed and rejected syntax through the
actual flat config and TS/TSX routing.

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
