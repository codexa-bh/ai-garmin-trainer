import Database from "better-sqlite3";
import { LATEST_SCHEMA_VERSION } from "@/lib/db/migrations";
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
// Two real tsx processes plus SQLite setup/readback are an integration check,
// not a 5s unit operation (the hosted integrated case completed in 6.15s).
// Bound each child independently and leave 5s for fixture/assertion overhead.
const childTimeoutMs = 10000;
const scenarioTimeoutMs = childTimeoutMs * 2 + 5000;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it.each([
  "keyless",
  "live",
  "integrated",
  "controls",
  "correction",
  "compaction",
  "capacity",
])(
  "finite %s producer seed uses current production completion/eligibility on only a stopped private run and refuses replay",
  (mode) => {
    const task =
      mode === "capacity"
        ? "T0274"
        : ["integrated", "controls", "correction", "compaction"].includes(mode)
          ? "T0272"
          : "T0270";
    const completed =
      mode === "capacity"
        ? 1
        : mode === "integrated"
          ? 184
          : mode === "compaction"
            ? 68
            : 4;
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
    const command = [
      "--import",
      "tsx",
      "scripts/desktop/summary_seed.ts",
      root,
      ...(mode === "keyless" ? [] : [mode]),
    ];
    const result = JSON.parse(
      execFileSync(process.execPath, command, {
        encoding: "utf8",
        timeout: childTimeoutMs,
      }),
    );
    expect(result).toMatchObject({
      task,
      runId: id,
      completed,
      incomplete: 1,
      providerCalls: 0,
      schema: LATEST_SCHEMA_VERSION,
      variant:
        mode === "capacity"
          ? "memory-capacity"
          : mode === "compaction"
            ? "integrated-compaction"
            : mode === "correction"
              ? "integrated-correction"
              : mode === "controls"
                ? "integrated-controls"
                : mode === "integrated"
                  ? "integrated-summary"
                  : mode === "live"
                    ? "live-summary"
                    : "keyless",
    });
    const seeded = new Database(path, { readonly: true });
    expect(
      seeded
        .prepare(
          "select count(*) as n from conversation_turn where summary_eligible=1",
        )
        .get(),
    ).toEqual({
      n: mode === "controls" ? 0 : mode === "compaction" ? 4 : completed,
    });
    if (mode === "controls") {
      expect(
        seeded
          .prepare("select enabled,configured_enabled from summary_control")
          .get(),
      ).toEqual({ enabled: 0, configured_enabled: 1 });
      expect(
        seeded
          .prepare(
            "select count(*) as n from conversation_turn where status='completed' and summary_eligible=0",
          )
          .get(),
      ).toEqual({ n: 4 });
      expect(
        seeded.prepare("select count(*) as n from summary_attempt").get(),
      ).toEqual({ n: 0 });
    }
    expect(
      seeded.prepare("select count(*) as n from conversation_completion").get(),
    ).toEqual({ n: completed });
    expect(seeded.prepare("select count(*) as n from message").get()).toEqual({
      n: originalMessages + completed * 2 + 1,
    });
    if (mode !== "keyless") {
      expect(
        seeded
          .prepare(
            "select count(*) as n from conversation where id in (?,?) and manual_title=1",
          )
          .get(`${task}-${id}-A`, `${task}-${id}-B`),
      ).toEqual({ n: mode === "capacity" ? 1 : 2 });
      expect(result.conversationId).toBe(`${task}-${id}-A`);
    }
    if (mode === "capacity") {
      expect(result).toMatchObject({
        manualItems: 18,
        configuredCharacters: 20000,
      });
      expect(result.manualCharacters).toBeGreaterThan(12000);
      expect(result.renderedCharacters).toBe(0); // Preferences do not consume generated allowance.
      expect(seeded.prepare("select cap from summary_control").get()).toEqual({
        cap: 20000,
      });
      expect(
        seeded.prepare("select count(*) as n from summary_preference").get(),
      ).toEqual({ n: 18 });
      expect(
        seeded.prepare("select count(*) as n from summary_attempt").get(),
      ).toEqual({ n: 0 });
    }
    if (mode === "compaction") {
      expect(
        seeded
          .prepare(
            "select count(*) as n from conversation_turn where conversation_id=? and status='completed' and summary_eligible=0",
          )
          .get(`${task}-${id}-long`),
      ).toEqual({ n: 64 });
      expect(
        seeded
          .prepare(
            "select payload from conversation_summary_pin where conversation_id=?",
          )
          .get(`${task}-${id}-long`),
      ).toEqual({ payload: "null" });
      expect(
        seeded
          .prepare(
            "select covered_through from conversation_segment where conversation_id=?",
          )
          .get(`${task}-${id}-long`),
      ).toEqual({ covered_through: 0 });
    }
    if (mode === "correction") {
      expect(
        seeded
          .prepare(
            "select content from message where role='user' and conversation_id=? order by created_at,rowid limit 1",
          )
          .get(`${task}-${id}-A`),
      ).toEqual({ content: "Remember: evening sessions suit me." });
    }
    seeded.close();
    const before = readFileSync(path);
    const replay = spawnSync(process.execPath, command, {
      encoding: "utf8",
      timeout: childTimeoutMs,
    });
    expect(replay.error).toBeUndefined();
    expect(replay.signal).toBeNull();
    expect(replay.status).toBe(1);
    expect(readFileSync(path)).toEqual(before);
  },
  scenarioTimeoutMs,
);
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
