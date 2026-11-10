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
  executeSummaryCommand,
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
import { encodeSummarySelection } from "@/lib/model-settings/summary-selection";
import type { AppEnv } from "@/lib/env";
let db: Database.Database, boot: string;
const f = vi.hoisted(() => ({
  generate: vi.fn(),
  keys: [] as string[],
  configurations: [] as AppEnv[],
}));
vi.mock("@/lib/db/connection", () => ({ getDatabase: () => db }));
vi.mock("@/lib/memory/summary-provider", () => ({
  createSummaryGeneration: (env: AppEnv) => {
    f.keys.push(env.OPENAI_API_KEY ?? "");
    f.configurations.push(env);
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
  f.configurations = [];
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
  expect(JSON.parse(prompt)).toHaveProperty("previous");
  return {
    patch: { summary: "Short weekdays for time.", exclude: [] },
    usage: { input: 100, output: 40, cached: null },
  };
}
describe("actual production summary composition and foreground cancellation", () => {
  const alternative = {
    id: "entry_manual",
    provider: "openrouter" as const,
    modelId: "Vendor/Manual:Exact",
  };
  const choice = encodeSummarySelection(alternative);
  function activate(
    entries = [alternative],
    generation = 1,
    key = "synthetic-router",
  ) {
    applyLiveConfiguration({
      version: 1,
      boot,
      generation,
      revision: String(generation),
      chatCatalog: { version: 1, entries, defaultEntryId: null },
      secrets: { OPENAI_API_KEY: "synthetic-one", OPENROUTER_API_KEY: key },
    });
  }
  async function saved() {
    await tickCrossChatSummary(boot);
    summaryStorage.editSummary(
      summaryStorage.version(),
      "Original qualified saved summary with reasons.",
      Date.now(),
    );
  }
  it("captures each manual choice and accounting independently without changing routine configuration or preferences", async () => {
    await saved();
    activate();
    const before = summaryStorage.version();
    const control = db
      .prepare("select model,generation,manual_revision from summary_control")
      .get();
    const preferences = db.prepare("select * from app_metadata").all();
    f.generate.mockResolvedValue({
      patch: { summary: "Shorter reasons." },
      usage: { input: 20, output: 10, cached: 0 },
    });
    const command = {
      version: 2 as const,
      expected: before,
      action: "densify-request" as const,
      id: "alternative",
      model: choice,
    };
    const result = await executeSummaryCommand(command);
    expect(result).toMatchObject({
      densify: {
        state: "review",
        modelLabel: "openrouter / Vendor/Manual:Exact",
      },
    });
    expect(f.configurations.at(-1)).toMatchObject({
      SUMMARY_MODEL: choice,
      OPENROUTER_API_KEY: "synthetic-router",
    });
    expect(
      db
        .prepare(
          "select policy_identity,price_basis,source_ids_json,usage_json from summary_attempt where job_id='densify_alternative'",
        )
        .get(),
    ).toMatchObject({
      policy_identity:
        'global-summary-text-v2/["openrouter","Vendor/Manual:Exact"]/manual-densify',
      price_basis: "unknown-price/no-reservation",
      source_ids_json: "[]",
      usage_json: JSON.stringify({ input: 20, output: 10, cached: 0 }),
    });
    await executeSummaryCommand(command);
    await expect(
      executeSummaryCommand({ ...command, model: undefined }),
    ).rejects.toThrow("summary_densify_identity_changed");
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare("select model,generation,manual_revision from summary_control")
        .get(),
    ).toEqual(control);
    expect(db.prepare("select * from app_metadata").all()).toEqual(preferences);
    expect(summaryStorage.version()).toEqual(before);
    await executeSummaryCommand({
      version: 2,
      expected: before,
      action: "densify-discard",
      id: command.id,
    });
    await executeSummaryCommand({
      version: 2,
      expected: before,
      action: "densify-request",
      id: "default-again",
    });
    expect(f.configurations.at(-1)?.SUMMARY_MODEL).toBe("gpt-6-luna");
    expect(getOptionalEnv().SUMMARY_MODEL).toBe("gpt-6-luna");
    expect(f.generate).toHaveBeenCalledTimes(2);
  });
  it("allows an explicit eligible alternative with an unavailable default without enabling or changing shared configuration", async () => {
    await saved();
    applyLiveConfiguration({
      version: 1,
      boot,
      generation: 1,
      revision: "1",
      chatCatalog: { version: 1, entries: [alternative], defaultEntryId: null },
      secrets: { OPENROUTER_API_KEY: "synthetic-router" },
    });
    expect(readCrossChatSummary(true)).toMatchObject({
      densify: {
        available: false,
        sourceAvailable: true,
        models: { default: { available: false } },
      },
    });
    const before = summaryStorage.version();
    await expect(
      executeSummaryCommand({
        version: 2,
        expected: before,
        action: "densify-request",
        id: "missing-default",
      }),
    ).rejects.toThrow();
    f.generate.mockResolvedValue({
      patch: { summary: "Shorter." },
      usage: { input: null, output: null, cached: null },
    });
    expect(
      await executeSummaryCommand({
        version: 2,
        expected: before,
        action: "densify-request",
        id: "eligible",
        model: choice,
      }),
    ).toMatchObject({ densify: { state: "review" } });
    expect(summaryStorage.version()).toEqual(before);
    expect(getOptionalEnv().SUMMARY_MODEL).toBe("gpt-6-luna");
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("select reserved_usd,price_basis from summary_attempt").get(),
    ).toEqual({
      reserved_usd: null,
      price_basis: "unknown-price/no-reservation",
    });
    await executeSummaryCommand({
      version: 2,
      expected: before,
      action: "densify-discard",
      id: "eligible",
    });
    changeCrossChatSummary("disable");
    await expect(
      executeSummaryCommand({
        version: 2,
        expected: summaryStorage.version(),
        action: "densify-request",
        id: "off",
        model: choice,
      }),
    ).rejects.toThrow();
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it.each(["removed", "remapped", "missing-key"])(
    "rejects %s selection before any provider or attempt",
    async (failure) => {
      await saved();
      activate(
        failure === "removed"
          ? []
          : failure === "remapped"
            ? [{ ...alternative, modelId: "replaced" }]
            : [alternative],
      );
      if (failure === "missing-key")
        applyLiveConfiguration({
          version: 1,
          boot,
          generation: 2,
          revision: "2",
          chatCatalog: {
            version: 1,
            entries: [alternative],
            defaultEntryId: null,
          },
          secrets: {},
        });
      await expect(
        executeSummaryCommand({
          version: 2,
          expected: summaryStorage.version(),
          action: "densify-request",
          id: "rejected",
          model: choice,
        }),
      ).rejects.toThrow();
      expect(f.generate).not.toHaveBeenCalled();
      expect(
        db.prepare("select count(*) as n from summary_attempt").get(),
      ).toEqual({ n: 0 });
    },
  );
  it("revokes delayed manual work on live catalog/key change without retargeting or replay", async () => {
    await saved();
    activate();
    let release!: (value: unknown) => void;
    f.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = executeSummaryCommand({
      version: 2,
      expected: summaryStorage.version(),
      action: "densify-request",
      id: "race",
      model: choice,
    });
    const captured = f.configurations.at(-1)!;
    activate([{ ...alternative, modelId: "replaced" }], 2, "synthetic-new");
    release({
      patch: { summary: "Late." },
      usage: { input: 20, output: 5, cached: 0 },
    });
    expect(await pending).toMatchObject({
      densify: { state: "failed", text: null },
    });
    expect(captured).toMatchObject({
      SUMMARY_MODEL: choice,
      OPENROUTER_API_KEY: "synthetic-router",
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(summaryStorage.inspect().text).toBe(
      "Original qualified saved summary with reasons.",
    );
  });
  it("keeps GET and routine overshoot passive, uses captured provider once and preserves usable content until explicit acceptance", async () => {
    await tickCrossChatSummary(boot);
    summaryStorage.editSummary(
      summaryStorage.version(),
      "Current qualified saved text. ".repeat(450),
      Date.now(),
    );
    const before = summaryStorage.version();
    for (let n = 0; n < 3; n++) {
      readCrossChatSummary(true);
      await tickCrossChatSummary(boot);
    }
    expect(f.generate).not.toHaveBeenCalled();
    f.generate.mockResolvedValue({
      patch: { summary: "Shorter qualified text." },
      usage: { input: 20, output: 10, cached: 0 },
    });
    const result = await executeSummaryCommand({
      version: 2,
      expected: before,
      action: "densify-request",
      id: "explicit",
    });
    expect(result).toMatchObject({
      densify: { state: "review", shorter: true },
    });
    expect(f.keys).toContain("synthetic-one");
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.generate.mock.calls[0][1])).toEqual({
      summary: "Current qualified saved text. ".repeat(450),
      targetCharacters: 6000,
    });
    expect(summaryStorage.version()).toEqual(before);
    expect(readCrossChatSummary(true)).toMatchObject({
      densify: { review: { state: "review" } },
    });
    await executeSummaryCommand({
      version: 2,
      expected: before,
      action: "densify-accept",
      id: "explicit",
    });
    expect(summaryStorage.read().text).toBe("Shorter qualified text.");
    expect(summaryStorage.version()).toEqual({
      ...before,
      revision: before.revision + 1,
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("shares native cancellation and writer exclusion without poisoning routine work", async () => {
    await tickCrossChatSummary(boot);
    summaryStorage.editSummary(
      summaryStorage.version(),
      "Saved qualified text",
      Date.now(),
    );
    f.generate.mockImplementation(() => new Promise(() => {}));
    const expected = summaryStorage.version();
    const pending = executeSummaryCommand({
      version: 2,
      expected,
      action: "densify-request",
      id: "native-cancel",
    });
    await expect(
      executeSummaryCommand({
        version: 2,
        expected,
        action: "densify-request",
        id: "different",
      }),
    ).rejects.toThrow();
    expect(summaryLifetime().running).toBe(true);
    stopSummaryLifetime();
    await pending;
    expect(readCrossChatSummary(true)).toMatchObject({
      densify: { review: { state: "cancelled", text: null } },
    });
    expect(summaryStorage.read().text).toBe("Saved qualified text");
    expect(summaryStorage.status(Date.now()).reason).toBeNull();
    expect(summaryLifetime().running).toBe(false);
  });
  it("omits unused archive/import excerpts from ordinary content without changing preserved legacy bytes", () => {
    db.exec(`insert into trainer_memory(id,category,value,status,source_type,provenance_text,created_at,updated_at)
      values('legacy','preference','Authored preserved legacy fact','confirmed','user','Authored original',1,1);
      insert into semantic_memory(id,user_id,kind,text,status,embedding_json,embedding_model,source,created_at,updated_at)
      values('vector','default','preference','Authored preserved vector fact','active','[0.1,0.2]','old-model','legacy',1,1);`);
    const before = db.serialize();
    const statements = vi.spyOn(db, "prepare");
    const content = readCrossChatSummary(true);
    expect(content).toMatchObject({
      legacy: [],
      historical: { candidates: [], manifests: [] },
    });
    expect(JSON.stringify(content)).not.toContain("Authored preserved");
    expect(
      statements.mock.calls.every(
        ([sql]) =>
          !/from (semantic_memory|trainer_memory)|summary_eligible=0/.test(sql),
      ),
    ).toBe(true);
    statements.mockRestore();
    expect(db.serialize()).toEqual(before);
  });
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
      version: 2,
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
  it("renews the real lease past the old deadline and publishes a single completed generation", async () => {
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
    await vi.advanceTimersByTimeAsync(90_000);
    expect(summaryLifetime().running).toBe(true);
    expect(readCrossChatSummary()).toMatchObject({ frontier: 0, pending: 4 });
    release(valid("", prompt));
    await running;
    expect(readCrossChatSummary()).toMatchObject({
      frontier: 4,
      pending: 0,
      attemptsToday: 1,
    });
    expect(summaryStorage.read().text).toBe("Short weekdays for time.");
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(summaryLifetime().running).toBe(false);
  });
  it("interrupts at exactly 300 seconds and rejects a late provider result without replay", async () => {
    let release!: (value: ReturnType<typeof valid>) => void;
    let prompt = "";
    f.generate.mockImplementation((_system: string, p: string) => {
      prompt = p;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await due();
    summaryStorage.editSummary(
      summaryStorage.version(),
      "Prior saved text",
      Date.now(),
    );
    const before = summaryStorage.version();
    const running = tickCrossChatSummary(boot);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(summaryLifetime().running).toBe(true);
    expect(readCrossChatSummary()).toMatchObject({ frontier: 0, pending: 4 });
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(readCrossChatSummary()).toMatchObject({
      frontier: 0,
      pending: 4,
      reason: "summary_interrupted",
      attemptsToday: 1,
    });
    expect(summaryStorage.read().text).toBe("Prior saved text");
    expect(summaryStorage.version()).toEqual(before);
    expect(summaryLifetime().running).toBe(false);
    release(valid("", prompt));
    await Promise.resolve();
    await tickCrossChatSummary(boot);
    expect(summaryStorage.read().text).toBe("Prior saved text");
    expect(readCrossChatSummary()).toMatchObject({
      frontier: 0,
      pending: 4,
      attemptsToday: 1,
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
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
