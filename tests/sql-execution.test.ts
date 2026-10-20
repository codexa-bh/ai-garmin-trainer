import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let primary: Database.Database;
const opened: Database.Database[] = [];
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "sql-adapter-")), "test.sqlite"),
  );
  const { getDatabase } = await import("../src/lib/db/connection");
  primary = getDatabase();
  const original = Database.prototype.pragma;
  vi.spyOn(Database.prototype, "pragma").mockImplementation(function (
    this: Database.Database,
    ...args: Parameters<Database.Database["pragma"]>
  ) {
    if (args[0] === "query_only = ON") opened.push(this);
    return original.apply(this, args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of opened.splice(0)) if (db.open) db.close();
  primary.close();
  vi.unstubAllEnvs();
});

it("uses real readonly/fileMustExist handles, query_only and the 750ms busy timeout", async () => {
  const { createSqliteAnalyticalExecution } =
    await import("../src/lib/ai/analytics/sqlite-execution");
  const port = createSqliteAnalyticalExecution();
  expect(opened).toHaveLength(0);
  const session = port.openQuery();
  const db = opened[0];
  expect(db.readonly).toBe(true);
  expect(db.pragma("query_only", { simple: true })).toBe(1);
  expect(db.pragma("busy_timeout", { simple: true })).toBe(750);
  expect(() =>
    session.readRows("delete from activity returning garmin_id"),
  ).toThrow(/readonly/);
  // Defense in depth: disabling query_only cannot turn the readonly file writable.
  db.pragma("query_only = OFF");
  expect(() =>
    session.readRows("delete from activity returning garmin_id"),
  ).toThrow(/readonly/);
  session.close();
  expect(db.open).toBe(false);
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "sql-missing-")), "absent.sqlite"),
  );
  expect(() => port.openQuery()).toThrow();
  expect(opened).toHaveLength(1);
});

it("keeps safe integer conversion, empty columns and opaque session shape", async () => {
  const { createSqliteAnalyticalExecution } =
    await import("../src/lib/ai/analytics/sqlite-execution");
  const session = createSqliteAnalyticalExecution().openQuery();
  expect(Object.keys(session).sort()).toEqual([
    "close",
    "readColumnNames",
    "readRows",
  ]);
  expect(session.readRows("select 9007199254740991 as value")).toEqual([
    { value: 9007199254740991 },
  ]);
  expect(
    session.readRows("select garmin_id as id from activity where 0"),
  ).toEqual([]);
  expect(session.readColumnNames()).toEqual(["id"]);
  session.close();
});

it("production facade closes query handles on success, rejection and execution failure without closing primary", async () => {
  const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");
  const close = vi.spyOn(Database.prototype, "close");
  expect(runReadOnlySql({ sql: "select * from message" }).status).toBe(
    "rejected",
  );
  expect(opened).toHaveLength(0);
  expect(runReadOnlySql({ sql: "select garmin_id from activity" }).status).toBe(
    "succeeded",
  );
  expect(runReadOnlySql({ sql: "select missing from activity" }).reason).toBe(
    "unknown_column",
  );
  const columns = Array.from(
    { length: 33 },
    (_, i) => `garmin_id as c${i}`,
  ).join(",");
  expect(
    runReadOnlySql({ sql: `select ${columns} from activity` }).reason,
  ).toBe("too_many_columns");
  expect(opened).toHaveLength(3);
  expect(opened.every((db) => !db.open)).toBe(true);
  expect(close).toHaveBeenCalledTimes(3);
  expect(primary.open).toBe(true);
});

it("inspection reads only fixed allowlisted counts/ranges and closes on failure", async () => {
  const { describeGarminDatabase } = await import("../src/lib/ai/sql-analysis");
  const queries: string[] = [];
  const prepare = Database.prototype.prepare;
  vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
    this: Database.Database,
    query: string,
  ) {
    if (this.readonly) queries.push(query);
    return prepare.call(this, query);
  });
  const description = describeGarminDatabase();
  expect(queries).toHaveLength(description.tables.length + 1);
  expect(
    queries.filter((query) => query.startsWith("select count(*)")),
  ).toEqual(
    description.tables
      .filter((table) => table.name !== "activity_calculated_grade")
      .map((table) => `select count(*) as count from ${table.name}`),
  );
  expect(opened[0].open).toBe(false);
  primary.exec("drop table daily_health");
  expect(() => describeGarminDatabase()).toThrow(/no such table/);
  expect(opened[1].open).toBe(false);
});

it("owns a lazy separate readonly grade snapshot and closes both handles on success and callback failure", async () => {
  const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");
  expect(
    runReadOnlySql({
      sql: "select * from activity_calculated_grade('missing')",
    }).status,
  ).toBe("succeeded");
  expect(opened).toHaveLength(2);
  expect(opened.every((db) => db.readonly && !db.open)).toBe(true);
  const insert = primary.prepare(
    "insert into activity (id, garmin_id, sport, started_at) values (?, ?, 'hiking', 1)",
  );
  for (let i = 0; i < 33; i += 1) insert.run(String(i), String(i));
  expect(
    runReadOnlySql({
      sql: "select count(*) as sections from activity a join activity_calculated_grade(a.garmin_id) g",
    }).status,
  ).toBe("failed");
  expect(opened).toHaveLength(4);
  expect(opened.every((db) => !db.open)).toBe(true);
  expect(primary.open).toBe(true);
});

it("production tool wiring exposes only guarded results and success-only same-turn handles", async () => {
  const { executeAnalyticsTool: execute } =
    await import("../src/lib/ai/tool-analytics");
  const ports = await import("../src/lib/ai/sql-analysis");
  const executeAnalyticsTool = (input: Parameters<typeof execute>[0]) =>
    execute(input, ports);
  const { TrainerToolExecutionContext } =
    await import("../src/lib/ai/tool-execution-context");
  const context = new TrainerToolExecutionContext();
  const run = (sql: string) =>
    executeAnalyticsTool({
      toolName: "runReadOnlySql",
      input: { sql, resultName: "facts", maxRows: 50 },
      index: 1,
      context,
    });
  expect(run("select count(*) as total from activity").status).toBe(
    "succeeded",
  );
  const saved = context.analysisResults.get("facts");
  expect(saved).toEqual([{ total: 0 }]);
  expect(run("select * from trainer_profile").status).toBe("rejected");
  expect(run("select nonexistent from activity").status).toBe("failed");
  expect(context.analysisResults.get("facts")).toBe(saved);
  expect(opened).toHaveLength(2);
  context.dispose();
  expect(context.analysisResults.size).toBe(0);
  expect(saved).toEqual([{ total: 0 }]);
});
