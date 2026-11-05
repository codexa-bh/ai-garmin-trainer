import Database from "better-sqlite3";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  summaryStorage as storage,
  noteSummaryActivity,
} from "@/lib/db/summary-storage";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import {
  summaryLimits,
  SUMMARY_MODEL_CONTEXT,
  SUMMARY_MODEL_OUTPUT,
} from "@/lib/memory/summary-policy";
import {
  conversationInputLimit,
  CONVERSATION_INPUT_LIMIT,
} from "@/lib/chat/conversation-replay";
import { removeSizeAwareSummaryFixtureSchema } from "./conversation-migration-fixture";

let db: Database.Database;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
});
afterEach(() => db.close());

it.each([1000, 6000, 20000])(
  "allocates finite serialized input/output for N=%s without a guessed tokenizer",
  (cap) => {
    const allowance = summaryLimits(cap);
    expect(allowance.output).toBeGreaterThan(4 * cap);
    expect(allowance.output).toBeLessThanOrEqual(SUMMARY_MODEL_OUTPUT);
    expect(allowance.input).toBeGreaterThan(2 * allowance.output);
    expect(allowance.input + allowance.output).toBeLessThan(
      SUMMARY_MODEL_CONTEXT,
    );
    expect(allowance.reservedUsd).toBe(
      (allowance.input * 0.25 + allowance.output * 0.5) / 1e6,
    );
  },
);

it("adds only measured memory to the existing whole-request allocation, keeping output/safety finite", () => {
  expect(conversationInputLimit()).toBe(CONVERSATION_INPUT_LIMIT);
  expect(conversationInputLimit(24000)).toBe(CONVERSATION_INPUT_LIMIT + 24000);
  expect(conversationInputLimit(SUMMARY_MODEL_CONTEXT)).toBe(
    SUMMARY_MODEL_CONTEXT - 4096 - 1639,
  );
  for (const invalid of [-1, 1.5, NaN, SUMMARY_MODEL_CONTEXT + 1])
    expect(() => conversationInputLimit(invalid)).toThrow("accounting_invalid");
});

it("admits one small completed activity after two seconds and separates observed estimates from unknown liabilities", () => {
  const now = Date.now();
  storage.configure(true, "gpt-6-luna", 20000);
  const turn = history.admit("small", "I prefer short weekdays.");
  history.complete(turn.admission, { content: "Noted.", grounding: null });
  noteSummaryActivity(now);
  expect(storage.admit(now + 1999, "early")).toBeNull();
  const batch = storage.admit(now + 2000, "due")!;
  expect(batch.sources).toHaveLength(1);
  expect(storage.reserve(batch, now + 2000)).toBe(true);
  expect(storage.status(now)).toMatchObject({
    unknownReservedUsd: 0,
    reservedUsdToday: 0,
    unpricedAttempts: 1,
  });
  storage.usage(batch, { input: 1000, output: 2000, cached: null });
  storage.fail(batch, "summary_invalid_output", now + 2001);
  const status = storage.status(now);
  expect(status.reservedUsdToday).toBe(0); // no fabricated reservation
  expect(status.unpricedAttempts).toBe(0); // known Luna usage has a published estimate
  expect(status.estimatedUsdToday).toBeCloseTo(0.0011); // standard undiscounted estimate, not invoice
  expect(status.unknownReservedUsd).toBe(0);
  expect(storage.admit(now + 100000, "no-blind-retry")).toBeNull();
});

it("rehearses schema20→21 on a populated online copy without rewriting old attempts, pin bytes, spend or unknown effects", async () => {
  removeSizeAwareSummaryFixtureSchema(db);
  db.exec("update app_metadata set value='20' where key='schema_version'");
  db.exec(`insert into summary_attempt(job_id,started_at,outcome,reserved,source_ids_json,upper_event,prior_revision,privacy_generation,control_generation)
    values('old-unknown',1,'interrupted',1,'[]',0,0,0,0);
    insert into summary_spend values('2026-11-03',1,0.01);
    insert into conversation values('preserved','Original',1,1,1);
    insert into conversation_summary_pin(conversation_id,payload,seal) values('preserved','null','historical-seal');`);
  const old = db.prepare("select * from summary_attempt").get();
  const pin = db.prepare("select * from conversation_summary_pin").get();
  const spend = db.prepare("select * from summary_spend").get();
  const original = db.serialize();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "summary21-online-")));
  const path = join(root, "copy.sqlite");
  await db.backup(path);
  const copy = new Database(path);
  try {
    migrateDatabase(copy);
    expect(
      copy
        .prepare(
          "select reserved_usd,spend_day,price_basis from summary_attempt",
        )
        .get(),
    ).toEqual({
      reserved_usd: 0.01,
      spend_day: null,
      price_basis: "legacy-flat-reservation",
    });
    expect(copy.prepare("select * from summary_attempt").get()).toMatchObject(
      old as object,
    );
    expect(
      copy.prepare("select * from conversation_summary_pin").get(),
    ).toEqual(pin);
    expect(copy.prepare("select * from summary_spend").get()).toEqual(spend);
    const after = copy.serialize();
    migrateDatabase(copy);
    expect(copy.serialize()).toEqual(after);
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    const reopened = new Database(path);
    try {
      expect(
        reopened.prepare("select reserved_usd from summary_attempt").get(),
      ).toEqual({ reserved_usd: 0.01 });
    } finally {
      reopened.close();
    }
    expect(db.serialize()).toEqual(original);
  } finally {
    copy.close();
    rmSync(root, { recursive: true, force: true });
  }
});
