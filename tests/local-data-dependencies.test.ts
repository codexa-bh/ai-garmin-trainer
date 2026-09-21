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
const allowed = new Set([
  "local-data/contracts.ts",
  "local-data/dashboard-policy.ts",
  "local-data/application.ts",
  "local-data/heart-rate-policy.ts",
  "local-data/activity-policy.ts",
  "local-data/coverage-policy.ts",
  "local-data/health-policy.ts",
  "garmin/types.ts",
  "garmin/detail-types.ts",
  "garmin/import-contracts.ts",
  "garmin/normalize.ts",
  "analytics/activity-dashboard-calculations.ts",
]);

// Type-inclusive closure complements the production runtime graph. No erased DB
// types or composition re-exports are accepted as application-owned contracts.
function check(
  file: string,
  overrides = new Map<string, string>(),
  seen = new Set<string>(),
) {
  const label = path.relative(path.join(root, "src/lib"), file);
  if (!allowed.has(label))
    throw new Error(`outer local-data dependency: ${label}`);
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
    // These owners currently need none of these ambient capabilities. This is a
    // feature regression, not a general capability-flow/security proof.
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
      ].includes(node.text)
    )
      throw new Error(`ambient capability: ${node.text}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const application = path.join(root, "src/lib/local-data/application.ts");
it("keeps local-data rules, use cases and erased contracts independent of outer capabilities", () => {
  for (const file of allowed) check(path.join(root, "src/lib", file));
});
it.each([
  'import type { TrainingPlan } from "../db/training-plan-repository";',
  'export { trainingPlanStatus } from "./composition";',
  'type Store = import("../db/repository");',
  'import type { NextRequest } from "next/server";',
  'import type { LanguageModel } from "ai";',
  'const io = import("node:fs");',
  'const io = require("node:fs");',
  'import io = require("node:fs");',
  "const io = import(name);",
  "const env = process.env;",
  'fetch("http://localhost");',
])("rejects outer dependencies including erased types: %s", (source) => {
  expect(() =>
    check(application, new Map([["local-data/application.ts", source]])),
  ).toThrow();
});
it("follows transitive type-only dependencies in policy", () => {
  expect(() =>
    check(
      application,
      new Map([
        [
          "local-data/activity-policy.ts",
          'import type { AppEnv } from "../env";',
        ],
      ]),
    ),
  ).toThrow("outer local-data dependency");
});

it("keeps local-data routes on composed applications instead of concrete storage", () => {
  for (const route of [
    "activities/route.ts",
    "activities/[garminId]/dashboard/route.ts",
    "health-dashboard/route.ts",
    "summary/route.ts",
    "delete/route.ts",
  ]) {
    const source = readFileSync(path.join(root, "src/app/api", route), "utf8");
    expect(source).not.toContain("lib/db/");
    expect(source).toContain("lib/local-data/composition");
  }
});
