# Blocking project guardrails

After the [pinned tool setup](validation.md#local-tool-setup), `npm ci && CI=true npm run validate`
is the comprehensive local path. Push `validate:ci` runs Prettier, Rust format,
Ruff format/lint, production Python dead-code analysis, ESLint (zero warnings),
the runtime architecture graph, both Knip modes, fresh Next type generation and
strict TypeScript, Vitest and Python contracts. Full `validate` adds the production
build; nightly macOS runs Clippy after resource assembly, then native tests/smoke.
Checks never rewrite source; type generation/build produce ignored framework output.
Formatting fixes are explicit separate actions: `npx prettier --write <files>`,
`rustup run 1.98.0 cargo fmt --manifest-path src-tauri/Cargo.toml`, or
`python3 -m ruff format <files>` from the pinned Python environment.

## Lint selection

ESLint 9 uses Next 16 core-web-vitals (including React and React hooks),
TypeScript recommended, no explicit `any`, and no unused variables (underscore
arguments remain intentional). SonarJS 4 adds these blocking rules:

- `no-identical-functions`, `no-all-duplicated-branches`, `no-identical-conditions`
- `no-element-overwrite`, `no-extra-arguments`, `no-ignored-return`
- `no-inverted-boolean-check`, `no-collection-size-mischeck`
- `no-redundant-jump`, `no-use-of-empty-return-value`

Duplicate-string is not selected: repeated fixture/UI vocabulary is not necessarily duplicated knowledge. Cognitive-complexity is not selected: there is no measured numerical complexity budget, and cohesion is not a function-size contest. Neither decision grants a grandfathered baseline or per-file debt waiver.

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

The guardrail test worker explicitly sets `CI=true` so local tests also cover
CI-specific parser behavior. Its long-lived ESLint API instance sets
`disallowAutomaticSingleRunInference: true`, preserving the real project, rules
and routing. This is necessary
for `lintText()` overlays: the single-run optimization reads on-disk placeholder
content on first use and isolated programs on subsequent calls, whereas the
watch-program host keeps current overlay text and imported types. Production
CLI lint keeps its normal single-run optimization. Reproduce the suite with
`CI=true npx vitest run tests/guardrails.test.ts`; tests include successive
invalid/valid/invalid overlays with imported promise types. Cold TypeScript
project initialization runs once in a `beforeAll` hook with a 30-second setup
budget; individual rule probes retain the normal five-second test timeout.
Project setup is not charged to the first assertion; initialization failures still fail the suite.

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

Feature-specific type-inclusive regressions complement the graph: [SQL dependency/execution tests](architecture/analytics-and-local-data.md#guarded-analytical-policy-and-sqlite-execution) check inward contracts, rejection-before-I/O and real readonly wiring; [AI dependency/adapter tests](architecture/ai-and-chat.md#ai-application-and-providertool-adapters) check orchestration/tools, exact provider behavior and the narrow existing Zod exception. They neither replace SQL parsing nor prove arbitrary capability flow.

### Feature/layer ownership (runtime and erased contracts)

The same `npm run architecture` gate also checks a **separate ownership graph**.
`scripts/backend-roles.mjs` explicitly assigns each backend file a feature and
`domain`, `application`, `adapter`, `composition` or `delivery` role. Its explicit
presentation-file inventory accounts for the remaining UI modules; there is no
folder-wide exemption for new helpers, even outside `lib`/`app/api`. Unclassified
runtime source fails, including unreachable files. New files require a reviewed
ownership decision, not a suppression. Operational scripts remain outer entrypoints
outside the `src` runtime graph and retain lint/Knip/type/test coverage.

Allowed local edges (also through aliases, barrels and erased contracts):

| Source                             | Allowed targets                                                     |
| ---------------------------------- | ------------------------------------------------------------------- |
| Domain / plain contracts           | Domain                                                              |
| Application / application ports    | Domain, application (including another feature's use case contract) |
| Adapter / infrastructure           | Domain, application, adapters                                       |
| Composition / compatibility facade | Domain, application, adapters, composition                          |
| HTTP delivery                      | Domain, application, composition, delivery; never concrete adapters |

Every inner root is checked transitively with deterministic source/line/target
witnesses. Unknown modules, unresolved/nonliteral loaders, assets and external
packages fail closed there. External packages are opaque, including their types;
the only inner exceptions are the existing exact `zod` imports in
`ai/tool-contracts` and `training-plan/snapshot`. This is schema use, not blanket
Zod/package purity. Delivery accepts only `next/server` transport and its existing
erased `ai` UI message type; direct SQL/provider packages cannot bypass composition.
Inner closures also use the existing scope-aware ambient
capability restrictions (local parameter shadows remain legal).

`import type`, `export type`, mixed imports, `import("...")` type expressions and
TS import-equals all contribute ownership edges. Only runtime edges contribute to
runtime cycles and client/storage/math capability traversal: a harmless erased
contract cycle is not a runtime cycle. Existing client erased-type allowance does
not grant inner policy permission to depend on concrete infrastructure contracts.
The direct ESLint rule gives fast coverage/layer feedback for known paths; the
TypeScript-resolved graph remains authoritative for aliases and transitive edges.

`tests/architecture-graph.test.mjs` separates original runtime regressions from
ownership fixtures; `guardrails.test.ts` verifies actual configured editor rules.
`backend-composition.test.mjs` covers every HTTP family and lazy production imports,
complementing supplied-port and real-adapter suites listed in the architecture map.
These are architectural checks, not package-internal analysis, arbitrary alias or
capability-flow proof, or a privacy/security sandbox. Role assignments still need
code review: labelling application policy an adapter is not an acceptable fix.

## Knip

`npm run knip` runs Knip 6 in full-project **and production** modes; both block.
Full-project analysis includes tests and tooling. Production analysis does not count
`tests/**` or `*.test.*` as consumers. Next routes/pages, the bundled desktop
runtime/OAuth helper, native setup/debug bootstraps and package/workflow/Python-invoked
tooling are production entrypoints, modelled individually in `knip.json` alongside
framework discovery. Orphaned helper scripts are not blanket entrypoints. Ollama
remains externally managed, never launched by repository setup scripts.

Knip catches unused files/exports/types/dependencies and missing direct dependencies;
it is not arbitrary dynamic reachability or security proof. Plain `.js`/`.mjs`
files are linted/analyzed but not type-checked (`allowJs` is off). Runtime storage
capabilities passed through the `local-data/composition` namespace have narrow
`@public` reasons because Knip cannot follow their later property consumption.
A test-only consumer is never a reason for `@public`, a baseline or a debt list.

Generated `.next`, dependencies, coverage, local `data`, Garmin token/connector
folders and `next-env.d.ts` are excluded from lint; Prettier retains its existing
local/generated exclusions. Secret files are not JS/TS analysis targets. Do not
put credentials or copied local data in source/test fixtures.

For a finding: confirm framework/dynamic/CLI usage, fix real unused code or an
ownership violation, then run the smallest focused test and aggregate validation.
If static analysis genuinely misclassifies a supported dynamic entrypoint, model
that one entry/export with its reason and regression coverage. Otherwise delete
unconsumed code, remove unnecessary exports/re-exports while retaining live owners,
and keep test-only data/helpers under `tests/`. Delete test-only product code and
its exclusive tests; retain coverage of production behavior through existing entrypoints.
Retiring a documented contract or needing a new product seam requires a scope decision.
There are no ignored binaries, file/export/dependency debt lists, blanket ignores,
file-level suppressions or hotspot limits to avoid remediation in any language.

## Rust

`npm run format:rust` checks the whole `src-tauri` crate with default rustfmt from
Rust **1.98.0**, including Windows-only source, without compiling native code.
`npm run lint:rust` runs locked, all-targets Clippy on the same toolchain, denying
warnings plus `clippy::dbg_macro`, `clippy::todo` and `clippy::unimplemented`.
It needs current assembled resources: run the production build and
`desktop:assemble` first. Nightly macOS runs it after assembly and before locked
native tests; its typecheck replaces a separate `cargo check`.

Hosted Clippy runs **after merge**, on macOS only. Windows-only Rust is formatted
but not linted/compiled by push or this nightly profile. A clean macOS result is
not Windows evidence. Fix findings in code; retain the existing narrow allows.
A new allow needs a genuinely incorrect finding, the smallest item and a reason.
Deny flags stay in the quality command, not Cargo build-wide `warnings = "deny"`.

## Python

The single pin file `scripts/python-quality-requirements.txt` supplies **Ruff 0.17.5**
and **Vulture 2.16** for CI, nightly and local setup. Ruff rejects other versions.
`npm run format:python`, `lint:python` and `deadcode:python` call the tracked-file
runner; missing tools fail rather than silently passing. Format/lint cover every
tracked `.py`, including tests and developer runners (the product bundles none). Ruff uses Python 3.12 syntax,
single quotes, 100 columns and explicit `F`, `E4`, `E7`, `E9` rules. No additional
rule-family coverage or Python type-checking is claimed.

Vulture scans tracked non-test Python at confidence **60**: `tests/` and `*_test.py`
supply neither definitions nor usage. The analysis-only model names only standard
HTTP/threading protocol callbacks/attributes and the documented externally imported
`densify_scenario` composition entrypoint, with reasons. It is never executed.
Vulture matches names; it proves no reachability or absence of dead code.

Trace a finding and search module-qualified access, dynamic lookup/patching and
side effects before deleting an import or definition. Use the same dead-code rule
as JS/TS; preserve supported dynamic contracts narrowly, never mark test-only code
public to keep it. Fix lint in code. Only a line-level `# noqa: E402` with a reason
may follow a deliberate `sys.path` setup; no other suppression is permitted.
Mass formatting stays mechanical, separate from hand fixes, with syntax-tree
comparison ignoring only docstring whitespace. Existing data/schema/runtime
semantics and bundled auth metadata/locks remain unchanged.

## Runtime remediation and verification

Navigation effects use React Effect Events to read current handlers without
restarting requests when render-local functions change identity. Active conversation
selection is transient React state with explicit unresolved/empty/selected states.
The persistent chat owner resolves and saves it through the conversation application
in the selected SQLite DB, independent of WebView origin; no browser storage is read.
History waits for a selected ID and a missing page never creates a conversation.
Selection/bootstrap/create/delete requests are serialized, while intent generations
reject superseded history/page/list completions. Chart selection and paging
are clamped during render; mode changes reset paging in their event handler.
Route changes reset map state before commit. These preserve existing UI contracts;
focused dashboard/hydration tests and local app smoke accompany the change.

Developer checks neither migrate/backfill data, deploy/release nor add telemetry. Removing unused exports must preserve live internal implementations. Ordered migrations remain authoritative.
