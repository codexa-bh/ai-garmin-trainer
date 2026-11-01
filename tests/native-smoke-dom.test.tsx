// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { HealthDashboardView } from "../src/app/dashboard/health-metrics";
import type { HealthDashboardDay } from "../src/app/dashboard/contracts";

declare global {
  interface Window {
    __trainerSmoke: (request: unknown) => Promise<void>;
    __trainerSmokeRestore: () => void;
  }
}
const smoke = window;
const invoke = vi.fn(async (_command: string, _args: unknown) => {});
const source = readFileSync("src-tauri/debug/smoke.js", "utf8");
const sentinel = "T0231-smoke-unit";
async function command(command: unknown) {
  await act(async () => {
    await smoke.__trainerSmoke({
      requestId: "request",
      expectedRunId: "run",
      command,
    });
  });
  return invoke.mock.calls.at(-1)?.[1] as {
    result: { ok: boolean; [key: string]: unknown };
  };
}
beforeEach(() => {
  invoke.mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: { invoke },
    configurable: true,
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{ width: 10 }] as unknown as DOMRectList,
  );
  const marker = document.createElement("section");
  marker.setAttribute("aria-label", "AI trainer dashboard");
  marker.setAttribute("data-renderer-ready", "true");
  document.body.append(marker);
  window.eval(source);
});
afterEach(() => {
  cleanup();
  smoke.__trainerSmokeRestore();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("native-installed rendered smoke boundary", () => {
  it("drives only finite rendered Health actions, keeps dates private, and masks without replacing layout", async () => {
    const record = (date: string) =>
      ({
        date,
        sleepMinutes: 444,
        sleepScore: 86,
        sleepDeepMinutes: 74,
        sleepLightMinutes: 244,
        sleepRemMinutes: 96,
        sleepAwakeMinutes: 30,
        sleepNapMinutes: 0,
        restingHeartRate: 52,
        hrvStatus: "synthetic-status",
        hrvMs: 41.2,
        stressAvg: 38,
        steps: 8412,
        calories: 2310,
        activeCalories: 710,
        restingCalories: 1600,
        totalCalories: 2310,
        intensityMinutes: 38,
        bodyBatteryAvg: null,
        bodyBatteryMorning: null,
        bodyBatteryEvening: null,
        availability: "complete",
      }) as HealthDashboardDay;
    function Health() {
      const [end, setEnd] = useState<string | null>(null);
      return (
        <>
          <p data-testid="outside">private outside transcript</p>
          <section className="health-dashboard-panel">
            <HealthDashboardView
              days={[record("2026-07-21"), record("2026-06-01")]}
              rangeEnd={end}
              onSelectRange={setEnd}
              notice=""
            />
          </section>
        </>
      );
    }
    render(<Health />);
    expect(
      (await command({ type: "health", action: "assert-range" })).result.ok,
    ).toBe(false);
    expect((await command({ type: "health", action: "next" })).result.ok).toBe(
      false,
    );
    expect(
      (await command({ type: "health", action: "previous" })).result.ok,
    ).toBe(true);
    expect(
      (await command({ type: "health", action: "remember-range" })).result.ok,
    ).toBe(true);
    for (const action of ["weekly", "monthly", "daily"]) {
      expect((await command({ type: "health", action })).result.ok).toBe(true);
      expect((await command({ type: "observe" })).result.healthMode).toBe(
        action,
      );
    }
    expect(
      (await command({ type: "health", action: "assert-range" })).result.ok,
    ).toBe(true);
    for (const action of ["capture-narrow", "capture-wide"]) {
      const table = screen.getByRole("table");
      const before = table.textContent;
      expect((await command({ type: "health", action })).result.ok).toBe(true);
      expect(table.textContent).toBe(before);
      expect(getComputedStyle(table.querySelector("td")!).visibility).toBe(
        "hidden",
      );
      expect(getComputedStyle(table.querySelector("time")!).visibility).toBe(
        "hidden",
      );
      expect(getComputedStyle(screen.getByTestId("outside")).visibility).toBe(
        "hidden",
      );
      smoke.__trainerSmokeRestore();
    }
    expect(
      (await command({ type: "health", action: "latest" })).result.ok,
    ).toBe(true);
    expect(
      (await command({ type: "health", action: "assert-range" })).result.ok,
    ).toBe(false);
    const observed = JSON.stringify(await command({ type: "observe" }));
    expect(observed).not.toMatch(
      /2026-|8,412|synthetic-status|private outside transcript/,
    );
    for (const unknown of [
      { type: "health", action: "eval" },
      { type: "health", action: "capture-wide", selector: "body" },
      { type: "health", action: "remember-range", date: "2026-01-01" },
    ])
      expect((await command(unknown)).result.ok).toBe(false);
  });

  it("refuses Health actions outside the visible Health owner", async () => {
    const click = vi.fn();
    render(
      <>
        <button onClick={click}>Daily</button>
        <div hidden>
          <table className="health-daily-matrix">
            <thead>
              <tr>
                {Array.from({ length: 7 }, (_, i) => (
                  <th key={i}>
                    <time dateTime="2026-01-01">private</time>
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      </>,
    );
    for (const action of [
      "daily",
      "capture-wide",
      "remember-range",
      "assert-range",
    ])
      expect((await command({ type: "health", action })).result.ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it("refuses mutation against server HTML before React hydration", async () => {
    document
      .querySelector("[data-renderer-ready]")
      ?.removeAttribute("data-renderer-ready");
    const click = vi.fn();
    render(<button onClick={click}>Activities</button>);
    expect((await command({ type: "observe" })).result.hydrated).toBe(false);
    expect(
      (await command({ type: "click", target: "Activities" })).result.ok,
    ).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
  it("updates an actual React-controlled textarea rather than merely its DOM value", async () => {
    function Controlled() {
      const [goals, setGoals] = useState("original-private-value");
      return (
        <>
          <textarea
            aria-label="Goals"
            value={goals}
            onChange={(event) => setGoals(event.target.value)}
          />
          <p data-testid="state">{goals}</p>
        </>
      );
    }
    render(<Controlled />);
    expect(
      (await command({ type: "input", target: "Goals", value: sentinel }))
        .result.ok,
    ).toBe(true);
    expect(screen.getByTestId("state").textContent).toBe(sentinel);
    expect(
      (await command({ type: "assert", target: "Goals", value: sentinel }))
        .result.ok,
    ).toBe(true);
    expect(
      (
        await command({
          type: "assert",
          target: "Goals",
          value: "T0231-smoke-other",
        })
      ).result.ok,
    ).toBe(false);
  });
  it("refuses private, hidden, disabled, readonly and ambiguous controls before dispatch", async () => {
    const click = vi.fn();
    render(
      <>
        <button onClick={click}>Garmin sign-in</button>
        <textarea aria-label="Password" />
        <button disabled onClick={click}>
          Save Profile
        </button>
        <div hidden>
          <button onClick={click}>Activities</button>
        </div>
        <button onClick={click}>Sync</button>
        <button onClick={click}>Sync</button>
        <textarea readOnly aria-label="Goals" />
      </>,
    );
    for (const target of [
      "Garmin sign-in",
      "Save Profile",
      "Activities",
      "Sync",
    ]) {
      expect((await command({ type: "click", target })).result.ok).toBe(false);
    }
    expect(
      (await command({ type: "input", target: "Password", value: sentinel }))
        .result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "input", target: "Goals", value: sentinel }))
        .result.ok,
    ).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
  it("does not observe copied values/transcripts or accept credential text", async () => {
    render(
      <>
        <section aria-label="AI trainer dashboard" />
        <textarea aria-label="Goals" defaultValue="private goal" />
        <p>secret transcript</p>
        <input type="password" defaultValue="private password" />
      </>,
    );
    const observation = await command({ type: "observe" });
    expect(observation.result.ok).toBe(true);
    expect(JSON.stringify(observation)).not.toMatch(
      /private goal|secret transcript|private password/,
    );
    expect(
      (
        await command({
          type: "input",
          target: "Goals",
          value: "private email@example.org",
        })
      ).result.ok,
    ).toBe(false);
    expect((await command({ type: "capture" })).result.ok).toBe(false);
  });
});
