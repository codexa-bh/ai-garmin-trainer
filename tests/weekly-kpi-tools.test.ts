import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeTrainerTool } from "../src/lib/ai/tool-execution";
import type { TrainerToolPorts } from "../src/lib/ai/tool-ports";
import { z } from "zod";
import { trainerToolContracts } from "../src/lib/ai/tool-contracts";
import type { KpiChange } from "../src/lib/weekly/kpi-contracts";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/lib/db/migrations";
import { createWeeklyStore } from "../src/lib/db/weekly-repository";
import { createWeekly } from "../src/lib/weekly/application";
import { executeWeeklyTool } from "../src/lib/ai/tool-weekly";
import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import { TRAINER_SYSTEM_PROMPT } from "../src/lib/ai/trainer-instructions";
import { authoredWeeklyKpis } from "./kpi-fixture";
import { weeklyCalendar } from "../src/lib/weekly/calendar";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";
import type { TrainerToolCall } from "../src/lib/ai/tool-types";
import type { WeeklyTurn } from "../src/lib/weekly/contracts";

let db: Database.Database;
let app: ReturnType<typeof createWeekly>;
const now = new Date("2026-11-10T12:00:00Z");
const weekStart = weeklyCalendar(now, "UTC").weekStart;
const turn: WeeklyTurn = {
  conversationId: "authored",
  turnId: "user",
  previousAssistantId: null,
  timeZone: "UTC",
};
let id = 0;
const fixture = authoredWeeklyKpis(now);
const commitment = {
  origin: fixture.sets[0].origin,
  provenance: fixture.sets[0].provenance,
  items: fixture.sets[0].items,
};
const savedAssessment = fixture.assessments[0];
const assessment = {
  setId: "new",
  asOf: savedAssessment.asOf,
  status: savedAssessment.status,
  totalPoints: savedAssessment.totalPoints,
  explanation: savedAssessment.explanation,
  items: savedAssessment.items,
  extras: savedAssessment.extras,
};
const change = {
  weekStart,
  commitment,
  assessments: [{ ...assessment, setId: "new" }],
};
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  id = 0;
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values ('authored','Authored',1,1)",
  ).run();
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values ('user','authored','user','Authored task',1)",
  ).run();
  app = createWeekly(
    createWeeklyStore(() => db),
    () => now,
    () => `kpi-${++id}`,
  );
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});
it.each([
  ["saveWeeklyKpis", ""],
  ["saveWeeklyKpis", " \t "],
  ["saveWeeklyDocuments", ""],
  ["saveWeeklyDocuments", " \t "],
] as const)(
  "saves schema-valid optional blank scoring through %s without requiring a prose rubric (%j)",
  async (toolName, scoring) => {
    const minimal = {
      origin: "planned" as const,
      items: [
        {
          id: "volume",
          conceptId: "volume",
          label: "Volume",
          scoring,
          tracks: [
            {
              key: "minutes",
              kind: "numeric" as const,
              unit: "min",
              meaning: "Agreed volume",
              target: { comparator: "at-least" as const, value: 90 },
              availablePoints: 100,
            },
          ],
        },
      ],
    };
    const input =
      toolName === "saveWeeklyKpis"
        ? { weekStart, commitment: minimal }
        : { changes: [], kpiChanges: [{ weekStart, commitment: minimal }] };
    expect(
      trainerToolContracts[toolName].inputSchema.safeParse(input).success,
    ).toBe(true);
    const { result } = await run([
      [{ toolName: "getWeeklyPlan", input: { weekStart } }],
      [{ toolName, input }],
    ]);
    expect(
      result.toolSteps.map((step) => [step.tool, step.status, step.reason]),
    ).toEqual([
      ["getWeeklyPlan", "succeeded", undefined],
      [toolName, "succeeded", undefined],
    ]);
    expect(app.readKpis(weekStart).sets[0].items[0].scoring).toBe(scoring);
    expect(app.readKpis(weekStart).assessments).toEqual([]);
  },
);

it.each(["saveWeeklyKpis", "saveWeeklyDocuments"] as const)(
  "refreshes only a committed current-week set after %s, preserving success on refresh failure",
  async (toolName) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const rules = structuredClone(commitment);
    rules.items[0].tracks.forEach((track) => {
      track.pointsRule = { kind: "proportional" };
    });
    const store = createWeeklyStore(() => db);
    const refresh = vi.fn(async () => {
      store.saveMeasurements({
        weekStart,
        timeZone: "UTC",
        revision: "measured",
        concepts: Object.fromEntries(
          rules.items.map((item) => [
            item.conceptId,
            {
              success: {
                recipeVersion: 1,
                status: "measured",
                values: Object.fromEntries(
                  item.tracks.map((track) => [track.key, 1]),
                ),
                signatures: Object.fromEntries(
                  item.tracks.map((track) => [
                    track.key,
                    JSON.stringify([track.kind, track.unit, track.meaning]),
                  ]),
                ),
                measuredAt: now.toISOString(),
                asOf: now.toISOString(),
                basis: "authored",
              },
            },
          ]),
        ),
      });
      return { status: "refreshed" };
    });
    const ports = {
      weekly: app,
      measurements: { refresh },
    } as unknown as TrainerToolPorts;
    const execute = (commit: typeof rules | undefined, target = weekStart) =>
      executeTrainerTool(
        {
          toolName,
          input:
            toolName === "saveWeeklyKpis"
              ? {
                  weekStart: target,
                  ...(commit
                    ? { commitment: commit }
                    : {
                        assessments: [
                          {
                            ...assessment,
                            setId: app.readKpis(target).latestId!,
                          },
                        ],
                      }),
                }
              : {
                  changes: [],
                  kpiChanges: [
                    {
                      weekStart: target,
                      ...(commit
                        ? { commitment: commit }
                        : {
                            assessments: [
                              {
                                ...assessment,
                                setId: app.readKpis(target).latestId!,
                              },
                            ],
                          }),
                    },
                  ],
                },
          index: 0,
          context: new TrainerToolExecutionContext(),
          weeklyTurn: turn,
          kpiSnapshots: [app.readKpis(target)],
        } as Parameters<typeof executeTrainerTool>[0],
        ports,
      );
    expect((await execute(rules)).status).toBe("succeeded");
    expect(refresh).toHaveBeenCalledExactlyOnceWith("UTC", weekStart);
    expect(app.readKpis(weekStart).points?.automatic).toBe(true);
    expect(app.readKpis(weekStart).points?.total).not.toBeNull();
    expect((await execute(undefined)).status).toBe("succeeded");
    expect((await execute(rules, "2026-11-16")).status).toBe("succeeded");
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRejectedValueOnce(new Error("busy"));
    expect((await execute({ ...rules, origin: "adaptation" })).status).toBe(
      "succeeded",
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(app.readKpis(weekStart).sets).toHaveLength(2);
  },
);

async function run(passes: TrainerToolCall[][], answers: string[] = []) {
  let pass = 0;
  const systems: string[] = [];
  const result = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Authored structured weekly request",
      weeklyTurn: turn,
    },
    {
      generate: async ({ system }) => {
        systems.push(
          typeof system === "string"
            ? system
            : `${system.policy}\n${system.context}`,
        );
        const calls = passes[pass++];
        return calls
          ? { toolCalls: calls }
          : { text: answers[0] ?? "Saved structured weekly KPIs." };
      },
      executeTool: async (input) => executeWeeklyTool(input, app),
    },
  );
  return { result, systems };
}
it.each([false, true])(
  "recovers one unavailable exact-set read with fresh discovery, without replaying a stale save tail (existing=%s)",
  async (existing) => {
    if (existing)
      createWeeklyStore(() => db).saveKpis(weekStart, structuredClone(fixture));
    const before = db.prepare("select * from weekly_kpi").all();
    const { result, systems } = await run(
      [
        [
          { toolName: "getWeeklyKpis", input: { weekStart, setId: "latest" } },
          { toolName: "saveWeeklyKpis", input: change },
        ],
        [{ toolName: "getWeeklyKpis", input: { weekStart } }],
      ],
      ["Read the canonical KPI state; nothing saved."],
    );
    expect(
      result.toolSteps.map((step) => [step.tool, step.status, step.reason]),
    ).toEqual([
      ["getWeeklyKpis", "rejected", "kpi_set_unavailable"],
      ["getWeeklyKpis", "succeeded", undefined],
    ]);
    expect(result.toolSteps[0].summary).toContain("Omit setId");
    expect(result.toolSteps[0].summary).not.toContain(
      "no repeated weekly save",
    );
    expect(systems[1]).toContain("Omit setId");
    expect(result.text).toBe("Read the canonical KPI state; nothing saved.");
    expect(db.prepare("select * from weekly_kpi").all()).toEqual(before);
    expect(app.read(weekStart).record).toBeNull();
  },
);

it("stops a second unavailable-set read instead of looping or resolving arbitrary IDs", async () => {
  createWeeklyStore(() => db).saveKpis(weekStart, structuredClone(fixture));
  const before = db.prepare("select * from weekly_kpi").all();
  const { result } = await run([
    [{ toolName: "getWeeklyKpis", input: { weekStart, setId: "latest" } }],
    [{ toolName: "getWeeklyKpis", input: { weekStart, setId: "unknown-set" } }],
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
  ]);
  expect(result.providerCalls).toBe(2);
  expect(result.toolSteps.map((step) => step.reason)).toEqual([
    "kpi_set_unavailable",
    "kpi_set_unavailable",
  ]);
  expect(db.prepare("select * from weekly_kpi").all()).toEqual(before);
  expect(() => app.readKpis(weekStart, "latest")).toThrow(
    "kpi_set_unavailable",
  );
});

it("does not correct uncertain reads or retry a save after read recovery", async () => {
  const generate = vi.fn(async () => ({
    toolCalls: [{ toolName: "getWeeklyKpis", input: { weekStart } }],
  }));
  const uncertain = await orchestrateTrainerChat(
    {
      system: TRAINER_SYSTEM_PROMPT,
      userRequest: "Read saved KPIs",
      weeklyTurn: turn,
    },
    {
      generate,
      executeTool: async () => ({
        index: 1,
        tool: "getWeeklyKpis",
        status: "failed",
        reason: "weekly_persistence_uncertain",
        summary: "Unavailable",
        privacy: "No content",
      }),
    },
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(uncertain.toolSteps).toHaveLength(1);
  const { result } = await run([
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
    [{ toolName: "getWeeklyKpis", input: { weekStart, setId: "latest" } }],
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
  ]);
  expect(result.toolSteps.at(-1)?.reason).toBe("duplicate_side_effect");
  expect(
    result.toolSteps.filter(
      (step) => step.tool === "saveWeeklyKpis" && step.status === "succeeded",
    ),
  ).toHaveLength(1);
  expect(app.readKpis(weekStart).sets).toHaveLength(1);
});

it("does not turn a rejected read into write authority", async () => {
  const { result } = await run([
    [{ toolName: "getWeeklyKpis", input: { weekStart, setId: "latest" } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
  ]);
  expect(result.toolSteps).toHaveLength(2);
  expect(result.toolSteps[1]).toMatchObject({
    tool: "saveWeeklyKpis",
    status: "rejected",
  });
  expect(app.readKpis(weekStart).revision).toBeNull();
});

it("allows a normal single save only after a fresh complete prior-pass read recovers the lookup", async () => {
  const { result } = await run([
    [{ toolName: "getWeeklyKpis", input: { weekStart, setId: "latest" } }],
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
  ]);
  expect(result.toolSteps.map((step) => [step.tool, step.status])).toEqual([
    ["getWeeklyKpis", "rejected"],
    ["getWeeklyKpis", "succeeded"],
    ["saveWeeklyKpis", "succeeded"],
    ["getWeeklyKpis", "succeeded"],
  ]);
  expect(app.readKpis(weekStart).sets).toHaveLength(1);
  expect(app.readKpis(weekStart).assessments).toHaveLength(1);
});

it.each(["saveWeeklyKpis", "saveWeeklyDocuments"] as const)(
  "parses strict rule metadata through %s and preserves it in an adaptation",
  (toolName) => {
    const rules = {
      origin: commitment.origin,
      items: commitment.items.map(({ id, conceptId, label, tracks }) => ({
        id,
        conceptId,
        label,
        tracks: structuredClone(tracks),
      })),
    };
    rules.items[0].tracks[0].pointsRule = {
      kind: "perUnit",
      points: 1,
      cap: 2,
    };
    rules.items[0].tracks[1].pointsRule = { kind: "proportional" };
    const schema = trainerToolContracts[toolName].inputSchema;
    const input =
      toolName === "saveWeeklyKpis"
        ? { weekStart, commitment: rules }
        : { changes: [], kpiChanges: [{ weekStart, commitment: rules }] };
    expect(schema.safeParse(input).success).toBe(true);
    const parsed = schema.parse(input);
    const changes: KpiChange[] =
      "weekStart" in parsed ? [parsed] : parsed.kpiChanges!;
    app.save([], turn, [], changes, [app.readKpis(weekStart)]);
    const before = app.readKpis(weekStart);
    const adaptation = { ...rules, origin: "adaptation" as const };
    app.save([], turn, [], [{ weekStart, commitment: adaptation }], [before]);
    expect(app.readKpis(weekStart).sets.at(-1)!.items).toEqual(rules.items);
    const omitted = structuredClone(adaptation);
    delete omitted.items[0].tracks[0].pointsRule;
    app.save(
      [],
      turn,
      [],
      [{ weekStart, commitment: omitted }],
      [app.readKpis(weekStart)],
    );
    // Omission remains visible: never silently copy server-side agreement.
    expect(
      app.readKpis(weekStart).sets.at(-1)!.items[0].tracks[0].pointsRule,
    ).toBeUndefined();
    rules.items[0].tracks[0].pointsRule = {
      kind: "threshold",
      extra: true,
    } as never;
    expect(schema.safeParse(input).success).toBe(false);
  },
);

it("discovers latest canonical identities outside the chart range and reuses them in a future real tool write", async () => {
  const store = createWeeklyStore(() => db);
  store.saveKpis(weekStart, structuredClone(fixture));
  const read = executeWeeklyTool(
    {
      toolName: "getKpiProgress",
      input: { from: "2026-08-03", through: "2026-08-10" },
      index: 0,
      context: new TrainerToolExecutionContext(),
      weeklyTurn: turn,
    },
    app,
  );
  expect(read.status).toBe("succeeded");
  const latest = (read.result as ReturnType<typeof app.progress>).latestPlan!;
  expect(latest.weekStart).toBe(weekStart);
  const canonical = latest.sets[0];
  expect(canonical.id).toBe(fixture.latestId);
  const future = "2026-11-16";
  const { result } = await run([
    [
      {
        toolName: "getKpiProgress",
        input: { from: "2026-08-03", through: "2026-08-10" },
      },
      { toolName: "getWeeklyPlan", input: { weekStart: future } },
    ],
    [
      {
        toolName: "saveWeeklyKpis",
        input: {
          weekStart: future,
          commitment: {
            origin: "planned",
            provenance:
              "Authored future reuse of discovered canonical identity",
            items: structuredClone(canonical.items),
          },
        },
      },
    ],
  ]);
  expect(result.toolSteps.every((step) => step.status === "succeeded")).toBe(
    true,
  );
  expect(app.readKpis(future).sets[0].items).toEqual(canonical.items);
  expect(
    db.prepare("select count(*) as n from weekly_kpi_track").get(),
  ).toEqual({ n: 2 });
  expect(app.context(turn).latestPlanWeek).toBe(future);
  const incompatible = structuredClone(canonical.items);
  incompatible[0].tracks[0].meaning =
    "Genuinely different qualifying selection";
  expect(() =>
    app.saveKpis(
      {
        weekStart: future,
        commitment: {
          origin: "adaptation",
          provenance: "Authored incompatible reuse refusal",
          items: incompatible,
        },
      },
      turn,
      [app.readKpis(future)],
    ),
  ).toThrow("incompatible_kpi_track_identity");
  expect(app.readKpis(future).sets).toHaveLength(1);
});

it("carries complete canonical prior-pass data through real dispatch and stores explained above100 compound results", async () => {
  const { result, systems } = await run([
    [{ toolName: "getWeeklyPlan", input: { weekStart } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
  ]);
  expect(result.toolSteps.map((s) => [s.tool, s.status])).toEqual([
    ["getWeeklyPlan", "succeeded"],
    ["saveWeeklyKpis", "succeeded"],
    ["getWeeklyKpis", "succeeded"],
  ]);
  expect(app.readKpis(weekStart).assessments[0]).toMatchObject({
    totalPoints: 112.5,
    status: "provisional",
    setId: app.readKpis(weekStart).originalId,
  });
  expect(systems.at(-1)).toContain("T0319 authored sessions");
  expect(systems.at(-1)).toContain('"value":null');
  expect(
    result.grounding?.toolSteps?.find((s) => s.tool === "saveWeeklyKpis")
      ?.status,
  ).toBe("succeeded");
  expect(JSON.stringify(result.grounding)).not.toContain(
    "T0319 synthetic report",
  );
});
it("rejects same-pass read authority and shares duplicate admission across focused/combined writes", async () => {
  const samePass = await run([
    [
      { toolName: "getWeeklyKpis", input: { weekStart } },
      { toolName: "saveWeeklyKpis", input: change },
    ],
  ]);
  expect(
    samePass.result.toolSteps.some(
      (s) => s.tool === "saveWeeklyKpis" && s.status === "rejected",
    ),
  ).toBe(true);
  expect(app.readKpis(weekStart).revision).toBeNull();
  const duplicate = await run([
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
    [
      {
        toolName: "saveWeeklyDocuments",
        input: {
          changes: [
            {
              weekStart,
              kind: "plan",
              title: "Not repeated",
              contentMarkdown: "Must not save after shared attempt",
            },
          ],
        },
      },
    ],
  ]);
  expect(duplicate.result.toolSteps.at(-1)?.reason).toBe(
    "duplicate_side_effect",
  );
  expect(app.read(weekStart).record).toBeNull();
  expect(app.readKpis(weekStart).revision).not.toBeNull();
  expect(duplicate.result.text).toContain("saveWeeklyKpis");
});
it("saves current assessment and upcoming commitments atomically without rewriting narrative", async () => {
  app.saveKpis({ weekStart, commitment }, turn, [app.readKpis(weekStart)]);
  const originalId = app.readKpis(weekStart).originalId!;
  const upcoming = "2026-11-16";
  const { result } = await run([
    [
      { toolName: "getWeeklyKpis", input: { weekStart } },
      { toolName: "getWeeklyKpis", input: { weekStart: upcoming } },
    ],
    [
      {
        toolName: "saveWeeklyDocuments",
        input: {
          changes: [],
          kpiChanges: [
            { weekStart, assessments: [{ ...assessment, setId: originalId }] },
            { weekStart: upcoming, commitment },
          ],
        },
      },
    ],
  ]);
  expect(result.toolSteps.at(-1)?.status).toBe("succeeded");
  expect(app.readKpis(weekStart).assessments[0].setId).toBe(originalId);
  expect(app.readKpis(upcoming).originalId).not.toBeNull();
  expect(app.read(weekStart).record).toBeNull();
  expect(app.read(upcoming).record).toBeNull();
});

it("honors controlled no-save behavior and rejects superseded turns through actual repository current-turn checks", async () => {
  await run([], ["Draft only; nothing saved."]);
  expect(app.readKpis(weekStart).revision).toBeNull();
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values ('newer','authored','user','No save',2)",
  ).run();
  const stale = await run([
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [{ toolName: "saveWeeklyKpis", input: change }],
  ]);
  expect(stale.result.toolSteps.at(-1)?.reason).toBe("weekly_turn_superseded");
  expect(app.readKpis(weekStart).revision).toBeNull();
});

it.each(["saveWeeklyKpis", "saveWeeklyDocuments"] as const)(
  "parses minimal %s commitments/assessments/corrections, reconstructs SQLite and preserves carried rich legacy bytes",
  async (toolName) => {
    const minimalCommitment = {
      origin: "planned" as const,
      items: commitment.items.map(({ id, conceptId, label, tracks }) => ({
        id,
        conceptId,
        label,
        tracks,
      })),
    };
    const minimalAssessment = {
      setId: "new",
      asOf: assessment.asOf,
      status: assessment.status,
      items: assessment.items.map(({ itemId, actuals, status, evidence }) => ({
        itemId,
        actuals,
        status,
        evidence: {
          origin: evidence.origin,
          references: evidence.references,
        },
      })),
      extras: [],
      totalPoints: 100,
    };
    const save = async (value: KpiChange) =>
      run([
        [{ toolName: "getWeeklyKpis", input: { weekStart } }],
        [
          {
            toolName,
            input:
              toolName === "saveWeeklyKpis"
                ? value
                : { changes: [], kpiChanges: [value] },
          },
        ],
      ]);
    // Legacy rich parsed input remains supported and is not normalized away.
    expect((await save(change)).result.toolSteps.at(-1)?.status).toBe(
      "succeeded",
    );
    const rich = structuredClone(app.readKpis(weekStart).sets[0]);
    expect(
      (
        await save({
          weekStart,
          commitment: { ...minimalCommitment, origin: "adaptation" },
          assessments: [minimalAssessment],
        })
      ).result.toolSteps.at(-1)?.status,
    ).toBe("succeeded");
    const read = app.readKpis(weekStart);
    expect(read.sets[0]).toEqual(rich);
    expect(read.sets[1]).not.toHaveProperty("definition");
    expect(read.sets[1].items[0]).not.toHaveProperty("scoring");
    expect(
      read.assessments.find((value) => value.setId === read.latestId),
    ).not.toHaveProperty("explanation");
    expect(
      (
        await save({
          weekStart,
          assessments: [
            {
              ...minimalAssessment,
              setId: read.latestId!,
              totalPoints: 0,
              items: minimalAssessment.items.map((item) => ({
                ...item,
                actuals: item.actuals.map((actual) => ({
                  ...actual,
                  awardedPoints: 0,
                })),
              })),
            },
          ],
        })
      ).result.toolSteps.at(-1)?.status,
    ).toBe("succeeded");
    const stored = db
      .prepare("select state_json from weekly_kpi where week_start=?")
      .get(weekStart);
    const restarted = new Database(db.serialize());
    try {
      const reopened = createWeekly(
        createWeeklyStore(() => restarted),
        () => now,
        () => `restarted-${++id}`,
      );
      expect(reopened.readKpis(weekStart)).toEqual(app.readKpis(weekStart));
      expect(reopened.readKpis(weekStart).sets[0]).toEqual(rich);
      expect(
        reopened
          .readKpis(weekStart)
          .assessments.find((value) => value.setId === read.latestId)
          ?.totalPoints,
      ).toBe(0);
      expect(
        restarted
          .prepare("select state_json from weekly_kpi where week_start=?")
          .get(weekStart),
      ).toEqual(stored);
      expect(
        db.prepare("select count(*) as n from weekly_kpi_track").get(),
      ).toEqual({ n: 2 });
    } finally {
      restarted.close();
    }
  },
);

it("does not advertise obsolete prose in either model schema and explicitly instructs minimal generation", () => {
  for (const toolName of ["saveWeeklyKpis", "saveWeeklyDocuments"] as const) {
    const schema = JSON.stringify(
      z.toJSONSchema(trainerToolContracts[toolName].inputSchema),
    );
    for (const field of [
      "definition",
      "selection",
      "evidenceRequired",
      "provenance",
    ])
      expect(schema).not.toContain(`"${field}":`);
    expect(schema).toContain("additionalProperties");
  }
  expect(TRAINER_SYSTEM_PROMPT).toContain(
    "Do not generate duplicate definition",
  );
  expect(trainerToolContracts.saveWeeklyKpis.description).toContain(
    "Use minimal structured inputs",
  );
});

it.each(["saveWeeklyKpis", "saveWeeklyDocuments"] as const)(
  "refuses a shared item-level point pool through parsed %s and saves nothing",
  async (toolName) => {
    const pooled = structuredClone(change);
    const item = pooled.commitment.items[0];
    for (const track of item.tracks) delete track.availablePoints;
    Object.assign(item, { availablePoints: 100 });
    const result = await run([
      [{ toolName: "getWeeklyKpis", input: { weekStart } }],
      [
        {
          toolName,
          input:
            toolName === "saveWeeklyKpis"
              ? pooled
              : { changes: [], kpiChanges: [pooled] },
        },
      ],
    ]);
    expect(result.result.toolSteps.at(-1)?.status).toBe("rejected");
    expect(app.readKpis(weekStart).revision).toBeNull();
    // Item-level awarded points are likewise refused on a per-track set.
    const awarded = structuredClone(change);
    Object.assign(awarded.assessments[0].items[0], { awardedPoints: 100 });
    const second = await run([
      [{ toolName: "getWeeklyKpis", input: { weekStart } }],
      [{ toolName: "saveWeeklyKpis", input: awarded }],
    ]);
    expect(second.result.toolSteps.at(-1)?.status).toBe("rejected");
    expect(app.readKpis(weekStart).revision).toBeNull();
  },
);

it("advertises per-measurement points only and no shared allocation", () => {
  for (const toolName of ["saveWeeklyKpis", "saveWeeklyDocuments"] as const) {
    const schema = z.toJSONSchema(
      trainerToolContracts[toolName].inputSchema,
    ) as Record<string, unknown>;
    const text = JSON.stringify(schema);
    // Exactly the track allocation and the actual award carry points.
    expect(text.match(/"availablePoints":/g)).toHaveLength(1);
    expect(text.match(/"awardedPoints":/g)).toHaveLength(1);
    expect(text).toContain("This numeric measurement's own agreed points");
  }
  const description = trainerToolContracts.saveWeeklyKpis.description;
  expect(description).not.toMatch(/share one item allocation/i);
  expect(description).toContain("Points are per measurement");
  expect(TRAINER_SYSTEM_PROMPT).toContain("Points per measurement");
  expect(TRAINER_SYSTEM_PROMPT).toContain("no shared pool");
});

it("keeps the trainer getKpiProgress tool at 12 weeks while the app Progress bound is wider", async () => {
  const thirteen = await run([
    [
      {
        toolName: "getKpiProgress",
        input: { from: "2026-08-17", through: weekStart },
      },
    ],
  ]);
  expect(thirteen.result.toolSteps.at(-1)?.status).toBe("rejected");
  const twelve = await run([
    [
      {
        toolName: "getKpiProgress",
        input: { from: "2026-08-24", through: weekStart },
      },
    ],
  ]);
  expect(twelve.result.toolSteps.at(-1)?.status).toBe("succeeded");
  expect(app.progress("2026-08-17", weekStart, 54).weeks).toHaveLength(13);
  expect(trainerToolContracts.getKpiProgress.description).toContain(
    "at most12 weeks",
  );
});
it("saves verified recipes through real orchestration with prior-pass reads, shares the weekly attempt and never changes points", async () => {
  const { createKpiMeasurements } =
    await import("../src/lib/weekly/measurements");
  const { executeMeasurementTool } = await import("../src/lib/ai/tool-weekly");
  const store = createWeeklyStore(() => db);
  store.saveKpis(weekStart, structuredClone(fixture));
  const before = JSON.stringify(store.readKpis(weekStart));
  let fail = false;
  const measurements = createKpiMeasurements(
    store,
    {
      run: async (recipes) => ({
        basis: "b",
        outcomes: recipes.map((r) =>
          fail
            ? {
                conceptId: r.conceptId,
                status: "failed" as const,
                reason: "unknown_column",
              }
            : {
                conceptId: r.conceptId,
                status: "measured" as const,
                values: { count: 2 },
              },
        ),
      }),
      basis: () => "b",
    },
    () => now,
    () => `m-${++id}`,
  );
  const save = {
    toolName: "saveKpiRecipes",
    input: {
      weekStart,
      recipes: [
        {
          conceptId: "authored-sessions",
          sql: "select count(*) as count from activity where started_at >= :week_start_ms and started_at < :week_end_ms",
          tracks: ["count"],
        },
      ],
    },
  };
  const go = (passes: TrainerToolCall[][]) =>
    orchestrateTrainerChat(
      {
        system: TRAINER_SYSTEM_PROMPT,
        userRequest: "Authored",
        weeklyTurn: turn,
      },
      {
        generate: (() => {
          let pass = 0;
          return async () => {
            const calls = passes[pass++];
            return calls ? { toolCalls: calls } : { text: "Done." };
          };
        })(),
        executeTool: async (input) =>
          ["saveKpiRecipes", "refreshKpiMeasurements"].includes(input.toolName)
            ? executeMeasurementTool(input, measurements)
            : executeWeeklyTool(input, app),
      },
    );
  // Same-pass read is not prior-pass authority.
  const samePass = await go([
    [{ toolName: "getWeeklyKpis", input: { weekStart } }, save],
  ]);
  expect(
    samePass.toolSteps.find((s) => s.tool === "saveKpiRecipes"),
  ).toMatchObject({
    status: "rejected",
    reason: "prior_complete_kpi_read_required",
  });
  // Failed verification is refused and saves nothing.
  fail = true;
  const refused = await go([
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [save],
  ]);
  expect(refused.toolSteps.at(-1)).toMatchObject({
    status: "rejected",
    reason: "recipe_verification_failed",
  });
  expect(measurements.recipes()).toEqual([]);
  fail = false;
  const saved = await go([
    [{ toolName: "getWeeklyKpis", input: { weekStart } }],
    [save],
    [{ toolName: "saveWeeklyKpis", input: change }],
    [{ toolName: "refreshKpiMeasurements", input: {} }],
  ]);
  expect(
    saved.toolSteps.map((s) => [s.tool, s.status, s.reason ?? null]),
  ).toEqual([
    ["getWeeklyKpis", "succeeded", null],
    ["saveKpiRecipes", "succeeded", null],
    ["saveWeeklyKpis", "rejected", "duplicate_side_effect"],
  ]);
  expect(measurements.recipes()).toMatchObject([
    { conceptId: "authored-sessions", version: 1 },
  ]);
  expect(
    store.readMeasurements(weekStart)?.concepts["authored-sessions"].success
      ?.values,
  ).toEqual({ count: 2 });
  expect(JSON.stringify(store.readKpis(weekStart))).toBe(before);
  // Refresh is a measurement-only read/write, not a save attempt.
  store.saveKpis("2026-11-02", structuredClone(fixture));
  const refreshed = await go([
    [{ toolName: "refreshKpiMeasurements", input: {} }],
  ]);
  expect(refreshed.toolSteps[0]).toMatchObject({ status: "succeeded" });
  expect(refreshed.toolSteps[0].summary).toContain(`${weekStart}: refreshed`);
  expect(refreshed.toolSteps[0].summary).toContain("2026-11-02: refreshed");
  expect(refreshed.toolSteps[0].summary).toContain(
    "Reviewed points are unchanged; declared rules may advance provisional points.",
  );
  expect(
    store.readMeasurements("2026-11-02")?.concepts["authored-sessions"].success
      ?.values,
  ).toEqual({ count: 2 });
  const previousRevision = store.readMeasurements("2026-11-02")?.revision;
  const explicit = await go([
    [{ toolName: "refreshKpiMeasurements", input: { weekStart } }],
  ]);
  expect(explicit.toolSteps[0].summary).toContain(`${weekStart}: refreshed`);
  expect(explicit.toolSteps[0].summary).not.toContain("2026-11-02");
  expect(store.readMeasurements("2026-11-02")?.revision).toBe(previousRevision);
  fail = true;
  const failed = await go([
    [{ toolName: "refreshKpiMeasurements", input: {} }],
  ]);
  expect(failed.toolSteps[0].summary).toContain(
    "failed: authored-sessions (prior values kept)",
  );
  expect(failed.toolSteps[0].summary).toContain("2026-11-02: refreshed");
  const history = await go([
    [
      {
        toolName: "refreshKpiMeasurements",
        input: { weekStart: "2026-01-05" },
      },
    ],
  ]);
  expect(history.toolSteps[0]).toMatchObject({
    status: "rejected",
    reason: "invalid_measurement_week",
  });
  expect(JSON.stringify(store.readKpis(weekStart))).toBe(before);
});
