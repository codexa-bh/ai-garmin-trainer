// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState, createRef } from "react";
import { SyncView } from "../src/app/dashboard/sync-view";
import { TerrainTable } from "../src/app/dashboard/terrain-table";
import { analyzeTerrainSections } from "../src/lib/analytics/terrain-sections";
import { emptySyncRun } from "../src/app/dashboard/contracts";
import { AssistantContent } from "../src/app/dashboard/markdown";
import {
  simpleTableFixture,
  tableFixture,
  tableProse,
} from "../scripts/ci/table-fixture";
import { HealthDashboardView } from "../src/app/dashboard/health-metrics";
import { ModelSettingsCard } from "../src/app/dashboard/model-settings-card";
import { useModelSettings } from "../src/app/dashboard/use-model-settings";
import { modelSettingsSnapshot } from "../src/lib/model-settings/policy";
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
    function (this: HTMLElement) {
      const closed = this.closest("details:not([open])");
      return (closed &&
      this !== closed &&
      this.closest("summary")?.parentElement !== closed
        ? []
        : [{ width: 10 }]) as unknown as DOMRectList;
    },
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
    label: "ollama / T0246/Long-local-model-name:exact-tag",
    available: true,
  },
  {
    id: "entry_footer_other",
    provider: "ollama" as const,
    modelId: "T0246/Alternate:Tag",
    displayName: "T0246 alternate",
    label: "ollama / T0246/Alternate:Tag",
    available: true,
  },
];
function composerFixture(eligibility?: "mixed" | "empty") {
  const posts = vi.fn();
  let preference: string | null = eligibility ? "entry_hidden_0" : null;
  const cloud = ["openai", "openai", "deepseek", "openrouter"].map(
    (provider, index) => ({
      id: `entry_hidden_${index}`,
      provider: provider as "openai" | "deepseek" | "openrouter",
      modelId: `T0253/Absent:${index}`,
      label: `${provider} / T0253/Absent:${index}`,
      available: false,
    }),
  );
  const options = eligibility
    ? [...(eligibility === "empty" ? [] : footerOptions), ...cloud]
    : footerOptions;
  const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== "PATCH") posts();
    if (init?.method === "PATCH")
      preference = JSON.parse(String(init.body)).modelId;
    // Use production metadata so privacy allowlists cannot pass against stale copy.
    const body = modelSettingsSnapshot(
      preference
        ? { version: 1, status: "selected", entryId: preference }
        : { version: 1, status: "unselected" },
      {
        catalog: { version: 1, entries: options, defaultEntryId: null },
        configured: {
          openai: false,
          deepseek: false,
          openrouter: false,
          ollama: true,
        },
      },
    );
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
  it("drives only visible Sync semantics, rejects duplicate/private inputs and returns booleans", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    function Fixture() {
      const [running, setRunning] = useState(false);
      const [paused, setPaused] = useState(false);
      return (
        <div className="sync-view-content">
          <section
            aria-labelledby="sync-action-heading"
            data-sync-running={running}
            data-sync-kind={paused ? "paused" : "idle"}
          >
            <button
              aria-label="Sync now — import latest Garmin data"
              disabled={running}
              onClick={() => {
                setRunning(true);
                setPaused(false);
              }}
            >
              Sync latest
            </button>
            <button disabled={running} onClick={() => setRunning(true)}>
              Continue historical import
            </button>
            <details>
              <summary>Technical details</summary>
              <pre>Private diagnostic canary</pre>
            </details>
            {running && (
              <button
                onClick={() => {
                  setRunning(false);
                  setPaused(true);
                }}
              >
                Cancel sync
              </button>
            )}
            <pre className="sync-log">
              <span className="sync-log-entry">Synthetic progress only</span>
            </pre>
          </section>
          <button>Refresh import summary</button>
        </div>
      );
    }
    render(<Fixture />);
    expect((await command({ type: "sync", action: "details" })).result.ok).toBe(
      true,
    );
    expect(document.querySelector("details")?.open).toBe(true);
    expect(
      (await command({ type: "sync", action: "details", value: "private" }))
        .result.ok,
    ).toBe(false);
    expect((await command({ type: "sync", action: "start" })).result.ok).toBe(
      true,
    );
    expect(
      (await command({ type: "sync", action: "observe" })).result,
    ).toMatchObject({
      running: true,
      cancelEnabled: true,
      startEnabled: false,
      progressStarted: true,
    });
    expect((await command({ type: "sync", action: "start" })).result.ok).toBe(
      false,
    );
    expect((await command({ type: "sync", action: "cancel" })).result.ok).toBe(
      true,
    );
    expect(
      (await command({ type: "sync", action: "observe" })).result,
    ).toMatchObject({ paused: true, running: false, startEnabled: true });
    expect(
      (await command({ type: "sync", action: "continue", value: "secret" }))
        .result.ok,
    ).toBe(false);
    expect((await command({ type: "sync", action: "auth" })).result.ok).toBe(
      false,
    );
    expect(
      (await command({ type: "sync", action: "continue" })).result.ok,
    ).toBe(true);
    for (const value of Object.values(
      (await command({ type: "sync", action: "observe" })).result,
    ))
      expect(typeof value).toBe("boolean");
  });
  it("drives fixed actual model owner explicit selection and synthetic draft/keys, returning only booleans and masking all copied content", async () => {
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
    await screen.findByText(
      /ollama \/ T0246\/Long-local-model-name:exact-tag/,
      { selector: "span" },
    );
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
    expect(
      (await command({ type: "composer", action: "reset" })).result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "composer", action: "observe" })).result
        .savedChoice,
    ).toBe(true);
    expect(
      fetcher.mock.calls
        .filter(([, init]) => init?.method === "PATCH")
        .map(([, init]) => init?.body),
    ).toEqual(['{"modelId":"entry_footer_long"}']);
    expect(posts).not.toHaveBeenCalled();
  });
  it.each(["mixed", "empty"] as const)(
    "proves %s eligible choices with unavailable explicit selection, finite actions and exact sanitized warnings",
    async (eligibility) => {
      smoke.__trainerOrdinaryIsolated = { runId: "unit" };
      vi.stubGlobal("innerWidth", 1280);
      vi.stubGlobal("innerHeight", 850);
      const { fetcher, posts } = composerFixture(eligibility);
      await screen.findByText(
        "Provider key is not configured. Save in native Settings and confirm live application; retry availability.",
      );
      let observed = (await command({ type: "composer", action: "observe" }))
        .result;
      expect(observed).toMatchObject({
        ok: true,
        catalogKnown: true,
        unavailableChoice: true,
        noEligibleChoices: eligibility === "empty",
        modelReady: eligibility !== "empty",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        (await command({ type: "composer", action: "draft" })).result
          .draftMatches,
      ).toBe(true);
      if (eligibility === "empty") {
        for (const action of ["choose", "keys"])
          expect((await command({ type: "composer", action })).result.ok).toBe(
            false,
          );
      } else {
        expect(
          (await command({ type: "composer", action: "keys" })).result
            .keysNoSend,
        ).toBe(true);
      }
      expect(
        (
          await command({
            type: "captureView",
            view: "composer",
            preset: "wide",
          })
        ).result.ok,
      ).toBe(true);
      expect(getComputedStyle(screen.getByRole("alert")).visibility).toBe(
        "visible",
      );
      expect(
        getComputedStyle(screen.getByText("private copied transcript"))
          .visibility,
      ).toBe("hidden");
      if (eligibility === "empty")
        expect(
          getComputedStyle(screen.getByText(/No available entries/)).visibility,
        ).toBe("visible");
      smoke.__trainerSmokeRestore();
      if (eligibility === "mixed") {
        await command({ type: "composer", action: "choose" });
        await screen.findByText(
          /ollama \/ T0246\/Long-local-model-name:exact-tag/,
          { selector: "span" },
        );
      }
      expect(
        (await command({ type: "composer", action: "reset" })).result.ok,
      ).toBe(false);
      observed = (await command({ type: "composer", action: "observe" }))
        .result;
      expect(observed.unavailableChoice).toBe(eligibility === "empty");
      expect(observed.noEligibleChoices).toBe(eligibility === "empty");
      expect(JSON.stringify(observed)).not.toMatch(
        /Absent|private|entry_hidden/,
      );
      expect(posts).not.toHaveBeenCalled();
      expect(
        fetcher.mock.calls
          .filter(([, init]) => init?.method === "PATCH")
          .map(([, init]) => init?.body),
      ).toEqual(
        eligibility === "empty" ? [] : ['{"modelId":"entry_footer_long"}'],
      );
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      select.options[0].textContent = "private unknown placeholder";
      expect(
        (
          await command({
            type: "captureView",
            view: "composer",
            preset: "wide",
          })
        ).result.ok,
      ).toBe(false);
      expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
      expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
    },
  );
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
      { type: "health", action: "calories" },
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
  it.each(["dependency", "startup"] as const)(
    "reveals only actual closed %s guidance and refuses private substitutions",
    async (recovery) => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(24, 300, 300, 150),
      );
      smoke.__trainerOrdinaryIsolated = { runId: "unit" };
      vi.stubGlobal("innerWidth", 1280);
      vi.stubGlobal("innerHeight", 850);
      render(
        <div className="sync-view-active">
          <SyncView
            closeSyncView={vi.fn()}
            syncCloseRef={createRef()}
            syncPillKind="error"
            syncPillLabel="Failed"
            runInBackground={vi.fn()}
            syncNow={vi.fn(async () => {})}
            isSyncing={false}
            syncRun={{
              ...emptySyncRun,
              kind: "failed",
              recovery,
              failureSummary: "private failure hidden",
            }}
            syncLogRef={createRef()}
            importSummary={null}
            runAction={vi.fn(async () => {})}
            refreshSummary={vi.fn(async () => {})}
            detailGarminId=""
            setDetailGarminId={vi.fn()}
            backfillDetail={vi.fn(async () => {})}
            refreshDetailCoverage={vi.fn(async () => {})}
            status={{ kind: "idle", message: "" }}
          />
        </div>,
      );
      const help = screen.getByRole("region", { name: "Garmin action setup" });
      help.parentElement!.scrollTop = 30;
      help.scrollIntoView = vi.fn(() => {
        help.parentElement!.scrollTop = 80;
      });
      expect(help.textContent).toContain("Saved data remains available");
      expect(help.textContent).not.toContain("Reconnect Garmin");
      expect(
        (await command({ type: "captureView", view: "sync", preset: "wide" }))
          .result.ok,
      ).toBe(true);
      expect(getComputedStyle(help.querySelector("p")!).visibility).toBe(
        "visible",
      );
      expect(
        getComputedStyle(screen.getByText("private failure hidden")).visibility,
      ).toBe("hidden");
      smoke.__trainerSmokeRestore();
      expect(help.parentElement!.scrollTop).toBe(30);
      help.querySelector("p")!.textContent =
        "private-path-canary Python not found";
      expect(
        (await command({ type: "captureView", view: "sync", preset: "wide" }))
          .result.ok,
      ).toBe(false);
      expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
    },
  );
  it("reveals only closed static Sync action state, never cursor values or substituted diagnostics", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    render(
      <div className="sync-view-active">
        <section className="sync-view-panel">
          <div className="sync-view-header">
            <h1>Sync</h1>
          </div>
          <div className="sync-view-content">
            <section aria-labelledby="sync-action-heading">
              <p>
                <span className="sync-history-status">
                  Older history needs attention.
                </span>
                <span className="sync-next-target">Private cursor canary</span>
              </p>
              <p className="sync-current-status">Latest refresh finished.</p>
              <p className="sync-counts">
                6 activity records processed · 14 health dates refreshed
              </p>
              <details>
                <summary>Technical details</summary>
                <pre>Private log canary</pre>
              </details>
            </section>
          </div>
        </section>
      </div>,
    );
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(true);
    const status = document.querySelector(".sync-history-status")!;
    expect(getComputedStyle(status).visibility).toBe("visible");
    const current = document.querySelector(".sync-current-status")!;
    expect(getComputedStyle(current).visibility).toBe("visible");
    expect(
      getComputedStyle(document.querySelector(".sync-counts")!).visibility,
    ).toBe("hidden");
    expect(
      getComputedStyle(screen.getByText("Private cursor canary")).visibility,
    ).toBe("hidden");
    expect(
      getComputedStyle(screen.getByText("Private log canary")).visibility,
    ).toBe("hidden");
    smoke.__trainerSmokeRestore();
    current.textContent = "Syncing…";
    const cue = document.createElement("span");
    cue.className = "sync-busy-cue";
    cue.setAttribute("aria-hidden", "true");
    current.prepend(cue);
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(true);
    expect(getComputedStyle(cue).visibility).toBe("visible");
    smoke.__trainerSmokeRestore();
    cue.textContent = "private-cue-canary";
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
    current.textContent = "private-path-canary";
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
    current.textContent = "Latest refresh finished.";
    status.textContent = "Private substituted diagnostic";
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  });
  it("refuses a rendered child leaking from collapsed Sync details and restores masks", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    render(
      <div className="sync-view-active">
        <section className="sync-view-panel">
          <div className="sync-view-header">
            <h1>Sync</h1>
          </div>
          <section className="sync-action-card">
            <details>
              <summary>Technical details</summary>
              <p>Private diagnostic</p>
            </details>
          </section>
        </section>
      </div>,
    );
    const child = screen.getByText("Private diagnostic");
    vi.spyOn(child, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  });
  it("keeps Sync scroll containers visible without exposing private descendants or direct ancestor text", async () => {
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    render(
      <div className="sync-view-active">
        <section className="sync-view-panel">
          <div className="sync-view-header">
            <h1>Sync</h1>
          </div>
          <div className="sync-view-content" data-testid="scroller">
            <section aria-labelledby="sync-action-heading">
              <h2 id="sync-action-heading">Run Garmin sync</h2>
              <span className="pill">Syncing</span>
              <button>Cancel sync</button>
              <button>Resume history</button>
              <p data-testid="private-sync">private copied progress</p>
            </section>
          </div>
        </section>
      </div>,
    );
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(true);
    expect(
      screen.getByTestId("scroller").hasAttribute("data-smoke-reveal"),
    ).toBe(true);
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Cancel sync" }))
        .visibility,
    ).toBe("visible");
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Resume history" }))
        .visibility,
    ).toBe("visible");
    expect(
      getComputedStyle(screen.getByTestId("private-sync")).visibility,
    ).toBe("hidden");
    smoke.__trainerSmokeRestore();
    screen
      .getByTestId("scroller")
      .append(document.createTextNode("private direct ancestor text"));
    expect(
      (await command({ type: "captureView", view: "sync", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
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

  describe("finite rendered Health boundary", () => {
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
    function Health({ calories = false }: { calories?: boolean }) {
      const [end, setEnd] = useState<string | null>(null);
      return (
        <>
          <p data-testid="outside">private outside transcript</p>
          <section className="health-dashboard-panel">
            <HealthDashboardView
              days={
                calories
                  ? [
                      [1700, 400, 2100],
                      [1700, 400, null],
                      [null, null, 1800],
                      [null, null, null],
                      [1700, null, 1900],
                      [0, 0, 0],
                      [1700, 400, 2150],
                    ].map(([resting, active, total], index) => ({
                      ...record(`2026-07-${15 + index}`),
                      restingCalories: resting,
                      activeCalories: active,
                      totalCalories: total,
                      calories: null,
                    }))
                  : [
                      { ...record("2026-07-21"), availability: "partial" },
                      record("2026-06-01"),
                    ]
              }
              rangeEnd={end}
              onSelectRange={setEnd}
              notice=""
            />
          </section>
        </>
      );
    }
    it("drives only finite actions and never returns private dates or values", async () => {
      render(<Health />);
      expect(
        (await command({ type: "health", action: "assert-range" })).result.ok,
      ).toBe(false);
      expect(
        (await command({ type: "health", action: "next" })).result.ok,
      ).toBe(false);
      expect(
        (await command({ type: "health", action: "previous" })).result.ok,
      ).toBe(true);
      expect(
        (await command({ type: "health", action: "remember-range" })).result.ok,
      ).toBe(true);
      for (const action of ["weekly", "monthly", "daily"]) {
        expect((await command({ type: "health", action })).result.ok).toBe(
          true,
        );
        expect((await command({ type: "observe" })).result.healthMode).toBe(
          action,
        );
      }
      expect(
        (await command({ type: "health", action: "assert-range" })).result.ok,
      ).toBe(true);
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

    it("reveals only canonical authored Calories after exact shared readout assertions", async () => {
      render(<Health calories />);
      const card = document.querySelector(".health-calories-chart")!;
      const unexpected = document.createElement("b");
      unexpected.textContent = "unexpected private descendant";
      card.append(unexpected);
      expect(
        (await command({ type: "health", action: "calories" })).result.ok,
      ).toBe(true);
      expect(
        (await command({ type: "health", action: "capture-wide" })).result.ok,
      ).toBe(true);
      expect(
        getComputedStyle(card.querySelector(".health-calories-breakdown dd")!)
          .visibility,
      ).toBe("visible");
      expect(
        getComputedStyle(card.querySelector(".recharts-bar-rectangle path")!)
          .visibility,
      ).toBe("visible");
      expect(getComputedStyle(card.querySelector("svg")!).visibility).toBe(
        "visible",
      );
      expect(getComputedStyle(card.querySelector("svg text")!).visibility).toBe(
        "hidden",
      );
      expect(getComputedStyle(unexpected).visibility).toBe("hidden");
      expect(getComputedStyle(screen.getByTestId("outside")).visibility).toBe(
        "hidden",
      );
      smoke.__trainerSmokeRestore();
      card
        .querySelector("button")!
        .setAttribute("aria-label", "noncanonical private value");
      expect(
        (await command({ type: "health", action: "capture-narrow" })).result.ok,
      ).toBe(false);
      expect(
        (await command({ type: "health", action: "calories" })).result.ok,
      ).toBe(false);
    });

    // Keep each real rendered capture/privacy contract independent of navigation
    // and the other viewport's CSS work within the normal per-test deadline.
    it.each(["capture-narrow", "capture-wide"])(
      "%s masks private content without replacing layout",
      async (action) => {
        render(<Health />);
        const comparison = document.querySelector(".health-daily-comparison")!;
        const status = screen.getByRole("status");
        const help = document.getElementById("health-daily-help")!;
        const unexpected = document.createElement("span");
        unexpected.textContent = "unexpected private notice";
        status.append(unexpected);
        const statusBefore = status.textContent;
        const helpBefore = help.textContent;
        const before = comparison.textContent;
        expect((await command({ type: "health", action })).result.ok).toBe(
          true,
        );
        expect(comparison.textContent).toBe(before);
        expect(status.textContent).toBe(statusBefore);
        expect(help.textContent).toBe(helpBefore);
        for (const box of [status, help]) {
          expect(getComputedStyle(box).visibility).toBe("visible");
          expect(getComputedStyle(box).color).toBe("rgba(0, 0, 0, 0)");
          // jsdom miscomputes text-shadow:none as the transparent currentColor;
          // assert the actual applied declaration rather than that serialization.
          const sanitizer = document.getElementById(
            "trainer-smoke-sanitizer",
          ) as HTMLStyleElement;
          const rule = [...sanitizer.sheet!.cssRules].find(
            (rule): rule is CSSStyleRule =>
              rule instanceof CSSStyleRule &&
              rule.selectorText.includes(box.id || '[role="status"]'),
          );
          expect(rule?.style.getPropertyValue("text-shadow")).toBe("none");
          expect(rule?.style.getPropertyPriority("text-shadow")).toBe(
            "important",
          );
        }
        expect(getComputedStyle(unexpected).visibility).toBe("hidden");
        expect(
          getComputedStyle(document.getElementById("health-daily-range")!)
            .visibility,
        ).toBe("hidden");
        for (const privateNode of comparison.querySelectorAll(
          "time, .health-rollup-value span, .health-rollup-value strong, .health-rollup-readout, .health-calories-breakdown dt, .health-calories-breakdown dd, .health-calories-legend span, svg text, .recharts-line-curve, .recharts-dot, .recharts-bar-rectangle, .health-daily-coverage li span",
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
        expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
        expect(status.textContent).toBe(statusBefore);
        expect(help.textContent).toBe(helpBefore);
        expect(getComputedStyle(status).color).not.toBe("rgba(0, 0, 0, 0)");
      },
    );
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

it("limits Activity label selection and masks to exact authored data", async () => {
  smoke.__trainerOrdinaryIsolated = { runId: "unit" };
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 850);
  const sports = ["strength_training", "gravel_cycling", "hiking"];
  function Fixture() {
    const [selected, select] = useState("");
    const sport = sports.find((item) => item === selected);
    const index = sports.indexOf(selected);
    return (
      <>
        <div className="activity-list">
          {sports.map((item, i) => (
            <button
              key={item}
              className={`activity-list-item ${selected === item ? "selected" : ""}`}
              onClick={() => select(item)}
            >
              <strong>{`T0295 synthetic ${item}`}</strong>
              <small>{`2026-01-0${3 - i} · ${item.replaceAll("_", " ")}`}</small>
            </button>
          ))}
        </div>
        {sport && (
          <div className="selected-activity-heading">
            <h2>{`T0295 synthetic ${sport}`}</h2>
            <p>{`2026-01-0${3 - index} · ${sport.replaceAll("_", " ")} · Garmin ID T0295-${sport}`}</p>
          </div>
        )}
        <p>Private unrelated facts</p>
      </>
    );
  }
  render(<Fixture />);
  expect(
    (
      await command({
        type: "captureView",
        view: "activityLabels",
        preset: "wide",
      })
    ).result.ok,
  ).toBe(false);
  expect(
    (await command({ type: "activityLabels", action: "strength" })).result
      .ready,
  ).toBe(true);
  expect(
    (await command({ type: "activityLabels", action: "list" })).result.ready,
  ).toBe(true);
  expect(
    (
      await command({
        type: "captureView",
        view: "activityLabels",
        preset: "wide",
      })
    ).result.ok,
  ).toBe(true);
  expect(
    screen
      .getByText("Private unrelated facts")
      .hasAttribute("data-smoke-reveal"),
  ).toBe(false);
  smoke.__trainerSmokeRestore();
  expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  expect(
    (await command({ type: "activityLabels", action: "gravel" })).result.ready,
  ).toBe(true);
  const small = document.querySelector(".activity-list-item small")!;
  small.textContent = "private activity text";
  expect(
    (
      await command({
        type: "captureView",
        view: "activityLabels",
        preset: "wide",
      })
    ).result.ok,
  ).toBe(false);
  expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  for (const invalid of [
    { type: "activityLabels", action: "hiking", selector: "body" },
    { type: "activityLabels", action: "settings" },
  ])
    expect((await command(invalid)).result.ok).toBe(false);
  delete smoke.__trainerOrdinaryIsolated;
  expect(
    (await command({ type: "activityLabels", action: "observe" })).result.ok,
  ).toBe(false);
});

it.each(["supported", "partial", "capped"])(
  "admits only finite authored Terrain %s, masks numeric/private values and restores after capture/failure",
  async (variant) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      bottom: 10,
      right: 10,
      width: 10,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    smoke.__trainerOrdinaryIsolated = { runId: "unit" };
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 850);
    const analysis = analyzeTerrainSections(
      "T0293-supported",
      "hiking",
      Array.from({ length: 101 }, (_, i) => ({
        elapsedSec: i * 10,
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 10000).toISOString(),
        distanceMeters: i * 10,
        altitudeMeters: i,
        heartRate: 125,
      })),
    );
    if (variant !== "supported") analysis.status = "partial";
    if (variant === "capped") {
      analysis.truncated = true;
      analysis.returnedSections = 100;
      analysis.sectionCount = 105;
    }
    function Fixture() {
      const [selected, select] = useState<string | null>(null);
      return (
        <>
          <div className="selected-activity-heading">
            <h2>{`T0293 synthetic ${variant}`}</h2>
          </div>
          <button className="activity-list-item">
            <strong>{`T0293 synthetic ${variant}`}</strong>
          </button>
          <p>Private unrelated facts</p>
          <TerrainTable
            analysis={analysis}
            selectedId={selected}
            onSelect={(id) => select(selected ? null : id)}
          />
          {selected ? (
            <span aria-label="Selected terrain section elevation interval" />
          ) : null}
        </>
      );
    }
    render(<Fixture />);
    expect(
      (await command({ type: "captureView", view: "terrain", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(
      (await command({ type: "terrain", action: variant })).result.ready,
    ).toBe(true);
    await command({ type: "terrain", action: "toggle" });
    expect(
      (await command({ type: "terrain", action: "observe" })).result,
    ).toMatchObject({ selected: true, highlighted: true, compact: true });
    await command({ type: "terrain", action: "toggle" });
    expect(
      (await command({ type: "terrain", action: "observe" })).result.selected,
    ).toBe(false);
    await command({ type: "terrain", action: "start" });
    expect(
      (await command({ type: "captureView", view: "terrain", preset: "wide" }))
        .result.ok,
    ).toBe(true);
    const region = screen.getByRole("region", { name: "Terrain sections" });
    expect(region.querySelector("p")!.hasAttribute("data-smoke-reveal")).toBe(
      true,
    );
    expect(
      screen
        .getByText("Private unrelated facts")
        .hasAttribute("data-smoke-reveal"),
    ).toBe(false);
    expect(
      within(region)
        .getByText("125", { selector: "td" })
        .hasAttribute("data-smoke-reveal"),
    ).toBe(false);
    smoke.__trainerSmokeRestore();
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
    await command({ type: "captureView", view: "terrain", preset: "wide" });
    region.querySelector("p")!.textContent = "Private replaced copy";
    expect(
      (await command({ type: "captureView", view: "terrain", preset: "wide" }))
        .result.ok,
    ).toBe(false);
    expect(document.querySelector("#trainer-smoke-sanitizer")).toBeNull();
    for (const value of [
      { type: "terrain", action: "settings" },
      { type: "terrain", action: "observe", selector: "body" },
      { type: "terrain", action: "supported", id: "private" },
    ])
      expect((await command(value)).result.ok).toBe(false);
    delete smoke.__trainerOrdinaryIsolated;
    expect(
      (await command({ type: "terrain", action: "observe" })).result.ok,
    ).toBe(false);
  },
);
