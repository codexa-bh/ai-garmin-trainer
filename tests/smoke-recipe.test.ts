import {
  chmodSync,
  linkSync,
  mkdtempSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorTime,
  populate,
  recipe,
  verify,
} from "../scripts/desktop/smoke_recipe";

function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "smoke-recipe-test-")));
  chmodSync(root, 0o700);
  return root;
}
function logical(db: Database.Database) {
  return [
    "trainer_profile",
    "app_metadata",
    "conversation",
    "message",
    "activity",
    "daily_health",
  ].map((table) => db.prepare(`select * from ${table} order by 1`).all());
}
afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("finite representative authored smoke recipe", () => {
  it("is logically deterministic across fresh private outputs and timezone/clock boundaries", () => {
    const root = scratch();
    const first = recipe(root, `smoke-input-${randomUUID()}`, "2026-11-01");
    const second = recipe(root, `smoke-input-${randomUUID()}`, "2026-11-01");
    const a = new Database(first.path, { readonly: true });
    const b = new Database(second.path, { readonly: true });
    try {
      expect(logical(a)).toEqual(logical(b));
      expect(first).toMatchObject({
        recipeVersion: 1,
        anchor: "2026-11-01",
        healthDays: 20,
        activities: 8,
        integrity: "ok",
        coverage: "ok",
      });
      expect(
        a
          .prepare(
            "select min(date) as oldest,max(date) as newest from daily_health",
          )
          .get(),
      ).toEqual({ oldest: "2026-10-12", newest: "2026-11-01" });
      expect(
        a
          .prepare(
            "select count(*) as n from daily_health where date='2026-10-22'",
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(
        a
          .prepare(
            "select sleep_minutes,steps from daily_health where date='2026-10-23'",
          )
          .get(),
      ).toEqual({ sleep_minutes: null, steps: 6990 });
      expect(
        a
          .prepare(
            "select steps,intensity_minutes from daily_health where date='2026-10-24'",
          )
          .get(),
      ).toEqual({ steps: 0, intensity_minutes: 0 });
      expect(statSync(first.path).mode & 0o777).toBe(0o600);
      expect(statSync(join(first.path, "..")).mode & 0o777).toBe(0o700);
    } finally {
      a.close();
      b.close();
    }
    for (const anchor of ["2024-02-29", "2026-03-29", "2026-12-31"])
      expect(new Date(anchorTime(anchor)).toISOString().slice(0, 10)).toBe(
        anchor,
      );
    for (const invalid of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-01",
      "not a date",
    ])
      expect(() => anchorTime(invalid)).toThrow();
  });

  it("is read by the existing conversation repository with distinct list/history ordering", async () => {
    const output = recipe(
      scratch(),
      `smoke-input-${randomUUID()}`,
      "2026-11-01",
    );
    const db = new Database(output.path, { readonly: true });
    vi.doMock("../src/lib/db/connection", () => ({ getDatabase: () => db }));
    const repository = await import("../src/lib/db/conversation-repository");
    try {
      const chats = repository.listConversations();
      expect(chats.map((chat) => chat.id)).toEqual([
        "default",
        "synthetic-chat-1",
        "synthetic-chat-2",
      ]);
      expect(new Set(chats.map((chat) => chat.title)).size).toBe(3);
      expect(repository.getConversation("synthetic-chat-1")?.createdAt).toEqual(
        new Date(anchorTime("2026-10-31")),
      );
      const turns = repository.listRecentChatMessages("default");
      expect(turns.map((turn) => turn.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(turns.map((turn) => turn.id)).toEqual(
        [0, 1, 2, 3].map((index) => `synthetic-turn-0-${index}`),
      );
    } finally {
      db.close();
      vi.doUnmock("../src/lib/db/connection");
    }
  });

  it("refuses inadequate, malformed, orphaned, future-schema, foreign-class and trigger inputs", () => {
    const mutations = [
      "update daily_health set steps='not numeric'",
      "update daily_health set hrv_ms=1e999",
      "delete from daily_health",
      "delete from activity",
      "delete from conversation",
      "update message set created_at=1",
      "update trainer_profile set goals_json='{}'",
      "update trainer_profile set preferences_json='[]'",
      "update message set conversation_id='orphan'",
      "update daily_health set date='2026-02-30' where date=(select min(date) from daily_health)",
      "update app_metadata set value='999' where key='schema_version'",
      "insert into app_metadata values ('unexpected','private',0)",
      "create trigger unexpected after insert on activity begin select 1; end",
      "insert into user(id,email,created_at,updated_at) values ('private','forbidden@example.invalid',0,0)",
    ];
    for (const mutation of mutations) {
      const db = new Database(":memory:");
      try {
        populate(db, "2026-11-01");
        db.exec(mutation);
        expect(() => verify(db, "synthetic"), mutation).toThrow();
      } finally {
        db.close();
      }
    }
    const db = new Database(":memory:");
    try {
      populate(db, "2026-11-01");
      expect(() => verify(db, "private")).toThrow();
      db.exec("delete from message;delete from conversation");
      expect(verify(db, "private").coverage).toBe("ok");
    } finally {
      db.close();
    }
  });

  it("preserves legitimate fractional imported duration/average-HR without accepting fractional counters or nonnumeric metrics", () => {
    const db = new Database(":memory:");
    try {
      populate(db, "2026-11-01");
      db.exec(
        "delete from message;delete from conversation;update activity set duration_sec=123.5,avg_heart_rate=130.25",
      );
      expect(verify(db, "private").coverage).toBe("ok");
      expect(
        db
          .prepare("select duration_sec,avg_heart_rate from activity limit 1")
          .get(),
      ).toEqual({ duration_sec: 123.5, avg_heart_rate: 130.25 });
      db.exec("update daily_health set steps=1.25");
      expect(() => verify(db, "private")).toThrow("Nonnumeric/nonfinite");
      db.exec(
        "update daily_health set steps=100;update activity set avg_heart_rate='not numeric'",
      );
      expect(() => verify(db, "private")).toThrow("Nonnumeric/nonfinite");
    } finally {
      db.close();
    }
  });

  it("publishes exclusively and refuses escaping/public/aliased/reused roots", () => {
    const root = scratch(),
      name = `smoke-input-${randomUUID()}`;
    const output = recipe(root, name, "2026-11-01");
    expect(() => recipe(root, name, "2026-11-01")).toThrow();
    const alias = join(root, "alias");
    symlinkSync(root, alias);
    for (const bad of [alias, ".", join(root, "missing")])
      expect(() => recipe(bad, name, "2026-11-01")).toThrow();
    for (const bad of ["../escape", "ordinary", "/absolute"])
      expect(() => recipe(root, bad, "2026-11-01")).toThrow();
    // A hardlinked existing output never becomes a replacement target.
    linkSync(output.path, join(root, "hardlink"));
    expect(() => recipe(root, name, "2026-11-01")).toThrow();
    chmodSync(root, 0o755);
    expect(() =>
      recipe(root, `smoke-input-${randomUUID()}`, "2026-11-01"),
    ).toThrow();
  });
});
