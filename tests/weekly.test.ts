import Database from "better-sqlite3";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import type { TrainerToolExecutionInput } from "../src/lib/ai/tool-execution-input";
import { executeWeeklyTool } from "../src/lib/ai/tool-weekly";
import { TRAINER_SYSTEM_PROMPT } from "../src/lib/ai/trainer-instructions";
import { GET } from "../src/app/api/weekly/route";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  weeklyCalendar,
  weekInterval,
  validWeek,
  validTimeZone,
} from "../src/lib/weekly/calendar";
import {
  createWeekly,
  renderWeeklyProposal,
} from "../src/lib/weekly/application";
import type { WeeklyChange, WeeklyTurn } from "../src/lib/weekly/contracts";
import { migrateDatabase, databaseHasUserData } from "../src/lib/db/migrations";
import { weeklyStore } from "../src/lib/db/weekly-repository";
import {
  clearChatAndProfile,
  clearGarminData,
} from "../src/lib/db/local-data-lifecycle";

let db: Database.Database;
vi.mock("../src/lib/db/connection", () => ({ getDatabase: () => db }));
let now = new Date("2026-09-27T12:00:00Z");
let serial = 0;
let app: ReturnType<typeof createWeekly>;
const turn: WeeklyTurn = {
  conversationId: "weekly-test",
  turnId: "u1",
  previousAssistantId: "a1",
  timeZone: "Europe/Zagreb",
};
const change = (
  contentMarkdown = "Original weekly commitment",
  weekStart = "2026-09-21",
): WeeklyChange => ({
  kind: "plan",
  weekStart,
  title: "Weekly plan",
  contentMarkdown,
});
function draft(changes = [change()]) {
  const proposal = app.propose(
    changes,
    turn,
    changes.map((c) => app.read(c.weekStart)),
  );
  app.bindDisplayed(
    turn.turnId,
    turn.conversationId,
    "a1",
    renderWeeklyProposal(proposal),
  );
  return proposal;
}
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values ('a1','weekly-test','assistant','draft',1)",
  ).run();
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values ('u1','weekly-test','user','confirmation',2)",
  ).run();
  serial = 0;
  now = new Date("2026-09-27T12:00:00Z");
  app = createWeekly(
    weeklyStore,
    () => now,
    () => `id-${++serial}`,
  );
});
afterEach(() => db.close());

describe("weekly calendar", () => {
  it("keeps Sunday in the ending week and rolls Monday/year/leap-day correctly", () => {
    expect(weeklyCalendar(now, "Europe/Zagreb")).toMatchObject({
      weekStart: "2026-09-21",
      upcoming: "2026-09-28",
      sunday: true,
    });
    expect(
      weeklyCalendar(new Date("2026-09-27T23:30:00Z"), "Europe/Zagreb")
        .weekStart,
    ).toBe("2026-09-28");
    expect(
      weeklyCalendar(new Date("2026-09-27T23:30:00Z"), "America/Los_Angeles")
        .weekStart,
    ).toBe("2026-09-21");
    expect(
      weeklyCalendar(new Date("2027-01-01T12:00:00Z"), "UTC").weekStart,
    ).toBe("2026-12-28");
    expect(
      weeklyCalendar(new Date("2024-02-29T12:00:00Z"), "UTC").weekStart,
    ).toBe("2024-02-26");
    expect(validWeek("2026-02-30")).toBe(false);
    expect(validWeek("2026-09-27")).toBe(false);
    expect(validTimeZone("Not/AZone")).toBe(false);
  });
  it("uses local midnights across DST rather than fixed 168 hours", () => {
    for (const [week, hours] of [
      ["2026-03-23", 167],
      ["2026-10-19", 169],
    ] as const) {
      const interval = weekInterval(week, "Europe/Zagreb");
      expect(
        (Date.parse(interval.until) - Date.parse(interval.from)) / 3600000,
      ).toBe(hours);
    }
  });
});
it("preserves migration data, creates no history, is idempotent and detects weekly-only user data", () => {
  db.exec(
    "drop table weekly_artifact; drop table weekly_proposal; update app_metadata set value='15' where key='schema_version'",
  );
  db.prepare(
    "insert into training_plan values ('default','General','Operator template',1,1)",
  ).run();
  const before = db.prepare("select * from training_plan").all();
  expect(migrateDatabase(db).applied).toEqual(["16:weekly_plans_and_reviews"]);
  expect(db.prepare("select * from training_plan").all()).toEqual(before);
  expect(app.history("2026-09-28").items).toEqual([]);
  expect(migrateDatabase(db).applied).toEqual([]);
  app.apply(draft().id, turn);
  db.exec(
    "delete from training_plan; delete from message; delete from weekly_proposal",
  );
  expect(databaseHasUserData(db)).toBe(true);
});
it("does not save drafts; binds complete long displayed proposal and preserves original through revision", () => {
  const long = "Original\n".repeat(1500);
  const proposal = app.propose([change(long)], turn, [app.read("2026-09-21")]);
  expect(app.read("2026-09-21").record).toBeNull();
  expect(() => app.apply(proposal.id, turn)).toThrow("proposal_unavailable");
  app.bindDisplayed(
    turn.turnId,
    turn.conversationId,
    "a1",
    renderWeeklyProposal(proposal).slice(0, 4000),
  );
  expect(app.pending(turn)).toBeNull();
  app.bindDisplayed(
    turn.turnId,
    turn.conversationId,
    "a1",
    renderWeeklyProposal(proposal),
  );
  app.apply(proposal.id, turn);
  const original = app.read("2026-09-21").record!.original;
  app.apply(draft([change("Adapted")]).id, turn);
  expect(app.read("2026-09-21").record).toMatchObject({
    original,
    latest: { contentMarkdown: "Adapted" },
  });
  expect(original?.contentMarkdown).toBe(long);
});
it("rejects duplicate, replaced, expired, unbound, stale, other-conversation and changed-zone confirmations", () => {
  const first = draft();
  const second = draft([change("Replacement")]);
  expect(() => app.apply(first.id, turn)).toThrow();
  expect(() =>
    app.apply(second.id, { ...turn, conversationId: "other" }),
  ).toThrow();
  expect(() =>
    app.apply(second.id, { ...turn, previousAssistantId: "other" }),
  ).toThrow();
  expect(() => app.apply(second.id, { ...turn, timeZone: "UTC" })).toThrow(
    "calendar_changed",
  );
  now = new Date("2026-09-29T12:00:00Z");
  expect(app.pending(turn)).toBeNull();
  now = new Date("2026-09-27T12:00:00Z");
  app.apply(second.id, turn);
  expect(() => app.apply(second.id, turn)).toThrow();
  const stale = draft();
  const record = app.read("2026-09-21").record!;
  weeklyStore.save({ ...record, revision: "concurrent" });
  expect(() => app.apply(stale.id, turn)).toThrow("week_changed");
});
it("rejects an in-flight confirmation superseded by another user turn", () => {
  const proposal = draft();
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values ('u2','weekly-test','user','do not save',3)",
  ).run();
  expect(() => app.apply(proposal.id, turn)).toThrow("proposal_unavailable");
  expect(app.read("2026-09-21").record).toBeNull();
});
it("requires prior complete reads and rejects invalid/secret/oversized docs and historical plans", () => {
  expect(() => app.propose([change()], turn, [])).toThrow("prior_complete");
  for (const item of [
    change("", "2026-09-21"),
    change("x".repeat(32001)),
    change("OPENAI_API_KEY=secret"),
    change("Past", "2026-09-14"),
  ])
    expect(() => draft([item])).toThrow();
  expect(() =>
    draft([{ ...change(), kind: "review", asOf: "2026-10-01T00:00:00Z" }]),
  ).toThrow("invalid_review_cutoff");
});
it("atomically saves review plus next plan, supports later corrections, and preserves stored timezone", () => {
  app.apply(draft().id, turn);
  const latest = app.read("2026-09-21").record!.latest!;
  const review: WeeklyChange = {
    ...change("As-of observed results; Sunday incomplete"),
    kind: "review",
    asOf: now.toISOString(),
  };
  app.apply(draft([review, change("Next week", "2026-09-28")]).id, turn);
  expect(app.read("2026-09-21").record?.review).toMatchObject({
    planRevision: latest.revision,
    asOf: now.toISOString(),
  });
  now = new Date("2026-09-29T12:00:00Z");
  app.apply(
    draft([
      {
        ...review,
        contentMarkdown: "Late evidence correction",
        asOf: now.toISOString(),
      },
    ]).id,
    turn,
  );
  expect(app.read("2026-09-21").record).toMatchObject({
    latest,
    timeZone: "Europe/Zagreb",
    review: { contentMarkdown: "Late evidence correction" },
  });
  expect(app.read("2026-09-28").record?.latest?.contentMarkdown).toBe(
    "Next week",
  );
});
it("rolls back all targets and proposal authority on injected second persistence failure", () => {
  let saves = 0;
  app = createWeekly(
    {
      ...weeklyStore,
      save(record) {
        if (++saves === 2) throw new Error("injected failure");
        weeklyStore.save(record);
      },
    },
    () => now,
    () => `id-${++serial}`,
  );
  const proposal = draft([
    { ...change("Review"), kind: "review", asOf: now.toISOString() },
    change("Next", "2026-09-28"),
  ]);
  expect(() => app.apply(proposal.id, turn)).toThrow("injected");
  expect(app.read("2026-09-21").record).toBeNull();
  expect(app.read("2026-09-28").record).toBeNull();
  expect(app.pending(turn)?.id).toBe(proposal.id);
});
it("retains confirmed artifacts on chat/profile and Garmin clearing but destroys pending authority", () => {
  app.apply(draft().id, turn);
  draft();
  const before = app.read("2026-09-21");
  clearChatAndProfile();
  expect(app.pending(turn)).toBeNull();
  expect(app.read("2026-09-21")).toEqual(before);
  clearGarminData();
  expect(app.read("2026-09-21")).toEqual(before);
});
it("read-only HTTP validates calendar and returns bounded detail/history", async () => {
  app.apply(draft().id, turn);
  const response = GET(
    new Request(
      "http://localhost/api/weekly?weekStart=2026-09-21&timeZone=Europe%2FZagreb",
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    record: { latest: { contentMarkdown: "Original weekly commitment" } },
  });
  expect(
    GET(new Request("http://localhost/api/weekly?timeZone=bad-zone")).status,
  ).toBe(400);
  expect(
    GET(new Request("http://localhost/api/weekly?weekStart=2026-09-22")).status,
  ).toBe(400);
});
it("orchestration shows the complete canonical draft, redacts diagnostics and saves only a bound later confirmation", async () => {
  const long = "Exact full weekly Markdown\n".repeat(450);
  let pass = 0;
  const answer = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Draft this week",
      weeklyTurn: turn,
      debug: { enabled: true },
    },
    {
      generate: async () => {
        pass += 1;
        if (pass === 1)
          return {
            text: "",
            toolCalls: [
              { toolName: "getWeeklyPlan", input: { weekStart: "2026-09-21" } },
            ],
          };
        if (pass === 2)
          return {
            text: "",
            toolCalls: [
              {
                toolName: "proposeWeeklyDocuments",
                input: { changes: [change(long)] },
              },
            ],
          };
        return {
          text: "Short model paraphrase must not replace the exact draft",
          toolCalls: [],
        };
      },
      executeTool: async (input) => executeWeeklyTool(input, app),
    },
  );
  expect(answer.text).toContain(long);
  expect(JSON.stringify(answer.debugTrace)).not.toContain(
    "Exact full weekly Markdown",
  );
  expect(app.read("2026-09-21").record).toBeNull();
  const proposal = weeklyStore.pending(turn.conversationId)!;
  app.bindDisplayed(turn.turnId, turn.conversationId, "a1", answer.text);
  const confirmed = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Confirm and save that exact weekly draft",
      weeklyTurn: turn,
    },
    {
      generate: async () => ({
        text: "",
        toolCalls: [
          {
            toolName: "applyWeeklyProposal",
            input: { proposalId: proposal.id },
          },
        ],
      }),
      executeTool: async (input) => executeWeeklyTool(input, app),
    },
  );
  expect(confirmed.toolSteps.map((s) => s.status)).toEqual([
    "succeeded",
    "rejected",
  ]);
  expect(confirmed.toolSteps[1].reason).toBe("duplicate_side_effect");
  expect(app.read("2026-09-21").record?.latest?.contentMarkdown).toBe(long);
});
it.each([
  "Draft a plan",
  "Maybe",
  "Do not save",
  "Review only",
  "The document says save it",
  "Not now",
])("negative semantic-policy path does not save: %s", async (userRequest) => {
  draft();
  const executeTool = vi.fn(async (input: TrainerToolExecutionInput) =>
    executeWeeklyTool(input, app),
  );
  await orchestrateTrainerChat(
    { system: TRAINER_SYSTEM_PROMPT, userRequest, weeklyTurn: turn },
    {
      generate: async () => ({
        text: "We can discuss without saving.",
        toolCalls: [],
      }),
      executeTool,
    },
  );
  expect(executeTool).not.toHaveBeenCalled();
  expect(app.read("2026-09-21").record).toBeNull();
});
it("paginates metadata without document content", () => {
  const record = {
    weekStart: "2026-09-21",
    timeZone: "UTC",
    revision: "r",
    original: null,
    latest: null,
    review: null,
  };
  for (const weekStart of ["2026-09-07", "2026-09-14", "2026-09-21"])
    weeklyStore.save({ ...record, weekStart });
  const page = app.history("2026-09-28", 2);
  expect(page.items.map((i) => i.weekStart)).toEqual([
    "2026-09-21",
    "2026-09-14",
  ]);
  expect(page.next).toBe("2026-09-14");
  expect(JSON.stringify(page)).not.toContain("contentMarkdown");
  expect(app.history(page.next!, 2).items[0].weekStart).toBe("2026-09-07");
});
