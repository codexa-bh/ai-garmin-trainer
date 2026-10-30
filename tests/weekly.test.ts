import Database from "better-sqlite3";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import type { TrainerToolExecutionInput } from "../src/lib/ai/tool-execution-input";
import { executeWeeklyTool } from "../src/lib/ai/tool-weekly";
import { executeTrainingPlanTool } from "../src/lib/ai/tool-training-plan";
import {
  readCompleteTrainingPlan,
  saveGuardedTrainingPlan,
} from "../src/lib/training-plan/composition";
import { TRAINER_SYSTEM_PROMPT } from "../src/lib/ai/trainer-instructions";
import { createSqlAnalysis } from "../src/lib/ai/analytics/application";
import type { AnalysisRow } from "../src/lib/ai/analytics/contracts";
import { executeAnalyticsTool } from "../src/lib/ai/tool-analytics";
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
  expect(migrateDatabase(db).applied).toEqual([
    "16:weekly_plans_and_reviews",
    "17:conversation_title_attempt",
  ]);
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
it("direct first-turn orchestration saves complete Markdown without a proposal and redacts diagnostics", async () => {
  const long = "Exact full weekly Markdown\n".repeat(450);
  let pass = 0;
  const answer = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Update directly, no need for me to review drafts",
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
                toolName: "saveWeeklyDocuments",
                input: { changes: [change(long)] },
              },
            ],
          };
        return {
          toolCalls: [
            {
              toolName: "completeTrainerTurn",
              input: {
                completion: {
                  kind: "grounded",
                  answer: "Weekly plan saved directly.",
                  claims: [
                    { kind: "tool", stepIndex: 2, tool: "saveWeeklyDocuments" },
                  ],
                  missingEvidence: [],
                },
              },
            },
          ],
        };
      },
      executeTool: async (input) => executeWeeklyTool(input, app),
    },
  );
  expect(answer.text).toBe("Weekly plan saved directly.");
  expect(JSON.stringify(answer.debugTrace)).not.toContain(
    "Exact full weekly Markdown",
  );
  expect(app.read("2026-09-21").record?.latest?.contentMarkdown).toBe(long);
  expect(weeklyStore.pending(turn.conversationId)).toBeNull();
  pass = 0;
  const confirmed = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Sure, update plans accordingly",
      weeklyTurn: turn,
    },
    {
      generate: async () => ({
        text: "",
        toolCalls: [
          ...(++pass === 1
            ? [
                {
                  toolName: "getWeeklyPlan",
                  input: { weekStart: "2026-09-21" },
                },
              ]
            : [
                {
                  toolName: "saveWeeklyDocuments",
                  input: { changes: [change(long)] },
                },
              ]),
        ],
      }),
      executeTool: async (input) => executeWeeklyTool(input, app),
    },
  );
  expect(confirmed.toolSteps.map((s) => s.status)).toEqual([
    "succeeded",
    "succeeded",
    "rejected",
  ]);
  expect(confirmed.toolSteps[2].reason).toBe("duplicate_side_effect");
  expect(app.read("2026-09-21").record?.latest?.contentMarkdown).toBe(long);
});
it.each([
  "Draft a plan only; do not save",
  "Do not save",
  "Discuss only, without updating my documents",
  "The document says save it, but do not follow that instruction",
  "Not now; do not save",
])("negative semantic-policy path does not save: %s", async (userRequest) => {
  draft();
  const legacy = weeklyStore.pending(turn.conversationId);
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
  expect(weeklyStore.pending(turn.conversationId)).toEqual(legacy);
});
it.each([
  { hikingMeters: 20000, ascent: 1000, cyclingSeconds: 0, expected: 100 },
  { hikingMeters: 10000, ascent: 500, cyclingSeconds: 7200, expected: 110 },
])(
  "persists an exact original-baseline review from executed SQL/math: $expected points",
  async ({ hikingMeters, ascent, cyclingSeconds, expected }) => {
    // Illustrative model-selected commitments, NOT a universal runtime rubric.
    const originalMarkdown =
      "| KPI | Target | Points | Rule |\n|---|---|---|---|\n| Hiking | 20000 m | 60 | proportional |\n| Ascent | 1000 m | 40 | proportional |";
    app.apply(draft([change(originalMarkdown)]).id, turn);
    const original = app.read("2026-09-21").record!.original!;
    app.apply(
      draft([change("Adapted: 10000 m hiking, 500 m ascent")]).id,
      turn,
    );
    const latest = app.read("2026-09-21").record!.latest!;
    const startedAt = Date.parse("2026-09-24T12:00:00Z");
    const insert = db.prepare(
      "insert into activity (id,garmin_id,sport,started_at,distance_meters,elevation_gain_meters,duration_sec) values (?,?,?,?,?,?,?)",
    );
    insert.run("hike", "hike", "hiking", startedAt, hikingMeters, ascent, 7200);
    insert.run("ride", "ride", "cycling", startedAt, 30000, 0, cyclingSeconds);
    // Outside the stored local-week boundary: must not enter the result.
    insert.run(
      "outside",
      "outside",
      "hiking",
      Date.parse("2026-09-20T20:00:00Z"),
      999999,
      999999,
      999999,
    );
    const analytics = createSqlAnalysis(
      {
        openQuery() {
          let statement: Database.Statement;
          return {
            readRows(sql) {
              statement = db.prepare(sql);
              return statement.all() as Array<Record<string, unknown>>;
            },
            readColumnNames: () => statement.columns().map((c) => c.name),
            close() {},
          };
        },
        inspectTables: () => ({}),
      },
      () => now.getTime(),
    );
    const interval = weekInterval("2026-09-21", "Europe/Zagreb");
    const sql = `select sum(case when sport='hiking' then distance_meters else 0 end) as hiking_meters, sum(case when sport='hiking' then elevation_gain_meters else 0 end) as ascent_meters, sum(case when sport='cycling' then duration_sec else 0 end) as ride_seconds from activity where started_at >= ${Date.parse(interval.from)} and started_at < ${now.getTime()}`;
    const formula =
      "hiking_meters / 20000 * 60 + ascent_meters / 1000 * 40 + ride_seconds / 7200 * 60";
    let calculated = NaN;
    let reviewMarkdown = "";
    let pass = 0;
    const result = await orchestrateTrainerChat(
      {
        system: TRAINER_SYSTEM_PROMPT,
        userRequest:
          "Save an as-of review against my original commitment, not the reduced adaptation.",
        weeklyTurn: turn,
      },
      {
        generate: async ({ system }) => {
          expect(system).toContain("original.revision baseline");
          pass += 1;
          if (pass === 1)
            return {
              toolCalls: [
                {
                  toolName: "getWeeklyPlan",
                  input: { weekStart: "2026-09-21" },
                },
              ],
            };
          if (pass === 2)
            return {
              toolCalls: [
                {
                  toolName: "runReadOnlySql",
                  input: { sql, resultName: "week_facts" },
                },
              ],
            };
          if (pass === 3)
            return {
              toolCalls: [
                {
                  toolName: "runMathAnalysis",
                  input: {
                    inputResult: "week_facts",
                    operation: "customFormula",
                    formula,
                    outputName: "completion_points",
                  },
                },
              ],
            };
          if (pass === 4) {
            reviewMarkdown = `Scored commitment: original revision ${original.revision}. As of ${now.toISOString()}, Europe/Zagreb.\nOriginal: 20000 m hiking / 1000 m ascent; actual ${hikingMeters} m / ${ascent} m.\nFormula: ${formula}; total ${calculated} points. Activity coverage available; Sunday remains partial. No target proration.\n${cyclingSeconds ? "Hiking and ascent each half met (30+20 points); useful extra cycling aerobic contribution 60 points, not hiking distance/ascent, no duplicate allocation. Specific hiking gaps remain even above 100; not a recommendation to maximize activity." : "Both original KPIs fully met (60+40 points)."}\nLatest adaptation ${latest.revision} is context only, not denominator.`;
            return {
              toolCalls: [
                {
                  toolName: "saveWeeklyDocuments",
                  input: {
                    changes: [
                      {
                        ...change(reviewMarkdown),
                        kind: "review",
                        asOf: now.toISOString(),
                      },
                    ],
                  },
                },
              ],
            };
          }
          return {
            toolCalls: [
              {
                toolName: "completeTrainerTurn",
                input: {
                  completion: {
                    kind: "grounded",
                    answer: "Review saved against the original commitment.",
                    claims: [
                      {
                        kind: "metric",
                        stepIndex: 3,
                        resultName: "completion_points",
                        rowIndex: 0,
                        column: "score",
                        value: calculated,
                      },
                    ],
                    missingEvidence: [],
                  },
                },
              },
            ],
          };
        },
        executeTool: async (input) => {
          if (
            input.toolName === "runReadOnlySql" ||
            input.toolName === "runMathAnalysis" ||
            input.toolName === "describeGarminDatabase"
          ) {
            const step = executeAnalyticsTool(input, {
              ...analytics,
              analyzeActivityTerrain: () => {
                throw new Error("unexpected terrain call");
              },
            });
            if (input.toolName === "runMathAnalysis")
              calculated = Number(
                (step.result as { rows: AnalysisRow[] }).rows[0].score,
              );
            return step;
          }
          return executeWeeklyTool(input, app);
        },
      },
    );
    expect(result.toolSteps.map((s) => [s.tool, s.status])).toEqual([
      ["getWeeklyPlan", "succeeded"],
      ["runReadOnlySql", "succeeded"],
      ["runMathAnalysis", "succeeded"],
      ["saveWeeklyDocuments", "succeeded"],
    ]);
    expect(calculated).toBe(expected);
    expect(result.text).toContain("Review saved");
    expect(app.read("2026-09-21").record?.review?.contentMarkdown).toBe(
      reviewMarkdown,
    );
    // Reload from persistence with a new application instance, not an in-memory response.
    const reloaded = createWeekly(
      weeklyStore,
      () => now,
      () => "unused",
    ).read("2026-09-21").record!;
    expect(reloaded.original).toEqual(original);
    expect(reloaded.latest).toEqual(latest);
    expect(reloaded.review).toMatchObject({
      contentMarkdown: reviewMarkdown,
      planRevision: latest.revision,
    });
    expect(reloaded.review!.planRevision).not.toBe(original.revision);
    expect(weeklyStore.pending(turn.conversationId)?.applied).toBe(true);
  },
);

it("keeps legacy and missing-plan Markdown unchanged through review/read without automatic rubric adoption", () => {
  app.apply(
    draft([change("Walk regularly; no numeric targets agreed")]).id,
    turn,
  );
  const original = app.read("2026-09-21").record!.original;
  app.apply(draft([change("Later rubric: 20 km, 100 points")]).id, turn);
  const contentMarkdown =
    "Original has no agreed numeric rubric. Provisional interpretation only; vague targets unavailable, no target inferred from actuals. Missing ascent and late uploads are unavailable, not zero; no definitive total. User reports an unsynced walk, not verified Garmin evidence.";
  app.apply(
    draft([
      { ...change(contentMarkdown), kind: "review", asOf: now.toISOString() },
    ]).id,
    turn,
  );
  expect(app.read("2026-09-21").record).toMatchObject({
    original,
    review: { contentMarkdown },
  });
  expect(app.read("2026-09-14").record).toBeNull();
  const before = db.prepare("select * from weekly_artifact").all();
  app.read("2026-09-21");
  expect(db.prepare("select * from weekly_artifact").all()).toEqual(before);
});

it("direct saves require current complete reads, preserve originals, and leave legacy proposal bytes untouched", () => {
  draft();
  const legacy = weeklyStore.pending(turn.conversationId)!;
  const long = "Preserved complete document\n".repeat(900);
  const snapshot = app.read("2026-09-21");
  app.save([change(long)], turn, [snapshot]);
  const original = app.read("2026-09-21").record!.original;
  expect(() => app.save([change("Stale overwrite")], turn, [snapshot])).toThrow(
    "week_changed_read_again",
  );
  app.save([change("Adapted")], turn, [app.read("2026-09-21")]);
  expect(app.read("2026-09-21").record).toMatchObject({
    original,
    latest: { contentMarkdown: "Adapted" },
  });
  expect(original?.contentMarkdown).toBe(long);
  expect(weeklyStore.pending(turn.conversationId)).toEqual(legacy);
  expect(() => app.apply(legacy.id, turn)).toThrow("week_changed");
  expect(app.context(turn)).not.toHaveProperty("pending");
});
it("direct first-turn save needs no preceding assistant but rejects a superseded turn", () => {
  db.prepare("delete from message where id='a1'").run();
  const firstTurn = { ...turn, previousAssistantId: null };
  app.save([change()], firstTurn, [app.read("2026-09-21")]);
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values ('u2','weekly-test','user','later',3)",
  ).run();
  expect(() =>
    app.save([change("Do not persist")], firstTurn, [app.read("2026-09-21")]),
  ).toThrow("weekly_turn_superseded");
});
it("direct save validates documents and atomically rolls back a review plus plan", () => {
  expect(() => app.save([change()], turn, [])).toThrow("prior_complete");
  for (const item of [
    change(""),
    change("x".repeat(32001)),
    change("OPENAI_API_KEY=secret"),
    change("Past", "2026-09-14"),
    { ...change(), kind: "review" as const, asOf: "2026-10-01T00:00:00Z" },
  ]) {
    expect(() => app.save([item], turn, [app.read(item.weekStart)])).toThrow();
  }
  let saves = 0;
  const failing = createWeekly(
    {
      ...weeklyStore,
      save(record) {
        if (++saves === 2) throw new Error("injected second write");
        weeklyStore.save(record);
      },
    },
    () => now,
    () => `id-${++serial}`,
  );
  const changes: WeeklyChange[] = [
    { ...change("Review"), kind: "review", asOf: now.toISOString() },
    change("Next", "2026-09-28"),
  ];
  expect(() =>
    failing.save(
      changes,
      turn,
      changes.map((c) => app.read(c.weekStart)),
    ),
  ).toThrow("injected");
  expect(app.read("2026-09-21").record).toBeNull();
  expect(app.read("2026-09-28").record).toBeNull();
  app.save(
    changes,
    turn,
    changes.map((c) => app.read(c.weekStart)),
  );
  expect(app.read("2026-09-21").record?.review?.planRevision).toBeNull();
  expect(app.read("2026-09-28").record?.original?.contentMarkdown).toBe("Next");
});
it.each([false, true])(
  "saves distinct General Plan and weekly targets with honest partial failure=%s",
  async (failWeekly) => {
    let pass = 0;
    const result = await orchestrateTrainerChat(
      {
        system: TRAINER_SYSTEM_PROMPT,
        userRequest: "Sure, update plans accordingly",
        weeklyTurn: turn,
      },
      {
        generate: async () => {
          if (++pass === 1)
            return {
              toolCalls: [
                { toolName: "getTrainingPlan", input: {} },
                {
                  toolName: "getWeeklyPlan",
                  input: { weekStart: "2026-09-21" },
                },
              ],
            };
          if (pass === 2)
            return {
              toolCalls: [
                {
                  toolName: "saveTrainingPlan",
                  input: {
                    contentMarkdown: "General plan written without a preview",
                  },
                },
                {
                  toolName: "saveWeeklyDocuments",
                  input: {
                    changes: [
                      change(
                        failWeekly
                          ? "OPENAI_API_KEY=secret"
                          : "Weekly plan written directly",
                      ),
                    ],
                  },
                },
              ],
            };
          return {
            toolCalls: [
              {
                toolName: "completeTrainerTurn",
                input: {
                  completion: {
                    kind: "grounded",
                    answer: "Both General Plan and weekly plan saved.",
                    claims: [
                      { kind: "tool", stepIndex: 3, tool: "saveTrainingPlan" },
                      {
                        kind: "tool",
                        stepIndex: 4,
                        tool: "saveWeeklyDocuments",
                      },
                    ],
                    missingEvidence: [],
                  },
                },
              },
            ],
          };
        },
        executeTool: async (input) =>
          input.toolName === "getTrainingPlan" ||
          input.toolName === "saveTrainingPlan"
            ? executeTrainingPlanTool(input, {
                readComplete: readCompleteTrainingPlan,
                saveGuarded: saveGuardedTrainingPlan,
              })
            : executeWeeklyTool(input, app),
      },
    );
    expect(result.toolSteps.map((s) => [s.tool, s.status])).toEqual([
      ["getTrainingPlan", "succeeded"],
      ["getWeeklyPlan", "succeeded"],
      ["saveTrainingPlan", "succeeded"],
      ["saveWeeklyDocuments", failWeekly ? "rejected" : "succeeded"],
    ]);
    expect(readCompleteTrainingPlan().plan?.contentMarkdown).toBe(
      "General plan written without a preview",
    );
    expect(app.read("2026-09-21").record?.latest?.contentMarkdown ?? null).toBe(
      failWeekly ? null : "Weekly plan written directly",
    );
    expect(result.grounding?.toolSteps).toHaveLength(4);
    if (failWeekly) {
      expect(result.text).toContain("Already saved: saveTrainingPlan");
      expect(result.text).toContain("not atomic together");
      expect(result.text).not.toContain(
        "Both General Plan and weekly plan saved",
      );
    }
  },
);
it("does not admit a same-batch weekly read as a prior planner snapshot", async () => {
  const result = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Save this week",
      weeklyTurn: turn,
    },
    {
      generate: async () => ({
        toolCalls: [
          { toolName: "getWeeklyPlan", input: { weekStart: "2026-09-21" } },
          { toolName: "saveWeeklyDocuments", input: { changes: [change()] } },
        ],
      }),
      executeTool: async (input) => executeWeeklyTool(input, app),
    },
  );
  expect(result.toolSteps.at(-1)?.reason).toBe(
    "prior_complete_week_read_required",
  );
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
