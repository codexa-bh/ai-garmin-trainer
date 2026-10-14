// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiniLineChart } from "../src/app/dashboard/activity-charts";

const points = [0, 60, 120].map((elapsedSec, index) => ({
  elapsedSec,
  heartRate: [100, 140, 120][index]!,
  altitudeMeters: [0, 20, 10][index]!,
  speedKmh: [0, 12, 6][index]!,
  gradePct: null,
}));
let width = 1440;
let height = 130;
let notifyResize: () => void;
const observe = vi.fn();
const disconnect = vi.fn();

function chart(
  valueKey: "heartRate" | "altitudeMeters" | "speedKmh" = "heartRate",
  data = points,
) {
  return (
    <MiniLineChart
      title="Metric"
      unit="units"
      valueKey={valueKey}
      points={data}
      domainStartSec={0}
      domainEndSec={120}
      averageValue={120}
    />
  );
}
function svg() {
  return screen.getByRole("img", { name: "Metric over elapsed time" });
}
function marker() {
  return svg().querySelector(".activity-chart-cursor ellipse")!;
}
function expectFixedCircle() {
  const ellipse = marker();
  expect(ellipse).toBeTruthy();
  expect((Number(ellipse.getAttribute("rx")) * 2 * width) / 320).toBeCloseTo(8);
  expect((Number(ellipse.getAttribute("ry")) * 2 * height) / 120).toBeCloseTo(
    8,
  );
  expect(ellipse.getAttribute("vector-effect")).toBe("non-scaling-stroke");
}

beforeEach(() => {
  width = 1440;
  height = 130;
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      width,
      height,
      right: 100 + width,
      bottom: height,
      toJSON: () => ({}),
    }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Activity chart CSS-pixel cursor geometry", () => {
  it.each(["heartRate", "altitudeMeters", "speedKmh"] as const)(
    "keeps %s circular and constant-size with keyboard-first selection and active resize",
    (key) => {
      render(chart(key));
      fireEvent.focus(svg());
      expectFixedCircle();
      expect(marker().getAttribute("cx")).toBe("8");
      fireEvent.keyDown(svg(), { key: "ArrowRight" });
      expect(marker().getAttribute("cx")).toBe("161");
      const originalPoints = svg()
        .querySelector("polyline")!
        .getAttribute("points");
      for (const [nextWidth, nextHeight] of [
        [640, 130],
        [280, 130],
        [900, 240],
        [1440, 130],
      ]) {
        width = nextWidth!;
        height = nextHeight!;
        act(() => notifyResize());
        expectFixedCircle();
        expect(marker().getAttribute("cx")).toBe("161");
        expect(
          svg()
            .querySelector(".activity-chart-cursor line")!
            .getAttribute("x1"),
        ).toBe("161");
        expect(svg().querySelector("polyline")!.getAttribute("points")).toBe(
          originalPoints,
        );
        expect(svg().getAttribute("preserveAspectRatio")).toBe("none");
      }
      fireEvent.keyDown(svg(), { key: "ArrowRight" });
      expect(marker().getAttribute("cx")).toBe("314");
      fireEvent.blur(svg());
      expect(marker()).toBeNull();
    },
  );

  it("preserves pointer mapping, sample center, readout and endpoint clamping", () => {
    render(chart());
    for (const [clientX, cx, cy, readout] of [
      [99, "8", "104", "0m elapsed · 100 units · Avg 120 units"],
      [820, "161", "8", "1m elapsed · 140 units · Avg 120 units"],
      [1600, "314", "56", "2m elapsed · 120 units · Avg 120 units"],
    ] as const) {
      fireEvent.pointerMove(svg(), { clientX });
      expectFixedCircle();
      expect(marker().getAttribute("cx")).toBe(cx);
      expect(marker().getAttribute("cy")).toBe(cy);
      expect(screen.getByText(readout)).toBeTruthy();
    }
    fireEvent.pointerLeave(svg());
    expect(marker()).toBeNull();
  });

  it("hides only the marker for invalid geometry and restores the selected sample when measurable", () => {
    width = 0;
    const view = render(chart());
    fireEvent.focus(svg());
    fireEvent.keyDown(svg(), { key: "ArrowRight" });
    for (const [nextWidth, nextHeight] of [
      [0, 130],
      [640, 0],
      [NaN, 130],
      [640, Infinity],
      [-1, 130],
      [Number.MIN_VALUE, 130],
    ]) {
      width = nextWidth!;
      height = nextHeight!;
      act(() => notifyResize());
      expect(marker()).toBeNull();
      expect(
        svg().querySelector(".activity-chart-cursor line")!.getAttribute("x1"),
      ).toBe("161");
      expect(
        screen.getByText("1m elapsed · 140 units · Avg 120 units"),
      ).toBeTruthy();
    }
    width = 640;
    height = 130;
    act(() => notifyResize());
    expectFixedCircle();
    expect(marker().getAttribute("cx")).toBe("161");
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects on insufficient data and re-observes after returning to a chart", () => {
    const view = render(chart());
    expect(observe).toHaveBeenCalledTimes(1);
    view.rerender(chart("heartRate", []));
    expect(screen.getByText("Not enough chartable data.")).toBeTruthy();
    expect(disconnect).toHaveBeenCalledTimes(1);
    view.rerender(chart("heartRate", points.slice(0, 1)));
    expect(screen.queryByRole("img")).toBeNull();
    view.rerender(chart());
    expect(observe).toHaveBeenCalledTimes(2);
    fireEvent.focus(svg());
    expectFixedCircle();
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("uses and releases a window resize fallback when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(chart());
    fireEvent.focus(svg());
    width = 280;
    fireEvent(window, new Event("resize"));
    expectFixedCircle();
    view.unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
