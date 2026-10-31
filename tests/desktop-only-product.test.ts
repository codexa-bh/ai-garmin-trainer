import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_SCHEMA_VERSION } from "../src/lib/db/migrations";

const root = process.cwd();
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function directory() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "trainer setup ü ")));
  directories.push(path);
  return path;
}
function command(script: string, cwd: string, databasePath?: string) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/tsx/dist/cli.mjs"),
        join(root, script),
        "--json",
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 15000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NEXT_TELEMETRY_DISABLED: "1",
          NODE_ENV: "production",
          ...(databasePath ? { DATABASE_PATH: databasePath } : {}),
        },
      },
    ),
  ) as Record<string, unknown>;
}
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("Tauri-only product launch contract", () => {
  it("supplies native launchers, not standalone web launch commands or runnable wrappers", () => {
    const { scripts } = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    for (const name of [
      "dev",
      "start",
      "start:local",
      "restart:local",
      "bootstrap:local",
    ])
      expect(scripts).not.toHaveProperty(name);
    expect(Object.values(scripts).join("\n")).not.toMatch(
      /next\s+(dev|start)\b/,
    );
    expect(scripts["desktop:dev"]).toBe(
      "npm run desktop:resources && tauri dev",
    );
    expect(scripts["desktop:build"]).toContain("tauri build");
    for (const name of [
      "bootstrap-local.mjs",
      "restart-local.sh",
      "restart-readiness.mjs",
    ])
      expect(existsSync(join(root, "scripts", name))).toBe(false);
    for (const name of ["doctor", "db:status", "db:migrate", "garmin:auth"])
      expect(scripts[name]).toMatch(/^tsx scripts\//);
  });

  it("keeps documented setup commands non-serving and external services operator-owned", () => {
    for (const name of [
      "doctor.ts",
      "db-status.ts",
      "migrate.ts",
      "garmin-auth.ts",
    ]) {
      const source = readFileSync(join(root, "scripts", name), "utf8");
      expect(source).not.toMatch(
        /next\s+(start|dev)|\.listen\(|ollama.*(?:serve|pull)/,
      );
    }
    const config = JSON.parse(
      readFileSync(join(root, "knip.json"), "utf8"),
    ) as {
      ignoreBinaries?: string[];
    };
    expect(config.ignoreBinaries ?? []).not.toContain("ollama");
    const setup = readFileSync(join(root, "src-tauri/ui/index.html"), "utf8");
    expect(setup).not.toContain("source/browser");
    expect(setup).toContain("Quit any other app or older");
    expect(setup).toContain("disposable populated copy");
  });
});

describe("explicit non-serving source setup", () => {
  it("reports missing/current schema read-only, creates only the explicit target, and preserves private config", () => {
    const cwd = directory();
    const config = join(cwd, ".env.local");
    const target = join(cwd, "selected ü.sqlite");
    writeFileSync(config, "DATABASE_PATH=./selected ü.sqlite\n", {
      mode: 0o600,
    });
    const original = hash(config);
    expect(command("scripts/db-status.ts", cwd)).toMatchObject({
      ok: true,
      exists: false,
      needsMigration: true,
    });
    expect(existsSync(target)).toBe(false);
    // migrate.ts deliberately uses process env, not automatic dotenv adoption.
    expect(command("scripts/migrate.ts", cwd, target)).toMatchObject({
      ok: true,
      schemaVersionAfter: LATEST_SCHEMA_VERSION,
      backupPath: null,
    });
    const before = hash(target);
    expect(command("scripts/db-status.ts", cwd)).toMatchObject({
      ok: true,
      current: true,
      needsMigration: false,
      integrity: "ok",
    });
    expect(hash(target)).toBe(before);
    expect(hash(config)).toBe(original);
    expect(existsSync(join(cwd, "data/trainer.sqlite"))).toBe(false);
    expect(existsSync(`${target}.trainer-writer`)).toBe(false);
  }, 20000);

  it("backs up selected stopped populated state before explicit upgrade without following a different dotenv target", () => {
    const cwd = directory();
    const target = join(cwd, "approved.sqlite");
    writeFileSync(
      join(cwd, ".env.local"),
      "DATABASE_PATH=./not-approved.sqlite\n",
      { mode: 0o600 },
    );
    command("scripts/migrate.ts", cwd, target);
    const db = new Database(target);
    db.prepare(
      "insert into conversation(id,title,created_at,updated_at) values (?,?,?,?)",
    ).run("preserved", "Setup continuity", 1, 1);
    db.prepare(
      "update app_metadata set value=? where key='schema_version'",
    ).run(String(LATEST_SCHEMA_VERSION - 1));
    db.close();
    const before = hash(target);
    const output = command("scripts/migrate.ts", cwd, target);
    expect(output).toMatchObject({
      ok: true,
      schemaVersionBefore: LATEST_SCHEMA_VERSION - 1,
      schemaVersionAfter: LATEST_SCHEMA_VERSION,
      integrity: "ok",
    });
    const backup = String(output.backupPath);
    expect(resolve(backup).startsWith(`${cwd}/backups/`)).toBe(true);
    expect(hash(backup)).toBe(before);
    expect(readdirSync(join(cwd, "backups"))).toHaveLength(1);
    const upgraded = new Database(target, { readonly: true });
    expect(
      upgraded
        .prepare("select title from conversation where id=?")
        .get("preserved"),
    ).toEqual({ title: "Setup continuity" });
    upgraded.close();
    expect(existsSync(join(cwd, "not-approved.sqlite"))).toBe(false);
  }, 20000);
});
