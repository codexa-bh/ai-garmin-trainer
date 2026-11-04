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
const integrated = process.argv[3] === "integrated";
const controls = process.argv[3] === "controls";
const correction = process.argv[3] === "correction";
const compaction = process.argv[3] === "compaction";
const live =
  process.argv[3] === "live" ||
  integrated ||
  controls ||
  correction ||
  compaction;
const task =
  integrated || controls || correction || compaction ? "T0272" : "T0270";
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
if (controls) summaryStorage.control("disable", Date.now());
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
const correctionSources = [
  [
    "A",
    "Remember: evening sessions suit me.",
    "You said evening sessions suit you; no measurement is implied.",
  ],
  [
    "A",
    "Keep walks short on weekdays.",
    "Short weekday walks are your stated preference.",
  ],
  [
    "B",
    "My goal is to hike comfortably for three hours.",
    "That is a goal, not verified current fitness.",
  ],
  [
    "B",
    "Do not save any training plan from this discussion.",
    "This discussion grants no plan-save permission.",
  ],
];
for (let index = 0; index < 4; index++) {
  const [chat, user, assistant] = (correction ? correctionSources : authored)[
    index
  ]!;
  const conversationId = `${task}-${runId}-${live ? chat : index}`;
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
if (compaction) {
  // Real H history, explicitly completed while S is Off. Only the four sources
  // above may enter routine S; no historical export or inferred role pairs.
  summaryStorage.control("disable", Date.now());
  const conversationId = `${task}-${runId}-long`;
  for (let index = 0; index < 64; index++) {
    const turn = conversationHistory.admit(
      conversationId,
      index === 0
        ? "I choose short weekday walks plus longer weekend hiking because time is limited. Long weekday sessions were tried and rejected. Keep that rationale, not a fitness measurement."
        : `Authored pacing example ${index}; do not change our chosen approach. ${"walking ".repeat(140)}`,
    );
    conversationHistory.complete(turn.admission, {
      content:
        index === 0
          ? "Option one: long weekday sessions, rejected for time. Option two: short weekday walks and weekend hiking, chosen for available time."
          : `Authored neutral pacing acknowledgement ${index}, not a new choice or measurement. ${"rest ".repeat(120)}`,
      grounding: null,
    });
  }
  getDatabase()
    .prepare("update conversation set manual_title=1 where id=?")
    .run(conversationId);
  summaryStorage.control("enable", Date.now());
}
if (integrated) {
  // Ten real S batches, without spending a paid chat to manufacture each batch.
  // These are explicit authored linked completions on the stopped new copy,
  // not inferred historical role pairs or writes into a running native DB.
  for (let index = 0; index < 180; index++) {
    const conversationId = `${task}-${runId}-neutral-${index}`;
    const turn = conversationHistory.admit(
      conversationId,
      "Authored neutral training discussion; no new preference, decision, equipment choice or measurement.",
    );
    conversationHistory.complete(turn.admission, {
      content: "Authored neutral acknowledgement, not new personal evidence.",
      grounding: null,
    });
    getDatabase()
      .prepare("update conversation set manual_title=1 where id=?")
      .run(conversationId);
  }
}
conversationHistory.admit(
  `${task}-${runId}-incomplete`,
  "Pre-clear incomplete source must not be promoted or resurrected.",
);
summaryStorage.admit(Date.now(), `prepare-${runId}`); // Only records actual backlog discovery; no clock override/provider.
console.log(
  JSON.stringify({
    task,
    runId,
    completed: integrated ? 184 : compaction ? 68 : 4,
    incomplete: 1,
    variant: compaction
      ? "integrated-compaction"
      : correction
        ? "integrated-correction"
        : controls
          ? "integrated-controls"
          : integrated
            ? "integrated-summary"
            : live
              ? "live-summary"
              : "keyless",
    ...(live ? { conversationId: `${task}-${runId}-A` } : {}),
    providerCalls: 0,
    source: "authored synthetic preparation on stopped copy",
    schema: LATEST_SCHEMA_VERSION,
  }),
);
