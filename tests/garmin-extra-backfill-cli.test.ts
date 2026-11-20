import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrateDatabase } from "../src/lib/db/migrations";
import { acquireDatabaseWriter } from "../src/lib/db/writer-ownership";
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
        NODE_ENV: "production",
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

// Each independent refusal gets the default deadline, not eight cumulative
// subprocess startups competing with the rest of the suite on hosted runners.
it.each(["missing", "relative", "nonexistent"] as const)(
  "refuses a %s target before any read",
  (kind) => {
    const target =
      kind === "missing"
        ? undefined
        : kind === "relative"
          ? "relative.sqlite"
          : join(directory(), "target.sqlite");
    const refused = cli(bounds, target);
    expect(refused.status).toBe(1);
    expect(refused.output).toMatchObject({ ok: false });
    expect(refused.output.error).toMatch(/canonical existing/);
  },
);

it("refuses an aliased target before any read", () => {
  const dir = directory();
  const target = join(dir, "target.sqlite");
  database(target, true);
  const alias = join(dir, "alias.sqlite");
  symlinkSync(target, alias);
  const refused = cli(bounds, alias);
  expect(refused.status).toBe(1);
  expect(refused.output.error).toMatch(/canonical/);
});

it("refuses an unmigrated target before any read", () => {
  const target = join(directory(), "target.sqlite");
  database(target, true);
  const refused = cli(bounds, target);
  expect(refused.status).toBe(1);
  expect(refused.output.error).toMatch(/Explicit schema migration/);
});

it.each([
  { name: "missing bounds", args: [], key: "synthetic-key", error: /--from/ },
  {
    name: "excessive request limit",
    args: [...bounds, "--max-requests", "5000"],
    key: "synthetic-key",
    error: /1 to 1000/,
  },
  { name: "empty key", args: bounds, key: "", error: /empty/ },
])("refuses $name before any read", ({ args, key, error }) => {
  const target = join(directory(), "target.sqlite");
  database(target, true);
  const refused = cli(args, target, key);
  expect(refused.status).toBe(1);
  expect(refused.output.error).toMatch(error);
});

it("snow-only shares writer refusal and uses an independent zero-request checkpoint", () => {
  const dir = directory();
  const target = join(dir, "snow.sqlite");
  database(target);
  const release = acquireDatabaseWriter(target);
  try {
    expect(cli([...bounds, "--snow-only"], target).output).toMatchObject({
      ok: false,
    });
  } finally {
    release();
  }
  const result = cli([...bounds, "--snow-only"], target);
  expect(result.output).toMatchObject({
    ok: true,
    status: "completed",
    counts: { selected: 0 },
    requests: { total: 0 },
  });
  const db = new Database(target);
  expect(db.prepare("select key from sync_checkpoint").all()).toEqual([
    { key: "garmin_snow_split_backfill" },
  ]);
  db.close();
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
