// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DailyCaloriesChart } from "../src/app/daily-calories-chart";

const days = (values: Array<[number | null, number | null, number | null]>) =>
  values.map(([resting, active, recordedTotal], index) => ({
    key: `2026-03-${String(index + 1).padStart(2, "0")}`,
    label: `March ${index + 1}, 2026`,
    resting,
    active,
    recordedTotal,
  }));
afterEach(cleanup);

it("draws exactly two stacked series with resting below active, not recorded total", () => {
  const { container } = render(
    <DailyCaloriesChart
      days={days([
        [1200, 300, 1550],
        [0, 0, 0],
      ])}
    />,
  );
  const series = container.querySelectorAll(".recharts-bar");
  expect(series).toHaveLength(2);
  const resting = series[0].querySelector(".recharts-bar-rectangle path")!;
  const active = series[1].querySelector(".recharts-bar-rectangle path")!;
  expect(resting.getAttribute("fill")).toBe("#49d6c8");
  expect(active.getAttribute("fill")).toBe("#b6a3ff");
  expect(
    Number(active.getAttribute("y")) + Number(active.getAttribute("height")),
  ).toBeCloseTo(Number(resting.getAttribute("y")));
  expect(
    Number(resting.getAttribute("height")) /
      Number(active.getAttribute("height")),
  ).toBeCloseTo(4);
  expect(screen.getByLabelText("Calorie components").textContent).toBe(
    "RestingActive",
  );
  fireEvent.focus(screen.getAllByRole("button")[0]);
  const readout = container.querySelector(".health-rollup-readout")!;
  expect(readout.textContent).toContain("Recorded total1,550 kcal");
  expect(readout.textContent).toContain(
    "Component sum 1,500 kcal; differs from recorded total.",
  );
});

it("keeps zeros, incomplete, nonfinite, total-only and total-absent source values honest", () => {
  const { container } = render(
    <DailyCaloriesChart
      days={days([
        [0, 0, 0],
        [1200, null, 1550],
        [null, null, 1500],
        [1200, 300, null],
        [NaN, 300, Infinity],
        [1200, -Infinity, 1700],
        [null, null, null],
      ])}
    />,
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(7);
  expect(buttons.map((button) => button.dataset.chartState)).toEqual([
    "available",
    "unavailable",
    "unavailable",
    "available",
    "unavailable",
    "unavailable",
    "unavailable",
  ]);
  const readout = container.querySelector(".health-rollup-readout")!;
  for (const event of [
    fireEvent.focus,
    fireEvent.pointerEnter,
    fireEvent.click,
  ]) {
    event(buttons[1]);
    expect(readout.textContent).toContain(
      "Resting1,200 kcalActiveUnavailableRecorded total1,550 kcal",
    );
    expect(readout.textContent).toContain(
      "Breakdown incomplete; no stack shown.",
    );
  }
  fireEvent.click(buttons[0]);
  expect(readout.textContent).toContain(
    "Resting0 kcalActive0 kcalRecorded total0 kcal",
  );
  fireEvent.click(buttons[3]);
  expect(readout.textContent).toContain("Recorded totalUnavailable");
  expect(readout.textContent).not.toContain("differs");
  expect(container.textContent).not.toMatch(/NaN|Infinity/);
  expect(
    buttons.every(
      (button) => button.getAttribute("aria-describedby") === readout.id,
    ),
  ).toBe(true);
});

it("retains accessible empty dates, exact large fractional values and refresh/page selection", () => {
  const { container, rerender } = render(
    <DailyCaloriesChart
      days={days([
        [null, null, null],
        [null, null, 1234567.125],
      ])}
    />,
  );
  expect(container.querySelector(".health-rollup-plot")).toBeNull();
  expect(
    screen.getByText("No complete calorie breakdowns for these dates."),
  ).toBeTruthy();
  fireEvent.focus(screen.getAllByRole("button")[0]);
  rerender(
    <DailyCaloriesChart
      days={days([
        [0, 0, 1234567.125],
        [0, 0, 0],
      ])}
    />,
  );
  expect(
    container.querySelector(".health-rollup-readout")?.textContent,
  ).toContain("1,234,567.125 kcal");
  rerender(
    <DailyCaloriesChart
      days={[
        {
          ...days([[1200, 300, 1500]])[0],
          key: "2025-12-01",
          label: "Older date",
        },
      ]}
    />,
  );
  expect(
    container.querySelector(".health-rollup-readout")?.textContent,
  ).toContain("Older date");
});
