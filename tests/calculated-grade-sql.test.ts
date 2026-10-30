import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let db: Database.Database;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "grade-sql-")), "test.sqlite"),
  );
  db = (await import("../src/lib/db/connection")).getDatabase();
  const activity = db.prepare(
    "insert into activity (id, garmin_id, sport, started_at) values (?, ?, 'hiking', ?)",
  );
  const point = db.prepare(
    "insert into activity_stream_point (garmin_id, elapsed_sec, timestamp, altitude_meters, distance_meters, grade_pct) values (?, ?, ?, ?, ?, ?)",
  );
  for (const [id, slope] of [
    ["rich", 0.1],
    ["partial", -0.1],
    ["index-only", 0.1],
    ["empty", 0],
  ] as const) {
    activity.run(id, id, 1);
    if (id === "empty") continue;
    for (let i = 0; i <= 24; i += 1) {
      // Stored elapsed is deliberately an index; actual timestamps establish seconds.
      point.run(
        id,
        i,
        id === "index-only"
          ? null
          : new Date(Date.UTC(2026, 0, 1) + i * 15_000).toISOString(),
        id === "partial" && i === 2 ? null : 100 + i * 30 * slope,
        i * 30,
        null,
      );
    }
  }
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
});

it("discovers a parameterized relation without deriving/counting streams; guarded examples execute", async () => {
  const ports = await import("../src/lib/ai/sql-analysis");
  const before = db.prepare("select * from activity_stream_point").all();
  const description = ports.describeGarminDatabase();
  const { renderToolSteps } = await import("../src/lib/ai/tool-evidence");
  const rendered = renderToolSteps([
    {
      index: 1,
      tool: "describeGarminDatabase",
      status: "succeeded",
      summary: "Schema",
      privacy: description.privacy,
      result: description,
    },
  ]);
  expect(rendered).toContain(
    "Discovery rowCount=0 is registration metadata only",
  );
  expect(rendered).toContain("adjacent gaps <=30s");
  expect(rendered).toContain("count(calculated_grade_pct)/count(*)");
  expect(rendered).toContain("WHERE garmin_id = 'verified-id'");
  const relation = description.tables.find(
    (table) => table.name === "activity_calculated_grade",
  );
  expect(relation).toMatchObject({
    rowCount: 0,
    description: expect.stringContaining("Timestamp-only timing"),
  });
  expect(relation?.columns.map((column) => column.name)).toContain(
    "quality_status",
  );
  const single = ports.runReadOnlySql({
    sql: description.examples[0].replace("verified-id", "rich"),
  });
  expect(single.status).toBe("succeeded");
  expect(single.rows).toMatchObject([
    {
      grade_method: "altitude_distance_sections_v1",
      target_window_sec: 180,
      total_sections: 2,
      valid_sections: 2,
      min_section_grade_pct: 10,
      max_section_grade_pct: 10,
      source_grade_samples: 0,
    },
  ]);
  const multiple = ports.runReadOnlySql({ sql: description.examples[1] });
  expect(multiple.status).toBe("succeeded");
  expect(multiple.rows).toHaveLength(4);
  expect(
    multiple.rows.find((row) => row.garmin_id === "partial"),
  ).toMatchObject({
    total_sections: 2,
    valid_sections: 1,
    min_section_grade_pct: -10,
  });
  expect(multiple.rows.find((row) => row.garmin_id === "empty")).toMatchObject({
    total_sections: 1,
    valid_sections: 0,
    min_section_grade_pct: null,
  });
  expect(
    multiple.rows.find((row) => row.garmin_id === "index-only"),
  ).toMatchObject({ valid_sections: 0 });
  expect(db.prepare("select * from activity_stream_point").all()).toEqual(
    before,
  );
  expect(
    db
      .prepare(
        "select count(*) n from sqlite_master where name='activity_calculated_grade'",
      )
      .get(),
  ).toEqual({ n: 0 });
});

it("accepts natural hidden-id WHERE/join constraints and safe numeric function literals", async () => {
  const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");
  const constrained = runReadOnlySql({
    sql: "select garmin_id, count(*) total_sections, count(calculated_grade_pct) valid_sections from activity_calculated_grade where garmin_id = 'rich'",
  });
  expect(constrained).toMatchObject({
    status: "succeeded",
    rows: [{ garmin_id: "rich", total_sections: 2, valid_sections: 2 }],
  });
  expect(
    runReadOnlySql({
      sql: "select a.garmin_id, count(g.calculated_grade_pct) valid_sections from activity a join activity_calculated_grade g on g.garmin_id = a.garmin_id group by a.garmin_id",
    }),
  ).toMatchObject({ status: "succeeded", returnedRows: 4 });
  db.prepare(
    "update activity_stream_point set garmin_id = '12345' where garmin_id = 'rich'",
  ).run();
  for (const sql of [
    "select count(calculated_grade_pct) valid_sections from activity_calculated_grade(12345)",
    "select count(calculated_grade_pct) valid_sections from activity_calculated_grade where garmin_id = 12345",
  ]) {
    expect(runReadOnlySql({ sql })).toMatchObject({
      status: "succeeded",
      rows: [{ valid_sections: 2 }],
    });
  }
});

it("registers successful grade cells as same-turn evidence and validates exact claims", async () => {
  const ports = await import("../src/lib/ai/sql-analysis");
  const { executeAnalyticsTool } = await import("../src/lib/ai/tool-analytics");
  const { TrainerToolExecutionContext } =
    await import("../src/lib/ai/tool-execution-context");
  const { validatedCompletion } = await import("../src/lib/ai/turn-completion");
  const context = new TrainerToolExecutionContext();
  const step = executeAnalyticsTool(
    {
      toolName: "runReadOnlySql",
      input: {
        sql: "select calculated_grade_pct, grade_method, quality_status from activity_calculated_grade('rich') limit 1",
        resultName: "grade",
        maxRows: 10,
      },
      index: 1,
      context,
    },
    {
      ...ports,
      analyzeActivityTerrain: () => {
        throw new Error("unexpected terrain call");
      },
    },
  );
  expect(step.status).toBe("succeeded");
  expect(context.analysisResults.get("grade")?.[0]).toMatchObject({
    calculated_grade_pct: 10,
    grade_method: "altitude_distance_sections_v1",
    quality_status: "available",
  });
  const claim = {
    kind: "metric",
    stepIndex: 1,
    resultName: "grade",
    rowIndex: 0,
    column: "calculated_grade_pct",
    value: 10,
  };
  const completion = {
    completion: {
      kind: "grounded",
      answer:
        "Estimated signed section grade is 10%; terrain/technicality unknown.",
      claims: [claim],
      missingEvidence: [],
    },
  };
  expect(validatedCompletion(completion, [step])).toBe(
    completion.completion.answer,
  );
  expect(
    validatedCompletion(
      {
        ...completion,
        completion: {
          ...completion.completion,
          claims: [{ ...claim, value: 11 }],
        },
      },
      [step],
    ),
  ).toBeNull();
  expect(
    validatedCompletion(completion, [{ ...step, status: "failed" }]),
  ).toBeNull();
  context.dispose();
});

it("preserves caps, unsafe/private SQL rejection and null quality evidence", async () => {
  const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");
  expect(
    runReadOnlySql({
      sql: "select * from activity_calculated_grade('partial')",
      maxRows: 1,
    }),
  ).toMatchObject({
    status: "succeeded",
    returnedRows: 1,
    truncated: true,
    rows: [{ calculated_grade_pct: null, quality_status: "missing_values" }],
  });
  for (const sql of [
    "delete from activity_calculated_grade('rich')",
    "select * from activity_calculated_grade('rich') join message",
    "select * from activity_calculated_grade('rich'); select 1",
    "select * from activity_calculated_grade('rich') -- comment",
  ]) {
    expect(runReadOnlySql({ sql }).status).toBe("rejected");
  }
  expect(
    runReadOnlySql({ sql: "select * from activity_calculated_grade" }),
  ).toMatchObject({
    status: "failed",
    rows: [],
    sqliteMessage: expect.stringContaining("requires an activity id"),
  });
  const insert = db.prepare(
    "insert into activity (id, garmin_id, sport, started_at) values (?, ?, 'hiking', 1)",
  );
  for (let i = 0; i < 33; i += 1) insert.run(`limit-${i}`, `limit-${i}`);
  expect(
    runReadOnlySql({
      sql: "select count(*) as sections from activity a join activity_calculated_grade(a.garmin_id) g",
    }).status,
  ).toBe("failed");
});
