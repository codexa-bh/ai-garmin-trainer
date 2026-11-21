// @vitest-environment jsdom
import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnowSection } from "../src/app/dashboard/activity-supplement";
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
          },
          {
            splitKey: "index:4",
            timerSeconds: null,
            distanceMeters: null,
            ascentMeters: 0,
            descentMeters: 0,
            avgSpeedMps: null,
            maxSpeedMps: null,
          },
          {
            splitKey: "index:5",
            timerSeconds: 205,
            distanceMeters: 2900,
            ascentMeters: 0,
            descentMeters: 360,
            avgSpeedMps: 0,
            maxSpeedMps: 19.5,
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
            },
          ]
        : [];
  return {
    bodyBatteryDelta: null,
    listCadence: { avgSpm: null, maxSpm: null, strideLengthCm: null },
    fitCadence: { avgCpm: null, stepLengthM: null },
    lapZones: [],
    snowTotals: [],
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
