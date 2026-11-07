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
  it("uses one compact paragraph without hidden exposition and preserves values and selection", () => {
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
    const region = screen.getByRole("region", { name: "Terrain sections" });
    expect(region.querySelectorAll("p")).toHaveLength(1);
    expect(region.querySelector("details, summary, ul")).toBeNull();
    const explanation = region.querySelector("p")!.textContent!;
    for (const meaning of [
      "Approximate elevation, not surface or technical difficulty",
      "smoothing hides short features and gaps are excluded",
      "Movement times are estimates",
      "pace uses elapsed time",
      "HR is averaged per section",
      "Missing data isn’t zero",
      "selection highlights only aligned elevation",
    ])
      expect(explanation).toContain(meaning);
    expect(explanation).not.toMatch(
      /Supported profile|25m|100m|300m|terrain-v2/,
    );
    expect(screen.queryByText("Method and quality")).toBeNull();
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
    expect(screen.getByText(/Partial coverage\./)).toBeTruthy();
    expect(
      screen.getByText(/Some section timing is unavailable\./),
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
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("keeps nearly complete timing marked incomplete without a coverage list", () => {
    renderAnalysis(analysisWith({ timeCoverage: 0.99999 }));
    expect(firstRow().textContent).toContain("Timing incomplete");
    expect(screen.queryByRole("list")).toBeNull();
    expect(document.body.textContent).not.toContain("100%");
  });
  it.each([
    [true, [], 1, 1],
    [true, [], 1, 4],
    [false, [], 1, 4],
    [false, ["section_rows_truncated"], 1, 4],
  ])(
    "discloses capped rows independently of quality codes (%s, %s)",
    (truncated, quality, returnedSections, sectionCount) => {
      const analysis = {
        ...analysisWith(),
        truncated,
        quality,
        returnedSections,
        sectionCount,
      };
      const before = JSON.stringify(analysis);
      renderAnalysis(analysis);
      const paragraph = screen
        .getByRole("region", { name: "Terrain sections" })
        .querySelector("p")!;
      expect(paragraph.textContent).toContain(
        `Showing ${returnedSections} of ${sectionCount} sections`,
      );
      expect(
        paragraph.textContent?.match(/not all sections are shown/g),
      ).toHaveLength(1);
      expect(within(grid()).getAllByRole("row")).toHaveLength(2);
      expect(JSON.stringify(analysis)).toBe(before);
    },
  );
  it("keeps nonempty unavailable/mixed timing honest and deduplicates reasons", () => {
    const analysis = analysisWith({ timeCoverage: 0.5, hrSupportSec: 100 });
    analysis.status = "unavailable";
    analysis.reason = "mixed_timestamp_clocks";
    analysis.quality = [
      "mixed_timestamp_clocks",
      "incomplete_time",
      "future_internal_code",
    ];
    renderAnalysis(analysis);
    const text = screen
      .getByRole("region", { name: "Terrain sections" })
      .querySelector("p")!.textContent!;
    expect(text).toContain("Analysis unavailable.");
    expect(
      text.match(/Mixed timestamp clocks prevent reliable timing\./g),
    ).toHaveLength(1);
    expect(text).not.toContain("Some section timing");
    expect(text).not.toMatch(
      /future_internal_code|future internal code|Supported profile/,
    );
    expect(firstRow().textContent).toContain(
      "Timing incomplete; HR coverage incomplete",
    );
  });
  it("does not dump unknown codes or claim complete coverage", () => {
    const analysis = analysisWith();
    analysis.status = "partial";
    analysis.reason = "new_reason";
    analysis.quality = Array.from(
      { length: 20 },
      (_, i) => `unknown_code_${i}`,
    );
    renderAnalysis(analysis);
    const paragraph = screen
      .getByRole("region", { name: "Terrain sections" })
      .querySelector("p")!;
    expect(paragraph.textContent).toContain("Partial coverage.");
    expect(paragraph.textContent).not.toMatch(
      /new.reason|unknown.code|Supported profile|complete coverage/,
    );
    expect(within(grid()).getAllByRole("row")).toHaveLength(2);
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
