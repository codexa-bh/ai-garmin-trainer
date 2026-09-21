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
  "sync-import.ts",
  "detail-import.ts",
  "baseline-import.ts",
  "detail-requests.ts",
  "import-ports.ts",
  "import-contracts.ts",
  "import-policy.ts",
  "types.ts",
  "detail-types.ts",
  "athlete-normalize.ts",
  "body-metrics-normalize.ts",
  "detail-normalize.ts",
  "activity-hr-zone-time.ts",
]);

// Type-inclusive closure complements the production runtime graph. No erased DB
// types or composition re-exports are accepted as application-owned contracts.
function check(
  file: string,
  overrides = new Map<string, string>(),
  seen = new Set<string>(),
) {
  const label = path.relative(path.join(root, "src/lib/garmin"), file);
  if (!allowed.has(label)) throw new Error(`outer Garmin dependency: ${label}`);
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

const sync = path.join(root, "src/lib/garmin/sync-import.ts");
it("keeps all Garmin application closures within reviewed pure modules and feature contracts", () => {
  for (const file of [
    "sync-import",
    "detail-import",
    "baseline-import",
    "detail-requests",
  ])
    check(path.join(root, `src/lib/garmin/${file}.ts`));
});
it.each([
  'import type { HealthCoverage } from "../db/repository";',
  'export type { HealthCoverage } from "../db/repository";',
  'type Store = import("../db/repository");',
  'import { runGarminSync } from "./composition";',
  'import { runGarminSync } from "./importer";',
  'import { GarminMcpClient } from "./mcp-client";',
  'import { fetchFitAltitudeWithLocalWrapper } from "./fit-altitude";',
  'import type { NextRequest } from "next/server";',
  'const io = import("node:fs");',
  'const io = require("node:fs");',
  'import io = require("node:fs");',
  "const io = import(name);",
  "const env = process.env;",
])(
  "rejects outer/ambient capabilities, including erased dependencies: %s",
  (source) => {
    expect(() => check(sync, new Map([["sync-import.ts", source]]))).toThrow();
  },
);
it("follows transitive dependencies through otherwise pure helpers", () => {
  expect(() =>
    check(
      sync,
      new Map([
        ["import-policy.ts", 'import { requireRuntimeEnv } from "../env";'],
      ]),
    ),
  ).toThrow("outer Garmin dependency");
});
