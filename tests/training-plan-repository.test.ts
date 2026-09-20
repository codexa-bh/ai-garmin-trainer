import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshRepository() {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "training-plan-repo-")),
    "trainer.sqlite",
  );
  return import("../src/lib/db/training-plan-repository");
}

describe("training plan repository", () => {
  beforeEach(() => {
    delete process.env.DATABASE_PATH;
  });

  it("supports no-plan read, save/read, and stale/current status", async () => {
    const repository = await freshRepository();

    expect(repository.getTrainingPlan()).toBeNull();
    expect(
      repository.trainingPlanStatus(new Date("2026-08-12T00:00:00Z").getTime()),
    ).toMatchObject({
      plan: null,
      stale: true,
      staleAfterDays: 14,
    });

    const saved = repository.replaceTrainingPlan({
      title: " Summit build ",
      contentMarkdown: " # Week 1\n- Easy aerobic hike ",
      now: new Date("2026-08-01T09:00:00Z"),
    });

    expect(saved).toEqual({
      title: "Summit build",
      contentMarkdown: "# Week 1\n- Easy aerobic hike",
      revisedAt: "2026-08-01T09:00:00.000Z",
    });
    expect(repository.getTrainingPlan()).toEqual(saved);
    expect(
      repository.trainingPlanStatus(new Date("2026-08-15T09:00:00Z").getTime())
        .stale,
    ).toBe(false);
    expect(
      repository.trainingPlanStatus(new Date("2026-08-15T09:00:01Z").getTime())
        .stale,
    ).toBe(true);
  });

  it("rejects empty and oversized replacement content", async () => {
    const repository = await freshRepository();

    expect(() =>
      repository.replaceTrainingPlan({ contentMarkdown: "   " }),
    ).toThrow("training_plan_content_required");
    expect(() =>
      repository.replaceTrainingPlan({ contentMarkdown: "x".repeat(32001) }),
    ).toThrow("training_plan_content_too_large");
  });
});
