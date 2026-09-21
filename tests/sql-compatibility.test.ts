import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "sql-contract-")), "test.sqlite"),
  );
});
afterEach(async () => {
  const { getDatabase } = await import("../src/lib/db/connection");
  getDatabase().close();
  vi.unstubAllEnvs();
});

it("preserves the complete provider-visible schema, examples, bounds and privacy", async () => {
  const { describeGarminDatabase } = await import("../src/lib/ai/sql-analysis");
  expect(describeGarminDatabase()).toMatchSnapshot();
});

it("characterizes admission precedence and correctable versus terminal failures", async () => {
  const { runReadOnlySql } = await import("../src/lib/ai/sql-analysis");
  const queries = [
    "select * from activity -- " + "x".repeat(6000),
    "select * from activity; -- comment",
    "delete from activity; select * from activity",
    "delete from activity",
    "select sum(training_load) as load from activity",
    "select * from training_plan",
    "select * from activities",
    'select * from "activity"',
    "select * from `activity`",
    "select * from [activity]",
    "select 1",
    "with hidden as (select * from session) select * from hidden",
    "with x as (select * from activity) select * from x",
    "select missing from activity",
    "select date from daily_health a join daily_health b on a.date=b.date",
    "select from activity",
    "select garmin_id as id from activity where 0;",
  ];
  expect(
    queries.map((sql) =>
      runReadOnlySql({ sql, resultName: "__ Test name! __" }),
    ),
  ).toMatchSnapshot();
});
