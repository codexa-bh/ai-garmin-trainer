import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// The runtime graph deliberately erases types. This feature check also follows
// erased contracts, so a type-only import cannot reintroduce storage/SDK ownership.
function references(text: string): string[] {
  const source = ts.createSourceFile(
    "module.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const result: string[] = [];
  const add = (node: ts.Node) => {
    if (!ts.isStringLiteralLike(node))
      throw new Error("nonliteral module dependency");
    result.push(node.text);
  };
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    )
      add(node.moduleReference.expression);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      if (!node.arguments[0]) throw new Error("missing module dependency");
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

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
  "chat/turn.ts",
  "chat/ports.ts",
  "chat/context.ts",
  "chat/context-ports.ts",
  "chat/contracts.ts",
  "chat/conversations.ts",
  "chat/conversation-policy.ts",
  "ai/context.ts",
  "ai/debug-types.ts",
  "ai/tool-types.ts",
  "ai/trainer-progress.ts",
  "ai/trainer-instructions.ts",
  "ai/execution-budget.ts",
  "analytics/activity-label.ts",
  "garmin/types.ts",
  "memory/types.ts",
  "memory/legacy-contracts.ts",
  "profile/contracts.ts",
]);

function checkClosure(
  file: string,
  overrides = new Map<string, string>(),
  seen = new Set<string>(),
) {
  const label = path
    .relative(path.join(root, "src/lib"), file)
    .split(path.sep)
    .join("/");
  if (!allowed.has(label))
    throw new Error(
      `chat dependency outside reviewed policy/contracts: ${label}`,
    );
  if (seen.has(file)) return;
  seen.add(file);
  for (const specifier of references(
    overrides.get(label) ?? readFileSync(file, "utf8"),
  )) {
    const resolved = ts.resolveModuleName(
      specifier,
      file,
      options,
      ts.sys,
    ).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport)
      throw new Error(`opaque chat dependency: ${specifier}`);
    checkClosure(resolved.resolvedFileName, overrides, seen);
  }
}
const turn = path.join(root, "src/lib/chat/turn.ts");

it("closes chat/conversation application dependencies over reviewed plain contracts and pure policy, including types", () => {
  for (const featureModule of ["turn", "context", "conversations"]) {
    checkClosure(path.join(root, `src/lib/chat/${featureModule}.ts`));
  }
});

it.each([
  'import type { StoredChatMessage } from "@/lib/db/conversation-repository";',
  'export type { StoredChatMessage } from "@/lib/db/conversation-repository";',
  'type Store = import("@/lib/db/conversation-repository");',
  'import { prepareChatTurn } from "./composition";',
  'import { selectedModel } from "@/lib/ai/providers";',
  'import type { UIMessage } from "ai";',
  'const database = import("@/lib/db/connection");',
  'const database = require("@/lib/db/connection");',
  'import db = require("@/lib/db/connection");',
  "const opaque = import(moduleName);",
])("rejects an outer dependency: %s", (text) => {
  expect(() => checkClosure(turn, new Map([["chat/turn.ts", text]]))).toThrow();
});

it("follows transitive erased imports through existing pure context helpers", () => {
  expect(() =>
    checkClosure(
      path.join(root, "src/lib/chat/context.ts"),
      new Map([
        [
          "ai/context.ts",
          'import type { TrainingPlanStatus } from "@/lib/db/training-plan-repository";',
        ],
      ]),
    ),
  ).toThrow("outside reviewed policy/contracts");
});
