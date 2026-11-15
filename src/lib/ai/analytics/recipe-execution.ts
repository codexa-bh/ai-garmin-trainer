import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { getOptionalEnv } from "@/lib/env";
import { getDatabase } from "@/lib/db/connection";
import type {
  KpiMeasurementExecution,
  KpiMeasurementRun,
  KpiMeasurementWindow,
  KpiRecipeOutcome,
} from "@/lib/weekly/kpi-contracts";
import { ANALYTICAL_SCHEMA } from "./schema";
import { validateRecipeSql } from "./policy";

/** Hard bounds for unattended saved measurements; not model-selectable. */
export const RECIPE_LIMITS = {
  recipeMs: 2000,
  totalMs: 8000,
  heapMb: 64,
  sqliteHeapBytes: 64 * 1024 * 1024,
  outputBytes: 64 * 1024,
  basisRows: 2000,
};

// Only allowlisted normalized columns become visible, as temp views that shadow
// the real tables. The parameterized grade virtual table is not registered.
function allowedViews(): string[] {
  return Object.values(ANALYTICAL_SCHEMA)
    .filter((table) => table.name !== "activity_calculated_grade")
    .map(
      (table) =>
        `create temp view ${table.name} as select ${table.columns.map((column) => column.name).join(", ")} from main.${table.name}`,
    );
}

// Imported-data basis for one window, computed in the same read snapshot as the
// recipes. Any successful sync settlement or correction of a window row changes it.
const BASIS_SQL = [
  "select id, finished_at from main.sync_run where status = 'completed' order by finished_at desc, id desc limit 1",
  `select * from main.activity where started_at >= :week_start_ms and started_at < :week_end_ms order by garmin_id limit ${RECIPE_LIMITS.basisRows}`,
  `select * from main.daily_health where date >= :week_start_date and date <= :week_last_date order by date limit ${RECIPE_LIMITS.basisRows}`,
];

// Runs in a fresh child with an empty environment. A watchdog thread ends the
// child when the parent disappears or the total deadline passes, even while the
// main thread is blocked inside a native SQLite call.
const CHILD = String.raw`
const { Worker } = require("node:worker_threads");
const { createHash } = require("node:crypto");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const job = JSON.parse(input);
  new Worker("const { workerData: w } = require('node:worker_threads'); const t = Date.now(); setInterval(() => { if (process.ppid !== w.parent || Date.now() - t > w.ms) process.kill(process.pid, 'SIGKILL'); }, 50);", { eval: true, workerData: { parent: process.ppid, ms: job.totalMs } }).unref();
  const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  const Database = require("better-sqlite3");
  const db = new Database(job.path, { readonly: true, fileMustExist: true, timeout: 750 });
  db.pragma("hard_heap_limit = " + job.sqliteHeapBytes);
  for (const view of job.views) db.exec(view);
  db.pragma("query_only = ON");
  db.exec("BEGIN");
  const hash = createHash("sha256");
  for (const sql of job.basis) hash.update(JSON.stringify(db.prepare(sql).safeIntegers(false).all(job.basisParams)));
  write({ basis: hash.digest("hex") });
  for (const [index, recipe] of job.recipes.entries()) {
    write({ start: index });
    try {
      const statement = db.prepare(recipe.sql);
      if (!statement.reader) throw new Error("not_a_query");
      statement.safeIntegers(false);
      const columns = statement.columns().map((column) => column.name);
      const expected = [...recipe.tracks].sort().join(",");
      const named = columns.filter((name) => name !== "missing_source");
      if (new Set(columns).size !== columns.length || [...named].sort().join(",") !== expected) {
        write({ index, failed: "column_mismatch" });
        continue;
      }
      const rows = [];
      for (const row of statement.iterate(job.params)) {
        rows.push(row);
        if (rows.length > 1) break;
      }
      if (rows.length !== 1) {
        write({ index, failed: rows.length ? "multiple_rows" : "no_row" });
        continue;
      }
      const row = rows[0];
      const cells = columns.map((name) => row[name]);
      if (cells.some((value) => value !== null && (typeof value !== "number" || !Number.isFinite(value)))) {
        write({ index, failed: "non_numeric" });
        continue;
      }
      const values = {};
      for (const name of named) values[name] = row[name];
      write({ index, values, incomplete: typeof row.missing_source === "number" && row.missing_source > 0 });
    } catch (error) {
      const message = String(error && error.message);
      write({ index, failed: /no such column/i.test(message) ? "unknown_column" : /no such table/i.test(message) ? "unknown_table" : /syntax/i.test(message) ? "syntax_error" : /memory/i.test(message) ? "resource_limit" : "sql_error" });
    }
  }
  db.exec("COMMIT");
  db.close();
  write({ done: true });
  process.exit(0);
});
`;

type ChildLine = {
  basis?: string;
  start?: number;
  index?: number;
  values?: Record<string, number | null>;
  incomplete?: boolean;
  failed?: string;
  done?: boolean;
};
type Recipe = Parameters<KpiMeasurementExecution["run"]>[0][number];

function civil(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(ms);
}
function basisParams(window: KpiMeasurementWindow) {
  return {
    week_start_ms: window.startMs,
    week_end_ms: window.endMs,
    week_start_date: window.weekStart,
    // Last civil date inside the measured window (week end or as-of day).
    week_last_date: civil(window.endMs - 1, window.timeZone),
  };
}

function runChild(
  path: string,
  recipes: Recipe[],
  window: KpiMeasurementWindow,
  deadline: number,
): Promise<{ lines: ChildLine[]; stuck: number | null; crashed: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${RECIPE_LIMITS.heapMb}`, "-e", CHILD],
      {
        cwd: process.cwd(),
        env: {} as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const lines: ChildLine[] = [];
    let buffer = "";
    let bytes = 0;
    let current: number | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (crashed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve({ lines, stuck: current, crashed });
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => finish(true),
        Math.max(
          1,
          Math.min(
            RECIPE_LIMITS.recipeMs + (current === null ? 1000 : 0),
            deadline - Date.now(),
          ),
        ),
      );
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += chunk.length;
      if (bytes > RECIPE_LIMITS.outputBytes) return finish(true);
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = JSON.parse(buffer.slice(0, newline)) as ChildLine;
        buffer = buffer.slice(newline + 1);
        lines.push(line);
        if (line.start !== undefined) {
          current = line.start;
          arm();
        } else if (line.index !== undefined) current = null;
        if (line.done) return finish(false);
        newline = buffer.indexOf("\n");
      }
    });
    child.on("error", () => finish(true));
    child.on("exit", () => finish(true));
    child.stdin.on("error", () => finish(true));
    arm();
    child.stdin.end(
      JSON.stringify({
        path,
        views: allowedViews(),
        basis: BASIS_SQL,
        basisParams: basisParams(window),
        params: { week_start_ms: window.startMs, week_end_ms: window.endMs },
        recipes: recipes.map(({ sql, tracks }) => ({
          sql: sql.trim().replace(/;$/, ""),
          tracks: tracks.map((track) => track.key),
        })),
        totalMs: Math.max(1, deadline - Date.now()),
        sqliteHeapBytes: RECIPE_LIMITS.sqliteHeapBytes,
      }),
    );
  });
}

/**
 * Bounded execution for saved weekly measurement recipes. Each run re-admits
 * every recipe, executes in one short-lived child process with a hard SIGKILL
 * deadline, and isolates a timed-out/crashed recipe by rerunning the remaining
 * ones in a fresh child, so all published outcomes share one read snapshot.
 */
export function createKpiRecipeExecution(): KpiMeasurementExecution {
  return {
    async run(recipes, window) {
      const deadline = Date.now() + RECIPE_LIMITS.totalMs;
      const outcomes = new Map<string, KpiRecipeOutcome>();
      let pending = recipes.filter((recipe) => {
        const admission = validateRecipeSql(recipe.sql);
        if (!admission.ok)
          outcomes.set(recipe.conceptId, {
            conceptId: recipe.conceptId,
            status: "failed",
            reason: admission.reason,
          });
        return admission.ok;
      });
      let basis = "";
      const path = getOptionalEnv().DATABASE_PATH;
      while (pending.length) {
        if (Date.now() >= deadline) {
          for (const recipe of pending)
            outcomes.set(recipe.conceptId, {
              conceptId: recipe.conceptId,
              status: "failed",
              reason: "timeout",
            });
          break;
        }
        const result = await runChild(
          path,
          pending,
          window,
          deadline,
        );
        basis = result.lines.find((line) => line.basis)?.basis ?? "";
        if (!result.crashed) {
          for (const line of result.lines) {
            if (line.index === undefined) continue;
            const recipe = pending[line.index];
            outcomes.set(
              recipe.conceptId,
              line.failed
                ? {
                    conceptId: recipe.conceptId,
                    status: "failed",
                    reason: line.failed,
                  }
                : {
                    conceptId: recipe.conceptId,
                    status: line.incomplete ? "incomplete" : "measured",
                    values: line.values ?? {},
                  },
            );
          }
          break;
        }
        // Isolate the recipe that hung or exhausted resources; discard partial
        // results and rerun the rest so they share one fresh snapshot.
        const culprit = result.stuck;
        if (culprit === null) {
          for (const recipe of pending)
            outcomes.set(recipe.conceptId, {
              conceptId: recipe.conceptId,
              status: "failed",
              reason: "execution_unavailable",
            });
          break;
        }
        outcomes.set(pending[culprit].conceptId, {
          conceptId: pending[culprit].conceptId,
          status: "failed",
          reason: "resource_limit",
        });
        pending = pending.filter((_, index) => index !== culprit);
      }
      return {
        basis,
        outcomes: recipes.map(
          (recipe) =>
            outcomes.get(recipe.conceptId) ?? {
              conceptId: recipe.conceptId,
              status: "failed",
              reason: "execution_unavailable",
            },
        ),
      } satisfies KpiMeasurementRun;
    },
    basis(window) {
      getDatabase();
      const db = new Database(getOptionalEnv().DATABASE_PATH, {
        readonly: true,
        fileMustExist: true,
        timeout: 750,
      });
      try {
        const hash = createHash("sha256");
        const params = basisParams(window);
        for (const sql of BASIS_SQL)
          hash.update(
            JSON.stringify(db.prepare(sql).safeIntegers(false).all(params)),
          );
        return hash.digest("hex");
      } finally {
        db.close();
      }
    },
  };
}
