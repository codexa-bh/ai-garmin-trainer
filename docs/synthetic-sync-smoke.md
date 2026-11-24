# Synthetic Sync — build/run card

**Use:** authored, keyless macOS ARM64 Sync/import evidence on a task-owned ordinary app, not private Garmin/account proof. Prerequisites: [desktop toolchain](../README.md#1-install-prerequisites-and-build), compatible Pivan scratch tooling, registered Trainer task worktree and the [scenario's before-use checks](smoke/sync.md#current-finite-synthetic-sync-scenario). No running app, private settings, key or tokens are selected.

## Prepare, build, run

Use the **same canonical physical cwd and plain `npm run`** for every npm command. Select the Trainer worktree returned by `task-source-setup` (the generic source variable may name a different repo in a multi-repo task). Stop after any failed command; do not run dependent steps.

```bash
# Set to this task's returned Trainer worktree, not its primary checkout.
trainer_worktree='/absolute/returned/trainer/task-worktree'
cd -P "$trainer_worktree"
pwd -P
npm ci

# Use allocator-returned paths. Preparation receives ROOT, not a category child.
scratch="$(pivan-harness task-scratch path "$PIVAN_TASK_PATH" --create)"
pivan-harness task-scratch path "$PIVAN_TASK_PATH" --category evidence --create
pivan-harness task-scratch path "$PIVAN_TASK_PATH" --category disposable --create
npm run smoke:prepare -- --scratch "$scratch"

# From the JSON record containing "prepared", use that exact directory:
prepared='/exact/returned/prepared-directory'
selection="$prepared/selection.json"
# This is the authored database-only selection, not private input discovery.
npm run desktop:build
bundle="$(pwd -P)/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/AI Trainer for Garmin Connect.app"
npm run smoke:history -- --scratch "$scratch" \
  --input-file "$selection" --bundle "$bundle" --synthetic-sync
```

Preparation emits a prepared-result record **and** resource disposition; select by the `prepared` key, not stdout line position. Default anchor is UTC today; explicit `--anchor YYYY-MM-DD` reproduces logical input, not output UUIDs or a product clock. Use the returned canonical scratch and compatible toolchain, never aliases or rewritten arguments to bypass a refusal.

## Read the result, not just the exit

- Inspect the history receipt, original-preservation/shutdown results and `synthetic-sync.json` (maximum **12 operations**). [Current scenario](smoke/sync.md#current-finite-synthetic-sync-scenario) separates actual cancellation/restart/discovery/finality from stopped **6/14 presentation seeding**. Inspect every required PNG; masks prove visible controls/geometry, not hidden counts or advancing animation.
- [Build identity](smoke/ownership.md#ordinary-build-identity-and-current-driver-reuse) is strict for this direct history caller. Do not mix alias/canonical paths, nested `npm run -s`, direct Python substitutes or context-stripping env wrappers. A source/context mismatch means diagnose and rebuild consistently; never edit stamps/bundle identity or borrow ordinary-runner corrected-driver reuse.
- [Inputs](smoke-inputs.md#finite-recipe-and-verification), [resource/disposal owner](smoke/ownership.md#preparation-reuse-and-owned-disposal) and [developer duties](developer-process.md) retain privacy, originals, evidence-first lifetime and no-copy-back rules. Preparation alone launches nothing. Synthetic success certifies neither Garmin/providers/auth nor default singleton/trusted input; [real-service authority](smoke/sync.md#independent-real-service-evidence-gate) is independent.
