import { ESLint } from "eslint";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Real project-backed files must exist before the parser builds its TS program.
const probeFiles = [
  "src/app/guardrail-probe.tsx",
  "src/lib/db/guardrail-probe.ts",
  "src/app/api/example/route.ts",
  "src/components/probe.tsx",
  "src/lib/probe.ts",
  "tests/probe.test.ts",
  "scripts/probe.ts",
];
for (const file of probeFiles) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "export {};\n", { flag: "wx" });
}
afterAll(() => {
  for (const file of probeFiles) unlinkSync(file);
});

// Exercise the real flat config/parser/file routing, not a parallel test config.
const eslint = new ESLint();
async function rules(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result.fatalErrorCount).toBe(0);
  return result.messages.map((message) => message.ruleId);
}

const clientFile = "src/app/guardrail-probe.tsx";
const storageFile = "src/lib/db/guardrail-probe.ts";
const mathFile = "src/lib/ai/math-analysis.ts";
const boundary = "architecture/boundaries";

describe("direct architecture boundaries", () => {
  it.each([
    'import { value } from "@/lib/db/repository"; void value;',
    'import { value } from "../lib/db/repository"; void value;',
    'import { value } from "@/lib/garmin/client"; void value;',
    'export { value } from "@/lib/garmin/importer";',
    'export * from "@/lib/env";',
    'void import("@/lib/ai/providers");',
    'void require("../lib/db/repository");',
    'import database = require("@/lib/db/repository"); void database;',
    'const target = "@/lib/db/repository"; void import(target);',
  ])("rejects client server dependency: %s", async (code) => {
    expect(await rules(`"use client"; ${code}`, clientFile)).toContain(
      boundary,
    );
  });

  it.each([
    'import type { Value } from "@/lib/db/repository"; export type Result = Value;',
    'import { type Value } from "@/lib/db/repository"; export type Result = Value;',
    'export type { Value } from "@/lib/db/repository";',
    'import { progress } from "@/lib/ai/trainer-progress"; void progress;',
    'import { normalize } from "@/lib/garmin/normalize"; void normalize;',
    'function example(require: (name: string) => void) { require("@/lib/db/repository"); } void example;',
  ])(
    "allows client shared/type-only and shadowed loader cases: %s",
    async (code) => {
      expect(await rules(`"use client"; ${code}`, clientFile)).not.toContain(
        boundary,
      );
    },
  );

  it("allows server route orchestration and applies client directives outside app", async () => {
    const code = 'import { getDb } from "@/lib/db/repository"; void getDb;';
    expect(await rules(code, "src/app/api/example/route.ts")).not.toContain(
      boundary,
    );
    expect(
      await rules(`"use client"; ${code}`, "src/components/probe.tsx"),
    ).toContain(boundary);
  });

  it.each([
    'import { context } from "../ai/context"; void context;',
    'export * from "@/lib/ai/providers";',
    'void import("@ai-sdk/openai");',
    'void require("ai");',
  ])("rejects storage AI execution: %s", async (code) => {
    expect(await rules(code, storageFile)).toContain(boundary);
  });

  it.each([
    'import type { TrainerProfile } from "../ai/context"; export type Profile = TrainerProfile;',
    'import { normalize } from "../garmin/normalize"; void normalize;',
    'import Database from "better-sqlite3"; void Database;',
  ])("allows storage contracts and owned persistence: %s", async (code) => {
    expect(await rules(code, storageFile)).not.toContain(boundary);
  });

  it("leaves local math imports to the transitive graph gate", async () => {
    expect(
      await rules(
        'import { score } from "./pure-helper"; void score;',
        mathFile,
      ),
    ).not.toContain(boundary);
  });

  it.each([
    "process.env",
    "globalThis.fetch",
    "fetch",
    "Function",
    "eval",
    "window",
    "WebSocket",
  ])("rejects ambient math capability %s", async (code) => {
    expect(await rules(`void ${code};`, mathFile)).toContain(
      "no-restricted-globals",
    );
  });

  it("allows pure math, erased SQL row types and local shadowing", async () => {
    expect(
      await rules(
        'import type { AnalysisRow } from "./sql-analysis"; export function score(row: AnalysisRow, fetch: number) { return Math.abs(fetch) + Number(row.value); }',
        mathFile,
      ),
    ).toEqual([]);
  });
});

describe("typed async enforcement", () => {
  it.each([clientFile, "tests/probe.test.ts", "scripts/probe.ts"])(
    "uses real types in %s",
    async (file) => {
      for (const code of ["Promise.resolve(1);", "void Promise.resolve(1);"]) {
        expect(await rules(code, file)).toContain(
          "@typescript-eslint/no-floating-promises",
        );
      }
      expect(
        await rules(
          "[1].forEach(async () => { await Promise.resolve(); });",
          file,
        ),
      ).toContain("@typescript-eslint/no-misused-promises");
      expect(
        await rules("if (Promise.resolve(true)) console.log('bad');", file),
      ).toContain("@typescript-eslint/no-misused-promises");
      expect(
        await rules("export async function value() { await 1; }", file),
      ).toContain("@typescript-eslint/await-thenable");
      expect(
        await rules(
          "export async function value() { await Promise.resolve(1); return Promise.resolve(2); } Promise.resolve().catch((error: unknown) => console.error(error));",
          file,
        ),
      ).toEqual([]);
    },
  );

  it("recognizes fetch promises and genuine thenables", async () => {
    expect(await rules('fetch("/api/profile");', clientFile)).toContain(
      "@typescript-eslint/no-floating-promises",
    );
    expect(
      await rules(
        "declare const work: PromiseLike<number>; export async function value() { return await work; }",
        "scripts/probe.ts",
      ),
    ).toEqual([]);
  });

  it("checks JSX callbacks and allows synchronous handled adapters", async () => {
    expect(
      await rules(
        "export const view = <button onClick={async () => { await Promise.resolve(); }} />;",
        clientFile,
      ),
    ).toContain("@typescript-eslint/no-misused-promises");
    expect(
      await rules(
        "export const view = <button onClick={() => { Promise.resolve().catch((error: unknown) => console.error(error)); }} />;",
        clientFile,
      ),
    ).toEqual([]);
  });

  it("closes concise-arrow void promise erasure without banning synchronous void", async () => {
    expect(
      await rules(
        "export const callback = () => void Promise.resolve();",
        clientFile,
      ),
    ).toContain("async/no-void-promise");
    expect(
      await rules(
        "export const callback = () => void ({ then: 1 });",
        clientFile,
      ),
    ).toEqual([]);
  });

  it("keeps JavaScript untyped", async () => {
    expect(
      await rules("Promise.resolve();", "scripts/probe.mjs"),
    ).not.toContain("@typescript-eslint/no-floating-promises");
  });
});

describe("blocking lint routing", () => {
  it("activates SonarJS, Next, React hooks and TypeScript rules", async () => {
    expect(
      await rules(
        "export function sign(value: number) { if (value > 0) return 1; else if (value > 0) return 2; return 0; }",
        "src/lib/probe.ts",
      ),
    ).toContain("sonarjs/no-identical-conditions");
    expect(
      await rules("export const value: any = 1;", "tests/probe.test.ts"),
    ).toContain("@typescript-eslint/no-explicit-any");
    expect(
      await rules("export const module = {};", "scripts/probe.ts"),
    ).toContain("@next/next/no-assign-module-variable");
    expect(
      await rules(
        'import { useState } from "react"; export function Probe({ enabled }: { enabled: boolean }) { if (enabled) useState(0); return null; }',
        clientFile,
      ),
    ).toContain("react-hooks/rules-of-hooks");
  });

  it.each([
    ".next/probe.ts",
    "data/probe.ts",
    ".garmin-token/probe.ts",
    ".garmin-mcp/probe.ts",
    "next-env.d.ts",
  ])("does not inspect generated/local material: %s", async (file) => {
    expect(await eslint.isPathIgnored(file)).toBe(true);
  });
});
