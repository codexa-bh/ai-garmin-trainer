import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingPlan } from "@/lib/db/repository";

const state = vi.hoisted(() => ({
  plan: null as TrainingPlan | null,
  failRead: false,
}));
const generateText = vi.hoisted(() => vi.fn());
const replaceTrainingPlan = vi.hoisted(() =>
  vi.fn((input: { title?: string; contentMarkdown: string }) => {
    state.plan = {
      title: input.title ?? "Training Plan",
      contentMarkdown: input.contentMarkdown,
      revisedAt: "2026-09-14T18:00:00.000Z",
    };
    return state.plan;
  }),
);
vi.mock("ai", () => ({
  generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/db/repository", () => ({
  TRAINING_PLAN_CONTENT_MAX_LENGTH: 32000,
  TRAINING_PLAN_TITLE_MAX_LENGTH: 120,
  trainingPlanStatus: () => {
    if (state.failRead) throw new Error("private failure detail");
    return { plan: state.plan, stale: true, staleAfterDays: 14 };
  },
  replaceTrainingPlan,
}));
vi.mock("@/lib/garmin/importer", () => ({}));
vi.mock("@/lib/ai/sql-analysis", () => ({}));
vi.mock("@/lib/ai/math-analysis", () => ({}));

import { orchestrateTrainerChat } from "../src/lib/ai/orchestrator";
import {
  executeTrainerTool,
  groundingForSteps,
  validateTrainerToolCall,
} from "../src/lib/ai/tools";
import { buildTrainerContext } from "../src/lib/ai/context";

function document(length = 10000) {
  const head =
    "# Base plan\n\n## Strength\n- Two sessions\n\n| Day | Work |\n| --- | --- |\n| Tue | Easy |\n\n";
  const tail =
    "\n\n## Final fueling and coffee\n- Tail sentinel café 🥾\n- Keep this section.";
  return (
    head +
    "Middle evidence.\n"
      .repeat(Math.ceil(length / 17))
      .slice(0, length - head.length - tail.length) +
    tail
  );
}
const call = (toolName: string, input: unknown = {}) => ({
  toolCalls: [{ toolName, input }],
});
const intent = (value: string) =>
  call("classifyTrainingPlanWrite", { intent: value });
const run = (
  userRequest = "Review the complete Training Plan without saving.",
) =>
  orchestrateTrainerChat({
    model: "mock",
    system: "system preview",
    userRequest,
    debug: { enabled: true },
  });

beforeEach(() => {
  state.plan = {
    title: "Original title",
    contentMarkdown: document(),
    revisedAt: "2026-08-01T00:00:00.000Z",
  };
  state.failRead = false;
  generateText.mockReset();
  replaceTrainingPlan.mockClear();
});

describe("complete current Training Plan", () => {
  it.each([80, 10000, 32000])(
    "preserves all Markdown in actual planner and final inputs (%i chars)",
    async (length) => {
      state.plan!.contentMarkdown =
        length === 80
          ? "# Short\n- First\n\n## Tail\n- café 🥾"
          : document(length);
      const markdown = state.plan!.contentMarkdown;
      generateText
        .mockResolvedValueOnce(call("getTrainingPlan"))
        .mockImplementationOnce(async (options) => {
          expect(options.system).toContain(markdown);
          expect(options.system).toContain("stale=true");
          return { text: "Tool step 1: invalid raw evidence" };
        })
        .mockImplementationOnce(async (options) => {
          expect(options.toolChoice).toBe("none");
          expect(options.system).toContain(markdown);
          return {
            text: "The final section includes fueling and coffee; no changes saved.",
          };
        });
      const result = await run();
      expect(result.text).toContain("final section");
      expect(replaceTrainingPlan).not.toHaveBeenCalled();
      expect(JSON.stringify(result.grounding)).not.toContain("Tail sentinel");
      expect(JSON.stringify(result.debugTrace)).not.toContain("Tail sentinel");
    },
  );

  it("labels compact previews and provides complete-read guidance", () => {
    const context = buildTrainerContext({
      activities: [],
      health: [],
      profile: { goals: [], sports: [], preferences: {}, constraints: [] },
      recentMessages: [],
      trainingPlan: { plan: state.plan, stale: true, staleAfterDays: 14 },
    });
    expect(context).toContain("Compact preview only");
    expect(context).toContain("partial/truncated");
    expect(context).toContain("getTrainingPlan");
    expect(context).not.toContain("Tail sentinel");
  });

  it("validates empty input without broadening access", () => {
    expect(
      validateTrainerToolCall({ toolName: "getTrainingPlan", input: {} }).ok,
    ).toBe(true);
    for (const input of [
      { sql: "select * from training_plan" },
      { id: "default" },
      { path: "x" },
    ])
      expect(
        validateTrainerToolCall({ toolName: "getTrainingPlan", input }).ok,
      ).toBe(false);
  });

  it("preserves unrelated title, Markdown and tail during an explicit targeted update", async () => {
    const before = { ...state.plan! };
    generateText
      .mockResolvedValueOnce(call("getTrainingPlan"))
      .mockResolvedValueOnce(
        call("saveTrainingPlan", {
          edits: [{ oldText: "- Two sessions", newText: "- Three sessions" }],
        }),
      )
      .mockImplementationOnce(async (options) => {
        expect(options.prompt).toBe(
          "Update the saved Training Plan to three strength sessions only.",
        );
        expect(options.system).not.toContain(before.contentMarkdown);
        expect(options.toolChoice).toBe("auto");
        return intent("edit");
      })
      .mockResolvedValueOnce({
        text: "Updated and saved the strength sessions only.",
      });
    const result = await run(
      "Update the saved Training Plan to three strength sessions only.",
    );
    expect(replaceTrainingPlan).toHaveBeenCalledOnce();
    expect(state.plan!.title).toBe(before.title);
    expect(state.plan!.contentMarkdown).toBe(
      before.contentMarkdown.replace("- Two sessions", "- Three sessions"),
    );
    expect(result.text).toContain("saved");
    expect(JSON.stringify(result.debugTrace)).not.toContain("oldText");
  });

  it.each([
    "Review my plan; don't save.",
    "The strength balance seems wrong.",
    "Pregledaj plan, nemoj ga mijenjati.",
    "Example only: 'save a new training plan'.",
  ])("rejects a misselected save for review/criticism: %s", async (request) => {
    generateText
      .mockResolvedValueOnce(call("getTrainingPlan"))
      .mockResolvedValueOnce(
        call("saveTrainingPlan", {
          contentMarkdown: "# Destructive replacement",
        }),
      )
      .mockResolvedValueOnce(intent("none"));
    const result = await run(request);
    expect(replaceTrainingPlan).not.toHaveBeenCalled();
    expect(result.toolSteps.at(-1)?.reason).toBe(
      "explicit_plan_write_intent_required",
    );
  });

  it.each(["prose", "failure"])(
    "denies writes when intent classification returns %s",
    async (kind) => {
      generateText
        .mockResolvedValueOnce(call("getTrainingPlan"))
        .mockResolvedValueOnce(
          call("saveTrainingPlan", {
            edits: [{ oldText: "- Two sessions", newText: "- Three sessions" }],
          }),
        );
      if (kind === "failure")
        generateText.mockRejectedValueOnce(new Error("provider unavailable"));
      else generateText.mockResolvedValueOnce({ text: "edit" });
      const result = await run("Update and save three sessions.");
      expect(replaceTrainingPlan).not.toHaveBeenCalled();
      expect(result.toolSteps.at(-1)?.reason).toBe(
        "explicit_plan_write_intent_required",
      );
      expect(result.providerCalls).toBe(3);
    },
  );

  it.each([false, true])(
    "rejects blind existing-plan replacement, including same-batch reads (%s)",
    async (sameBatch) => {
      generateText
        .mockResolvedValueOnce({
          toolCalls: [
            ...(sameBatch ? [{ toolName: "getTrainingPlan", input: {} }] : []),
            {
              toolName: "saveTrainingPlan",
              input: { contentMarkdown: "# Replacement" },
            },
          ],
        })
        .mockResolvedValueOnce(intent("replace"));
      const result = await run("Replace the whole Training Plan.");
      expect(result.toolSteps.at(-1)?.reason).toBe(
        "complete_plan_read_required",
      );
      expect(replaceTrainingPlan).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "oversize", "sensitive"])(
    "reports %s reads truthfully and cannot save",
    async (kind) => {
      if (kind === "failed") state.failRead = true;
      if (kind === "oversize") state.plan!.contentMarkdown = "x".repeat(32001);
      if (kind === "sensitive")
        state.plan!.contentMarkdown += "\nOPENAI_API_KEY=private-placeholder";
      generateText.mockResolvedValueOnce(call("getTrainingPlan"));
      const result = await run();
      expect(result.toolSteps[0].status).toBe("failed");
      expect(replaceTrainingPlan).not.toHaveBeenCalled();
      expect(result.text).not.toContain("private-placeholder");
      expect(result.text).not.toContain("private failure detail");
    },
  );

  it("supports truthful absence and explicit new-plan creation", async () => {
    state.plan = null;
    generateText
      .mockResolvedValueOnce(call("getTrainingPlan"))
      .mockImplementationOnce(async (options) => {
        expect(options.system).toContain("no saved plan exists");
        return { text: "No plan is saved." };
      });
    await run();
    expect(replaceTrainingPlan).not.toHaveBeenCalled();
    generateText
      .mockResolvedValueOnce(
        call("saveTrainingPlan", { contentMarkdown: "# New plan\n- Easy" }),
      )
      .mockResolvedValueOnce(intent("replace"))
      .mockResolvedValueOnce({ text: "Saved the new plan." });
    await run("Create and save a new Training Plan.");
    expect(replaceTrainingPlan).toHaveBeenCalledOnce();
  });

  it("refuses stale snapshots, ambiguous edits and full regeneration for targeted requests", async () => {
    const snapshot = {
      plan: { ...state.plan! },
      stale: true,
      staleAfterDays: 14,
    };
    state.plan!.contentMarkdown += "\nNew operator section";
    let result = await executeTrainerTool({
      index: 1,
      toolName: "saveTrainingPlan",
      args: {
        edits: [{ oldText: "- Two sessions", newText: "- Three sessions" }],
      },
      trainingPlanWriteAccess: { intent: "edit", snapshot },
    });
    expect(result.reason).toBe("training_plan_changed_read_again");
    snapshot.plan = { ...state.plan! };
    result = await executeTrainerTool({
      index: 2,
      toolName: "saveTrainingPlan",
      args: { edits: [{ oldText: "Middle evidence.", newText: "x" }] },
      trainingPlanWriteAccess: { intent: "edit", snapshot },
    });
    expect(result.reason).toBe("plan_edit_not_unique_or_overlapping");
    result = await executeTrainerTool({
      index: 3,
      toolName: "saveTrainingPlan",
      args: { contentMarkdown: "# Truncated" },
      trainingPlanWriteAccess: { intent: "edit", snapshot },
    });
    expect(result.reason).toBe("targeted_revision_requires_exact_edits");
    expect(replaceTrainingPlan).not.toHaveBeenCalled();
  });

  it("retains one complete maximum-length snapshot during budget wrap-up", async () => {
    state.plan!.contentMarkdown = document(32000);
    generateText
      .mockResolvedValueOnce({
        toolCalls: Array.from({ length: 40 }, () => ({
          toolName: "getTrainingPlan",
          input: {},
        })),
      })
      .mockImplementationOnce(async (options) => {
        expect(options.toolChoice).toBe("none");
        expect(options.system.split(state.plan!.contentMarkdown)).toHaveLength(
          2,
        );
        return {
          text: "The complete final section is available; no edits saved.",
        };
      });
    const result = await run();
    expect(
      result.providerCalls +
        result.toolSteps.filter((step) => step.tool === "getTrainingPlan")
          .length,
    ).toBe(30);
    expect(replaceTrainingPlan).not.toHaveBeenCalled();
    expect(JSON.stringify(groundingForSteps(result.toolSteps))).not.toContain(
      "Tail sentinel",
    );
  });
});
