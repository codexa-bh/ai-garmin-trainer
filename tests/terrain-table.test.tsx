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
    name: "Estimated elevation-profile sections",
  });
}
function firstRow() {
  return within(grid()).getAllByRole("row")[1];
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
  it("labels the section time-weighted average and keeps complete diagnostics out of the grid", () => {
    const analysis = analysisWith();
    const before = JSON.stringify(analysis);
    const onSelect = vi.fn();
    renderAnalysis(analysis, onSelect);
    expect(
      within(grid()).getByRole("columnheader", { name: "Avg HR (bpm)" }),
    ).toBeTruthy();
    expect(within(firstRow()).getByRole("cell", { name: "125" })).toBeTruthy();
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
      within(firstRow()).getByRole("cell", { name: "59m 4s / 2m 44s" }),
    ).toBeTruthy();
    expect(
      within(firstRow()).getByRole("cell", { name: "28m 4s/km" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Section 1" }));
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
      const cells = within(firstRow()).getAllByRole("cell");
      expect(cells[7].textContent).toBe("Unavailable");
      expect(cells[8].textContent).toBe("Unavailable / Unavailable");
      expect(cells[9].textContent).toBe("Unavailable");
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
  it("distinguishes zero stationary time and unavailable HR, and tolerates old missing payloads", () => {
    const view = renderAnalysis(
      analysisWith({
        estimatedStationarySec: 0,
        averageHeartRate: null,
        hrSupportSec: 0,
      }),
    );
    expect(
      within(firstRow()).getByRole("cell", { name: "59m 4s / 0s" }),
    ).toBeTruthy();
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
