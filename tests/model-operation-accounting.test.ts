import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  reserveTitleSpend,
  recordTitleUsage,
} from "@/lib/db/conversation-title-spend";
import { conversationHistory } from "@/lib/db/conversation-history";
import { summaryStorage } from "@/lib/db/summary-storage";
import { encodeSummarySelection } from "@/lib/model-settings/summary-selection";

let db: Database.Database;
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
beforeEach(() => {
  db = new Database(":memory:");
  migrateDatabase(db);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

it("does not cap future titles or erase historical liabilities/unknown usage", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  db.prepare(
    "insert into conversation_title_spend(id,day,reserved_usd) values('old','2026-11-05',0.1)",
  ).run();
  for (let index = 0; index < 120; index++) {
    const receipt = reserveTitleSpend();
    expect(receipt).not.toBeNull();
    recordTitleUsage(receipt!, { input: null, output: null, cached: null });
  }
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  expect(reserveTitleSpend()).not.toBeNull();
  expect(
    db
      .prepare(
        "select count(*) as attempts,sum(reserved_usd) as reserved from conversation_title_spend",
      )
      .get(),
  ).toEqual({ attempts: 122, reserved: 0.1 });
  expect(
    db
      .prepare(
        "select reserved_usd,usage_json from conversation_title_spend where id='old'",
      )
      .get(),
  ).toEqual({ reserved_usd: 0.1, usage_json: null });
});

it("keeps existing compaction liabilities without attempt/spending admission caps", () => {
  const turn = conversationHistory.admit("authored", "Keep short weekdays.");
  db.prepare(
    "insert into conversation_compaction_spend values('2099-01-01',10,0.1)",
  ).run();
  for (let index = 0; index < 15; index++)
    expect(conversationHistory.reserveCompaction(turn.admission)).toBe(true);
  expect(
    db.prepare("select * from conversation_compaction_spend").get(),
  ).toEqual({ day: "2099-01-01", attempts: 25, reserved_usd: 0.1 });
});

it("represents unpriced selected-model summary attempts separately from preserved USD reservations", () => {
  const raw = encodeSummarySelection({
    id: "entry_local",
    provider: "ollama",
    modelId: "Any:Exact",
  });
  const now = Date.now();
  summaryStorage.configure(true, raw, 6000);
  const turn = conversationHistory.admit(
    "authored",
    "Short weekdays chosen for time.",
  );
  conversationHistory.complete(turn.admission, {
    content: "Noted.",
    grounding: null,
  });
  summaryStorage.admit(now, "debounce");
  const batch = summaryStorage.admit(now + 2001, "new")!;
  expect(summaryStorage.reserve(batch, now + 2001)).toBe(true);
  summaryStorage.usage(batch, { input: 10, output: 5, cached: null });
  summaryStorage.fail(batch, "summary_invalid_output", now + 2001);
  db.prepare(
    "insert into summary_attempt(job_id,started_at,outcome,reserved,source_ids_json,upper_event,prior_revision,privacy_generation,control_generation,reserved_usd,price_basis) values('old',1,'interrupted',1,'[]',0,0,0,0,0.01,'legacy-flat-reservation')",
  ).run();
  expect(summaryStorage.status(now)).toMatchObject({
    reservedUsdToday: 0,
    estimatedUsdToday: 0,
    unknownReservedUsd: 0.01,
    unpricedAttempts: 2,
    priceBasis: "unknown-price/no-reservation",
  });
  expect(
    db
      .prepare("select reserved_usd from summary_attempt where job_id='new'")
      .get(),
  ).toEqual({ reserved_usd: null });
});
