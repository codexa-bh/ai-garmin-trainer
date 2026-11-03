import { randomUUID, createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { recipe } from "../scripts/desktop/smoke_recipe";

it("authors linked source on the exclusive stopped run copy only and rejects aliases/replay", () => {
  const scratch = realpathSync(
    mkdtempSync(join(tmpdir(), "conversation-seed-")),
  );
  const original = recipe(
    scratch,
    `smoke-input-${randomUUID()}`,
    "2026-11-03",
    true,
  );
  const digest = () =>
    createHash("sha256").update(readFileSync(original.path)).digest("hex");
  const before = digest();
  const id = randomUUID();
  const root = join(scratch, `ordinary-${id}`);
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(join(root, "owner"), id, { mode: 0o600 });
  const target = join(root, "trainer.sqlite");
  copyFileSync(original.path, target, constants.COPYFILE_EXCL);
  const invoke = (action: string, path = root) =>
    spawnSync(
      resolve("node_modules/.bin/tsx"),
      [resolve("scripts/desktop/conversation_seed.ts"), action, path],
      {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: scratch,
        },
      },
    );
  const first = invoke("initial");
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    authoredPairs: 64,
    messages: 128,
    syntheticOnly: true,
    providerCalls: 0,
  });
  expect(existsSync(target + ".trainer-writer")).toBe(false);
  expect(invoke("initial").status).toBe(1);
  expect(invoke("append").status).toBe(0);
  const alias = join(scratch, "alias");
  symlinkSync(root, alias);
  expect(invoke("initial", alias).status).toBe(1);
  expect(invoke("arbitrary").status).toBe(1);
  const copy = new Database(target, { readonly: true });
  try {
    expect(
      copy
        .prepare(
          "select count(*) as n from conversation_turn where status='completed'",
        )
        .get(),
    ).toEqual({ n: 84 });
    expect(
      copy.prepare("select count(*) as n from conversation_completion").get(),
    ).toEqual({ n: 84 });
  } finally {
    copy.close();
  }
  expect(digest()).toBe(before);
});
