// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  SleepStagesChart,
  type SleepStagePoint,
} from "../src/app/sleep-stages-chart";

type Row = [
  rem: number | null,
  deep: number | null,
  light: number | null,
  recorded: number | null,
];
const points = (rows: Row[]): SleepStagePoint[] =>
  rows.map(([rem, deep, light, recordedDuration], index) => ({
    key: `2026-03-${String(index + 1).padStart(2, "0")}`,
    label: `March ${index + 1}, 2026`,
    rem,
    deep,
    light,
    recordedDuration,
  }));
const minutes = (value: number) => `${value} min`;
const renderChart = (rows: Row[], presentation: "daily" | "rollup" = "daily") =>
  render(
    <SleepStagesChart
      points={points(rows)}
      presentation={presentation}
      formatDuration={minutes}
    />,
  );
afterEach(cleanup);

it("stacks exactly REM, Deep, Light bottom to top, never recorded duration", () => {
  const { container } = renderChart([[60, 120, 240, 450]]);
  const series = container.querySelectorAll(".recharts-bar");
  expect(series).toHaveLength(3);
  const rect = (index: number) =>
    series[index].querySelector(".recharts-bar-rectangle path")!;
  const [rem, deep, light] = [rect(0), rect(1), rect(2)];
  const y = (node: Element) => Number(node.getAttribute("y"));
  const h = (node: Element) => Number(node.getAttribute("height"));
  expect(y(deep) + h(deep)).toBeCloseTo(y(rem));
  expect(y(light) + h(light)).toBeCloseTo(y(deep));
  expect(h(deep) / h(rem)).toBeCloseTo(2);
  expect(h(light) / h(rem)).toBeCloseTo(4);
  expect(
    new Set([rem, deep, light].map((n) => n.getAttribute("fill"))).size,
  ).toBe(3);
  expect(screen.getByLabelText("Sleep stages, top to bottom").textContent).toBe(
    "LightDeepREM",
  );
  const readout = container.querySelector(".health-rollup-readout")!;
  expect(readout.textContent).toContain("Recorded duration450 min");
  expect(readout.textContent).toContain("Stage sum 420 min; differs");
  expect(container.textContent).not.toMatch(/Awake|Nap/);
});

it("keeps zero, incomplete and nonfinite values honest and selectable by pointer, focus and click", () => {
  const { container } = renderChart([
    [0, 0, 0, 0],
    [60, null, 240, 450],
    [null, null, null, 480],
    [60, 100, 200, null],
    [NaN, 100, 200, Infinity],
    [null, null, null, null],
  ]);
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.dataset.chartState)).toEqual([
    "available",
    "unavailable",
    "unavailable",
    "available",
    "unavailable",
    "unavailable",
  ]);
  const readout = container.querySelector(".health-rollup-readout")!;
  for (const event of [
    fireEvent.pointerEnter,
    fireEvent.focus,
    fireEvent.click,
  ]) {
    event(buttons[1]);
    expect(readout.textContent).toContain("REM60 min");
    expect(readout.textContent).toContain("DeepUnavailable");
    expect(readout.textContent).toContain("Recorded duration450 min");
    expect(readout.textContent).toContain("Stage breakdown incomplete");
  }
  fireEvent.click(buttons[0]);
  expect(readout.textContent).toContain("Light0 minDeep0 minREM0 min");
  expect(readout.textContent).not.toContain("differs");
  fireEvent.click(buttons[3]);
  expect(readout.textContent).toContain("Recorded durationUnavailable");
  expect(container.textContent).not.toMatch(/NaN|Infinity/);
  expect(
    buttons.every(
      (button) => button.getAttribute("aria-describedby") === readout.id,
    ),
  ).toBe(true);
});

it("keeps recorded duration when no stack is available and says so when everything is missing", () => {
  const first = renderChart([[null, null, null, 450]]);
  expect(first.container.querySelector(".health-rollup-plot")).toBeNull();
  expect(screen.getByText(/No complete stage breakdowns/)).toBeTruthy();
  expect(
    first.container.querySelector(".health-rollup-readout")?.textContent,
  ).toContain("Recorded duration450 min");
  cleanup();
  const stagesOnly = renderChart([[60, 120, 240, null]]);
  expect(stagesOnly.container.querySelector(".recharts-bar")).toBeTruthy();
  cleanup();
  const empty = renderChart([[null, null, null, null]], "rollup");
  expect(empty.container.querySelector(".empty-state")).toBeTruthy();
  expect(
    screen.getByText(/sleep-stage durations are unavailable/),
  ).toBeTruthy();
  expect(empty.container.querySelector(".health-sleep-legend")).toBeNull();
});

it("describes rollups as per-stage averages and follows a refreshed point set", () => {
  const { container, rerender } = renderChart(
    [
      [60, 120, 240, 450],
      [61, 121, 241, 451],
    ],
    "rollup",
  );
  expect(
    screen.getByText(/each stage averaged over its available days/),
  ).toBeTruthy();
  expect(container.textContent).not.toMatch(/Period total/);
  fireEvent.click(screen.getAllByRole("button")[0]);
  rerender(
    <SleepStagesChart
      points={points([[10, 20, 30, 70]]).map((point) => ({
        ...point,
        key: "other",
        label: "Other period",
      }))}
      presentation="rollup"
      formatDuration={minutes}
    />,
  );
  const readout = container.querySelector(".health-rollup-readout")!;
  expect(readout.textContent).toContain("Other period");
  expect(readout.textContent).not.toContain("March");
});
