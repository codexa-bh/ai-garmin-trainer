// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HealthRollupChart } from "../src/app/health-rollup-chart";

const periods = (values: Array<number | null>) =>
  values.map((value, index) => ({
    key: `2026-${String(index + 1).padStart(2, "0")}`,
    label: `Period ${index + 1}`,
    value,
  }));
const metric = (point: { value: number | null }) => point.value;

function chart(values: Array<number | null>, kind: "bar" | "line" = "bar") {
  return (
    <HealthRollupChart
      rollups={periods(values)}
      metric={metric}
      title="Test metric"
      unit="steps"
      kind={kind}
    />
  );
}

afterEach(cleanup);

describe("Health rollup presentation", () => {
  it("distinguishes zero, missing, non-finite and large values without inventing data", () => {
    render(chart([0, null, NaN, Infinity, 1234567]));
    const values = screen.getByLabelText("Test metric period values");
    expect(within(values).getAllByRole("button")).toHaveLength(5);
    expect(
      within(values).getByRole("button", { name: "Period 1: 0 steps" }).dataset
        .chartState,
    ).toBe("available");
    for (const index of [2, 3, 4]) {
      const unavailable = within(values).getByRole("button", {
        name: `Period ${index}: unavailable`,
      });
      expect(unavailable.dataset.chartState).toBe("unavailable");
      fireEvent.focus(unavailable);
      expect(screen.getByText(`Period ${index}: Unavailable`)).toBeTruthy();
    }
    expect(
      within(values).getByRole("button", { name: "Period 5: 1,234,567 steps" }),
    ).toBeTruthy();
  });

  it("keeps every unavailable period accessible even in an empty chart", () => {
    render(chart([null, null], "line"));
    expect(screen.getByText("Unavailable for these periods.")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(document.querySelector(".health-rollup-plot")).toBeNull();
  });

  it("renders a single real zero and an all-zero series as available", () => {
    const { rerender } = render(chart([0]));
    expect(document.querySelector(".health-rollup-plot")).toBeTruthy();
    rerender(chart([0, 0, 0]));
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(
      document.querySelectorAll('[data-chart-state="unavailable"]'),
    ).toHaveLength(0);
  });

  it("uses the same duration formatter for fractional values and keyboard/touch readouts", () => {
    render(
      <HealthRollupChart
        rollups={periods([417.4])}
        metric={metric}
        title="Sleep"
        unit="min"
        kind="line"
        formatValue={() => "6 h 57 m/day"}
      />,
    );
    const value = screen.getByRole("button", {
      name: "Period 1: 6 h 57 m/day",
    });
    fireEvent.click(value);
    expect(screen.getByText("Period 1: 6 h 57 m/day")).toBeTruthy();
    fireEvent.focus(value);
    expect(
      document.getElementById(value.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Period 1: 6 h 57 m/day");
  });

  it("keeps seven raw Daily dates, isolated zero points and line gaps without rollup wording", () => {
    const values = [1, 2, null, 3, 4, null, 0];
    const dates = values.map((value, index) => ({
      key: `2026-03-${String(index + 1).padStart(2, "0")}`,
      label: `March ${index + 1}, 2026`,
      value,
    }));
    render(
      <HealthRollupChart
        rollups={dates}
        metric={metric}
        title="Raw"
        unit="ms"
        kind="line"
        presentation="daily"
      />,
    );
    const card = screen.getByRole("group", { name: "Raw daily chart" });
    expect(screen.queryByText(/Period average|Period total|\/day/)).toBeNull();
    expect(screen.getByText("Daily source values · ms")).toBeTruthy();
    const buttons = within(
      screen.getByLabelText("Raw daily values"),
    ).getAllByRole("button");
    expect(buttons.map((button) => button.dataset.sourceDate)).toEqual(
      dates.map((date) => date.key),
    );
    expect(card.querySelectorAll(".recharts-line-dot")).toHaveLength(5);
    const curve = card.querySelector(".recharts-line-curve")?.getAttribute("d");
    expect(curve?.match(/M/g)).toHaveLength(3);
    for (const index of [2, 5])
      expect(buttons[index].dataset.chartState).toBe("unavailable");
    fireEvent.focus(buttons[6]);
    expect(card.querySelector(".health-rollup-readout")?.textContent).toBe(
      "March 7, 2026: 0 ms",
    );
  });

  it("keeps categorical Daily context accessible without treating it as a numeric value", () => {
    render(
      <HealthRollupChart
        rollups={[{ key: "2026-03-01", label: "March 1, 2026", value: null }]}
        metric={metric}
        title="HRV"
        unit="ms"
        presentation="daily"
        pointDetail={() => "Low"}
        emptyMessage="No recorded values for these dates."
      />,
    );
    expect(
      screen.getByRole("button", { name: "March 1, 2026: unavailable · low" })
        .dataset.chartState,
    ).toBe("unavailable");
    expect(document.querySelector(".health-rollup-plot")).toBeNull();
  });

  it("drops stale selections on paging and recalculates selected values after refresh", () => {
    const { rerender } = render(chart([10, 20]));
    fireEvent.focus(screen.getByRole("button", { name: "Period 1: 10 steps" }));
    rerender(chart([15, 20]));
    expect(screen.getByText("Period 1: 15 steps")).toBeTruthy();
    rerender(
      <HealthRollupChart
        rollups={[{ key: "2025-12", label: "Older period", value: 30 }]}
        metric={metric}
        title="Test metric"
        unit="steps"
      />,
    );
    expect(screen.getByText("Older period: 30 steps")).toBeTruthy();
    expect(screen.queryByText("Period 1: 15 steps")).toBeNull();
  });
});
