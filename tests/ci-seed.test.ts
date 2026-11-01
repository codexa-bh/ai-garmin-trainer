import { chmodSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { seed } from "../scripts/ci/seed";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runIntegrityCheck,
} from "../src/lib/db/migrations";

function scratch() {
  // macOS /var aliases /private/var: exact canonical root is required.
  const root = mkdtempSync(join(tmpdir(), "ci-seed-test-"));
  chmodSync(root, 0o700);
  return root;
}

describe("narrow CI-only synthetic seed", () => {
  it("uses current migrations and typed Profile schema without credentials or env discovery", async () => {
    const { realpathSync } = await import("node:fs");
    const root = realpathSync(scratch());
    const name = `ci-seed-${randomUUID()}`;
    const path = seed(root, name);
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(runIntegrityCheck(db)).toBe("ok");
      expect(
        db.prepare("select goals_json from trainer_profile").get(),
      ).toEqual({ goals_json: '["CI synthetic initial goal"]' });
      expect(
        db.prepare("select count(*) as count from conversation").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
    expect(() => seed(root, name)).toThrow();
  });

  it("adds only the explicit synthetic disclosure conversation when opted in", async () => {
    const { realpathSync } = await import("node:fs");
    const path = seed(realpathSync(scratch()), `ci-seed-${randomUUID()}`, true);
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare("select id, title from conversation").all()).toEqual([
        { id: "default", title: "T0243 synthetic disclosure" },
      ]);
      expect(
        db
          .prepare(
            "select role, content, grounding_json from message order by created_at desc",
          )
          .all(),
      ).toEqual([
        {
          role: "assistant",
          content: "T0243 synthetic trace",
          grounding_json: JSON.stringify({
            debugTrace: {
              schemaVersion: 1,
              finalAnswer: "T0243 synthetic diagnostic only",
            },
          }),
        },
        {
          role: "assistant",
          content: "T0243 synthetic missing trace",
          grounding_json: null,
        },
      ]);
      expect(
        db
          .prepare("select created_at from message order by created_at desc")
          .all(),
      ).toEqual([{ created_at: 1000 }, { created_at: 0 }]);
      expect(runIntegrityCheck(db)).toBe("ok");
    } finally {
      db.close();
    }
  });

  it("refuses aliases, reused/escaping names, relative and public scratch", async () => {
    const { realpathSync } = await import("node:fs");
    const root = realpathSync(scratch());
    const name = `ci-seed-${randomUUID()}`;
    const alias = join(root, "alias");
    symlinkSync(root, alias);
    for (const invalid of [alias, ".", join(root, "missing")])
      expect(() => seed(invalid, name)).toThrow();
    for (const invalid of [
      "../escape",
      "/absolute",
      "ci-seed-not-uuid",
      "ordinary",
    ])
      expect(() => seed(root, invalid)).toThrow();
    chmodSync(root, 0o755);
    expect(() => seed(root, name)).toThrow();
  });
});
