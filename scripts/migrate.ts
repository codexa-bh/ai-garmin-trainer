import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { createSchemaSql } from "../src/lib/db/migrations";
import { getOptionalEnv } from "../src/lib/env";

const dbPath = getOptionalEnv().DATABASE_PATH;
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
for (const statement of createSchemaSql()) db.exec(statement);
console.log(`SQLite schema ready at ${dbPath}`);
