import { beforeEach, describe, expect, it, vi } from "vitest";

const statusPayload = {
  plan: null,
  stale: true,
  staleAfterDays: 14,
};
const trainingPlanStatus = vi.fn(() => statusPayload);
const replaceTrainingPlan = vi.fn(
  (input: { title?: string; contentMarkdown: string }) => ({
    title: input.title?.trim() || "Training Plan",
    contentMarkdown: input.contentMarkdown.trim(),
    revisedAt: "2026-08-12T12:00:00.000Z",
  }),
);

vi.mock("@/lib/db/repository", () => ({
  TRAINING_PLAN_CONTENT_MAX_LENGTH: 32000,
  TRAINING_PLAN_TITLE_MAX_LENGTH: 120,
  trainingPlanStatus,
  replaceTrainingPlan,
}));

describe("training plan route", () => {
  beforeEach(() => {
    trainingPlanStatus.mockClear();
    replaceTrainingPlan.mockClear();
    vi.resetModules();
  });

  it("returns the current no-plan status", async () => {
    const { GET } = await import("../src/app/api/training-plan/route");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(statusPayload);
    expect(trainingPlanStatus).toHaveBeenCalledOnce();
  });

  it("saves bounded Markdown content", async () => {
    const { PUT } = await import("../src/app/api/training-plan/route");

    const response = await PUT(
      new Request("http://localhost/api/training-plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: " Alpine base ",
          contentMarkdown: " # Week 1\n- Easy hike ",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(replaceTrainingPlan).toHaveBeenCalledWith({
      title: "Alpine base",
      contentMarkdown: "# Week 1\n- Easy hike",
    });
    expect(payload.plan.title).toBe("Alpine base");
  });

  it("rejects empty and oversized content with bounded errors", async () => {
    const { PUT } = await import("../src/app/api/training-plan/route");

    const empty = await PUT(
      new Request("http://localhost/api/training-plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentMarkdown: "   " }),
      }),
    );
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/cannot be empty/i);

    const oversized = await PUT(
      new Request("http://localhost/api/training-plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentMarkdown: "x".repeat(32001) }),
      }),
    );
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error).toMatch(/exceeds 32000/);
  });
});
