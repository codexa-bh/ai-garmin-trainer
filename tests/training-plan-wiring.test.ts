import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrainerToolExecutionContext } from "../src/lib/ai/tool-execution-context";

const previousPath = process.env.DATABASE_PATH;
beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "plan-wiring-")),
    "trainer.sqlite",
  );
});
afterEach(() => {
  if (previousPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousPath;
});
const request = (body: unknown) =>
  new Request("http://localhost/api/training-plan", {
    method: "PUT",
    body: JSON.stringify(body),
  });

it("wires manual HTTP and guarded tool operations to the same synchronous SQLite singleton", async () => {
  const route = await import("../src/app/api/training-plan/route");
  const { executeTrainingPlanTool } =
    await import("../src/lib/ai/tool-training-plan");
  const { completeTrainingPlanSchema } =
    await import("../src/lib/training-plan/snapshot");
  const { trainingPlanStatus } =
    await import("../src/lib/training-plan/composition");
  const { getDatabase } = await import("../src/lib/db/connection");
  expect(await (await route.GET()).json()).toEqual({
    plan: null,
    stale: true,
    staleAfterDays: 14,
  });
  const saved = await route.POST(
    request({
      title: "  My\nPlan ",
      markdown: "  Alpha\nBeta\nUntouched café 🥾  ",
    }),
  );
  expect(saved.status).toBe(200);
  const read = executeTrainingPlanTool({
    context: new TrainerToolExecutionContext(),
    index: 1,
    toolName: "getTrainingPlan",
    input: {},
  });
  const snapshot = completeTrainingPlanSchema.parse(read.result);
  expect(snapshot.plan).toMatchObject({
    title: "My Plan",
    contentMarkdown: "Alpha\nBeta\nUntouched café 🥾",
  });
  const result = executeTrainingPlanTool({
    context: new TrainerToolExecutionContext(),
    index: 2,
    toolName: "saveTrainingPlan",
    input: { edits: [{ oldText: "Beta", newText: "Updated" }] },
    trainingPlanSnapshot: snapshot,
  });
  expect(result).not.toBeInstanceOf(Promise);
  expect(result.status).toBe("succeeded");
  expect(Object.keys(result.result as object).sort()).toEqual([
    "contentLength",
    "revisedAt",
    "title",
  ]);
  expect(trainingPlanStatus().plan).toMatchObject({
    title: "My Plan",
    contentMarkdown: "Alpha\nUpdated\nUntouched café 🥾",
  });
  const row = getDatabase()
    .prepare(
      "select id, title, content_markdown, revised_at, updated_at from training_plan",
    )
    .get() as Record<string, unknown>;
  expect(row.id).toBe("default");
  expect(row.revised_at).toBe(row.updated_at);
  expect(row.revised_at).toBeTypeOf("number");
  expect(
    executeTrainingPlanTool({
      context: new TrainerToolExecutionContext(),
      index: 3,
      toolName: "saveTrainingPlan",
      input: { contentMarkdown: "blind" },
      trainingPlanSnapshot: snapshot,
    }),
  ).toMatchObject({
    status: "rejected",
    reason: "training_plan_changed_read_again",
  });
  expect(
    executeTrainingPlanTool({
      context: new TrainerToolExecutionContext(),
      index: 4,
      toolName: "saveTrainingPlan",
      input: { contentMarkdown: "blind" },
    }),
  ).toMatchObject({
    status: "rejected",
    reason: "complete_plan_read_required",
  });
  // Manual overwrite remains independent of tool snapshot authorization.
  expect(
    (await route.PUT(request({ content: "manual overwrite" }))).status,
  ).toBe(200);
  expect(trainingPlanStatus().plan).toMatchObject({
    title: "Training Plan",
    contentMarkdown: "manual overwrite",
  });
});

it("retains route aliases, precedence, exact error mapping and sensitive manual-save distinction", async () => {
  const route = await import("../src/app/api/training-plan/route");
  const { readCompleteTrainingPlan } =
    await import("../src/lib/training-plan/composition");
  for (const body of [
    null,
    [],
    {},
    { contentMarkdown: 42, markdown: "ignored" },
  ]) {
    const response = await route.PUT(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Training Plan contentMarkdown is required.",
    });
  }
  for (const [body, status, error] of [
    [{ contentMarkdown: " " }, 400, "Training Plan content cannot be empty."],
    [
      { contentMarkdown: "x".repeat(32001) },
      413,
      "Training Plan content exceeds 32000 characters.",
    ],
    [
      { contentMarkdown: "x", title: "x".repeat(121) },
      400,
      "Training Plan title exceeds 120 characters.",
    ],
  ] as const) {
    const response = await route.PUT(request(body));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  }
  const malformed = await route.PUT(
    new Request("http://localhost/api/training-plan", {
      method: "PUT",
      body: "{",
    }),
  );
  expect(malformed.status).toBe(500);
  expect(await malformed.json()).toEqual({
    error: "Training Plan could not be saved.",
  });
  const fallback = await route.PUT(
    request({ contentMarkdown: null, markdown: "alias", title: 17 }),
  );
  expect((await fallback.json()).plan).toMatchObject({
    title: "Training Plan",
    contentMarkdown: "alias",
  });
  const sensitive = await route.PUT(
    request({ contentMarkdown: "/Users/private/document" }),
  );
  expect(sensitive.status).toBe(200);
  expect(() => readCompleteTrainingPlan()).toThrow("private_plan_content");
});

it("maps storage failure to existing HTTP 500 while tool persistence failure propagates without retry", async () => {
  const route = await import("../src/app/api/training-plan/route");
  const { getDatabase } = await import("../src/lib/db/connection");
  const { saveGuardedTrainingPlan } =
    await import("../src/lib/training-plan/composition");
  getDatabase().exec(
    "create trigger reject_plan before insert on training_plan begin select raise(abort, 'rejected_write'); end",
  );
  const response = await route.PUT(request({ contentMarkdown: "x" }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Training Plan could not be saved.",
  });
  expect(() => saveGuardedTrainingPlan({ contentMarkdown: "x" })).toThrow(
    "rejected_write",
  );
  expect(
    getDatabase().prepare("select count(*) as n from training_plan").get(),
  ).toEqual({ n: 0 });
});
