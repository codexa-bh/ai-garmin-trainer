import Database from "better-sqlite3";
import { getOptionalEnv } from "@/lib/env";
import { getDatabase } from "@/lib/db/connection";
import type {
  AnalyticalExecution,
  AnalyticalTableStatistics,
} from "./contracts";
import { SQL_LIMITS } from "./contracts";
import { ANALYTICAL_SCHEMA } from "./schema";

function readonlyDb(): Database.Database {
  getDatabase();
  const path = getOptionalEnv().DATABASE_PATH;
  const db = new Database(path, {
    readonly: true,
    fileMustExist: true,
    timeout: SQL_LIMITS.timeoutMs,
  });
  db.pragma("query_only = ON");
  return db;
}

// Outer adapter only. Production tools receive the guarded facade, not this port.
export function createSqliteAnalyticalExecution(): AnalyticalExecution {
  return {
    openQuery() {
      const db = readonlyDb();
      let statement: Database.Statement;
      return {
        readRows(sql) {
          statement = db.prepare(sql);
          statement.safeIntegers(false);
          return statement.all() as Array<Record<string, unknown>>;
        },
        readColumnNames: () => statement.columns().map((column) => column.name),
        close: () => db.close(),
      };
    },
    inspectTables() {
      const db = readonlyDb();
      try {
        const tables = Object.values(ANALYTICAL_SCHEMA).map(
          (descriptor): [string, AnalyticalTableStatistics] => {
            const row = db
              .prepare(`select count(*) as count from ${descriptor.name}`)
              .get() as { count: number };
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
        db.close();
      }
    },
  };
}
