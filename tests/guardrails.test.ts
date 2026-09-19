import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

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

  it.each([
    'import { readFile } from "node:fs"; void readFile;',
    'export * from "../db/repository";',
    'void import("@/lib/garmin/client");',
    'void require("node:child_process");',
  ])("rejects math runtime imports: %s", async (code) => {
    expect(await rules(code, mathFile)).toContain(boundary);
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
