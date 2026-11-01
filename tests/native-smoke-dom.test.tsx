// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AssistantContent } from "../src/app/dashboard/markdown";
import {
  simpleTableFixture,
  tableFixture,
  tableProse,
} from "../scripts/ci/table-fixture";
import { HealthDashboardView } from "../src/app/dashboard/health-metrics";
import { ModelSettingsCard } from "../src/app/dashboard/model-settings-card";
import { useModelSettings } from "../src/app/dashboard/use-model-settings";
import type { ModelSettingsSnapshot } from "../src/lib/model-settings/contracts";
import type { HealthDashboardDay } from "../src/app/dashboard/contracts";

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

const footerOptions = [
  {
    id: "entry_footer_long",
    provider: "ollama" as const,
    modelId: "T0246/Long-local-model-name:exact-tag",
    displayName:
      "T0246 long descriptive local model selection for narrow composer footer",
    label:
      "T0246 long descriptive local model selection for narrow composer footer — ollama / T0246/Long-local-model-name:exact-tag",
    available: true,
  },
  {
    id: "entry_footer_other",
    provider: "ollama" as const,
    modelId: "T0246/Alternate:Tag",
    displayName: "T0246 alternate",
    label: "T0246 alternate — ollama / T0246/Alternate:Tag",
    available: true,
  },
];
function composerFixture() {
  const posts = vi.fn();
  const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== "PATCH") posts();
    const saved = init?.body === '{"modelId":"entry_footer_long"}';
    const selected = footerOptions[saved ? 0 : 1];
    const body: ModelSettingsSnapshot = {
      version: 2,
      options: footerOptions,
      selected: saved ? selected.id : null,
      defaultEntryId: footerOptions[1].id,
      effective: {
        entryId: selected.id,
        provider: selected.provider,
        modelName: selected.modelId,
        source: saved ? "saved" : "env",
        available: true,
      },
    };
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  vi.stubGlobal("fetch", fetcher);
  function Fixture() {
    const model = useModelSettings(true);
    const [draft, setDraft] = useState("");
    return (
      <>
        <div className="trainer-heading-row">
          <p className="section-kicker">Daily trainer</p>
          <h2>Chat with your private coach</h2>
        </div>
        <div className="transcript">private copied transcript</div>
        <div className="composer-dock">
          <textarea
            aria-label="Message"
            value={draft}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="composer-submit-group">
            <ModelSettingsCard modelSettings={model} />
            <button disabled={!draft} onClick={posts}>
              Send
            </button>
          </div>
        </div>
      </>
    );
  }
  render(<Fixture />);
  return { fetcher, posts };
}

describe("native-installed rendered smoke boundary", () => {
  it("drives fixed actual model owner selection/reset and synthetic draft/keys, returning only booleans and masking all copied content", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const isText = this.tagName === "TEXTAREA";
        const left = isText ? 100 : this.tagName === "SELECT" ? 500 : 730;
        const width = isText ? 800 : this.tagName === "SELECT" ? 220 : 80;
        const top = isText ? 500 : 610;
        return {
          left,
          right: left + width,
          top,
          bottom: top + 40,
          width,
          height: 40,
        } as DOMRect;
      },
    );
    const { fetcher, posts } = composerFixture();
    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
        false,
      ),
    );
    expect(
      (await command({ type: "composer", action: "draft" })).result
        .draftMatches,
    ).toBe(true);
    expect(
      (await command({ type: "composer", action: "keys" })).result.keysNoSend,
    ).toBe(true);
    await command({ type: "composer", action: "choose" });
    await screen.findByRole("button", { name: "Reset to configured default" });
    const observed = (await command({ type: "composer", action: "observe" }))
      .result;
    for (const key of [
      "modelReady",
      "singleControl",
      "footerOrder",
      "fitsViewport",
      "draftMatches",
      "textareaStable",
      "savedChoice",
      "keysNoSend",
    ])
      expect(observed[key]).toBe(true);
    expect(JSON.stringify(observed)).not.toMatch(
      /private|exact-tag|T0246-composer-unit/,
    );
    expect(
      (await command({ type: "captureView", view: "composer", preset: "wide" }))
        .result.ok,
    ).toBe(true);
    expect(
      getComputedStyle(screen.getByText("private copied transcript"))
        .visibility,
    ).toBe("hidden");
    expect(getComputedStyle(screen.getByRole("combobox")).visibility).toBe(
      "visible",
    );
    expect(
      getComputedStyle(screen.getByRole("textbox", { name: "Message" }))
        .visibility,
    ).toBe("visible");
    expect(
      document.getElementById("trainer-smoke-sanitizer")?.textContent,
    ).not.toMatch(/position|display|width|height/);
    smoke.__trainerSmokeRestore();
    await command({ type: "composer", action: "reset" });
    await screen.findByRole("option", {
      name: `Default · ${footerOptions[1].label}`,
    });
    expect(
      (await command({ type: "composer", action: "observe" })).result
        .defaultChoice,
    ).toBe(true);
    expect(
      fetcher.mock.calls
        .filter(([, init]) => init?.method === "PATCH")
        .map(([, init]) => init?.body),
    ).toEqual(['{"modelId":"entry_footer_long"}', '{"modelId":null}']);
    expect(posts).not.toHaveBeenCalled();
  });
  it("refuses composer privileges, unknown/extra/private values, copied drafts/catalog captures and non-Trainer surfaces", async () => {
    expect(
      (await command({ type: "composer", action: "draft" })).result.ok,
    ).toBe(false);
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    const { posts, fetcher } = composerFixture();
    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
        false,
      ),
    );
    for (const action of [
      "send",
      "cancel",
      "login",
      "select",
      "capture",
      "eval",
    ])
      expect((await command({ type: "composer", action })).result.ok).toBe(
        false,
      );
    for (const extra of [
      { value: "private" },
      { selector: "textarea" },
      { modelId: "entry_private" },
      { key: "Enter" },
    ])
      expect(
        (await command({ type: "composer", action: "choose", ...extra })).result
          .ok,
      ).toBe(false);
    const textarea = screen.getByRole("textbox", {
      name: "Message",
    }) as HTMLTextAreaElement;
    textarea.value = "private preexisting draft";
    expect(
      (await command({ type: "composer", action: "draft" })).result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "captureView", view: "composer", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    textarea.value = "";
    await command({ type: "composer", action: "draft" });
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    select.options[1].textContent = "private unexpected model label";
    expect(
      (await command({ type: "composer", action: "choose" })).result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "captureView", view: "composer", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
    const aside = document.createElement("aside");
    aside.className = "settings-sheet";
    document.body.append(aside);
    expect(
      (await command({ type: "composer", action: "observe" })).result.ok,
    ).toBe(false);
    expect(posts).not.toHaveBeenCalled();
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });
  it("ordinary mode rejects debug disclosure, Health and Settings controls and observations", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    const click = vi.fn();
    render(
      <>
        <DebugFixture />
        <section className="health-dashboard-panel">
          <button onClick={click}>Daily</button>
          <table className="health-daily-matrix">
            <thead>
              <tr>
                {Array.from({ length: 7 }, (_, i) => (
                  <th key={i}>
                    <time dateTime="2026-01-01">private date</time>
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </section>
      </>,
    );
    const observed = (await command({ type: "observe" })).result;
    for (const key of [
      "llmDebug",
      "healthMode",
      "healthReady",
      "healthMissingRecord",
      "healthPartialRecord",
      "healthPreviousEnabled",
      "healthNextEnabled",
      "healthLatestEnabled",
    ])
      expect(observed[key]).toBeUndefined();
    for (const request of [
      { type: "click", target: "LLM debug traces" },
      { type: "click", target: "First LLM trace" },
      { type: "debugKey", key: "Enter" },
      { type: "captureDebug" },
      { type: "health", action: "daily" },
      { type: "health", action: "remember-range" },
      { type: "health", action: "capture-wide" },
      { type: "settings", action: "open" },
    ])
      expect((await command(request)).result.ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
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
  it("requests current own-WebView screen updates rather than a cached pre-mask snapshot", () => {
    const capture = readFileSync("src-tauri/src/dev_capture.rs", "utf8");
    expect(capture).toContain("class!(WKSnapshotConfiguration)");
    expect(capture).toContain("setAfterScreenUpdates: true");
    expect(capture).toContain("takeSnapshotWithConfiguration: configuration");
    expect(capture).not.toContain(
      "takeSnapshotWithConfiguration:std::ptr::null",
    );
    expect(capture).not.toMatch(
      /makeKeyAndOrderFront|activateIgnoringOtherApps|CGWindowListCreateImage/,
    );
  });

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
              days={[
                { ...record("2026-07-21"), availability: "partial" },
                record("2026-06-01"),
              ]}
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
      const comparison = document.querySelector(".health-daily-comparison")!;
      const before = comparison.textContent;
      expect((await command({ type: "health", action })).result.ok).toBe(true);
      expect(comparison.textContent).toBe(before);
      for (const privateNode of comparison.querySelectorAll(
        "time, .health-rollup-value span, .health-rollup-value strong, .health-rollup-readout, svg text, .recharts-line-curve, .recharts-dot, .recharts-bar-rectangle, .health-daily-coverage li span",
      )) {
        expect(getComputedStyle(privateNode).visibility).toBe("hidden");
      }
      expect(
        getComputedStyle(
          comparison.querySelector(".health-rollup-heading strong")!,
        ).visibility,
      ).toBe("visible");
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

function tableSmokeFixture(surface: string) {
  smoke.__trainerOrdinaryIsolated = { runId: "unit" };
  vi.stubGlobal("innerWidth", 420);
  vi.stubGlobal("innerHeight", 850);
  const inChat = surface.startsWith("chat");
  render(
    <>
      <p>private outside content</p>
      <section className={inChat ? "transcript" : "training-plan-active"}>
        <article className="training-plan-report">
          <h3>{`T0249 synthetic ${surface}`}</h3>
          <AssistantContent
            content={
              surface === "chat-simple"
                ? simpleTableFixture
                : tableFixture(surface !== "plan")
            }
          />
        </article>
      </section>
    </>,
  );
  const table = document.querySelector("table")!;
  const wrapper = table.parentElement!;
  table.scrollIntoView = vi.fn(() => {
    throw Error("Must not scroll hidden ancestors");
  });
  vi.spyOn(table.tHead!, "getBoundingClientRect").mockReturnValue({
    width: 520,
    top: 10,
    bottom: 50,
  } as DOMRect);
  Object.defineProperty(wrapper, "scrollWidth", { value: 520 });
  Object.defineProperty(wrapper, "clientWidth", { value: 350 });
  wrapper.style.overflowX = "auto";
  vi.spyOn(table, "getBoundingClientRect").mockReturnValue({
    width: 520,
  } as DOMRect);
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 350,
  } as DOMRect);
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      const rect = { width: 10, top: 0 };
      return this.toString() === tableProse
        ? [rect, { width: 10, top: 20 }]
        : [rect];
    },
  });
  return { table, wrapper };
}

describe("finite ordinary synthetic table smoke", () => {
  it.each(["plan", "review", "chat", "chat-simple"])(
    "verifies only seeded %s, returns booleans and masks canonical tables without geometry changes",
    async (surface) => {
      const { table } = tableSmokeFixture(surface);
      const result = (await command({ type: "tables", surface, edge: "start" }))
        .result;
      expect(result).toMatchObject({
        ok: true,
        compact: true,
        proseWrapped: true,
        contained: true,
        allCells: true,
        scrollable: true,
        headerVisible: true,
      });
      expect(
        Object.values(result).filter((value) => typeof value === "string"),
      ).toEqual([surface, "start"]);
      expect(
        (
          await command({
            type: "captureView",
            view: "tables",
            preset: "narrow",
          })
        ).result.ok,
      ).toBe(true);
      expect(table.getAttribute("data-smoke-reveal")).toBe("");
      expect(
        screen
          .getByText("private outside content")
          .hasAttribute("data-smoke-reveal"),
      ).toBe(false);
      expect(table.getAttribute("style")).toBeNull();
      expect(
        document.querySelector("#trainer-smoke-sanitizer")?.textContent,
      ).not.toMatch(/position|width|height|display/);
      smoke.__trainerSmokeRestore();
      expect(document.querySelector("#trainer-smoke-sanitizer")).toBeNull();
      expect(table.hasAttribute("data-smoke-reveal")).toBe(false);
    },
  );

  it("refuses private direct ancestor text rather than revealing a scroller indiscriminately", async () => {
    const { table } = tableSmokeFixture("plan");
    table.parentElement!.parentElement!.append(
      document.createTextNode("private direct content"),
    );
    await command({ type: "tables", surface: "plan", edge: "start" });
    expect(
      (await command({ type: "captureView", view: "tables", preset: "narrow" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("#trainer-smoke-sanitizer")).toBeNull();
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  });

  it("refuses captures when a canonical table header is clipped/offscreen", async () => {
    const { table } = tableSmokeFixture("plan");
    vi.mocked(table.tHead!.getBoundingClientRect).mockReturnValue({
      width: 520,
      top: -100,
      bottom: -60,
    } as DOMRect);
    expect(
      (await command({ type: "tables", surface: "plan", edge: "start" })).result
        .headerVisible,
    ).toBe(false);
    expect(
      (await command({ type: "captureView", view: "tables", preset: "narrow" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("#trainer-smoke-sanitizer")).toBeNull();
  });

  it("refuses private/mutated or ambiguous content and restores masks on failure", async () => {
    const { table } = tableSmokeFixture("plan");
    await command({ type: "tables", surface: "plan", edge: "start" });
    await command({ type: "captureView", view: "tables", preset: "narrow" });
    table.querySelector("td")!.textContent = "private document";
    expect(
      (await command({ type: "captureView", view: "tables", preset: "narrow" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("#trainer-smoke-sanitizer")).toBeNull();
    expect(
      (await command({ type: "tables", surface: "plan", edge: "start" })).result
        .ok,
    ).toBe(false);
    expect(
      (
        await command({
          type: "tables",
          surface: "plan",
          edge: "start",
          selector: "body",
        })
      ).result.ok,
    ).toBe(false);
  });

  it("rejects debug/default mode, unknown surfaces/edges and preselection captures", async () => {
    tableSmokeFixture("plan");
    expect(
      (await command({ type: "captureView", view: "tables", preset: "narrow" }))
        .result.ok,
    ).toBe(false);
    for (const value of [
      { surface: "settings", edge: "start" },
      { surface: "plan", edge: "arbitrary" },
    ])
      expect((await command({ type: "tables", ...value })).result.ok).toBe(
        false,
      );
    delete smoke.__trainerOrdinaryIsolated;
    expect(
      (await command({ type: "tables", surface: "plan", edge: "start" })).result
        .ok,
    ).toBe(false);
  });
});
