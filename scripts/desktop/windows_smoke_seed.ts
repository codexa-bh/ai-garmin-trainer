// Finite in-memory adapter to the existing authored recipe. No filesystem input,
// private selection, production migration or general fixture endpoint.
import Database from "better-sqlite3";
import { pathToFileURL } from "node:url";
import { populate, verify } from "./smoke_recipe";

export function syntheticWindowsInput(anchor: string): Buffer {
  const db = new Database(":memory:");
  try {
    populate(db, anchor);
    verify(db, "synthetic");
    return db.serialize();
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 3) throw new Error("One UTC anchor required");
  process.stdout.write(syntheticWindowsInput(process.argv[2]));
}
