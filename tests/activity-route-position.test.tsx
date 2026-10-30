// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MiniLineChart, RouteMap } from "../src/app/dashboard/activity-charts";
import type { ActivityDashboardPayload } from "../src/app/dashboard/contracts";
import { buildActivityDashboardRoute } from "../src/lib/analytics/activity-dashboard-calculations";

const metrics = ["heartRate", "altitudeMeters", "speedKmh"] as const;
const chartPoints = [40, 41, 42, 43].map((sourceElapsedSec, i) => ({
  elapsedSec: i * 180,
  sourceElapsedSec,
  heartRate: i === 1 ? null : 100 + i,
  altitudeMeters: i === 1 ? null : 200 + i,
  speedKmh: i === 1 ? null : i,
  gradePct: null,
}));
function routePoint(elapsedSec: number) {
  return {
    elapsedSec,
    lat: 40 + elapsedSec / 10000,
    lon: 10 + elapsedSec / 10000,
    altitudeMeters: null,
    gradePct: null,
  };
}
function route(
  points = [40, 42, 44].map(routePoint),
): ActivityDashboardPayload["route"] {
  return buildActivityDashboardRoute(points);
}
function dot() {
  return document.querySelector(".route-map-chart-position");
}
function expectPoint(index: number) {
  const lines = document.querySelectorAll(".route-map-route-line line");
  const segment = lines[index === 0 ? 0 : index - 1]!;
  expect(dot()).toBeTruthy();
  expect(dot()!.getAttribute("cx")).toBe(
    segment.getAttribute(index === 0 ? "x1" : "x2"),
  );
  expect(dot()!.getAttribute("cy")).toBe(
    segment.getAttribute(index === 0 ? "y1" : "y2"),
  );
}
beforeEach(() => {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 320,
    height: 120,
    right: 320,
    bottom: 120,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("active chart source identity", () => {
  it.each(metrics)(
    "reports actual filtered %s samples, not display time or inactive readouts",
    (valueKey) => {
      const report = vi.fn();
      const props = {
        title: "Metric",
        unit: "units",
        points: chartPoints,
        valueKey,
        domainStartSec: 0,
        domainEndSec: 540,
        onActiveSample: report,
      };
      const view = render(<MiniLineChart {...props} />);
      const svg = screen.getByRole("img");
      expect(report).not.toHaveBeenCalled();
      fireEvent.focus(svg);
      expect(report).toHaveBeenLastCalledWith(valueKey, 40);
      fireEvent.keyDown(svg, { key: "ArrowRight" });
      expect(report).toHaveBeenLastCalledWith(valueKey, 42);
      fireEvent.keyDown(svg, { key: "ArrowLeft" });
      expect(report).toHaveBeenLastCalledWith(valueKey, 40);
      fireEvent.pointerMove(svg, { clientX: 212 });
      expect(report).toHaveBeenLastCalledWith(valueKey, 42);
      fireEvent.pointerMove(svg, { clientX: 999 });
      expect(report).toHaveBeenLastCalledWith(valueKey, 43);
      fireEvent.pointerLeave(svg);
      expect(report).toHaveBeenLastCalledWith(valueKey, null);
      fireEvent.focus(svg);
      fireEvent.blur(svg);
      expect(report).toHaveBeenLastCalledWith(valueKey, null);
      fireEvent.focus(svg);
      view.rerender(
        <MiniLineChart
          {...props}
          points={chartPoints.map((p) => ({ ...p }))}
        />,
      );
      expect(report).toHaveBeenLastCalledWith(valueKey, null);
      expect(svg.querySelector(".activity-chart-cursor")).toBeNull();
      fireEvent.focus(svg);
      view.rerender(<MiniLineChart {...props} points={[]} />);
      expect(report).toHaveBeenLastCalledWith(valueKey, null);
      view.rerender(<MiniLineChart {...props} />);
      fireEvent.focus(screen.getByRole("img"));
      view.unmount();
      expect(report).toHaveBeenLastCalledWith(valueKey, null);
    },
  );

  it.each([undefined, NaN, Infinity])(
    "suppresses unavailable source keys (%s) without losing chart behavior",
    (sourceElapsedSec) => {
      const report = vi.fn();
      render(
        <MiniLineChart
          title="Legacy"
          unit="bpm"
          valueKey="heartRate"
          points={chartPoints.map((p) => ({ ...p, sourceElapsedSec }))}
          domainStartSec={0}
          domainEndSec={540}
          onActiveSample={report}
        />,
      );
      fireEvent.focus(screen.getByRole("img"));
      expect(report).toHaveBeenLastCalledWith("heartRate", null);
      expect(document.querySelector(".activity-chart-cursor")).toBeTruthy();
    },
  );
});

describe("nearest retained route representative", () => {
  it.each([
    [40, 0],
    [41, 0],
    [42, 1],
    [43, 1],
    [44, 2],
  ])(
    "maps source %s to retained point %s with earlier ties",
    (source, index) => {
      render(<RouteMap route={route()} selectedSourceElapsedSec={source} />);
      expectPoint(index);
      expect(
        document.querySelectorAll(".route-map-chart-position"),
      ).toHaveLength(1);
      expect(document.querySelectorAll(".route-map-marker")).toHaveLength(2);
    },
  );

  it.each([null, NaN, Infinity, 39, 45])(
    "rejects unavailable/out-of-support selection (%s)",
    (source) => {
      render(<RouteMap route={route()} selectedSourceElapsedSec={source} />);
      expect(dot()).toBeNull();
    },
  );

  it("uses existing capped GPS representatives, not proportional chart indices", () => {
    const capped = route(Array.from({ length: 1001 }, (_, i) => routePoint(i)));
    expect(capped.points).toHaveLength(400);
    const source = 501;
    const expected = capped.points.reduce(
      (best, point, i) =>
        Math.abs(point.elapsedSec - source) <
        Math.abs(capped.points[best].elapsedSec - source)
          ? i
          : best,
      0,
    );
    render(<RouteMap route={capped} selectedSourceElapsedSec={source} />);
    expectPoint(expected);
  });

  it("retains first duplicate key and rejects invalid GPS/support", () => {
    const data = route();
    data.points = [
      routePoint(40),
      { ...routePoint(40), lat: 40.001 },
      routePoint(44),
    ];
    const view = render(
      <RouteMap route={data} selectedSourceElapsedSec={40} />,
    );
    expectPoint(0);
    for (const points of [
      [],
      [routePoint(40)],
      [routePoint(40), { ...routePoint(44), lat: NaN }],
      [routePoint(40), { ...routePoint(44), lon: 181 }],
      [routePoint(40), { ...routePoint(44), elapsedSec: Infinity }],
    ]) {
      view.rerender(
        <RouteMap route={{ ...data, points }} selectedSourceElapsedSec={40} />,
      );
      expect(dot()).toBeNull();
    }
  });

  it("tracks external/offline projection through pan/zoom/Fit without resetting on selection", () => {
    const data = route();
    const view = render(
      <RouteMap route={data} selectedSourceElapsedSec={42} />,
    );
    const svg = document.querySelector(".route-map-svg")!;
    expectPoint(1);
    fireEvent.pointerDown(svg, {
      pointerId: 7,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 120, clientY: 110 });
    fireEvent.pointerUp(svg, { pointerId: 7 });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in route map" }));
    expectPoint(1);
    view.rerender(<RouteMap route={data} selectedSourceElapsedSec={44} />);
    expect(svg.getAttribute("data-pan-x")).toBe("20");
    expect(svg.getAttribute("data-pan-y")).toBe("10");
    expect(svg.getAttribute("data-zoom-offset")).toBe("1");
    expectPoint(2);
    fireEvent.error(document.querySelector(".route-map-tiles image")!);
    expect(
      screen.getByText("OpenTopoMap tiles failed; offline route shown."),
    ).toBeTruthy();
    expectPoint(2);
    view.rerender(<RouteMap route={data} selectedSourceElapsedSec={42} />);
    expect(svg.getAttribute("data-pan-x")).toBe("20");
    expectPoint(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset route map view" }),
    );
    expectPoint(1);
    expect(svg.getAttribute("data-pan-x")).toBe("0");
    expect(svg.getAttribute("data-zoom-offset")).toBe("0");
    view.rerender(<RouteMap route={data} selectedSourceElapsedSec={null} />);
    expect(dot()).toBeNull();
    const css = readFileSync("src/app/style.css", "utf8");
    expect(css).toMatch(
      /\.route-map-chart-position \{[^}]*pointer-events: none;/,
    );
    expect(css).toMatch(/\.route-map-svg \{[^}]*overflow: hidden;/);
  });
});
