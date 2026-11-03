// Finite synthetic H scenario, exclusively on an already-created ordinary run copy.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { getDatabase } from "../../src/lib/db/connection";
import { conversationHistory } from "../../src/lib/db/conversation-history";
import {
  ensureConversation,
  renameConversation,
} from "../../src/lib/db/conversation-repository";

export function seed(root: string, action: "initial" | "append") {
  const directory = lstatSync(root);
  const id = basename(root).replace(/^ordinary-/, "");
  const path = join(root, "trainer.sqlite");
  const file = lstatSync(path);
  if (
    realpathSync(root) !== root ||
    !directory.isDirectory() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o777) !== 0o700 ||
    !/^ordinary-[0-9a-f-]{36}$/.test(basename(root)) ||
    readFileSync(join(root, "owner"), "utf8") !== id ||
    realpathSync(path) !== path ||
    !file.isFile() ||
    file.nlink !== 1 ||
    file.uid !== process.getuid?.() ||
    (file.mode & 0o777) !== 0o600 ||
    !["initial", "append"].includes(action)
  )
    throw new Error("Exclusive ordinary synthetic copy required");
  const probe = new Database(path, { readonly: true, fileMustExist: true });
  const conversationId = "t0269-history-" + id;
  try {
    if (
      action === "initial" &&
      (
        probe.prepare("select count(*) as n from conversation").get() as {
          n: number;
        }
      ).n !== 0
    )
      throw new Error("Empty authored chat source required");
    if (
      action === "append" &&
      (
        probe
          .prepare(
            "select count(*) as n from conversation where id=? and manual_title=1",
          )
          .get(conversationId) as { n: number }
      ).n !== 1
    )
      throw new Error("Exact prior synthetic conversation required");
  } finally {
    probe.close();
  }
  process.env.DATABASE_PATH = path;
  ensureConversation(conversationId, "T0269 authored continuity");
  renameConversation(conversationId, "T0269 authored continuity"); // No background title calls.
  const count = action === "initial" ? 64 : 20;
  for (let index = 0; index < count; index++) {
    const admitted = conversationHistory.admit(
      conversationId,
      index === 0 && action === "initial"
        ? "Fictional options: weekday evenings were rejected because of available time. I choose short weekday walks and weekend hiking. Keep this rationale and the rejected alternative."
        : `Fictional discussion ${action} ${index}: keep weekdays short for available time. ${"walking ".repeat(140)}`,
    );
    conversationHistory.complete(admitted.admission, {
      content:
        index === 0 && action === "initial"
          ? "Option one is evening sessions, rejected for time. Option two is short weekday walks and weekend hiking, chosen for available time. No measurements or save permission are asserted."
          : `Fictional acknowledgment ${index}: option two remains for available time; evenings remain rejected. ${"rest ".repeat(120)}`,
      grounding: null,
    });
  }
  const db = getDatabase();
  return {
    conversationId,
    authoredPairs: count,
    messages: (
      db
        .prepare("select count(*) as n from message where conversation_id=?")
        .get(conversationId) as { n: number }
    ).n,
    syntheticOnly: true,
    providerCalls: 0,
  };
}
if (process.argv[1]?.endsWith("conversation_seed.ts")) {
  try {
    if (
      process.argv.length !== 4 ||
      !["initial", "append"].includes(process.argv[2])
    )
      throw new Error("Finite seed arguments required");
    console.log(
      JSON.stringify(
        seed(process.argv[3], process.argv[2] as "initial" | "append"),
      ),
    );
  } catch {
    console.error(
      "Finite authored conversation preparation refused; no native launch.",
    );
    process.exitCode = 1;
  }
}
