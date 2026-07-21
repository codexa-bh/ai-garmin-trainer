import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTrainerContext } from "../src/lib/ai/context";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "trainer-memory-")),
    "test.sqlite",
  );
});

describe("confirmation-based learned memory", () => {
  it("keeps pending memory out of context until confirmation", async () => {
    const repository = await import("../src/lib/db/repository");
    const pending = repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value: "Prefers short hill intervals after long hikes.",
      sourceType: "agent_proposal",
      provenanceText: "Proposed from chat; awaiting user confirmation.",
    });
    expect(repository.listActiveTrainerMemories()).toEqual([]);
    repository.confirmTrainerMemory(pending.id);
    const active = repository.listActiveTrainerMemories();
    expect(active).toHaveLength(1);
    const context = buildTrainerContext({
      activities: [],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      learnedMemories: active,
      recentMessages: [],
    });
    expect(context).toContain("Confirmed learned memories");
    expect(context).toContain("Prefers short hill intervals");
  });

  it("lists pending/confirmed memories for review and removes rejected/forgotten memories from active use", async () => {
    const repository = await import("../src/lib/db/repository");
    const pending = repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value: "Prefers morning hikes before strength work.",
      sourceType: "chat_explicit_intent",
      provenanceText: "User explicitly asked to remember preference.",
    });
    const rejected = repository.createTrainerMemoryProposal({
      category: "learned_preference",
      value: "Wrong preference proposal.",
      sourceType: "chat_explicit_intent",
      provenanceText: "User rejected this proposal.",
    });

    expect(
      repository.listTrainerMemoriesForReview().map((item) => item.status),
    ).toEqual(["pending_confirmation", "pending_confirmation"]);

    repository.confirmTrainerMemory(pending.id);
    repository.rejectTrainerMemory(rejected.id);
    expect(
      repository.listActiveTrainerMemories().map((item) => item.id),
    ).toEqual([pending.id]);
    expect(
      repository.listTrainerMemoriesForReview().map((item) => item.id),
    ).toEqual([pending.id]);

    repository.forgetTrainerMemory(pending.id);
    expect(repository.listActiveTrainerMemories()).toEqual([]);
    expect(repository.listTrainerMemoriesForReview()).toEqual([]);
  });

  it("expires or reconfirms temporary memory before use", async () => {
    const repository = await import("../src/lib/db/repository");
    const proposal = repository.createTrainerMemoryProposal({
      category: "temporary_constraint",
      value: "Avoid downhill running until calf tightness clears.",
      sourceType: "user_confirmation",
      provenanceText: "User confirmed temporary constraint.",
      expiresAt: new Date("2026-07-01T00:00:00Z"),
    });
    repository.confirmTrainerMemory(proposal.id);
    expect(
      repository.listActiveTrainerMemories(
        8,
        Date.parse("2026-06-30T00:00:00Z"),
      ),
    ).toHaveLength(1);
    expect(
      repository.listActiveTrainerMemories(
        8,
        Date.parse("2026-07-02T00:00:00Z"),
      ),
    ).toEqual([]);
    expect(repository.getTrainerMemory(proposal.id)?.status).toBe("expired");
  });
});
