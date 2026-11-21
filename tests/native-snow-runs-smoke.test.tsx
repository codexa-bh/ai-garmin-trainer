// @vitest-environment jsdom
import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  hidesRedundantSnowLaps,
  SnowSection,
} from "../src/app/dashboard/activity-supplement";
import type {
  ActivitySupplement,
  SupplementCoverage,
} from "../src/lib/local-data/supplement-contracts";

const source = readFileSync("src-tauri/debug/smoke.js", "utf8");
const invoke = vi.fn();
const variants = ["populated", "unknown", "unsupported", "preserved"] as const;
type Variant = (typeof variants)[number];
const names = {
  populated: "Fictional snow day",
  unknown: "Fictional snow unknown",
  unsupported: "Fictional snow unsupported",
  preserved: "Fictional snow preserved",
};
const sports = {
  populated: "resort_snowboarding",
  unknown: "resort_skiing",
  unsupported: "backcountry_skiing",
  preserved: "resort_skiing",
};
const bucket = (index: number, seconds: number) => ({
  bucket: index,
  kind: index === 0 ? ("below" as const) : ("zone" as const),
  zone: index === 0 ? null : index,
  seconds,
  lowerBpm: index === 0 ? null : 80 + index * 20,
  upperBpm: index === 5 ? null : 99 + index * 20,
});
const derived = (avg: number, seconds: number[]) => ({
  avgHeartRate: avg,
  supportSeconds: 200,
  windowSeconds: 200,
  unavailableReason: null,
  zones: {
    buckets: seconds.map((value, index) => bucket(index, value)),
    unavailableReason: null,
  },
});
const noWindow = {
  avgHeartRate: null,
  supportSeconds: null,
  windowSeconds: null,
  unavailableReason: "invalid-window" as const,
  zones: {
    buckets: null,
    unavailableReason: "heart-rate-unavailable" as const,
  },
};
function supplement(variant: Variant): ActivitySupplement {
  const unknown: SupplementCoverage = { status: "not_imported", reason: null };
  const entries =
    variant === "populated"
      ? [
          {
            splitKey: "index:2",
            timerSeconds: 190.4,
            distanceMeters: 2600,
            ascentMeters: 0.5,
            descentMeters: 340,
            avgSpeedMps: 10,
            maxSpeedMps: 17.8,
            heartRate: derived(151, [0, 0, 60, 70, 70, 0]),
          },
          {
            splitKey: "index:4",
            timerSeconds: null,
            distanceMeters: null,
            ascentMeters: 0,
            descentMeters: 0,
            avgSpeedMps: null,
            maxSpeedMps: null,
            heartRate: noWindow,
          },
          {
            splitKey: "index:5",
            timerSeconds: 205,
            distanceMeters: 2900,
            ascentMeters: 0,
            descentMeters: 360,
            avgSpeedMps: 0,
            maxSpeedMps: 19.5,
            heartRate: derived(144, [0, 0, 100, 0, 115, 0]),
          },
        ]
      : variant === "preserved"
        ? [
            {
              splitKey: "index:8",
              timerSeconds: 12.5,
              distanceMeters: 0,
              ascentMeters: null,
              descentMeters: 0,
              avgSpeedMps: null,
              maxSpeedMps: 0,
              heartRate: noWindow,
            },
          ]
        : [];
  return {
    bodyBatteryDelta: null,
    listCadence: { avgSpm: null, maxSpm: null, strideLengthCm: null },
    fitCadence: { avgCpm: null, stepLengthM: null },
    lapZones: [],
    snowTotals:
      variant === "populated"
        ? [
            {
              splitType: "SKI_RUN_SPLIT",
              count: 12,
              durationSec: 3600,
              distanceMeters: 31000,
              bestSplitDistanceMeters: 4200,
              maxSpeedMps: 19.5,
            },
            {
              splitType: "SKI_LIFT_SPLIT",
              count: 11,
              durationSec: 3000,
              distanceMeters: 8400,
              bestSplitDistanceMeters: 1300,
              maxSpeedMps: null,
            },
          ]
        : [],
    snowRuns: {
      relevant: true,
      total: entries.length,
      returned: entries.length,
      truncated: false,
      entries,
    },
    coverage: {
      activity_body_battery: unknown,
      running_dynamics: unknown,
      lap_hr_zones: unknown,
      snowboard_splits: unknown,
      snow_run_lift_splits:
        variant === "populated"
          ? { status: "populated", reason: null }
          : variant === "preserved"
            ? { status: "failed", reason: "fit-download" }
            : variant === "unsupported"
              ? { status: "unavailable", reason: "unsupported-sport" }
              : unknown,
    },
  };
}
function Fixture() {
  const [variant, setVariant] = useState<Variant>("populated");
  const [collapsed, collapse] = useState(false);
  return (
    <section aria-label="AI trainer dashboard" data-renderer-ready="true">
      <div className="activity-list" hidden={collapsed}>
        {variants.map((item) => (
          <button
            key={item}
            className={`activity-list-item ${item === variant ? "selected" : ""}`}
            onClick={() => setVariant(item)}
          >
            <strong>{names[item]}</strong>
          </button>
        ))}
      </div>
      <button
        aria-label={
          collapsed ? "Expand activity selector" : "Collapse activity selector"
        }
        onClick={() => collapse(!collapsed)}
      >
        Selector
      </button>
      <div className="selected-activity-heading">
        <h2>{names[variant]}</h2>
      </div>
      <p>Private neighboring facts</p>
      <SnowSection supplement={supplement(variant)} sport={sports[variant]} />
      {hidesRedundantSnowLaps(supplement(variant), sports[variant]) ? null : (
        <div className="lap-table-wrap">
          <table>
            <caption>Lap details</caption>
            <tbody>
              {[1, 2, 3].map((lap) => (
                <tr key={lap}>
                  <th>{lap}</th>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
async function command(value: unknown) {
  await act(async () => {
    await (
      window as unknown as { __trainerSmoke: (value: unknown) => Promise<void> }
    ).__trainerSmoke({
      requestId: "request",
      expectedRunId: "run",
      expectedBoot: "boot",
      command: value,
    });
  });
  return invoke.mock.calls.at(-1)![1].result;
}
beforeEach(() => {
  invoke.mockReset();
  Object.assign(window, {
    __TAURI_INTERNALS__: { invoke },
    __trainerOrdinaryIsolated: { runId: "run" },
  });
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 850);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 100 },
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 20,
    bottom: 200,
    width: 600,
    height: 180,
    left: 0,
    right: 600,
    x: 0,
    y: 20,
    toJSON: () => ({}),
  });
  window.eval(source);
});
afterEach(() => {
  (
    window as unknown as { __trainerSmokeRestore: () => void }
  ).__trainerSmokeRestore();
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("validates all authored states, contains only boolean observations and restores masks", async () => {
  render(<Fixture />);
  for (const variant of variants) {
    expect((await command({ type: "snowRuns", action: variant })).ready).toBe(
      true,
    );
    expect(
      (await command({ type: "snowRuns", action: "start" })).headerVisible,
    ).toBe(true);
    const result = await command({
      type: "captureView",
      view: "snowRuns",
      preset: "wide",
    });
    expect(result.ok).toBe(true);
    const absent = variant === "unknown" || variant === "unsupported";
    // Rows exist only for populated/preserved; the others must show no snow section
    // and reveal only the exact selected activity heading.
    expect(
      !!document.querySelector(".snow-run-display[data-smoke-reveal]"),
    ).toBe(!absent);
    // Laps are gone exactly where individual runs are stored; kept otherwise,
    // and an unrevealed lap table never enters a capture.
    expect(!!document.querySelector(".snow-runs")).toBe(!absent);
    expect(
      !!document.querySelector(".lap-table-wrap table[data-smoke-reveal]"),
    ).toBe(false);
    expect(!!document.querySelector(".lap-table-wrap")).toBe(absent);
    expect(
      !!document.querySelector(".snow-section, .snow-runs-wrap") && absent,
    ).toBe(false);
    expect(
      !!document.querySelector(".selected-activity-heading[data-smoke-reveal]"),
    ).toBe(absent);
    expect(
      [...document.querySelectorAll("p[data-smoke-reveal]")].some((node) =>
        node.textContent?.includes("Private neighboring"),
      ),
    ).toBe(false);
    (
      window as unknown as { __trainerSmokeRestore: () => void }
    ).__trainerSmokeRestore();
    expect(
      document.querySelector("[data-smoke-reveal],#trainer-smoke-sanitizer"),
    ).toBeNull();
  }
  const result = await command({ type: "snowRuns", action: "observe" });
  expect(Object.keys(result).sort()).toEqual(
    [
      "ok",
      "action",
      "trustedInput",
      "choicesReady",
      "ready",
      "contained",
      "scrollable",
      "edgeReached",
      "headerVisible",
    ].sort(),
  );
});
it("opens and closes only the authored derived-zone Times disclosures", async () => {
  render(<Fixture />);
  const open = () =>
    [...document.querySelectorAll(".snow-runs details")].map(
      (node) => (node as HTMLDetailsElement).open,
    );
  expect((await command({ type: "snowRuns", action: "populated" })).ready).toBe(
    true,
  );
  expect(open()).toEqual([false, false]);
  expect((await command({ type: "snowRuns", action: "times" })).ready).toBe(
    true,
  );
  expect(open()).toEqual([true, true]);
  expect((await command({ type: "snowRuns", action: "times" })).ready).toBe(
    true,
  );
  expect(open()).toEqual([false, false]);
  // No disclosure to open: preserved has only an unavailable reason.
  await command({ type: "snowRuns", action: "preserved" });
  expect((await command({ type: "snowRuns", action: "times" })).ok).toBe(false);
});

it("checks only the authored adjacent lap table and refuses altered evidence", async () => {
  render(
    <section aria-label="AI trainer dashboard" data-renderer-ready="true">
      <button className="activity-list-item">
        <strong>Fictional lap run</strong>
      </button>
      <div className="selected-activity-heading">
        <h2>Fictional lap run</h2>
      </div>
      <div className="lap-table-wrap">
        <table>
          <thead>
            <tr>
              <th>HR zones</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="lap-zone-column">
                <span role="group" aria-label="Zone 3 (141–160 bpm): 3m 40s" />
              </td>
            </tr>
            <tr>
              <td className="lap-zone-column">Stored</td>
            </tr>
            <tr>
              <td className="lap-zone-column" />
            </tr>
            <tr>
              <td className="lap-zone-column">All zero</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>,
  );
  expect((await command({ type: "snowRuns", action: "laps" })).ready).toBe(
    true,
  );
  document
    .querySelector(".lap-zone-column [role=group]")!
    .setAttribute("aria-label", "Changed evidence");
  expect((await command({ type: "snowRuns", action: "laps" })).ok).toBe(false);
});

it("refuses unknown/private controls, extra fields, debug mode, altered cells and stale selected identity", async () => {
  render(<Fixture />);
  for (const value of [
    { type: "snowRuns", action: "eval" },
    { type: "snowRuns", action: "populated", selector: "body" },
  ])
    expect((await command(value)).ok).toBe(false);
  expect((await command({ type: "snowRuns", action: "populated" })).ready).toBe(
    true,
  );
  // An altered derived HR value is refused like any other altered cell.
  const hrCell = document.querySelector(".snow-runs tbody td:nth-child(7)")!;
  hrCell.textContent = "152";
  expect(
    (await command({ type: "captureView", view: "snowRuns", preset: "wide" }))
      .ok,
  ).toBe(false);
  hrCell.textContent = "151";
  document.querySelector(".snow-runs tbody td")!.textContent =
    "Private substituted value";
  expect(
    (await command({ type: "captureView", view: "snowRuns", preset: "wide" }))
      .ok,
  ).toBe(false);
  expect(
    document.querySelector("[data-smoke-reveal],#trainer-smoke-sanitizer"),
  ).toBeNull();
  document.querySelector(".selected-activity-heading h2")!.textContent =
    "Private other activity";
  expect((await command({ type: "snowRuns", action: "observe" })).ready).toBe(
    false,
  );
  delete (window as unknown as { __trainerOrdinaryIsolated?: unknown })
    .__trainerOrdinaryIsolated;
  expect((await command({ type: "snowRuns", action: "observe" })).ok).toBe(
    false,
  );
});
