import Database from "better-sqlite3";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { conversationHistory } from "../../src/lib/db/conversation-history";
import { summaryStorage } from "../../src/lib/db/summary-storage";
import { getDatabase } from "../../src/lib/db/connection";
import {
  LATEST_SCHEMA_VERSION,
  currentSchemaVersion,
} from "../../src/lib/db/migrations";

// One finite authored preparation, exclusively on an existing stopped run copy.
const root = process.argv[2];
const live = process.argv[3] === "live";
if (
  (process.argv.length !== 3 && !(process.argv.length === 4 && live)) ||
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
const authored = [
  [
    "A",
    "I want to hike comfortably for three hours. Keep weekday sessions short because I collect my bicycle at18:00.",
    "Option one: two long weekday sessions. Option two: short weekday walks plus a longer weekend hike.",
  ],
  [
    "A",
    "Use the second option; the weekday time limit is the reason.",
    "You chose short weekday walks plus a longer weekend hike for available time.",
  ],
  [
    "B",
    "I tried the long weekday plan and stopped because I could not fit it in. Keep short weekday walks and weekend hiking for now.",
    "The long weekday approach was tried and rejected for time, not measured fitness.",
  ],
  [
    "B",
    "Could hiking poles or a lighter bag help? I have not chosen.",
    "Those alternatives remain undecided, not a purchase preference.",
  ],
];
for (let index = 0; index < 4; index++) {
  const [chat, user, assistant] = authored[index]!;
  const conversationId = `T0270-${runId}-${live ? chat : index}`;
  const turn = conversationHistory.admit(
    conversationId,
    live
      ? user!
      : "I prefer short weekday walks because of time; long weekdays were rejected.",
  );
  conversationHistory.complete(turn.admission, {
    content: live
      ? assistant!
      : "Authored acknowledgement, not a measurement or plan save.",
    grounding: null,
  });
  if (live)
    getDatabase()
      .prepare("update conversation set manual_title=1 where id=?")
      .run(conversationId);
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
    variant: live ? "live-summary" : "keyless",
    ...(live ? { conversationId: `T0270-${runId}-A` } : {}),
    providerCalls: 0,
    source: "authored synthetic preparation on stopped copy",
    schema: LATEST_SCHEMA_VERSION,
  }),
);
