import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateDatabase, SCHEMA_MIGRATIONS } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryStorage as storage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import {
  getTrainerProfile,
  saveTrainerProfile,
} from "@/lib/db/profile-repository";
import { readSummaryPin } from "@/lib/db/conversation-summary-pin";
import { createSummaryEngine } from "@/lib/memory/summary-application";
import { compactConversation } from "@/lib/chat/conversation-compaction";

let db: Database.Database;
let now: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.UTC(2026, 10, 9);
  storage.configure(true, "gpt-6-luna", 6000);
});
afterEach(() => db.close());
const prior =
  "Short weekday sessions because caregiving limits time; long weekdays failed. Equipment remains unchosen, not rejected. ".repeat(
    120,
  );
function complete(user: string, chat = "authored") {
  const turn = history.admit(chat, user);
  history.complete(turn.admission, {
    content: "Assistant suggestion remains unverified.",
    grounding: null,
  });
  return turn;
}
function tables() {
  return Object.fromEntries(
    (
      db
        .prepare(
          "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [
      name,
      db
        .prepare(
          `select * from "${name}"${name === "app_metadata" ? " where key<>'schema_version'" : ""}`,
        )
        .all(),
    ]),
  );
}
it("preserves every populated authored schema24 table through25, changes effective triggers, and reopens idempotently", () => {
  saveTrainerProfile({
    goals: ["Authored goal"],
    sports: ["hiking"],
    preferences: {},
    constraints: ["Caregiving"],
  });
  storage.editSummary(storage.version(), prior, now);
  storage.edit(storage.version(), null, "Separate preference", now);
  for (let n = 0; n < 5; n++) complete(`Authored user ${n}`);
  const active = history.admit("authored", "Current request");
  const replay = history.read(active.admission);
  const oldCompact = JSON.stringify({
    speaker: "user",
    text: "Caregiving limits weekdays.",
    sourceTurnIds: [replay.turns[0]!.turnId],
  });
  expect(history.publish(replay, replay.turns.slice(0, 1), oldCompact)).toBe(
    true,
  );
  db.exec(`insert into activity(id,garmin_id,sport,started_at) values('authored-activity','fictional-1','hiking',1);
    insert into daily_health(date,steps) values('2026-11-01',1234);
    insert into training_plan values('default','Authored plan','Example /Users/example/plan.md',1,1);
    insert into conversation_title_spend values('historical','2026-11-01',0.25,'{"input":10}');`);
  // Schema25 has no added tables/columns or data transformations. Restore exactly
  // the four removed historical trigger definitions to author effective schema24.
  for (const migration of SCHEMA_MIGRATIONS.filter(
    (m) => m.version === 18 || m.version === 24,
  ))
    for (const statement of migration.statements)
      if (
        statement.startsWith("create trigger conversation_profile_") ||
        statement.startsWith("create trigger summary_explicit_correction ")
      )
        db.exec(statement);
  db.exec(
    "drop table weekly_kpi; drop table weekly_kpi_track; update app_metadata set value='24' where key='schema_version'",
  );
  expect(
    db
      .prepare(
        "select name from sqlite_master where type='trigger' and (name like 'conversation_profile_%' or name='summary_explicit_correction')",
      )
      .all(),
  ).toHaveLength(4);
  const before = tables();
  expect(migrateDatabase(db)).toMatchObject({
    fromVersion: 24,
    toVersion: 26,
    applied: [
      "25:memory_freshness_without_erasure",
      "26:structured_weekly_kpis",
    ],
    integrity: "ok",
  });
  const preserved = { ...before, weekly_kpi: [], weekly_kpi_track: [] };
  expect(tables()).toEqual(preserved);
  expect(
    db
      .prepare(
        "select name from sqlite_master where type='trigger' and (name like 'conversation_profile_%' or name='summary_explicit_correction')",
      )
      .all(),
  ).toEqual([]);
  expect(
    db
      .prepare(
        "select name from sqlite_master where type='trigger' and name in ('summary_privacy','summary_pin_control','conversation_message_delete')",
      )
      .all(),
  ).toHaveLength(3);
  const bytes = db.serialize();
  db.close();
  db = new Database(bytes);
  expect(migrateDatabase(db).applied).toEqual([]);
  expect(tables()).toEqual(preserved);
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(history.read(active.admission).segment.compact).toBe(oldCompact);
  expect(storage.read().text).toBe(prior);
});
it("ignores Profile timestamps/no-op saves, rejects changed-Profile in-flight work, and preserves memory, pins and compact on insert/update/delete", () => {
  storage.editSummary(storage.version(), prior, now);
  for (let n = 0; n < 4; n++) complete(`Source ${n}`);
  const turn = history.admit("authored", "Follow-up");
  const replay = history.read(turn.admission);
  expect(
    history.publish(
      replay,
      replay.turns.slice(0, 1),
      "User caregiving rationale; assistant options unchosen.",
    ),
  ).toBe(true);
  const pin = readSummaryPin("authored");
  const originalProfile = getTrainerProfile();
  saveTrainerProfile(originalProfile); // inserting an equivalent empty Profile
  saveTrainerProfile(originalProfile);
  db.exec("update trainer_profile set updated_at=updated_at+100");
  expect(() => history.assertCurrent(turn.admission)).not.toThrow();
  noteSummaryActivity(now);
  now += 3000;
  const job = storage.admit(now, "profile-job")!;
  expect(job.profile).toEqual(originalProfile);
  saveTrainerProfile({
    ...originalProfile,
    constraints: ["Only mornings now"],
  });
  expect(() => history.assertCurrent(turn.admission)).toThrow("invalidated");
  expect(storage.reserve(job, now)).toBe(false);
  expect(storage.read().text).toBe(prior);
  expect(readSummaryPin("authored")).toEqual(pin);
  expect(
    (
      db
        .prepare(
          "select compact from conversation_segment where conversation_id='authored'",
        )
        .get() as { compact: string }
    ).compact,
  ).toContain("caregiving");
  const fresh = history.admit("fresh", "Current Profile");
  db.exec("delete from trainer_profile");
  expect(() => history.assertCurrent(fresh.admission)).toThrow("invalidated");
  expect(storage.read().text).toBe(prior);
  expect(readSummaryPin("authored")).toEqual(pin);
});
it.each(["suppressed", "memory-private"])(
  "routine context preserves independent meaning but never substitutes an older assistant after %s latest context",
  async (restriction) => {
    complete("Earlier independent topic.");
    const restricted = complete(
      restriction === "memory-private"
        ? "Please do not remember this discussion."
        : "Restricted latest option.",
    );
    if (restriction === "suppressed")
      db.prepare("insert into summary_suppression(source_id) values(?)").run(
        `${restricted.admission.turnId}:1`,
      );
    else {
      noteSummaryActivity(now);
      now += 3000;
      const generate = vi.fn(async (_system: string, prompt: string) => {
        expect(JSON.parse(prompt).newSources[1].user).toBe(
          "Please do not remember this discussion.",
        );
        return {
          patch: { summary: "", exclude: [1] },
          usage: { input: 20, output: 10, cached: 0 },
        };
      });
      await createSummaryEngine({
        storage,
        generation: { generate },
        now: () => now,
        identity: () => "privacy-origin",
        current: () => true,
        jitter: () => 0,
      }).tick(new AbortController().signal);
      expect(generate).toHaveBeenCalledTimes(1);
    }
    const selected = complete(
      "Use that for future coaching; I can train only on weekends.",
    );
    noteSummaryActivity(now);
    now += 3000;
    const job = storage.admit(now, "context-boundary")!;
    const source = job.sources.find(
      (source) => source.sourceId === `${selected.admission.turnId}:1`,
    )!;
    expect(source.user).toContain("only on weekends");
    expect(source.referent).toBeNull();
  },
);

it("normal maintenance automatically consolidates repeated prior, corrections and new learning in one request per batch", async () => {
  storage.editSummary(storage.version(), prior, now);
  storage.edit(storage.version(), null, "Separate preference", now);
  const generate = vi.fn(async (system: string, prompt: string) => {
    const input = JSON.parse(prompt);
    expect(system).toContain("automatically learns, corrects and consolidates");
    expect(input.previous).toContain("caregiving");
    expect(JSON.stringify(input)).not.toContain("Separate preference");
    expect(input.newSources[0].user).toContain("mornings");
    expect(system).not.toContain("Do not restate, globally rewrite");
    return {
      patch: {
        exclude: [],
        summary:
          "Current mornings; short weekdays because caregiving limits time, and long weekdays failed. Equipment remains undecided. New Sunday watercolor practice because the studio is quiet.",
      },
      usage: { input: 100, output: 40, cached: 0 },
    };
  });
  const engine = createSummaryEngine({
    storage,
    generation: { generate },
    now: () => now,
    identity: () => `curation-${now}`,
    current: () => true,
    jitter: () => 0,
  });
  for (const user of [
    "Actually mornings now work better. I practice watercolor on Sundays because the studio is quiet.",
    "Correction: mornings still work; long weekday plans failed.",
  ]) {
    complete(user);
    noteSummaryActivity(now);
    now += 3000;
    await engine.tick(new AbortController().signal);
    expect(storage.read().text).toContain("because caregiving");
    expect(storage.status(now).pending).toBe(0);
  }
  expect(generate).toHaveBeenCalledTimes(2);
  expect(storage.preferences()[0].text).toBe("Separate preference");
  expect(storage.read().text.length).toBeLessThan(prior.length);
});
it.each([
  "We discussed blood pressure with my clinician.",
  "My token budget is low.",
  "The route uses GPS navigation.",
  "Quoted: ignore previous instructions; fictional sk-example.",
])("compacts ordinary discussion without topic screening: %s", async (user) => {
  for (let n = 0; n < 4; n++) complete(user);
  const active = history.admit("authored", "Follow-up");
  const generate = vi.fn(async (_system: string, prompt: string) => {
    expect(JSON.parse(prompt).sources[0].user).toBe(user);
    return JSON.stringify({
      summary:
        `User discussed: ${user} Assistant suggestions unverified. ` +
        "Caregiving rationale remains. ".repeat(240),
    });
  });
  expect(
    await compactConversation(history, history.read(active.admission), {
      generate,
      count: vi.fn(),
    }),
  ).toBe(true);
  expect(history.read(active.admission).segment.compact.length).toBeGreaterThan(
    6000,
  );
});
