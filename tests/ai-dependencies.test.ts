import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const root = process.cwd();
const config = ts.readConfigFile(
  path.join(root, "tsconfig.json"),
  ts.sys.readFile,
);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;
// Type-inclusive reviewed closure: plain feature contracts/application and pure
// rules only. Zod is the existing schema-only exception, not an SDK wrapper.
const allowed = new Set([
  "ai/analytics/contracts.ts",
  "ai/debug-trace.ts",
  "ai/debug-types.ts",
  "ai/execution-budget.ts",
  "ai/math-analysis.ts",
  "ai/orchestration-ports.ts",
  "ai/orchestrator.ts",
  "ai/provider-errors.ts",
  "ai/tool-analytics.ts",
  "ai/tool-contracts.ts",
  "ai/tool-evidence.ts",
  "ai/tool-execution-context.ts",
  "ai/tool-execution-input.ts",
  "ai/tool-execution.ts",
  "ai/tool-local-data.ts",
  "ai/tool-ports.ts",
  "ai/tool-selection.ts",
  "ai/tool-step-diagnostics.ts",
  "ai/tool-training-plan.ts",
  "ai/tool-weekly.ts",
  "weekly/contracts.ts",
  "weekly/calendar.ts",
  "weekly/application.ts",
  "ai/tool-types.ts",
  "ai/trainer-instructions.ts",
  "ai/trainer-progress.ts",
  "ai/training-plan-evidence.ts",
  "ai/turn-completion.ts",
  "analytics/activity-dashboard-calculations.ts",
  "analytics/terrain-sections.ts",
  "chat/contracts.ts",
  "garmin/detail-types.ts",
  "garmin/import-contracts.ts",
  "garmin/types.ts",
  "local-data/activity-policy.ts",
  "local-data/application.ts",
  "local-data/contracts.ts",
  "training-plan/application.ts",
  "training-plan/contracts.ts",
  "training-plan/edits.ts",
  "training-plan/limits.ts",
  "training-plan/policy.ts",
  "training-plan/snapshot.ts",
]);
function check(
  file: string,
  overrides = new Map<string, string>(),
  seen = new Set<string>(),
) {
  const label = path.relative(path.join(root, "src/lib"), file);
  if (!allowed.has(label)) throw new Error(`outer AI dependency: ${label}`);
  if (seen.has(file)) return;
  seen.add(file);
  const source = ts.createSourceFile(
    file,
    overrides.get(label) ?? readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function dependency(node: ts.Node) {
    if (!ts.isStringLiteralLike(node)) throw new Error("opaque dependency");
    if (
      node.text === "zod" &&
      ["ai/tool-contracts.ts", "training-plan/snapshot.ts"].includes(label)
    )
      return;
    const resolved = ts.resolveModuleName(
      node.text,
      file,
      options,
      ts.sys,
    ).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport)
      throw new Error(`opaque dependency: ${node.text}`);
    check(resolved.resolvedFileName, overrides, seen);
  }
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      dependency(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      dependency(node.argument.literal);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    )
      dependency(node.moduleReference.expression);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      if (!node.arguments[0]) throw new Error("missing dependency");
      dependency(node.arguments[0]);
    }
    // Feature regression, not a general capability-flow or sandbox proof.
    if (
      ts.isIdentifier(node) &&
      [
        "process",
        "fetch",
        "globalThis",
        "require",
        "eval",
        "Function",
        "XMLHttpRequest",
        "setTimeout",
        "AbortController",
      ].includes(node.text)
    )
      throw new Error(`ambient capability: ${node.text}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
it("keeps orchestration, handlers, selection and metadata independent of outer adapters including erased types", () => {
  for (const file of allowed) check(path.join(root, "src/lib", file));
});
it.each([
  'import type { LanguageModel } from "ai";',
  'import { tool } from "ai";',
  'import { createOpenAI } from "@ai-sdk/openai";',
  'import type { AppEnv } from "../env";',
  'export { executeTrainerTool } from "./tool-composition";',
  'import { runReadOnlySql } from "./sql-analysis";',
  'import { selectedModel } from "./providers";',
  'type Store = import("../db/repository");',
  'import { runGarminSync } from "../garmin/composition";',
  'import { saveGuardedTrainingPlan } from "../training-plan/composition";',
  'import { NextResponse } from "next/server";',
  'const io = import("node:fs");',
  'const io = require("node:fs");',
  'import io = require("node:fs");',
  "const io = import(name);",
  "const io = globalThis.fetch;",
  "const env = process.env;",
  "setTimeout(callback, 1);",
])("rejects SDK/adapter/ambient dependencies: %s", (source) => {
  expect(() =>
    check(
      path.join(root, "src/lib/ai/orchestrator.ts"),
      new Map([["ai/orchestrator.ts", source]]),
    ),
  ).toThrow();
});
it("follows transitive type-only contracts rather than ignoring them", () => {
  expect(() =>
    check(
      path.join(root, "src/lib/ai/tool-execution.ts"),
      new Map([
        ["ai/tool-ports.ts", 'import type { Database } from "better-sqlite3";'],
      ]),
    ),
  ).toThrow("opaque dependency");
});
