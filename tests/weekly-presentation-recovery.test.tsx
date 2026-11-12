// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TrainingPlanView } from "../src/app/dashboard/training-plan-view";
import { useTrainingPlanFeature } from "../src/app/dashboard/use-training-plan";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("recovers General Plan read/save failures without routine Reload or lost editor drafts", async () => {
  const saved = (title: string) =>
    Response.json({
      plan: {
        title,
        contentMarkdown: `${title} body`,
        revisedAt: "2026-11-12T12:00:00Z",
      },
      stale: false,
      staleAfterDays: 60,
    });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 500 }))
    .mockResolvedValueOnce(saved("First"))
    .mockResolvedValueOnce(Response.json({}, { status: 500 }))
    .mockResolvedValueOnce(saved("Fresh"));
  vi.stubGlobal("fetch", fetch);
  function View() {
    const plan = useTrainingPlanFeature({ setStatus: () => {} });
    const run = (work: Promise<unknown>) => {
      work.catch(() => {
        throw new Error("Unexpected General Plan action failure");
      });
    };
    return (
      <>
        <button onClick={() => run(plan.loadTrainingPlan("manual"))}>
          Read General Plan
        </button>
        <TrainingPlanView
          {...plan}
          closeTrainingPlan={() => {}}
          trainingPlanCloseRef={createRef()}
          runInBackground={run}
        />
      </>
    );
  }
  render(<View />);
  expect(screen.queryByRole("button", { name: /Retry|Reload/ })).toBeNull();
  fireEvent.click(screen.getByText("Read General Plan"));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByText("First body");
  expect(screen.queryByRole("button", { name: /Retry|Reload/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Draft title" },
  });
  fireEvent.change(screen.getByLabelText("Markdown plan"), {
    target: { value: "Keep my draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Fresh" });
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Draft title");
  expect(screen.getByLabelText("Markdown plan")).toHaveProperty(
    "value",
    "Keep my draft",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByText("Fresh body");
  expect(fetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
    "GET",
    "GET",
    "PUT",
    "GET",
  ]);
  expect(screen.queryByRole("button", { name: /Retry|Reload/ })).toBeNull();
});
