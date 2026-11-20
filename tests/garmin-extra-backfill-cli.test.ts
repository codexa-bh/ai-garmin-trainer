import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrateDatabase } from "../src/lib/db/migrations";
import { removeGarminExtraFixtureSchema } from "./conversation-migration-fixture";

/** CLI gates that never reach the network; the key is synthetic. */
const root = process.cwd();
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function directory() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "extra backfill ü ")));
  directories.push(path);
  return path;
}
function cli(
  args: string[],
  databasePath: string | undefined,
  key = "synthetic-key",
) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/tsx/dist/cli.mjs"),
      join(root, "scripts/backfill-garmin-extra.ts"),
      ...args,
    ],
    {
      encoding: "utf8",
      input: key,
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(databasePath ? { DATABASE_PATH: databasePath } : {}),
      },
    },
  );
  const line = (result.stdout || result.stderr).trim().split("\n").at(-1)!;
  return {
    status: result.status,
    output: JSON.parse(line) as Record<string, unknown>,
    raw: `${result.stdout}${result.stderr}`,
  };
}
function database(path: string, schema28 = false) {
  const db = new Database(path);
  migrateDatabase(db);
  if (schema28) removeGarminExtraFixtureSchema(db);
  db.close();
}
const bounds = ["--from", "2026-01-01", "--to", "2026-01-31"];

it("refuses missing, relative, aliased and unmigrated targets before any read", () => {
  const dir = directory();
  const target = join(dir, "target.sqlite");
  expect(cli(bounds, undefined).output).toMatchObject({ ok: false });
  expect(cli(bounds, "relative.sqlite").output.error).toMatch(/canonical/);
  expect(cli(bounds, target).output.error).toMatch(/canonical existing/);
  database(target, true);
  const alias = join(dir, "alias.sqlite");
  symlinkSync(target, alias);
  expect(cli(bounds, alias).output.error).toMatch(/canonical/);
  const refused = cli(bounds, target);
  expect(refused.status).toBe(1);
  expect(refused.output.error).toMatch(/Explicit schema migration/);
  expect(cli([], target).output.error).toMatch(/--from/);
  expect(
    cli([...bounds, "--max-requests", "5000"], target).output.error,
  ).toMatch(/1 to 1000/);
  expect(cli(bounds, target, "").output.error).toMatch(/empty/);
});

it("completes an empty stored range with zero requests and never prints the key", () => {
  const dir = directory();
  const target = join(dir, "target.sqlite");
  database(target);
  const run = cli(bounds, target, "synthetic-secret-key-value");
  expect(run.status).toBe(0);
  expect(run.output).toMatchObject({
    ok: true,
    status: "completed",
    pass: 1,
    phase: "done",
    requests: { total: 0 },
    integrity: "ok",
    foreignKeys: "ok",
  });
  expect(run.raw).not.toContain("synthetic-secret-key-value");
  expect(run.raw).not.toContain(dir);
  const invalid = cli(["--from", "2026-02-30", "--to", "2026-03-01"], target);
  expect(invalid.output).toMatchObject({
    status: "refused",
    reason: "invalid-bounds",
  });
});
