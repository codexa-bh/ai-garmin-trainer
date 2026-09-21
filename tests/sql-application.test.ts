import { describe, expect, it, vi } from "vitest";
import { createSqlAnalysis } from "../src/lib/ai/analytics/application";
import type {
  AnalyticalExecution,
  AnalyticalQuerySession,
} from "../src/lib/ai/analytics/contracts";
import { SQL_LIMITS } from "../src/lib/ai/analytics/contracts";
import {
  clampRows,
  interpretSqlRows,
  safeResultName,
  validateSql,
  classifySqliteError,
} from "../src/lib/ai/analytics/policy";

function fixture(rows: Array<Record<string, unknown>> = [{ value: 1 }]) {
  const events: string[] = [];
  const session: AnalyticalQuerySession = {
    readRows: vi.fn((sql) => {
      events.push(`read:${sql}`);
      return rows;
    }),
    readColumnNames: vi.fn(() => {
      events.push("columns");
      return ["value"];
    }),
    close: vi.fn(() => {
      events.push("close");
    }),
  };
  const execution: AnalyticalExecution = {
    openQuery: vi.fn(() => {
      events.push("open");
      return session;
    }),
    inspectTables: vi.fn(() => {
      events.push("inspect");
      return {};
    }),
  };
  const now = vi.fn(() => {
    events.push("clock");
    return 100;
  });
  return {
    events,
    session,
    execution,
    now,
    app: createSqlAnalysis(execution, now),
  };
}
const sql = "select value from activity";

describe("guarded SQL application with supplied capabilities", () => {
  it.each([
    ["x".repeat(6001), "oversized_sql"],
    ["select * from activity -- comment;", "comments_denied"],
    ["delete from activity; select * from activity", "multi_statement"],
    ["pragma query_only", "unsafe_statement"],
    ["select load_extension('x') from activity", "forbidden_token"],
    ["select * from trainer_profile", "disallowed_table"],
    [
      "with x as (select * from semantic_memory) select * from x",
      "disallowed_table",
    ],
    ["select * from activity join unknown on 1", "disallowed_table"],
    ['select * from "activity"', "disallowed_table"],
  ])(
    "rejects before opening, inspecting or reading time: %s",
    (query, reason) => {
      const f = fixture();
      expect(f.app.runReadOnlySql({ sql: query })).toMatchObject({
        status: "rejected",
        reason,
      });
      expect(f.events).toEqual([]);
    },
  );

  it("binds lazily and keeps trim, clock, query and close order", () => {
    const f = fixture();
    expect(f.events).toEqual([]);
    expect(Object.keys(f.app).sort()).toEqual([
      "describeGarminDatabase",
      "runReadOnlySql",
    ]);
    expect(
      f.app.runReadOnlySql({ sql: `  ${sql};  `, resultName: " A result! " }),
    ).toMatchObject({ status: "succeeded", resultName: "a_result" });
    expect(f.events).toEqual([
      "open",
      "clock",
      `read:${sql}`,
      "clock",
      "close",
    ]);
  });

  it("asks for statement columns only for empty results after the elapsed check", () => {
    const f = fixture([]);
    expect(f.app.runReadOnlySql({ sql })).toMatchObject({
      rows: [],
      columns: [{ name: "value" }],
      rowCount: 0,
      truncated: false,
    });
    expect(f.events).toEqual([
      "open",
      "clock",
      `read:${sql}`,
      "clock",
      "columns",
      "close",
    ]);
  });

  it.each([750, 751])(
    "preserves post-execution timeout at %i ms",
    (elapsed) => {
      const f = fixture([]);
      f.now.mockReturnValueOnce(0).mockReturnValueOnce(elapsed);
      const result = f.app.runReadOnlySql({ sql });
      expect(result.status).toBe(elapsed === 750 ? "succeeded" : "failed");
      if (elapsed > 750) {
        expect(result.reason).toBe("timeout");
        expect(f.session.readColumnNames).not.toHaveBeenCalled();
        expect(result.correctionAllowed).toBeUndefined();
      }
      expect(f.session.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["readRows", "readColumnNames"] as const)(
    "maps %s failures and closes exactly once",
    (method) => {
      const f = fixture([]);
      vi.mocked(f.session[method]).mockImplementation(() => {
        throw new Error("no such column: absent /private/database.sqlite");
      });
      const result = f.app.runReadOnlySql({ sql });
      expect(result).toMatchObject({
        status: "failed",
        reason: "unknown_column",
        correctionAllowed: true,
        missingIdentifier: "absent",
      });
      expect(JSON.stringify(result)).not.toContain("/private/");
      expect(f.session.close).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps normalization failures inside the query catch/finally", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const f = fixture([{ value: circular }]);
    expect(f.app.runReadOnlySql({ sql })).toMatchObject({
      status: "failed",
      reason: "sql_error",
    });
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });

  it("does not translate open or close failures or add a new initialization catch", () => {
    const f = fixture();
    vi.mocked(f.execution.openQuery).mockImplementationOnce(() => {
      throw new Error("open failed");
    });
    expect(() => f.app.runReadOnlySql({ sql })).toThrow("open failed");
    expect(f.session.close).not.toHaveBeenCalled();
    expect(f.now).not.toHaveBeenCalled();
    vi.mocked(f.session.close).mockImplementationOnce(() => {
      throw new Error("close failed");
    });
    expect(() => f.app.runReadOnlySql({ sql })).toThrow("close failed");
  });

  it("retains first-clock failure outside the lifecycle catch", () => {
    const f = fixture();
    f.now.mockImplementationOnce(() => {
      throw new Error("clock failed");
    });
    expect(() => f.app.runReadOnlySql({ sql })).toThrow("clock failed");
    expect(f.session.readRows).not.toHaveBeenCalled();
    expect(f.session.close).not.toHaveBeenCalled();
  });

  it("uses bounded inspection only and lets inspection errors propagate", () => {
    const f = fixture();
    f.app.describeGarminDatabase();
    expect(f.events).toEqual(["inspect"]);
    vi.mocked(f.execution.inspectTables).mockImplementationOnce(() => {
      throw new Error("inspection failed");
    });
    expect(() => f.app.describeGarminDatabase()).toThrow("inspection failed");
  });
});

describe("pure admission and evidence interpretation", () => {
  it.each([
    [undefined, 50],
    [NaN, 50],
    [Infinity, 50],
    [-Infinity, 50],
    [0, 1],
    [-5, 1],
    [3.9, 3],
    [999, 200],
  ])("coerces row cap %s to %i", (input, expected) => {
    expect(clampRows(input)).toBe(expected);
  });
  it("keeps name cleaning and UTF-8 rather than character SQL limits", () => {
    expect(safeResultName("___")).toBe("sql_result");
    expect(safeResultName("A".repeat(50))).toBe("a".repeat(40));
    expect(validateSql(`select '${"é".repeat(3000)}' from activity`)).toEqual({
      ok: false,
      reason: "oversized_sql",
    });
  });
  it("normalizes cells without mutating supplied rows", () => {
    const row = Object.freeze({
      missing: undefined,
      nil: null,
      yes: true,
      bigint: 7n,
      nan: NaN,
      infinity: Infinity,
      text: "é".repeat(501),
      object: { x: 1 },
    });
    const result = interpretSqlRows([row], Object.keys(row), 50, "test");
    expect(result.rows).toEqual([
      {
        missing: null,
        nil: null,
        yes: true,
        bigint: 7,
        nan: null,
        infinity: null,
        text: "é".repeat(499) + "…",
        object: '{"x":1}',
      },
    ]);
    expect(row.bigint).toBe(7n);
  });
  it("preserves full rowCount versus capped returnedRows and byte trimming", () => {
    const raw = Array.from({ length: 250 }, () => ({ text: "é".repeat(500) }));
    const result = interpretSqlRows(raw, ["text"], 200, "test");
    expect(result).toMatchObject({
      status: "succeeded",
      rowCount: 250,
      truncated: true,
    });
    expect(result.returnedRows).toBe(result.rows.length);
    expect(result.returnedRows).toBeLessThan(200);
    expect(
      new TextEncoder().encode(JSON.stringify(result.rows)).length,
    ).toBeLessThanOrEqual(SQL_LIMITS.maxBytes);
    expect(
      new TextEncoder().encode(JSON.stringify([...result.rows, raw[0]])).length,
    ).toBeGreaterThan(SQL_LIMITS.maxBytes);
  });
  it("retains too-many-columns precedence and zero-fit byte rejection", () => {
    const columns = Array.from({ length: 33 }, (_, i) => `c${i}`);
    expect(interpretSqlRows([], columns, 50, "test").reason).toBe(
      "too_many_columns",
    );
    const key = "x".repeat(60_000);
    expect(interpretSqlRows([{ [key]: 1 }], [key], 50, "test")).toMatchObject({
      status: "rejected",
      reason: "too_many_bytes",
    });
  });
  it.each([
    ["no such column: a.missing", "unknown_column", "a.missing"],
    ["no such table: activity", "unknown_table", "activity"],
    ["ambiguous column name: date", "ambiguous_column", "date"],
    ['near "from": syntax error', "syntax_error", undefined],
    ["other failure", "sql_error", undefined],
  ])(
    "preserves classified error metadata: %s",
    (message, reason, missingIdentifier) => {
      expect(classifySqliteError(new Error(message), sql)).toMatchObject({
        reason,
        missingIdentifier,
        correctionAllowed: true,
        sqliteMessage: message,
      });
    },
  );
});
