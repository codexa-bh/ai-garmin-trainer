// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerrainTable } from "../src/app/dashboard/terrain-table";
import {
  analyzeTerrainSections,
  type TerrainSection,
} from "../src/lib/analytics/terrain-sections";

function analysisWith(overrides: Partial<TerrainSection> = {}) {
  const analysis = analyzeTerrainSections(
    "synthetic",
    "hiking",
    Array.from({ length: 101 }, (_, i) => ({
      elapsedSec: i * 10,
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString(),
      distanceMeters: i * 10,
      altitudeMeters: i,
      heartRate: 125,
    })),
  );
  Object.assign(
    analysis.sections[0],
    {
      elapsedSec: 3708,
      estimatedMovingSec: 3544,
      estimatedStationarySec: 164,
      timeSupportSec: 3708,
      hrSupportSec: 3708,
      timeCoverage: 1,
      elapsedPaceSecPerKm: 1684,
    },
    overrides,
  );
  return analysis;
}
function grid() {
  return screen.getByRole("table", {
    name: "Section details",
  });
}
function firstRow() {
  return within(grid()).getAllByRole("row")[1];
}
function cell(header: string, row = firstRow()) {
  const index = within(grid())
    .getAllByRole("columnheader")
    .findIndex((th) => th.textContent === header);
  expect(index).toBeGreaterThanOrEqual(0);
  return within(row).getAllByRole("cell")[index];
}
function renderAnalysis(analysis = analysisWith(), onSelect = vi.fn()) {
  return render(
    <TerrainTable
      analysis={analysis}
      selectedId="section-1"
      onSelect={onSelect}
    />,
  );
}
afterEach(cleanup);

describe("terrain section presentation", () => {
  it("projects aligned compact columns without changing hidden domain fields", () => {
    const analysis = analysisWith({ steepUpMeters: 127, steepDownMeters: 91 });
    const before = structuredClone(analysis);
    renderAnalysis(analysis);
    expect(
      within(grid())
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "Section",
      "Type",
      "Range",
      "Distance",
      "Ascent",
      "Descent",
      "Grade",
      "Duration",
      "Pace",
      "Avg HR",
    ]);
    expect(within(firstRow()).getAllByRole("cell")).toHaveLength(10);
    expect(cell("Range").textContent).toBe("0–1 km");
    expect(cell("Distance").textContent).toBe("1 km");
    expect(cell("Ascent").textContent).toMatch(/ m$/);
    expect(cell("Descent").textContent).toMatch(/ m$/);
    expect(cell("Grade").textContent).toMatch(/%$/);
    expect(grid().textContent).not.toMatch(/≈|≥10%|stationary|127|91/);
    expect(analysis).toEqual(before);
    expect(
      screen.getByRole("region", { name: "Terrain measurements" }).tabIndex,
    ).toBe(0);
  });
  it.each([
    [
      {
        startDistanceMeters: 12.4,
        endDistanceMeters: 912.4,
        distanceMeters: 900,
      },
      "Range",
      "12–912 m",
    ],
    [
      { startDistanceMeters: 999, endDistanceMeters: 12345.6 },
      "Range",
      "0.999–12.346 km",
    ],
    [{ distanceMeters: 12345.6 }, "Distance", "12.346 km"],
    [{ distanceMeters: 0 }, "Distance", "0 m"],
    [{ ascentMeters: 12.34 }, "Ascent", "12.3 m"],
    [{ descentMeters: 0 }, "Descent", "0 m"],
    [{ meanGradePct: -8.24 }, "Grade", "-8.2%"],
    [{ meanGradePct: 0 }, "Grade", "0%"],
    [{ averageHeartRate: 124.6 }, "Avg HR", "125 bpm"],
    [{ elapsedPaceSecPerKm: 59.6 }, "Pace", "1m/km"],
    [{ elapsedPaceSecPerKm: 3599.6 }, "Pace", "1h/km"],
    [{ elapsedPaceSecPerKm: 0 }, "Pace", "0s/km"],
    [{ startDistanceMeters: NaN }, "Range", "Unavailable"],
    [{ endDistanceMeters: Infinity }, "Range", "Unavailable"],
    [{ startDistanceMeters: -1 }, "Range", "Unavailable"],
    [
      { startDistanceMeters: 1001, endDistanceMeters: 1000 },
      "Range",
      "Unavailable",
    ],
    [{ distanceMeters: -1 }, "Distance", "Unavailable"],
    [{ distanceMeters: Infinity }, "Distance", "Unavailable"],
    [{ ascentMeters: NaN }, "Ascent", "Unavailable"],
    [{ descentMeters: Infinity }, "Descent", "Unavailable"],
    [{ meanGradePct: NaN }, "Grade", "Unavailable"],
    [{ averageHeartRate: null }, "Avg HR", "Unavailable"],
    [{ averageHeartRate: Infinity }, "Avg HR", "Unavailable"],
  ] as const)(
    "formats row measurements honestly: %j / %s",
    (overrides, header, expected) => {
      renderAnalysis(analysisWith(overrides));
      expect(cell(header).textContent).toBe(expected);
      expect(grid().textContent).not.toMatch(
        /NaN|Infinity|Unavailable (m|bpm)|Unavailable%/,
      );
    },
  );
  it("uses numeric native buttons with distinct accessible names, focus and pressed state", () => {
    const analysis = analysisWith();
    analysis.sections = Array.from({ length: 12 }, (_, i) => ({
      ...analysis.sections[0],
      id: `section-${i + 1}`,
    }));
    const onSelect = vi.fn();
    const view = renderAnalysis(analysis, onSelect);
    const button = screen.getByRole("button", { name: "Select section 12" });
    expect(button.textContent).toBe("12");
    expect(button.getAttribute("type")).toBe("button");
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("section-12");
    view.rerender(
      <TerrainTable
        analysis={analysis}
        selectedId="section-12"
        onSelect={onSelect}
      />,
    );
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
  it.each([
    ["legacy missing payload", undefined],
    ["unsupported team sport", analyzeTerrainSections("team", "soccer", [])],
    [
      "unsupported strength",
      analyzeTerrainSections("strength", "strength_training", []),
    ],
    ["missing walk stream", analyzeTerrainSections("walk", "walking", [])],
    [
      "insufficient hike evidence",
      analyzeTerrainSections("short", "hiking", [
        {
          distanceMeters: 0,
          altitudeMeters: 0,
          elapsedSec: 0,
          timestamp: null,
          heartRate: null,
        },
        {
          distanceMeters: 100,
          altitudeMeters: 10,
          elapsedSec: 10,
          timestamp: null,
          heartRate: null,
        },
      ]),
    ],
    [
      "missing elevation on a walk",
      analyzeTerrainSections(
        "no-elevation",
        "walk",
        Array.from({ length: 61 }, (_, i) => ({
          distanceMeters: i * 10,
          altitudeMeters: null,
          elapsedSec: i * 10,
          timestamp: null,
          heartRate: null,
        })),
      ),
    ],
    [
      "empty rows despite populated summary counts",
      { ...analysisWith(), sections: [] },
    ],
  ])("renders no terrain UI for %s", (_label, analysis) => {
    const { container } = render(
      <TerrainTable analysis={analysis} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(
      screen.queryByRole("region", { name: "Terrain sections" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Terrain sections" }),
    ).toBeNull();
    expect(screen.queryByText("Method and quality")).toBeNull();
    expect(screen.queryByText(/No supported terrain sections/)).toBeNull();
    expect(container.childElementCount).toBe(0);
  });
  it("retains genuine analyzer caps, partial warnings and whole-analysis totals", () => {
    const points = Array.from({ length: 241 }, (_, i) => ({
      elapsedSec: i * 10,
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString(),
      distanceMeters: i * 10,
      altitudeMeters: Math.floor(i / 60) % 2 ? 60 - (i % 60) : i % 60,
      heartRate: null,
    }));
    const full = analyzeTerrainSections("capped", "hiking", points);
    const capped = analyzeTerrainSections("capped", "hiking", points, 1);
    expect(capped.truncated).toBe(true);
    expect(capped.sections).toEqual(full.sections.slice(0, 1));
    expect(capped.ascentMeters).toBe(full.ascentMeters);
    // The cap boolean must remain meaningful even without its redundant quality code.
    capped.quality = capped.quality.filter(
      (code) => code !== "section_rows_truncated",
    );
    capped.sections.forEach(Object.freeze);
    Object.freeze(capped.sections);
    Object.freeze(capped);
    renderAnalysis(capped);
    expect(
      screen.getByRole("region", { name: "Terrain sections" }).textContent,
    ).toMatch(/truncated|Only part|Showing 1/i);
    expect(within(grid()).getAllByRole("row")).toHaveLength(2);
    expect(cell("Data notes").textContent).toContain("Avg HR unavailable");
    expect(within(firstRow()).getAllByRole("cell")).toHaveLength(11);
  });
  it("keeps actual rows visible even when summary counts are zero", () => {
    const analysis = analysisWith();
    analysis.sectionCount = 0;
    analysis.returnedSections = 0;
    renderAnalysis(analysis);
    expect(
      screen.getByRole("region", { name: "Terrain sections" }),
    ).toBeTruthy();
    expect(within(grid()).getAllByRole("row")).toHaveLength(2);
  });
  it("labels the section time-weighted average and keeps complete diagnostics out of the grid", () => {
    const analysis = analysisWith();
    const before = JSON.stringify(analysis);
    const onSelect = vi.fn();
    renderAnalysis(analysis, onSelect);
    expect(
      within(grid()).getByRole("columnheader", { name: "Avg HR" }),
    ).toBeTruthy();
    expect(
      within(firstRow()).getByRole("cell", { name: "125 bpm" }),
    ).toBeTruthy();
    expect(
      within(grid()).queryByRole("columnheader", { name: "Support / quality" }),
    ).toBeNull();
    expect(
      within(grid()).queryByRole("columnheader", { name: "Data notes" }),
    ).toBeNull();
    expect(grid().textContent).not.toContain("Time 100%");
    expect(grid().textContent).not.toContain("estimated_elevation_profile");
    const disclosure = screen
      .getByText("Method and quality")
      .closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(screen.getByText("Method and quality"));
    expect(disclosure.open).toBe(true);
    expect(disclosure.textContent).toContain("section's average heart rate");
    expect(disclosure.textContent).toContain("not the whole-activity average");
    expect(disclosure.textContent).toContain("timing coverage 100%");
    expect(disclosure.textContent).toContain(
      "Avg HR covers 1h 1m 48s of 1h 1m 48s timed support (100%)",
    );
    expect(
      within(firstRow()).getByRole("cell", { name: "1h 1m 48s" }),
    ).toBeTruthy();
    expect(
      within(firstRow()).getByRole("cell", { name: "28m 4s/km" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select section 1" }));
    expect(onSelect).toHaveBeenCalledWith("section-1");
    expect(JSON.stringify(analysis)).toBe(before);
  });
  it.each([
    [0, "0s"],
    [59, "59s"],
    [60, "1m"],
    [624, "10m 24s"],
    [2321, "38m 41s"],
    [3600, "1h"],
    [3708, "1h 1m 48s"],
    [5522, "1h 32m 2s"],
    [3660, "1h 1m"],
    [59.6, "1m"],
    [3599.6, "1h"],
  ])("formats elapsed %s as %s without zero-valued units", (seconds, label) => {
    renderAnalysis(analysisWith({ elapsedSec: seconds as number }));
    expect(
      within(firstRow()).getByRole("cell", {
        name: label as string,
      }),
    ).toBeTruthy();
  });
  it.each([null, NaN, Infinity, -1])(
    "does not turn missing or invalid duration %s into zero",
    (value) => {
      renderAnalysis(
        analysisWith({
          elapsedSec: value,
          estimatedMovingSec: value,
          estimatedStationarySec: value,
          elapsedPaceSecPerKm: value,
        }),
      );
      expect(cell("Duration").textContent).toBe("Unavailable");
      expect(cell("Pace").textContent).toBe("Unavailable");
      expect(firstRow().textContent).not.toContain("NaN");
    },
  );
  it("keeps unavailable timing and average HR warnings visible with readable global partial reasons", () => {
    const analysis = analysisWith({
      timeCoverage: 0,
      timeSupportSec: 0,
      hrSupportSec: 0,
      averageHeartRate: null,
      elapsedSec: null,
      quality: "estimated_elevation_profile;incomplete_time;incomplete_hr",
    });
    analysis.status = "partial";
    analysis.quality = [
      "excluded_gaps_invalid_or_short_support",
      "incomplete_time",
    ];
    renderAnalysis(analysis);
    expect(
      within(grid()).getByRole("columnheader", { name: "Data notes" }),
    ).toBeTruthy();
    expect(firstRow().textContent).toContain(
      "Timing unavailable; Avg HR unavailable",
    );
    expect(
      screen.getByText(
        /Some gaps, invalid samples or short stretches were excluded/,
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "excluded_gaps_invalid_or_short_support",
    );
    expect(document.body.textContent).not.toContain(
      "estimated_elevation_profile",
    );
  });
  it("discloses incomplete HR over timed support without marking complete rows as broken", () => {
    const analysis = analysisWith({ hrSupportSec: 1854 });
    analysis.sections.push({
      ...analysis.sections[0],
      id: "section-2",
      hrSupportSec: 3708,
    });
    renderAnalysis(analysis);
    const rows = within(grid()).getAllByRole("row");
    expect(rows[1].textContent).toContain("HR coverage incomplete");
    expect(rows[2].lastElementChild?.textContent).toBe("—");
    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole("cell")).toHaveLength(11);
      expect(cell("Avg HR", row).textContent).toBe("125 bpm");
    }
    expect(
      screen.getByRole("list", { name: "Per-section data coverage" })
        .textContent,
    ).toContain("Avg HR covers 30m 54s of 1h 1m 48s timed support (50%)");
  });
  it("does not round an incomplete timing fraction into a misleading complete percentage", () => {
    renderAnalysis(analysisWith({ timeCoverage: 0.99999 }));
    expect(firstRow().textContent).toContain("Timing incomplete");
    expect(
      screen.getByRole("list", { name: "Per-section data coverage" })
        .textContent,
    ).toContain("timing coverage >99%");
  });
  it("distinguishes zero duration and unavailable HR, and tolerates old missing payloads", () => {
    const view = renderAnalysis(
      analysisWith({
        elapsedSec: 0,
        estimatedStationarySec: 0,
        averageHeartRate: null,
        hrSupportSec: 0,
      }),
    );
    expect(within(firstRow()).getByRole("cell", { name: "0s" })).toBeTruthy();
    expect(firstRow().textContent).toContain("Avg HR unavailable");
    view.rerender(
      <TerrainTable
        analysis={undefined}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.queryByRole("region", { name: "Terrain sections" }),
    ).toBeNull();
  });
});
