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
  it("opts into only finite automatic-rule metadata while retaining assessment/history and no preseeded measurements", async () => {
    const { realpathSync } = await import("node:fs");
    const path = seed(
      realpathSync(scratch()),
      `ci-seed-${randomUUID()}`,
      false,
      false,
      false,
      false,
      "automatic",
    );
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const { weekStart } = (
        await import("../src/lib/weekly/calendar")
      ).weeklyCalendar(
        new Date(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      const row = db
        .prepare("select state_json from weekly_kpi where week_start=?")
        .get(weekStart) as { state_json: string };
      const state = JSON.parse(row.state_json);
      expect(state.sets[1].items[0].tracks[1]).toMatchObject({
        pointsRule: { kind: "proportional" },
        requiresCondition: "condition",
      });
      expect(state.assessments[1].items[0].actuals[1].awardedPoints).toBeNull();
      expect(state.assessments[1].totalPoints).toBe(112.5);
      expect(state.assessments[0].items[0].actuals[1].awardedPoints).toBe(40);
      expect(
        db.prepare("select count(*) as n from weekly_kpi_measurement").get(),
      ).toEqual({ n: 0 });
      expect(runIntegrityCheck(db)).toBe("ok");
      expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
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

  it("prepares only synthetic table documents/chat with unchanged schema and no private inputs", async () => {
    const { realpathSync } = await import("node:fs");
    const root = realpathSync(scratch());
    const path = seed(root, `ci-seed-${randomUUID()}`, false, true);
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(runIntegrityCheck(db)).toBe("ok");
      const rows = db.prepare("select role, content from message").all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        role: "assistant",
        content: expect.stringContaining("Crédit"),
      });
      const record = db
        .prepare("select document_json from weekly_artifact")
        .get() as { document_json: string };
      const weekly = JSON.parse(record.document_json) as {
        latest: { title: string; contentMarkdown: string };
        original: unknown;
        review: { title: string; contentMarkdown: string };
      };
      expect(weekly.latest.title).toBe("T0249 synthetic plan");
      expect(weekly.latest.contentMarkdown).toContain("30 / 30");
      expect(weekly.original).toEqual(weekly.latest);
      expect(weekly.review.title).toBe("T0249 synthetic review");
      expect(weekly.review.contentMarkdown).toContain("https://example.test/");
      expect(
        db.prepare("select count(*) as count from activity").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
    expect(() => seed(root, `ci-seed-${randomUUID()}`, true, true)).toThrow(
      "exclusive",
    );
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
