/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TrainingPlanView } from "../src/app/dashboard/training-plan-view";

afterEach(cleanup);

it.each([
  [false, "2026-09-29T00:00:00Z", null],
  [true, "2026-08-01T00:00:00Z", "More than 60 days since revision"],
  [true, "invalid", "Revision date unavailable"],
])(
  "renders advisory review wording without editing (review=%s, date=%s)",
  (stale, revisedAt, banner) => {
    const save = vi.fn(async () => {});
    const edit = vi.fn();
    const { container } = render(
      <TrainingPlanView
        trainingPlan={{
          title: "General template",
          contentMarkdown: "Tuesday strength; Thursday hike",
          revisedAt,
        }}
        closeTrainingPlan={vi.fn()}
        trainingPlanCloseRef={createRef()}
        trainingPlanMessage="Loaded"
        trainingPlanStale={stale}
        trainingPlanStaleAfterDays={60}
        runInBackground={vi.fn()}
        loadTrainingPlan={vi.fn(async () => {})}
        trainingPlanState="loaded"
        trainingPlanSaving={false}
        trainingPlanEditing={false}
        startTrainingPlanEdit={edit}
        saveTrainingPlan={save}
        trainingPlanTitleDraft=""
        setTrainingPlanTitleDraft={vi.fn()}
        trainingPlanMarkdownDraft=""
        setTrainingPlanMarkdownDraft={vi.fn()}
        cancelTrainingPlanEdit={vi.fn()}
      />,
    );
    const review = container.querySelector(".training-plan-stale");
    if (banner) {
      expect(review?.textContent).toContain(banner);
      expect(review?.textContent).toContain(
        "remains usable; changes are optional",
      );
    } else expect(review).toBeNull();
    expect(screen.getByText("Tuesday strength; Thursday hike")).toBeTruthy();
    expect(container.textContent).not.toMatch(
      /stale|expired|invalid|older than/,
    );
    if (revisedAt === "invalid")
      expect(container.textContent).not.toContain("60 days");
    expect(save).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  },
);
