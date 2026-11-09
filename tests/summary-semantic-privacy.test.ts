import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryStorage as storage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import {
  summaryImportInspection,
  createSummaryImport,
} from "@/lib/db/summary-import";
import {
  summaryRebuildInventory,
  startSummaryRebuild,
  summaryRebuildStatus,
  cancelSummaryRebuild,
} from "@/lib/db/summary-rebuild";
import { createSummaryEngine } from "@/lib/memory/summary-application";
import {
  minimizeSummarySource,
  validateSummaryReplacement,
} from "@/lib/memory/summary-policy";
let db: Database.Database, now: number, sequence: number;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
  now = Date.now();
  sequence = 0;
  storage.configure(true, "gpt-6-luna", 1000);
});
afterEach(() => {
  db.close();
});
function turn(
  user: string,
  chat = "authored",
  answer = "Authored assistant context",
) {
  const admitted = history.admit(chat, user);
  history.complete(admitted.admission, { content: answer, grounding: null });
  return admitted;
}
type Prompt = {
  previous: string;
  currentProfile: unknown;
  newSources: {
    user: string;
    createdAt: number | null;
    assistantContext?: string;
    assistantContextOrigin?: number;
  }[];
};
async function tick(
  patch: unknown,
  inspect?: (input: Prompt, system: string) => void,
) {
  noteSummaryActivity(now);
  now += 3000;
  const generate = vi.fn(async (system: string, prompt: string) => {
    inspect?.(JSON.parse(prompt), system);
    return { patch, usage: { input: 17, output: 9, cached: 0 } };
  });
  await createSummaryEngine({
    storage,
    generation: { generate },
    now: () => now,
    identity: () => `semantic-${++sequence}`,
    current: () => true,
    jitter: () => 0,
  }).tick(new AbortController().signal);
  return generate;
}
it.each([
  "Don't save my weekly review; weekends suit me because of childcare",
  "Do not save my weekly review yet; I prefer short weekdays because caregiving limits time.",
  "Do not save my training plan; I prefer mornings.",
  "Do not save my weekly plan; I prefer mornings.",
  "Do not save this week's plan; I prefer mornings.",
  'She said "Do not save this; never store it." I prefer mornings.',
])(
  "admits document/narrative prose to the actual single request: %s",
  async (user) => {
    turn(user);
    const generate = await tick(
      { summary: "Independent preference", exclude: [] },
      (input, system) => {
        expect(input.newSources[0].user).toBe(user);
        expect(input.newSources[0].createdAt).toBeTypeOf("number");
        expect(input.newSources[0]).not.toHaveProperty("sourceId");
        expect(system).not.toContain("excluded by the application");
      },
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(storage.inspect().text).toBe("Independent preference");
  },
);
it.each([
  "Do not remember this private note.",
  "Do not save this in memory.",
  "Do not save this.",
  "Never store this",
  "I prefer mornings; but do not save this.",
  "Forget what I previously told you.",
])(
  "applies supplied current-input exclusion without erasing prior: %s",
  async (user) => {
    const prior = "Unrelated prior reason. ".repeat(1500);
    storage.editSummary(storage.version(), prior, now);
    turn(user);
    await tick({ summary: prior, exclude: [0] }, (input) => {
      expect(input.previous).toBe(prior);
      expect(input.newSources[0].user).toBe(user);
      expect(input).toHaveProperty("currentProfile");
    });
    expect(storage.inspect().text).toBe(prior);
    expect(db.prepare("select reason from summary_disposition").get()).toEqual({
      reason: "privacy-excluded",
    });
    expect(db.prepare("select usage_json from summary_attempt").get()).toEqual({
      usage_json: JSON.stringify({ input: 17, output: 9, cached: 0 }),
    });
    const bytes = db.serialize();
    db.close();
    db = new Database(bytes);
    expect(summaryRebuildInventory("boot").counts.includedUserMessages).toBe(0);
    turn("I choose that option.");
    await tick({ summary: prior, exclude: [] }, (input) => {
      expect(input.newSources[0]).not.toHaveProperty("assistantContext");
    });
  },
);
it.each([[0, 0], [-1], [0.5], [1], ["0"], null])(
  "rejects malformed/foreign decisions %j with pending/accounting intact",
  async (exclude) => {
    storage.editSummary(storage.version(), "Prior", now);
    turn("Private input");
    await tick({ summary: "Prior", exclude });
    expect(storage.inspect().text).toBe("Prior");
    expect(storage.status(now)).toMatchObject({
      frontier: 0,
      pending: 1,
      reason: "summary_invalid_output",
    });
    expect(
      db.prepare("select count(*) as n from summary_suppression").get(),
    ).toEqual({ n: 0 });
  },
);
it("refuses all-excluded historical erasure and unknown extra fields", async () => {
  storage.editSummary(storage.version(), "Prior", now);
  turn("Do not save this");
  await tick({ summary: "", exclude: [0] });
  expect(storage.inspect().text).toBe("Prior");
  expect(storage.status(now).frontier).toBe(0);
  storage.control("retry", now);
  await tick({ summary: "Prior", exclude: [0], rationale: "not authority" });
  expect(storage.status(now).frontier).toBe(0);
});
it("durably excludes reviewed Off input after seeing its original dates", async () => {
  storage.configure(false, "gpt-6-luna", 1000);
  turn("Do not save this private note.");
  storage.configure(true, "gpt-6-luna", 1000);
  const candidates = summaryImportInspection().candidates;
  expect(candidates).toHaveLength(1);
  createSummaryImport(candidates.map((c) => c.id));
  await tick({ summary: "", exclude: [0] }, (input) =>
    expect(input.newSources[0].createdAt).toBeTypeOf("number"),
  );
  expect(summaryImportInspection().candidates).toEqual([]);
  expect(summaryRebuildInventory("boot").counts.includedUserMessages).toBe(0);
});
it("rejects stale decisions atomically without writing restrictions", async () => {
  turn("Do not save this.");
  await tick({ summary: "", exclude: [0] }, () =>
    storage.control("disable", now),
  );
  expect(
    db.prepare("select count(*) as n from summary_suppression").get(),
  ).toEqual({ n: 0 });
  expect(storage.status(now).frontier).toBe(0);
});
it("maps decisions only to frozen admitted positions, not hard-excluded sources", () => {
  turn("Admitted");
  noteSummaryActivity(now);
  now += 3000;
  const batch = storage.admit(now, "mapping")!;
  batch.sources.unshift({
    ...batch.sources[0],
    sourceId: "hard-excluded",
    eligible: false,
    eventSeq: 0,
    user: null,
  });
  const inputs = batch.sources.flatMap((s) => {
    const input = minimizeSummarySource(s);
    return input ? [input] : [];
  });
  const result = validateSummaryReplacement(
    { summary: "", exclude: [0] },
    batch,
    inputs,
  )!;
  expect(result.dispositions.map((d) => [d.sourceId, d.reason])).toEqual([
    ["hard-excluded", "excluded"],
    [batch.sources[1].sourceId, "privacy-excluded"],
  ]);
});
it("keeps staged exclusions durable across rebuild continuation without partial publication", async () => {
  for (let n = 0; n < 41; n++) turn(`Authored input ${n}`, `chat-${n}`);
  storage.editSummary(storage.version(), "Unrelated active prior", now);
  const inventory = summaryRebuildInventory("boot");
  startSummaryRebuild("staged", inventory.snapshot, "boot", now);
  await tick({ summary: "Draft independent facts", exclude: [0] });
  expect(summaryRebuildStatus()).toMatchObject({ state: "active" });
  expect(storage.inspect().text).toBe("Unrelated active prior");
  await tick({ summary: "Complete independent facts", exclude: [] });
  expect(summaryRebuildStatus()).toMatchObject({ state: "complete" });
  expect(storage.inspect().text).toBe("Complete independent facts");
  expect(summaryRebuildInventory("boot").counts.includedUserMessages).toBe(40);
});
it("labels same-batch assistant ancestry and retains independent user meaning", async () => {
  turn("Do not save this private option.");
  turn("I prefer weekends independently.");
  await tick({ summary: "Weekends suit the user.", exclude: [0] }, (input) => {
    expect(input.newSources[1].assistantContextOrigin).toBe(0);
    expect(input.newSources[1].assistantContext).toBe(
      "Authored assistant context",
    );
  });
  expect(storage.inspect().text).toBe("Weekends suit the user.");
  expect(summaryRebuildInventory("boot").counts.includedUserMessages).toBe(1);
  expect(summaryRebuildInventory("boot").counts.assistantContext).toBe(0);
});
it.each(["cancel", "failure"])(
  "retains valid staged restriction on later %s, never publishes the partial draft",
  async (ending) => {
    for (let n = 0; n < 41; n++) turn(`Authored input ${n}`, `chat-${n}`);
    storage.editSummary(storage.version(), "Active prior", now);
    const review = summaryRebuildInventory("boot");
    startSummaryRebuild("staged", review.snapshot, "boot", now);
    await tick({ summary: "Independent draft", exclude: [0] });
    if (ending === "cancel") cancelSummaryRebuild("staged");
    else await tick(null);
    expect(storage.inspect().text).toBe("Active prior");
    expect(summaryRebuildInventory("boot").counts.includedUserMessages).toBe(
      40,
    );
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  },
);
it("rolls back summary and privacy together on a transactional write failure", async () => {
  turn("Do not remember this.");
  db.exec(
    "create trigger authored_crash before update of payload on summary_state begin select raise(abort,'authored crash'); end",
  );
  await tick({ summary: "", exclude: [0] });
  expect(storage.status(now).frontier).toBe(0);
  expect(
    db.prepare("select count(*) as n from summary_suppression").get(),
  ).toEqual({ n: 0 });
});
it("preserves original-message restrictions across content/hash edits", async () => {
  db.prepare(
    "insert into conversation(id,title,created_at,updated_at) values('legacy','Authored',1,1)",
  ).run();
  db.prepare(
    "insert into message(id,conversation_id,role,content,created_at) values('original','legacy','user','Do not store this',1)",
  ).run();
  const review = summaryRebuildInventory("boot");
  startSummaryRebuild("original", review.snapshot, "boot", now);
  await tick({ summary: "", exclude: [0] });
  db.prepare(
    "update message set content='Edited original',created_at=2 where id='original'",
  ).run();
  expect(summaryRebuildInventory("boot").counts.includedUserMessages).toBe(0);
});
it("omits a staged excluded origin from the next rebuild chunk without older fallback", async () => {
  for (let n = 0; n < 41; n++) {
    const admitted = turn(`Authored input ${n}`);
    db.prepare("update message set created_at=? where id=?").run(
      1000 + n * 2,
      admitted.userRecord.id,
    );
    db.prepare(
      "update message set created_at=? where id=(select assistant_id from conversation_turn where user_id=?)",
    ).run(1001 + n * 2, admitted.userRecord.id);
  }
  const review = summaryRebuildInventory("boot");
  startSummaryRebuild("context-chunks", review.snapshot, "boot", now);
  await tick({ summary: "Independent draft", exclude: [39] });
  expect(summaryRebuildStatus()?.state).toBe("active");
  await tick(
    { summary: "Independent complete summary", exclude: [] },
    (input) => {
      expect(input.newSources).toHaveLength(1);
      expect(input.newSources[0].user).toBe("Authored input 40");
      expect(input.newSources[0]).not.toHaveProperty("assistantContext");
    },
  );
  expect(summaryRebuildStatus()?.state).toBe("complete");
});
it("rejects unrelated concurrent restrictions after staging and preserves active prior", async () => {
  for (let n = 0; n < 41; n++) turn(`Authored input ${n}`, `chat-${n}`);
  storage.editSummary(storage.version(), "Active prior", now);
  const review = summaryRebuildInventory("boot");
  startSummaryRebuild("external", review.snapshot, "boot", now);
  await tick({ summary: "Independent draft", exclude: [0] });
  db.prepare("insert into summary_suppression values(?)").run(
    review.selected[40].sourceId,
  );
  expect(
    await tick({ summary: "Must not publish", exclude: [] }),
  ).not.toHaveBeenCalled();
  expect(storage.inspect().text).toBe("Active prior");
  expect(summaryRebuildStatus()?.state).toBe("interrupted");
});
