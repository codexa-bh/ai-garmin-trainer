import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/lib/db/migrations";
import { conversationHistory as history } from "@/lib/db/conversation-history";
import { summaryStorage } from "@/lib/db/summary-storage";
import {
  initializeLiveConfiguration,
  applyLiveConfiguration,
  getOptionalEnv,
} from "@/lib/env";
import {
  tickCrossChatSummary,
  readCrossChatSummary,
  changeCrossChatSummary,
  catchUpCrossChatSummary,
  prepareSummaryAdoption,
} from "@/lib/memory/summary-composition";
import {
  stopSummaryLifetime,
  summaryLifetime,
  installSummaryWake,
  notifySummaryActivity,
} from "@/lib/memory/summary-lifetime";
import { ensureConversation } from "@/lib/db/conversation-repository";
import { readSummaryPin } from "@/lib/db/conversation-summary-pin";
import { SUMMARY_DEADLINE_MS } from "@/lib/memory/summary-policy";
import { activationEnvironment } from "../scripts/desktop/settings";
let db: Database.Database, boot: string;
const f = vi.hoisted(() => ({ generate: vi.fn(), keys: [] as string[] }));
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
vi.mock("@/lib/memory/summary-provider", () => ({
  createSummaryGeneration: (key: string) => {
    f.keys.push(key);
    return { generate: f.generate };
  },
}));
const owner = process as typeof process & {
  __trainerLiveConfigurationV1?: unknown;
  __trainerSummaryLifetimeV1?: unknown;
};
beforeEach(() => {
  delete owner.__trainerLiveConfigurationV1;
  delete owner.__trainerSummaryLifetimeV1;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  vi.stubEnv("SUMMARY_ENABLED", "true");
  vi.stubEnv("SUMMARY_MODEL", "gpt-6-luna");
  vi.stubEnv("SUMMARY_CHAR_LIMIT", "6000");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-one");
  db = new Database(":memory:");
  migrateDatabase(db);
  boot = randomUUID();
  initializeLiveConfiguration(boot);
  f.generate.mockReset();
  f.keys = [];
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete owner.__trainerLiveConfigurationV1;
  delete owner.__trainerSummaryLifetimeV1;
});
function seed() {
  for (let i = 0; i < 4; i++) {
    const turn = history.admit(`chat${i}`, "I prefer short weekdays for time.");
    history.complete(turn.admission, {
      content: "User-stated preference only.",
      grounding: null,
    });
  }
}
async function due() {
  await tickCrossChatSummary(boot);
  seed();
  await tickCrossChatSummary(boot);
  vi.setSystemTime(Date.now() + 10001);
}
function valid(_system: string, prompt: string) {
  const input = JSON.parse(prompt) as { newSources: { sourceId: string }[] };
  return {
    patch: {
      version: 1,
      keep: [],
      upsert: input.newSources.map((source, i) => ({
        id: `item${i}`,
        text: "Short weekdays for time.",
        category: "constraint",
        stance: "user-stated",
        sourceIds: [source.sourceId],
        priority: 4,
        expiresAt: null,
        replaces: [],
      })),
      remove: [],
      coverage: input.newSources.map((source) => ({
        sourceId: source.sourceId,
        reason: "represented",
      })),
    },
    usage: { input: 100, output: 40, cached: null },
  };
}
describe("actual production summary composition and foreground cancellation", () => {
  it("owns activity notification only in the native lifetime and stops it on shutdown", () => {
    const wake = vi.fn();
    notifySummaryActivity();
    installSummaryWake(wake);
    notifySummaryActivity();
    expect(wake).toHaveBeenCalledTimes(1);
    stopSummaryLifetime();
    notifySummaryActivity();
    expect(wake).toHaveBeenCalledTimes(1);
  });
  it("bounds explicit catch-up at 8 seconds and never adopts late work into a newly frozen null pin", async () => {
    await tickCrossChatSummary(boot);
    seed();
    let release!: (value: ReturnType<typeof valid>) => void;
    let prompt = "";
    f.generate.mockImplementation((_system: string, p: string) => {
      prompt = p;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const catchup = catchUpCrossChatSummary();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledTimes(1);
    const active = summaryLifetime().inFlight;
    await vi.advanceTimersByTimeAsync(6000);
    await catchup;
    expect(readCrossChatSummary().pending).toBe(4);
    ensureConversation("after-timeout");
    expect(readSummaryPin("after-timeout")).toBeNull();
    release(valid("", prompt));
    await active;
    expect(readCrossChatSummary().frontier).toBe(4);
    expect(readSummaryPin("after-timeout")).toBeNull();
  });
  it("privacy/control changes during the explicit wait prevent stale Refresh adoption", async () => {
    await tickCrossChatSummary(boot);
    seed();
    ensureConversation("refresh-target");
    f.generate.mockImplementation(() => new Promise(() => {}));
    const prepared = prepareSummaryAdoption({
      version: 1,
      action: "refresh",
      expected: summaryStorage.version(),
      conversationId: "refresh-target",
      segmentRevision: 0,
    });
    const observed = expect(prepared).rejects.toThrow("summary_stale_action");
    await vi.advanceTimersByTimeAsync(2000);
    changeCrossChatSummary("disable");
    await vi.advanceTimersByTimeAsync(1000);
    await observed;
    expect(readSummaryPin("refresh-target")).toBeNull();
    expect(summaryStorage.status(Date.now()).frontier).toBe(0);
  });
  it("passive status never generates; a never-settling provider is bounded by the whole-operation deadline, shutdown stops further work", async () => {
    f.generate.mockImplementation(() => new Promise(() => {}));
    await due();
    expect(readCrossChatSummary()).toMatchObject({
      pending: 4,
      usedByChat: false,
    });
    expect(f.generate).not.toHaveBeenCalled();
    const running = tickCrossChatSummary(boot);
    await Promise.resolve();
    expect(f.generate).toHaveBeenCalledTimes(1);
    await tickCrossChatSummary(boot);
    expect(f.generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SUMMARY_DEADLINE_MS);
    await running;
    expect(readCrossChatSummary()).toMatchObject({
      frontier: 0,
      reason: "summary_interrupted",
      attemptsToday: 1,
    });
    stopSummaryLifetime();
    await tickCrossChatSummary(boot);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("uses independent admitted native keys and rejects late output after live rotation without changing topology", async () => {
    let release!: (value: ReturnType<typeof valid>) => void;
    let prompt = "";
    f.generate.mockImplementation((_system: string, p: string) => {
      prompt = p;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await due();
    const running = tickCrossChatSummary(boot);
    await Promise.resolve();
    applyLiveConfiguration({
      version: 1,
      boot,
      generation: 1,
      revision: "1",
      chatCatalog: { version: 1, entries: [], defaultEntryId: null },
      secrets: { OPENAI_API_KEY: "synthetic-two" },
    });
    release(valid("", prompt));
    await running;
    expect(summaryStorage.status(Date.now()).frontier).toBe(0);
    expect(f.keys).toContain("synthetic-one");
    expect(getOptionalEnv().SUMMARY_MODEL).toBe("gpt-6-luna");
    expect(getOptionalEnv().AI_MODEL).toBe("gpt-6-luna");
    changeCrossChatSummary("retry");
    vi.setSystemTime(Date.now() + 30001);
    f.generate.mockImplementation(async (system: string, prompt: string) =>
      valid(system, prompt),
    );
    await tickCrossChatSummary(boot);
    expect(f.keys.at(-1)).toBe("synthetic-two");
    expect(summaryStorage.status(Date.now()).frontier).toBe(4);
  });
  it("refuses foreign native tick identity and does not re-enable immediate Off through polling", async () => {
    await expect(tickCrossChatSummary("foreign")).rejects.toThrow(
      "summary_tick_denied",
    );
    expect(f.generate).not.toHaveBeenCalled();
    await tickCrossChatSummary(boot);
    changeCrossChatSummary("disable");
    await tickCrossChatSummary(boot);
    expect(readCrossChatSummary()).toMatchObject({
      state: "disabled",
      enabled: false,
    });
  });
  it("native summary selection is restart-only, explicit/unselected by default and preserves chat/extraction fields", () => {
    const frame = {
      version: 3,
      fields: {
        DATABASE_PATH: "/unused/new-copy.sqlite",
        SUMMARY_ENABLED: "true",
        SUMMARY_MODEL: "gpt-6-luna",
        SUMMARY_CHAR_LIMIT: "6000",
        AI_MODEL: "preserved-extractor",
      },
      secrets: { OPENAI_API_KEY: "synthetic-one" },
      chatCatalog: { version: 1, entries: [], defaultEntryId: null },
      selectionCompatibility: {
        database: null,
        catalog: { version: 1, entries: [], defaultEntryId: null },
      },
    };
    const active = activationEnvironment(frame, "new");
    expect(active.SUMMARY_MODEL).toBe("gpt-6-luna");
    expect(active.AI_MODEL).toBe("preserved-extractor");
    expect(getOptionalEnv({}).SUMMARY_MODEL).toBe("unselected");
    expect(getOptionalEnv({}).SUMMARY_ENABLED).toBe("false");
    for (const SUMMARY_CHAR_LIMIT of ["999", "20001", "1.5", "NaN"])
      expect(() =>
        activationEnvironment(
          { ...frame, fields: { ...frame.fields, SUMMARY_CHAR_LIMIT } },
          "new",
        ),
      ).toThrow();
    expect(() =>
      activationEnvironment(
        { ...frame, fields: { ...frame.fields, SUMMARY_MODEL: "unreviewed" } },
        "new",
      ),
    ).toThrow();
  });
});
