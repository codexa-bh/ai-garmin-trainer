import Database from "better-sqlite3";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { populate, verify } from "../scripts/desktop/smoke_recipe";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("finite producer seed uses current production completion/eligibility on only a stopped private run and refuses replay", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "summary-seed-")));
  roots.push(base);
  const id = randomUUID(),
    root = join(base, `ordinary-${id}`);
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(join(root, "owner"), id, { mode: 0o600 });
  const path = join(root, "trainer.sqlite");
  const db = new Database(path);
  populate(db, "2026-11-03");
  verify(db, "synthetic");
  const originalMessages = (
    db.prepare("select count(*) as n from message").get() as { n: number }
  ).n;
  db.close();
  chmodSync(path, 0o600);
  const command = ["--import", "tsx", "scripts/desktop/summary_seed.ts", root];
  const result = JSON.parse(
    execFileSync(process.execPath, command, { encoding: "utf8" }),
  );
  expect(result).toMatchObject({
    task: "T0270",
    runId: id,
    completed: 4,
    incomplete: 1,
    providerCalls: 0,
    schema: 19,
  });
  const seeded = new Database(path, { readonly: true });
  expect(
    seeded
      .prepare(
        "select count(*) as n from conversation_turn where summary_eligible=1",
      )
      .get(),
  ).toEqual({ n: 4 });
  expect(
    seeded.prepare("select count(*) as n from conversation_completion").get(),
  ).toEqual({ n: 4 });
  expect(seeded.prepare("select count(*) as n from message").get()).toEqual({
    n: originalMessages + 9,
  });
  seeded.close();
  const before = readFileSync(path);
  const replay = spawnSync(process.execPath, command, { encoding: "utf8" });
  expect(replay.status).not.toBe(0);
  expect(readFileSync(path)).toEqual(before);
});
it("finite recipe refuses nonempty/enabled global memory instead of treating it as an authorized input", () => {
  const db = new Database(":memory:");
  try {
    populate(db, "2026-11-03");
    verify(db, "synthetic");
    db.prepare("update summary_control set enabled=1").run();
    expect(() => verify(db, "synthetic")).toThrow("empty, disabled");
  } finally {
    db.close();
  }
});
