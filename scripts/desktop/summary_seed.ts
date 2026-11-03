import Database from "better-sqlite3";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { conversationHistory } from "../../src/lib/db/conversation-history";
import { summaryStorage } from "../../src/lib/db/summary-storage";
import {
  LATEST_SCHEMA_VERSION,
  currentSchemaVersion,
} from "../../src/lib/db/migrations";

// One finite authored preparation, exclusively on an existing stopped run copy.
const root = process.argv[2];
if (
  process.argv.length !== 3 ||
  !root ||
  realpathSync(root) !== root ||
  !/^ordinary-[a-f0-9-]{36}$/.test(basename(root))
)
  throw new Error("Owned ordinary run root required.");
const runId = basename(root).slice("ordinary-".length);
if (readFileSync(join(root, "owner"), "utf8") !== runId)
  throw new Error("Run ownership mismatch.");
const path = join(root, "trainer.sqlite");
const info = lstatSync(path);
if (
  !info.isFile() ||
  info.nlink !== 1 ||
  info.uid !== process.getuid?.() ||
  info.mode & 0o077 ||
  realpathSync(path) !== path
)
  throw new Error("Private unaliased existing run DB required.");
const probe = new Database(path, { readonly: true, fileMustExist: true });
try {
  if (
    currentSchemaVersion(probe) !== LATEST_SCHEMA_VERSION ||
    probe.prepare("select 1 from conversation_turn limit 1").get()
  )
    throw new Error(
      "Fresh current-schema authored run required; never migrate or replay seed.",
    );
} finally {
  probe.close();
}
process.env.DATABASE_PATH = path;
summaryStorage.configure(true, "gpt-6-luna", 6000);
for (let index = 0; index < 4; index++) {
  const turn = conversationHistory.admit(
    `T0270-${runId}-${index}`,
    "I prefer short weekday walks because of time; long weekdays were rejected.",
  );
  conversationHistory.complete(turn.admission, {
    content: "Authored acknowledgement, not a measurement or plan save.",
    grounding: null,
  });
}
conversationHistory.admit(
  `T0270-${runId}-incomplete`,
  "Pre-clear incomplete source must not be promoted or resurrected.",
);
summaryStorage.admit(Date.now(), `prepare-${runId}`); // Only records actual backlog discovery; no clock override/provider.
console.log(
  JSON.stringify({
    task: "T0270",
    runId,
    completed: 4,
    incomplete: 1,
    providerCalls: 0,
    source: "authored synthetic preparation on stopped copy",
    schema: LATEST_SCHEMA_VERSION,
  }),
);
