import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkArchitecture } from "../scripts/architecture-graph.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function project(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "architecture-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        moduleResolution: "bundler",
        module: "esnext",
        paths: { "@/*": ["./src/*"] },
        allowJs: true,
      },
    }),
  );
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, "src", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}
function diagnostics(files) {
  return checkArchitecture(project(files)).diagnostics.join("\n");
}

const client = '"use client"; import "@/shared";';
const math = 'export { score } from "../pure";';

describe("runtime architecture graph", () => {
  it.each([
    "db/repository",
    "garmin/client",
    "garmin/importer",
    "garmin/mcp-config",
    "env",
    "ai/providers",
  ])("rejects client transitive owner %s with witness", (owner) => {
    const output = diagnostics({
      "app/client.ts": client,
      "shared/index.ts": `export * from "../lib/${owner}.js";`,
      [`lib/${owner}.ts`]: "export const value = 1;",
    });
    expect(output).toContain(
      "client-server: app/client.ts:1 -> shared/index.ts:1 -> lib/",
    );
  });
  it.each([
    'import "ai";',
    'export * from "@ai-sdk/openai";',
    'import "./ai/providers";',
  ])("rejects transitive storage AI: %s", (code) => {
    expect(
      diagnostics({
        "lib/db/store.ts": 'import "../helper";',
        "lib/helper.ts": code,
        "lib/ai/providers.ts": "export {};",
      }),
    ).toContain("storage-ai");
  });
  it("allows route orchestration, pure diamonds, erased types and shadowed require", () => {
    expect(
      diagnostics({
        "app/client.tsx": client,
        "shared/index.ts":
          'export * from "../left"; export * from "../right"; import type { Row } from "../lib/db/store"; export type { Row };',
        "left.ts": 'export { value } from "./leaf";',
        "right.ts": 'export { value } from "./leaf";',
        "leaf.ts":
          'export const value = 1; export function local(require: (x: string) => void) { require("./missing"); }',
        "lib/db/store.ts":
          'export type Row = number; import { type Value } from "../../shared/types";',
        "shared/types.ts":
          'export type Value = number; export type { Row } from "../lib/db/store";',
        "app/api/route.ts":
          'import "../../lib/db/store"; import "../../lib/ai/providers";',
        "lib/ai/providers.ts": "export {};",
      }),
    ).toBe("");
  });
  it.each([
    'export * from "./b";',
    'import "./b";',
    'import("./b");',
    'require("./b");',
    'import b = require("./b");',
    'import { type Shape, value } from "./b"; void value;',
  ])("follows runtime syntax %s and reports cycles", (code) => {
    expect(
      diagnostics({ "a.ts": code, "b.ts": 'export * from "./a";' }),
    ).toContain("runtime-cycle: a.ts -> b.ts -> a.ts");
  });
  it("reports self cycles deterministically and sees changed files on rerun", () => {
    const root = project({ "a.ts": 'import "./a";' });
    expect(checkArchitecture(root).diagnostics[0]).toContain("a.ts -> a.ts");
    writeFileSync(path.join(root, "src/a.ts"), "export {};");
    expect(checkArchitecture(root).diagnostics).toEqual([]);
  });
  it("reports three-module cycles", () => {
    expect(
      diagnostics({
        "a.ts": 'import "./b";',
        "b.ts": 'import "./c";',
        "c.ts": 'import "./a";',
      }),
    ).toContain("runtime-cycle: a.ts -> b.ts -> c.ts -> a.ts");
  });

  it("rejects unresolved imports even outside constrained roots", () => {
    expect(
      diagnostics({ "app/api/route.ts": 'import "./missing";' }),
    ).toContain("unresolved");
  });
  it.each(["import(target);", "require(target);"])(
    "fails closed for indirect opaque loaders %s",
    (code) => {
      expect(
        diagnostics({
          "app/client.ts": client,
          "shared.ts": `const target = './x'; ${code}`,
        }),
      ).toContain("opaque-dependency");
    },
  );
  it("fails on syntax errors rather than dropping edges", () => {
    expect(diagnostics({ "bad.ts": "export const = ;" })).toContain("analysis");
  });
});

describe("bounded math pure local closure", () => {
  it("follows literal lazy helpers but erases type-only lazy references", () => {
    expect(
      diagnostics({
        "lib/ai/math-analysis.ts":
          'export const score = () => import("../pure"); export type Row = import("../db/store").Row;',
        "lib/pure.ts": "export const value = 1;",
        "lib/db/store.ts": "export type Row = number;",
      }),
    ).toBe("");
  });

  it("accepts multiple pure helpers, local shadowing and erased imports", () => {
    expect(
      diagnostics({
        "lib/ai/math-analysis.ts": math,
        "lib/pure.ts":
          'export { score } from "./leaf"; import type { Row } from "./db/store";',
        "lib/leaf.ts":
          "export function score(fetch: number, process: number) { return Math.abs(fetch) + process; }",
        "lib/db/store.ts": "export type Row = number;",
      }),
    ).toBe("");
  });
  it.each([
    "node:fs",
    "node:child_process",
    "node:http",
    "better-sqlite3",
    "some-pure-package",
  ])("rejects opaque package %s", (specifier) => {
    expect(
      diagnostics({
        "lib/ai/math-analysis.ts": math,
        "lib/pure.ts": `export * from "${specifier}";`,
      }),
    ).toContain("math-capability");
  });
  it.each([
    "process.env",
    "fetch('/')",
    "globalThis.fetch",
    "global",
    "window",
    "document",
    "XMLHttpRequest",
    "WebSocket",
    "eval('1')",
    "Function('return 1')",
  ])("rejects ambient capability %s in reachable helpers", (expression) => {
    expect(
      diagnostics({
        "lib/ai/math-analysis.ts": math,
        "lib/pure.ts": `export const score = ${expression};`,
      }),
    ).toContain("math-capability");
  });
  it.each([
    'import "./db/store";',
    'import("./garmin/client");',
    'require("node:fs");',
    "import(target);",
  ])("rejects indirect math capability %s", (code) => {
    expect(
      diagnostics({
        "lib/ai/math-analysis.ts": math,
        "lib/pure.ts": code,
        "lib/db/store.ts": "export {};",
        "lib/garmin/client.ts": "export {};",
      }),
    ).toMatch(/math-capability|opaque-dependency/);
  });
  it("does not apply math ambient restrictions to unrelated modules", () => {
    expect(
      diagnostics({
        "lib/ai/math-analysis.ts": "export const value = 1;",
        "lib/other.ts": "fetch('/');",
      }),
    ).toBe("");
  });
});
