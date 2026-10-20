import Database from "better-sqlite3";
import { getOptionalEnv } from "@/lib/env";
import { getDatabase } from "@/lib/db/connection";
import type {
  AnalyticalExecution,
  AnalyticalTableStatistics,
} from "./contracts";
import { SQL_LIMITS } from "./contracts";
import { ANALYTICAL_SCHEMA } from "./schema";
import {
  calculateGradeSections,
  GRADE_MAX_ACTIVITIES,
  GRADE_MAX_POINTS,
  type GradeSample,
} from "./calculated-grade";

function registerCalculatedGrade(
  db: Database.Database,
  path: string,
): () => void {
  let invocations = 0;
  let source: Database.Database | undefined;
  const sourceDb = () => {
    // SQLite cannot re-enter the executing connection from a virtual-table callback.
    // Own one lazy readonly snapshot for all section reads in this query session.
    if (!source) {
      source = new Database(path, {
        readonly: true,
        fileMustExist: true,
        timeout: SQL_LIMITS.timeoutMs,
      });
      source.pragma("query_only = ON");
      source.exec("BEGIN");
    }
    return source;
  };
  db.table("activity_calculated_grade", {
    parameters: ["garmin_id"],
    columns: [
      "window_index",
      "start_elapsed_sec",
      "end_elapsed_sec",
      "calculated_grade_pct",
      "grade_method",
      "target_window_sec",
      "support_seconds",
      "support_distance_meters",
      "sample_count",
      "usable_sample_count",
      "source_grade_sample_count",
      "quality_status",
    ],
    rows: function* (activityId: unknown) {
      const id =
        typeof activityId === "number" &&
        Number.isSafeInteger(activityId) &&
        activityId >= 0
          ? String(activityId)
          : activityId;
      if (typeof id !== "string" || !id.length || id.length > 128)
        throw new Error(
          "Calculated grade requires an activity id: use activity_calculated_grade('verified-id') or WHERE garmin_id = 'verified-id'; unbound rowCount is not data availability",
        );
      invocations += 1;
      if (invocations > GRADE_MAX_ACTIVITIES)
        throw new Error("Calculated grade activity invocation limit exceeded");
      const points = sourceDb()
        .prepare(
          "select timestamp, altitude_meters, distance_meters, grade_pct from activity_stream_point where garmin_id = ? order by elapsed_sec limit ?",
        )
        .all(id, GRADE_MAX_POINTS + 1) as GradeSample[];
      for (const row of calculateGradeSections(points)) {
        yield [
          row.window_index,
          row.start_elapsed_sec,
          row.end_elapsed_sec,
          row.calculated_grade_pct,
          row.grade_method,
          row.target_window_sec,
          row.support_seconds,
          row.support_distance_meters,
          row.sample_count,
          row.usable_sample_count,
          row.source_grade_sample_count,
          row.quality_status,
        ];
      }
    },
  });
  return () => {
    if (source?.open) source.close();
  };
}

function readonlyDb(): { db: Database.Database; close: () => void } {
  getDatabase();
  const path = getOptionalEnv().DATABASE_PATH;
  const db = new Database(path, {
    readonly: true,
    fileMustExist: true,
    timeout: SQL_LIMITS.timeoutMs,
  });
  try {
    const closeSource = registerCalculatedGrade(db, path);
    db.pragma("query_only = ON");
    return {
      db,
      close: () => {
        try {
          closeSource();
        } finally {
          db.close();
        }
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

// Outer adapter only. Production tools receive the guarded facade, not this port.
export function createSqliteAnalyticalExecution(): AnalyticalExecution {
  return {
    openQuery() {
      const { db, close } = readonlyDb();
      let statement: Database.Statement;
      return {
        readRows(sql) {
          statement = db.prepare(sql);
          statement.safeIntegers(false);
          return statement.all() as Array<Record<string, unknown>>;
        },
        readColumnNames: () => statement.columns().map((column) => column.name),
        close,
      };
    },
    inspectTables() {
      const { db, close } = readonlyDb();
      try {
        const tables = Object.values(ANALYTICAL_SCHEMA).map(
          (descriptor): [string, AnalyticalTableStatistics] => {
            // Parameterized grade has no static rows. Do not derive or scan streams
            // for discovery, and never confuse that count with evidence availability.
            const row =
              descriptor.name === "activity_calculated_grade"
                ? { count: 0 }
                : (db
                    .prepare(`select count(*) as count from ${descriptor.name}`)
                    .get() as { count: number });
            let dateRange:
              { min: string | null; max: string | null } | undefined;
            if (descriptor.name === "activity") {
              dateRange = db
                .prepare(
                  "select date(min(started_at) / 1000, 'unixepoch') as min, date(max(started_at) / 1000, 'unixepoch') as max from activity",
                )
                .get() as { min: string | null; max: string | null };
            } else if (descriptor.name === "daily_health") {
              dateRange = db
                .prepare(
                  "select min(date) as min, max(date) as max from daily_health",
                )
                .get() as { min: string | null; max: string | null };
            }
            return [descriptor.name, { rowCount: row.count, dateRange }];
          },
        );
        return Object.fromEntries(tables);
      } finally {
        close();
      }
    },
  };
}
