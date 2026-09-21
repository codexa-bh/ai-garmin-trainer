import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkArchitecture } from "../scripts/architecture-graph.mjs";
import { backendRoles } from "../scripts/backend-roles.mjs";

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
  // These original regressions isolate runtime policy; erased ownership is
  // intentionally stricter and has its own positive/negative fixtures below.
  return checkArchitecture(project(files))
    .diagnostics.filter((message) => !message.startsWith("layer-"))
    .join("\n");
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
    expect(
      checkArchitecture(root).diagnostics.find((line) =>
        line.startsWith("runtime-cycle:"),
      ),
    ).toContain("a.ts -> a.ts");
    writeFileSync(path.join(root, "src/a.ts"), "export {};");
    expect(
      checkArchitecture(root).diagnostics.filter(
        (line) => !line.startsWith("layer-"),
      ),
    ).toEqual([]);
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

describe("type-inclusive backend ownership", () => {
  function layers(files, roles = backendRoles) {
    return checkArchitecture(project(files), roles).diagnostics.join("\n");
  }
  it("accepts feature contracts, cross-feature applications, adapters and composition", () => {
    expect(
      layers({
        "app/api/profile/route.ts": 'import "@/lib/profile/composition";',
        "lib/profile/composition.ts":
          'import "./application"; import "../db/profile-repository";',
        "lib/profile/application.ts":
          'import type { Profile } from "./contracts"; import "../local-data/application";',
        "lib/profile/contracts.ts": "export type Profile = string;",
        "lib/local-data/application.ts": "export {};",
        "lib/db/profile-repository.ts":
          'import type { Profile } from "../profile/contracts";',
      }),
    ).toBe("");
  });
  it.each([
    'import "../db/connection";',
    'import type { Row } from "../db/connection";',
    'import { type Row } from "../db/connection";',
    'import { type Row, value } from "../db/connection";',
    'export type { Row } from "../db/connection";',
    'export type * from "../db/connection";',
    'export * from "../db/connection";',
    'type Row = import("../db/connection").Row;',
    'import db = require("../db/connection");',
    'import type db = require("../db/connection");',
    'import("../db/connection");',
    'require("../db/connection");',
  ])("rejects runtime/erased ownership syntax %s", (source) => {
    const output = layers({
      "lib/profile/application.ts": source,
      "lib/db/connection.ts":
        "export type Row = number; export const value = 1;",
    });
    expect(output).toContain(
      "layer-dependency: lib/profile/application.ts:1 -> lib/db/connection.ts:",
    );
    expect(output).toContain(
      "profile/application cannot depend on storage/adapter",
    );
  });
  it("follows aliases and erased barrels with a deterministic full witness", () => {
    const files = {
      "lib/profile/application.ts":
        'import type { Row } from "@/lib/profile/contracts";',
      "lib/profile/contracts.ts":
        'export type { Row } from "../db/connection";',
      "lib/db/connection.ts": "export type Row = number;",
    };
    const output = layers(files);
    expect(output).toContain(
      "lib/profile/application.ts:1 -> lib/profile/contracts.ts:1 -> lib/db/connection.ts",
    );
    expect(output).toContain("(type-only)");
    expect(layers(files)).toBe(output);
  });
  it.each([
    ["lib/profile/contracts.ts", 'import "./application";'],
    ["lib/profile/application.ts", 'import "./composition";'],
    ["lib/db/profile-repository.ts", 'import "../profile/composition";'],
    ["lib/profile/composition.ts", 'import "../../app/api/profile/route";'],
    [
      "app/api/profile/route.ts",
      'import "../../../lib/db/profile-repository";',
    ],
  ])("rejects reverse ownership from %s", (source, code) => {
    expect(
      layers({
        "lib/profile/contracts.ts": "export {};",
        "lib/profile/application.ts": "export {};",
        "lib/profile/composition.ts": "export {};",
        "lib/db/profile-repository.ts": "export {};",
        "app/api/profile/route.ts": "export {};",
        [source]: code,
      }),
    ).toContain("layer-dependency:");
  });
  it.each([
    'import "ai";',
    'import type { Model } from "@ai-sdk/openai";',
    'import "node:fs";',
    'import "next/server";',
    'import "zod";',
    "import(name);",
    "require(name);",
    'import "./missing";',
  ])("fails closed for opaque/unapproved dependencies %s", (source) => {
    expect(layers({ "lib/profile/application.ts": source })).toContain(
      "layer-dependency:",
    );
  });
  it.each([
    'import "better-sqlite3";',
    'import "@ai-sdk/openai";',
    'import "ai";',
    'import type { Database } from "better-sqlite3";',
  ])("rejects HTTP bypassing feature composition with %s", (source) => {
    expect(layers({ "app/api/profile/route.ts": source })).toContain(
      "layer-dependency:",
    );
  });
  it("accepts framework transport and erased UI wire types only in delivery", () => {
    expect(
      layers({
        "app/api/chat/route.ts":
          'import "next/server"; import type { UIMessage } from "ai";',
      }),
    ).toBe("");
  });
  it("accepts only the existing neutral schema owners, not arbitrary Zod wrappers", () => {
    expect(
      layers({
        "lib/ai/tool-contracts.ts":
          'import { z } from "zod"; export const schema = z.string();',
      }),
    ).toBe("");
  });
  it.each([
    "process.env",
    "fetch('/')",
    "globalThis.fetch",
    "eval('1')",
    "Function('')",
  ])("rejects inner ambient capabilities %s", (expression) => {
    expect(
      layers({
        "lib/profile/contracts.ts": `export const value = ${expression};`,
      }),
    ).toContain("layer-capability:");
  });
  it("permits lexical shadows and type-only inward cycles without creating runtime cycles", () => {
    expect(
      layers({
        "lib/profile/contracts.ts":
          'export type { A } from "../chat/contracts"; export type B = number; export function f(fetch: number) { return fetch; }',
        "lib/chat/contracts.ts":
          'export type { B } from "../profile/contracts"; export type A = number;',
      }),
    ).toBe("");
  });
  it.each([
    "lib/profile/new-helper.ts",
    "server.ts",
    "app/new-backend-helper.ts",
    "lib/new-feature/application.ts",
    "app/api/new/route.ts",
  ])("requires classification of %s even when unreachable", (name) => {
    expect(layers({ [name]: "export {};" })).toContain(
      `layer-coverage: ${name}: unclassified backend module`,
    );
  });
  it("cannot launder a dependency through an unclassified helper outside backend folders", () => {
    expect(
      layers({
        "lib/profile/application.ts": 'import "../../shared";',
        "shared.ts": 'import "./lib/db/connection";',
        "lib/db/connection.ts": "export {};",
      }),
    ).toContain("layer-dependency: lib/profile/application.ts:1 -> shared.ts");
  });
  it("checks classified transitive helper capabilities, including erased imports", () => {
    expect(
      layers(
        {
          "lib/profile/application.ts":
            'import type { T } from "../../helper";',
          "helper.ts": 'export type T = string; fetch("/");',
        },
        {
          ...backendRoles,
          "helper.ts": { feature: "profile", layer: "domain" },
        },
      ),
    ).toContain("layer-capability: lib/profile/application.ts:1 -> helper.ts");
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
