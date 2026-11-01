// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";

declare global {
  interface Window {
    __trainerSmoke: (request: unknown) => Promise<void>;
    __trainerSmokeRestore: () => void;
    __trainerOrdinaryIsolated?: { runId: string };
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
  invoke.mockReset();
  delete smoke.__trainerOrdinaryIsolated;
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function DebugFixture() {
  return (
    <aside className="settings-sheet">
      <details className="settings-card llm-debug-card">
        <summary>
          LLM debug traces <span>2 assistant turns</span>
        </summary>
        <p>
          Local developer diagnostics are enabled by application policy. Traces
          may include private normalized Garmin/chat/tool context; keep them
          local and out of screenshots or support artifacts.
        </p>
        <div className="debug-trace-list">
          <details className="debug-trace-item">
            <summary>
              {new Date(1000).toLocaleString()} — T0243 synthetic trace
            </summary>
            <pre>
              {JSON.stringify(
                {
                  schemaVersion: 1,
                  finalAnswer: "T0243 synthetic diagnostic only",
                },
                null,
                2,
              )}
            </pre>
          </details>
          <details className="debug-trace-item">
            <summary>
              {new Date(0).toLocaleString()} — T0243 synthetic missing trace
            </summary>
            <p>No debug trace captured for this assistant message.</p>
          </details>
        </div>
      </details>
    </aside>
  );
}

describe("native-installed rendered smoke boundary", () => {
  it("ordinary mode rejects debug disclosure actions and observations", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    render(<DebugFixture />);
    expect(
      (await command({ type: "observe" })).result.llmDebug,
    ).toBeUndefined();
    for (const request of [
      { type: "click", target: "LLM debug traces" },
      { type: "click", target: "First LLM trace" },
      { type: "debugKey", key: "Enter" },
      { type: "captureDebug" },
    ])
      expect((await command(request)).result.ok).toBe(false);
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(
      false,
    );
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
  });
  it("denies ordinary viewport/capture controls in legacy mode or wrong view/preset", async () => {
    expect(
      (await command({ type: "setViewport", preset: "wide" })).result.ok,
    ).toBe(false);
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    expect(
      (await command({ type: "captureView", view: "setup", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(
      (
        await command({
          type: "captureView",
          view: "trainer",
          preset: "arbitrary",
        })
      ).result.ok,
    ).toBe(false);
    expect((await command({ type: "capture" })).result.ok).toBe(false);
  });
  it("masks private content without reflow and restores on callback rejection", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    render(
      <>
        <nav>
          <button>Sync</button>
        </nav>
        <p data-testid="private">private transcript</p>
      </>,
    );
    const result = await command({
      type: "captureView",
      view: "trainer",
      preset: "wide",
    });
    expect(result.result.ok).toBe(true);
    const style = document.getElementById("trainer-smoke-sanitizer");
    expect(style?.textContent).not.toMatch(
      /position|width|height|display|top:|left:/,
    );
    expect(getComputedStyle(screen.getByTestId("private")).visibility).toBe(
      "hidden",
    );
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Sync" })).visibility,
    ).toBe("visible");
    expect(JSON.stringify(result)).not.toContain("private transcript");
    smoke.__trainerSmokeRestore();
    expect(style?.isConnected).toBe(false);
    invoke.mockRejectedValueOnce(new Error("permission refused"));
    await command({ type: "captureView", view: "trainer", preset: "wide" });
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  });
  it("keeps reviewed native-mobile chrome visible without revealing copied content", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 420);
    vi.stubGlobal("innerHeight", 850);
    render(
      <header>
        <div className="app-brand">
          <h1 className="app-title">Garmin AI Trainer</h1>
        </div>
        <div className="app-mobile-menu">
          <button className="app-menu-toggle">Menu</button>
        </div>
        <p data-testid="private-mobile">private transcript</p>
      </header>,
    );
    expect(
      (
        await command({
          type: "captureView",
          view: "trainer",
          preset: "narrow",
        })
      ).result.ok,
    ).toBe(true);
    expect(
      getComputedStyle(
        screen.getByRole("heading", { name: "Garmin AI Trainer" }),
      ).visibility,
    ).toBe("visible");
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Menu" })).visibility,
    ).toBe("visible");
    expect(
      getComputedStyle(screen.getByTestId("private-mobile")).visibility,
    ).toBe("hidden");
  });
  it("refuses copied Profile Goals and expires successful masks without native cleanup", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 420);
    vi.stubGlobal("innerHeight", 850);
    const { unmount } = render(
      <aside className="settings-sheet">
        <div className="profile-settings-card">
          <span className="pill">Profile saved</span>
          <label>
            Goals
            <textarea aria-label="Goals" defaultValue="private original" />
          </label>
        </div>
      </aside>,
    );
    expect(
      (
        await command({
          type: "captureView",
          view: "profile",
          preset: "narrow",
        })
      ).result.ok,
    ).toBe(false);
    unmount();
    render(
      <aside className="settings-sheet">
        <div className="profile-settings-card">
          <span className="pill">Profile saved</span>
          <label>
            Goals
            <textarea aria-label="Goals" defaultValue={sentinel} />
          </label>
        </div>
      </aside>,
    );
    vi.useFakeTimers();
    let pending: Promise<void>;
    await act(async () => {
      pending = smoke.__trainerSmoke({
        requestId: "capture",
        expectedRunId: "run",
        expectedBoot: "boot",
        command: { type: "captureView", view: "profile", preset: "narrow" },
      });
      await vi.advanceTimersByTimeAsync(120);
      await pending;
    });
    expect(document.getElementById("trainer-smoke-sanitizer")).not.toBeNull();
    expect((invoke.mock.calls.at(-1)?.[1] as { boot: string }).boot).toBe(
      "boot",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
  });
  it("observes native hidden ancestors correctly and refuses hidden inner-summary activation", async () => {
    render(<DebugFixture />);
    let result = (await command({ type: "observe" })).result;
    expect(result.llmDebug).toMatchObject({
      open: false,
      warningVisible: false,
      innerOpen: [false, false],
      previewsVisible: [false, false],
      bodiesVisible: [false, false],
    });
    expect(
      (await command({ type: "click", target: "First LLM trace" })).result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "click", target: "LLM debug traces" })).result.ok,
    ).toBe(true);
    expect(
      (await command({ type: "click", target: "First LLM trace" })).result.ok,
    ).toBe(true);
    result = (await command({ type: "observe" })).result;
    expect(result.llmDebug).toMatchObject({
      open: true,
      warningVisible: true,
      innerOpen: [true, false],
      previewsVisible: [true, true],
      bodiesVisible: [true, false],
    });
    await command({ type: "click", target: "LLM debug traces" });
    result = (await command({ type: "observe" })).result;
    expect(result.llmDebug).toMatchObject({
      open: false,
      innerOpen: [true, false],
      previewsVisible: [false, false],
      bodiesVisible: [false, false],
    });
    expect(JSON.stringify(result)).not.toContain("synthetic diagnostic");
    expect(JSON.stringify(result)).not.toContain("synthetic trace");
  });

  it("permits only fixed synthetic debug capture, restores styling and refuses any private or additional content", async () => {
    render(<DebugFixture />);
    const before = document.querySelector(".llm-debug-card")!.textContent;
    expect((await command({ type: "captureDebug" })).result.ok).toBe(true);
    expect(document.getElementById("trainer-smoke-sanitizer")).not.toBeNull();
    smoke.__trainerSmokeRestore();
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
    expect(document.querySelector(".llm-debug-card")!.textContent).toBe(before);
    const pre = document.querySelector("pre")!;
    pre.textContent = "private diagnostic";
    expect((await command({ type: "captureDebug" })).result.ok).toBe(false);
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
    pre.textContent = JSON.stringify(
      { schemaVersion: 1, finalAnswer: "T0243 synthetic diagnostic only" },
      null,
      2,
    );
    const extra = document.createElement("p");
    extra.textContent = "private extra node";
    document.querySelector(".llm-debug-card")!.append(extra);
    expect((await command({ type: "captureDebug" })).result.ok).toBe(false);
  });

  it("prepares only the fixed disclosure summary for native-local Enter/Space without synthetic key activation", async () => {
    render(<DebugFixture />);
    expect((await command({ type: "debugKey", key: "Enter" })).result).toEqual({
      ok: true,
      readyForNativeKey: true,
    });
    expect(document.activeElement).toBe(
      document.querySelector(".llm-debug-card > summary"),
    );
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(
      false,
    );
    for (const key of ["Tab", "Escape", "a", "Meta+Q"]) {
      expect((await command({ type: "debugKey", key })).result.ok).toBe(false);
    }
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
