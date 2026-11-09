/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import React from "react";
import {
  render,
  cleanup,
  act,
  fireEvent,
  screen,
} from "@testing-library/react";
import { useMemoryFeature } from "@/app/dashboard/use-memory";
import type { Status } from "@/app/dashboard/contracts";
import { MemoryContent } from "@/app/dashboard/memory-content";
import type { SummaryInspection } from "@/app/dashboard/use-memory";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const invoke = vi.fn(async (_name: string, _args: unknown) => {});
const source = readFileSync("src-tauri/debug/smoke.js", "utf8");
async function command(command: unknown) {
  await window.__trainerSmoke({
    requestId: "unit",
    expectedRunId: "unit",
    command,
  });
  return (invoke.mock.calls.at(-1)?.[1] as { result: Record<string, unknown> })
    .result;
}
beforeEach(() => {
  invoke.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.__trainerOrdinaryIsolated = { runId: "unit" };
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: { invoke },
    configurable: true,
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{ width: 10 }] as unknown as DOMRectList,
  );
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 850);
  document.body.innerHTML = `<section aria-label="AI trainer dashboard" data-renderer-ready="true"></section><aside class="settings-sheet memory-sheet" role="dialog" aria-labelledby="memory-sheet-heading"><h2 id="memory-sheet-heading">Memory</h2><div class="memory-root-card" data-memory-ready="true" data-memory-chat-ready="true" data-memory-view="manage"><h3>What your trainer remembers</h3><p>private copied sentinel</p><button>Add preference</button><button>Refresh</button><button>Clear saved memory</button><section aria-label="Manual preferences"><h4>Your preferences</h4></section><section aria-label="Rebuild from chat history"><h3>Update memory from chat history</h3><p>private counts and cost</p><button disabled>Review and update</button></section><label>Preference<textarea></textarea></label><button>Save preference</button></div></aside>`;
  window.eval(source);
});
afterEach(async () => {
  window.__trainerSmokeRestore();
  await command({ type: "memory", action: "cancel-confirm" });
  await command({ type: "memory", action: "fixture-reset" });
  cleanup();
  delete window.__trainerOrdinaryIsolated;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("admits only the fixed whole-summary editor action and refuses private generated text or caller-supplied input", async () => {
  const panel = document.querySelector(".memory-root-card")!;
  const button = document.createElement("button");
  button.textContent = "Edit summary";
  const click = vi.fn();
  button.addEventListener("click", click);
  panel.append(button);
  expect((await command({ type: "memory", action: "summary-edit" })).ok).toBe(
    true,
  );
  expect(click).toHaveBeenCalledOnce();
  expect(
    (await command({ type: "memory", action: "summary-edit", text: "private" }))
      .ok,
  ).toBe(false);
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Generated summary");
  section.innerHTML =
    '<p class="memory-text">private copied generated text</p>';
  panel.append(section);
  expect((await command({ type: "memory", action: "summary-edit" })).ok).toBe(
    false,
  );
  expect(click).toHaveBeenCalledOnce();
});
it("returns closed booleans, uses only fixed run draft and preserves exact confirmation ownership", async () => {
  expect(await command({ type: "memory", action: "observe" })).toEqual({
    ok: true,
    action: "observe",
    trustedInput: false,
    visible: true,
    loaded: true,
    presentationFixture: false,
    progressiveComplete: false,
    confirmationVisible: false,
    hasManual: false,
    updatedManual: false,
    off: false,
    editing: true,
    rebuildVisible: true,
    rebuildStartDisabled: true,
    rebuildCancelDisabled: true,
  });
  const input = document.querySelector("textarea")!;
  const inputEvent = vi.fn();
  input.addEventListener("input", inputEvent);
  expect((await command({ type: "memory", action: "draft" })).ok).toBe(true);
  expect(input.value).toBe(
    "T0272-unit: Short weekdays chosen for time; long weekdays rejected. Fake discussion https://example.invalid/training.",
  );
  expect(inputEvent).toHaveBeenCalledOnce();
  const confirm = window.confirm;
  const clicked = vi.fn();
  document.querySelectorAll("button")[2].addEventListener("click", clicked);
  expect((await command({ type: "memory", action: "clear" })).ok).toBe(true);
  expect(clicked).toHaveBeenCalledOnce();
  expect(window.confirm).toBe(confirm);
});
it("uses only the finite6578-scalar summary draft above target and refuses altered editor values", async () => {
  const panel = document.querySelector(".memory-root-card")!;
  panel.setAttribute("aria-label", "Edit generated summary");
  // The real editor's accessible section is inside the Memory root.
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Edit generated summary");
  panel.append(section);
  const input = document.querySelector("textarea")!;
  expect((await command({ type: "memory", action: "draft-update" })).ok).toBe(
    true,
  );
  expect([...input.value].length).toBe(6578);
  expect(input.value).toContain("T0272-unit");
  expect(
    (await command({ type: "memory", action: "draft-update", text: "private" }))
      .ok,
  ).toBe(false);
  input.value += "altered";
  expect((await command({ type: "memory", action: "draft-update" })).ok).toBe(
    false,
  );
});
it("admits the native-copy probe only for the exact focused authored summary; no caller text/key/clipboard result", async () => {
  const panel = document.querySelector<HTMLElement>(".memory-root-card")!;
  const input = document.querySelector("textarea")!;
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Edit generated summary");
  section.append(input);
  panel.replaceChildren(section);
  expect((await command({ type: "memory", action: "draft-update" })).ok).toBe(
    true,
  );
  expect((await command({ type: "memory", action: "native-copy" })).ok).toBe(
    false,
  );
  input.focus();
  const result = await command({ type: "memory", action: "native-copy" });
  expect(result.ok).toBe(true);
  expect(JSON.stringify(result)).not.toContain(input.value);
  expect(result.trustedInput).toBe(false); // Renderer admission alone is NOT native evidence.
  for (const extra of [
    { key: "a" },
    { text: "private" },
    { clipboard: true },
    { selector: "body" },
  ])
    expect(
      (await command({ type: "memory", action: "native-copy", ...extra })).ok,
    ).toBe(false);
  input.value += "private";
  expect((await command({ type: "memory", action: "native-copy" })).ok).toBe(
    false,
  );
  expect((await command({ type: "memory", action: "editor-check" })).ok).toBe(
    false,
  );
  delete window.__trainerOrdinaryIsolated;
  expect((await command({ type: "memory", action: "native-copy" })).ok).toBe(
    false,
  );
});
it("checks only full-window long-editor geometry with visible actions and internal scroll", async () => {
  const panel = document.querySelector<HTMLElement>(".memory-root-card")!;
  const input = document.querySelector("textarea")!;
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Edit generated summary");
  section.append(input);
  const save = document.createElement("button");
  save.textContent = "Save summary";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel edit";
  panel.replaceChildren(section, save, cancel);
  panel.classList.add("memory-summary-editing");
  await command({ type: "memory", action: "draft-update" });
  input.focus();
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
    width: 1200,
    height: 600,
  } as DOMRect);
  Object.defineProperty(input, "scrollHeight", {
    configurable: true,
    value: 1800,
  });
  Object.defineProperty(input, "clientHeight", {
    configurable: true,
    value: 600,
  });
  expect((await command({ type: "memory", action: "editor-check" })).ok).toBe(
    true,
  );
  expect(input.scrollTop).toBeGreaterThan(0);
  vi.spyOn(cancel, "getBoundingClientRect").mockReturnValue({
    top: 900,
    bottom: 950,
  } as DOMRect);
  expect((await command({ type: "memory", action: "editor-check" })).ok).toBe(
    false,
  );
  expect(
    (await command({ type: "memory", action: "editor-check", height: 600 })).ok,
  ).toBe(false);
});
it("waits for retained-chat startup inspection before fixed native mutations, without hiding global content", async () => {
  const panel = document.querySelector<HTMLElement>(".memory-root-card")!;
  panel.dataset.memoryChatReady = "false";
  expect((await command({ type: "memory", action: "observe" })).loaded).toBe(
    false,
  );
  expect(panel.dataset.memoryReady).toBe("true");
  expect((await command({ type: "memory", action: "forget" })).ok).toBe(false);
  panel.dataset.memoryChatReady = "true";
  expect((await command({ type: "memory", action: "observe" })).loaded).toBe(
    true,
  );
});
it("refuses unknown/extra/private selectors, noncanonical content and debug mode without edits", async () => {
  const input = document.querySelector("textarea")!;
  for (const value of [
    { type: "memory", action: "export" },
    { type: "memory", action: "rebuild-start" },
    { type: "memory", action: "rebuild-cancel" },
    { type: "memory", action: "draft", text: "private" },
    { type: "memory", action: "observe", selector: "body" },
  ])
    expect((await command(value)).ok).toBe(false);
  input.value = "private draft";
  expect((await command({ type: "memory", action: "draft" })).ok).toBe(false);
  expect(input.value).toBe("private draft");
  const paragraph = document.createElement("p");
  paragraph.className = "memory-text";
  paragraph.textContent = "unrecognized saved fact";
  document
    .querySelector('[aria-label="Manual preferences"]')!
    .append(paragraph);
  expect((await command({ type: "memory", action: "observe" })).ok).toBe(false);
  paragraph.remove();
  delete window.__trainerOrdinaryIsolated;
  expect((await command({ type: "memory", action: "draft" })).ok).toBe(false);
});
it("enters the same history view when its overview link truthfully says running", async () => {
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  const link = document.createElement("button");
  link.textContent = "Update from chat history · running";
  const clicked = vi.fn();
  link.addEventListener("click", clicked);
  document.querySelector(".memory-root-card")!.append(link);
  expect(
    (await command({ type: "memory", action: "rebuild-preflight" })).ok,
  ).toBe(true);
  expect(clicked).toHaveBeenCalledOnce();
});
it("only scrolls the fixed preflight; it cannot start/cancel paid work or return source/count/cost text", async () => {
  const section = document.querySelector(
    '[aria-label="Rebuild from chat history"]',
  ) as HTMLElement;
  section.scrollIntoView = vi.fn();
  const clicked = vi.fn();
  section.addEventListener("click", clicked);
  const result = await command({ type: "memory", action: "rebuild-preflight" });
  expect(result.ok).toBe(true);
  expect(section.scrollIntoView).not.toHaveBeenCalled();
  expect(clicked).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("private");
});
it("admits only fixed presentation snapshots, blocks all Memory POSTs locally and restores fetch", async () => {
  document.querySelector("textarea")!.remove();
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  for (const action of [
    "fixture-populated",
    "fixture-off",
    "fixture-history",
    "fixture-running",
    "fixture-complete",
    "fixture-interrupted",
    "fixture-failed",
    "fixture-cancelled",
    "fixture-unknown",
  ]) {
    const result = await command({ type: "memory", action });
    expect(result.ok).toBe(true);
    expect(result.presentationFixture).toBe(true);
    const value = await fetch("/api/cross-chat-summary?view=content");
    expect(value.status).toBe(action === "fixture-unknown" ? 503 : 200);
    if (value.ok) {
      const dto = (await value.json()) as {
        stored: { version: 2; text: string };
        preferences: { id: string; text: string }[];
        rebuild: {
          counts: { excludedUserMessages: number };
          operation: { state: string; reason: string | null } | null;
        };
      };
      expect(dto.stored.version).toBe(2);
      expect(dto.stored.text.split("\n")).toHaveLength(3);
      expect(dto.preferences).toEqual([
        { id: "fixture_preference", text: "Keep explanations concise." },
      ]);
      expect(dto.rebuild.counts.excludedUserMessages).toBe(184);
      if (action === "fixture-failed")
        expect(dto.rebuild.operation).toMatchObject({
          state: "interrupted",
          reason: "summary_invalid_output",
        });
      if (action === "fixture-cancelled")
        expect(dto.rebuild.operation?.state).toBe("cancelled");
    }
    await expect(
      fetch("/api/cross-chat-summary", { method: "POST" }),
    ).rejects.toThrow(/cannot mutate/);
    for (const mutation of [
      "confirm",
      "save",
      "enable",
      "disable",
      "refresh",
      "retry",
    ])
      expect((await command({ type: "memory", action: mutation })).ok).toBe(
        false,
      );
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await command({ type: "memory", action: "fixture-reset" }))
      .presentationFixture,
  ).toBe(false);
  expect(fetch).toBe(fetcher);
  delete window.__trainerOrdinaryIsolated;
  expect(
    (await command({ type: "memory", action: "fixture-populated" })).ok,
  ).toBe(false);
});
function MemoryFixtureHarness() {
  const [, setStatus] = React.useState<Status>({ kind: "ok", message: "" });
  const feature = useMemoryFeature({ setStatus });
  const { loadMemories } = feature;
  React.useEffect(() => {
    loadMemories(false).catch(() => {
      throw new Error("Test load failed");
    });
  }, [loadMemories]);
  return React.createElement(MemoryContent, {
    ...feature,
    onOpenSource: vi.fn(),
    runInBackground: (work) => {
      work.catch(() => {
        throw new Error("Test action failed");
      });
    },
  });
}
it.each([
  "fixture-ordinary",
  "fixture-ordinary-failed",
  "fixture-ordinary-interrupted",
])(
  "proves automatic ordinary temporal DOM reconciliation and no mutation for %s",
  async (fixture) => {
    vi.useFakeTimers();
    document.querySelector("textarea")!.remove();
    const original = vi.fn();
    vi.stubGlobal("fetch", original);
    expect(
      (await command({ type: "memory", action: fixture, text: "private" })).ok,
    ).toBe(false);
    delete window.__trainerOrdinaryIsolated;
    expect((await command({ type: "memory", action: fixture })).ok).toBe(false);
    window.__trainerOrdinaryIsolated = { runId: "unit" };
    expect((await command({ type: "memory", action: fixture })).ok).toBe(true);
    const aside = document.querySelector("aside")!;
    aside.replaceChildren();
    await act(async () => {
      render(React.createElement(MemoryFixtureHarness), { container: aside });
    });
    expect(
      screen.getByText(/Recent conversation updates pending/),
    ).toBeTruthy();
    expect(
      (await command({ type: "memory", action: "observe" }))
        .progressiveComplete,
    ).toBe(false);
    for (const action of ["retry", "save", "confirm", "disable"]) {
      expect((await command({ type: "memory", action })).ok).toBe(false);
    }
    await expect(
      fetch("/api/cross-chat-summary", {
        method: "POST",
        body: JSON.stringify({ version: 2, action: "retry" }),
      }),
    ).rejects.toThrow(/cannot mutate/);
    for (let tick = 0; tick < 6; tick++) {
      await act(() => vi.advanceTimersByTimeAsync(2000));
      const observed = await command({ type: "memory", action: "observe" });
      expect(observed.progressiveComplete).toBe(tick === 5);
      if (tick === 3) expect(screen.getByText(/Connection lost/)).toBeTruthy();
    }
    const terminal =
      fixture === "fixture-ordinary"
        ? /Saved memory available/
        : fixture === "fixture-ordinary-failed"
          ? /provider could not finish/
          : /update was interrupted/;
    expect(screen.getByText(terminal)).toBeTruthy();
    expect(
      screen.queryByText(/Recent conversation updates pending|Connection lost/),
    ).toBeNull();
    const fetcher = vi.spyOn(globalThis, "fetch");
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(fetcher).not.toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
    // Ordinary expiry uses the same unconditional reset owner, never a new timer.
    await act(() => vi.advanceTimersByTimeAsync(120000));
    expect(fetch).toBe(original);
  },
);
it("binds the finite progressive response sequence to actual production hook observations and refuses mutation/extra input", async () => {
  vi.useFakeTimers();
  document.querySelector("textarea")!.remove();
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  const original = vi.fn();
  vi.stubGlobal("fetch", original);
  expect(
    (
      await command({
        type: "memory",
        action: "fixture-progressive",
        text: "private",
      })
    ).ok,
  ).toBe(false);
  expect(
    (await command({ type: "memory", action: "fixture-progressive" })).ok,
  ).toBe(true);
  const aside = document.querySelector("aside")!;
  aside.replaceChildren();
  await act(async () => {
    render(React.createElement(MemoryFixtureHarness), { container: aside });
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Update from chat history/ }),
  );
  expect(
    (await command({ type: "memory", action: "observe" })).progressiveComplete,
  ).toBe(false);
  await expect(
    fetch("/api/cross-chat-summary", { method: "POST" }),
  ).rejects.toThrow(/cannot mutate/);
  for (let n = 0; n < 6; n++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const result = await command({ type: "memory", action: "observe" });
    expect(result.progressiveComplete).toBe(n === 5);
  }
  expect(original).not.toHaveBeenCalled();
  expect(screen.getByText("Saved memory updated")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Review and update" }),
  ).toBeNull();
  // A failed read now intentionally retains the last projection. Reset must
  // observe its asynchronous replacement, not reject that known transitional DOM.
  fireEvent.click(screen.getByRole("button", { name: "Back to memory" }));
  await act(async () => {
    await command({ type: "memory", action: "fixture-unknown" });
  });
  const restored = await (
    await fetch("/api/cross-chat-summary?view=content")
  ).json();
  expect(restored.error).toBeTruthy();
  original.mockResolvedValue(
    new Response(
      JSON.stringify({
        version: 1,
        state: "fresh",
        reason: null,
        enabled: true,
        expected: { revision: 3, privacy: 0, control: 1, manual: 0 },
        stored: { version: 2, text: "" },
        preferences: [],
        legacy: [],
        historical: { candidates: [], manifests: [] },
        reservedUsdToday: 0,
        estimatedUsdToday: 0,
        unknownReservedUsd: 0,
        priceBasis: "authored",
        selectedChat: {
          conversationId: "A",
          segmentRevision: 0,
          pin: null,
          reason: null,
        },
      }),
    ),
  );
  await act(async () => {
    expect(
      (await command({ type: "memory", action: "fixture-reset" })).ok,
    ).toBe(true);
  });
  expect(fetch).toBe(original);
  const final = await command({ type: "memory", action: "observe" });
  expect(final).toMatchObject({ loaded: true, presentationFixture: false });
  vi.useRealTimers();
});
it("permits only closed non-generating fixed history reviews, never caller inputs or mutations", async () => {
  document.querySelector("textarea")!.remove();
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  await command({ type: "memory", action: "fixture-history" });
  const expected = { revision: 3, privacy: 0, control: 1, manual: 0 };
  const selection = {
    version: 1,
    conversationIds: ["fixture_chat_0"],
    includeLegacy: true,
  };
  const review = { version: 2, expected, action: "rebuild-review", selection };
  const result = await (
    await fetch("/api/cross-chat-summary", {
      method: "POST",
      body: JSON.stringify(review),
    })
  ).json();
  expect(result.rebuild.selection).toEqual(selection);
  expect(result.rebuild.counts).toMatchObject({
    includedUserMessages: 19,
    excludedUserMessages: 181,
    selectedChats: 1,
  });
  for (const changed of [
    { ...review, force: true },
    { ...review, action: "rebuild-start" },
    { ...review, selection: { ...selection, conversationIds: ["private-id"] } },
    { ...review, selection: { ...selection, text: "private" } },
    { ...review, expected: { ...expected, control: 2 } },
  ])
    await expect(
      fetch("/api/cross-chat-summary", {
        method: "POST",
        body: JSON.stringify(changed),
      }),
    ).rejects.toThrow(/cannot mutate/);
  for (const action of ["usage", "chat-details", "refresh"])
    expect((await command({ type: "memory", action })).ok).toBe(false);
});
it.each([
  { name: "overview", actions: [] },
  { name: "history review", actions: ["rebuild-preflight"] },
  {
    name: "history confirmation",
    actions: ["rebuild-preflight", "history-effects"],
  },
  {
    name: "cancelled confirmation",
    actions: ["rebuild-preflight", "history-effects", "cancel-confirm"],
  },
  { name: "management", actions: ["manage"] },
  {
    name: "failed validation result",
    fixture: "fixture-failed",
    actions: ["rebuild-preflight"],
  },
  {
    name: "cancelled result",
    fixture: "fixture-cancelled",
    actions: ["rebuild-preflight"],
  },

  { name: "back navigation", actions: ["manage", "back"] },
  { name: "Separate preference removal confirmation", actions: ["forget"] },
])(
  "captures and restores actual production Memory $name with fixed authored content",
  async ({ actions, fixture }) => {
    document.querySelector("textarea")!.remove();
    document
      .querySelector('[aria-label="Rebuild from chat history"]')!
      .remove();
    await command({ type: "memory", action: fixture ?? "fixture-populated" });
    const dto = (await (
      await fetch("/api/cross-chat-summary?view=content")
    ).json()) as SummaryInspection;
    const aside = document.querySelector("aside")!;
    aside.querySelector(".memory-root-card")!.remove();
    render(
      React.createElement(MemoryContent, {
        memory: dto,
        densifyReview: null,
        densifyMemory: vi.fn(),
        memoryMessage: "",
        isMemoryLoading: false,
        isMemoryReadUnavailable: false,
        pendingMemoryAction: null,
        loadMemories: vi.fn(),
        reviewHistory: vi.fn(),
        changeMemory: vi.fn(),
        editingMemoryId: null,
        editingMemoryText: "",
        setEditingMemoryId: vi.fn(),
        setEditingMemoryText: vi.fn(),
        cancelMemoryEdit: vi.fn(),
        beginMemoryEdit: vi.fn(),
        canDiscardMemoryEdit: () => true,
        onOpenSource: vi.fn(),
        runInBackground: vi.fn(),
      }),
      { container: aside.appendChild(document.createElement("div")) },
    );
    for (const action of actions)
      expect((await command({ type: "memory", action })).ok).toBe(true);
    const result = await command({
      type: "captureView",
      view: "memory",
      preset: "wide",
    });
    expect(result).toMatchObject({ ok: true });
    window.__trainerSmokeRestore();
    expect(
      (await command({ type: "memory", action: "observe" }))
        .presentationFixture,
    ).toBe(true);
  },
);
it("exercises only supplied Densify presentation through the actual hook, refuses nonfixture dispatch and masks unknown candidates", async () => {
  document.querySelector("textarea")!.remove();
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  const fetcher = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  expect((await command({ type: "memory", action: "densify" })).ok).toBe(false);
  expect(
    (
      await command({
        type: "memory",
        action: "fixture-densify-ready",
        text: "private",
      })
    ).ok,
  ).toBe(false);
  await command({ type: "memory", action: "fixture-densify-ready" });
  document.querySelector(".memory-root-card")!.remove();
  function Harness() {
    const [, setStatus] = React.useState<Status>({ kind: "ok", message: "" });
    const feature = useMemoryFeature({ setStatus });
    const { loadMemories } = feature;
    React.useEffect(() => {
      loadMemories(false).catch(() => {
        throw Error("Test read failed");
      });
    }, [loadMemories]);
    return React.createElement(MemoryContent, {
      ...feature,
      onOpenSource: vi.fn(),
      runInBackground: (work) => {
        work.catch(() => {
          throw Error("Test action failed");
        });
      },
    });
  }
  render(React.createElement(Harness), {
    container: document.querySelector("aside")!,
  });
  await screen.findByRole("button", { name: "Densify summary" });
  await act(async () => {
    expect((await command({ type: "memory", action: "densify" })).ok).toBe(
      true,
    );
  });
  await screen.findByRole("heading", { name: "Review densified summary" });
  const preview = screen.getByRole("region", {
    name: "Complete candidate summary",
  });
  expect([...preview.textContent!]).toHaveLength(7000);
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(getComputedStyle(preview).visibility).toBe("visible");
  window.__trainerSmokeRestore();
  const originalCandidate = preview.textContent;
  preview.textContent = "private injected candidate";
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(false);
  expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
  window.__trainerSmokeRestore();
  preview.textContent = originalCandidate;
  await act(async () => {
    await command({ type: "memory", action: "densify-discard" });
  });
  await screen.findByText(/Candidate discarded/);
  await act(async () => {
    expect(
      (await command({ type: "memory", action: "fixture-populated" })).ok,
    ).toBe(true);
  });
  expect((await command({ type: "memory", action: "observe" })).loaded).toBe(
    true,
  );
  expect(screen.queryByText(/13250 characters/)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("restores the fixed presentation adapter on expiry and refuses caller fixture fields", async () => {
  vi.useFakeTimers();
  document.querySelector("textarea")!.remove();
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    (
      await command({
        type: "memory",
        action: "fixture-populated",
        snapshot: {},
      })
    ).ok,
  ).toBe(false);
  await command({ type: "memory", action: "fixture-populated" });
  await vi.advanceTimersByTimeAsync(120000);
  expect(fetch).toBe(fetcher);
  vi.useRealTimers();
});
it("reveals a controlled textarea’s canonical default text only when its live value also matches", async () => {
  const input = document.querySelector("textarea")!;
  input.textContent =
    "T0272-unit: Short weekdays chosen for time; long weekdays rejected. Fake discussion https://example.invalid/training.";
  input.value = input.textContent;
  expect(
    (await command({ type: "captureView", view: "memory", preset: "narrow" }))
      .ok,
  ).toBe(false);
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(getComputedStyle(input).visibility).toBe("visible");
  window.__trainerSmokeRestore();
  input.value = "private unexpected draft";
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(false);
  expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
});
it("reveals only exact authored memory text, refusing other content without leaking masked values", async () => {
  const text = document.createElement("p");
  text.className = "memory-text";
  text.textContent =
    "T0272-unit: Short weekdays chosen for time; long weekdays rejected. Fake discussion https://example.invalid/training.";
  document.querySelector('[aria-label="Manual preferences"]')!.append(text);
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(getComputedStyle(text).visibility).toBe("visible");
  window.__trainerSmokeRestore();
  text.textContent = "private unknown text";
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(false);
});
it("reveals only the exact full-window editor header and restores masks, hiding unknown header text", async () => {
  const sheet = document.querySelector(".memory-sheet")!;
  const header = document.createElement("header");
  header.className = "sheet-header";
  header.innerHTML =
    "<div><h2>Edit generated summary</h2></div><button>Close</button>";
  sheet.prepend(header);
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(header.hasAttribute("data-smoke-reveal")).toBe(true);
  window.__trainerSmokeRestore();
  expect(header.hasAttribute("data-smoke-reveal")).toBe(false);
  header.querySelector("h2")!.textContent += " private sentinel";
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(header.hasAttribute("data-smoke-reveal")).toBe(false);
  expect(header.querySelector("h2")!.hasAttribute("data-smoke-reveal")).toBe(
    false,
  );
});
it("reveals only the exact conditional purpose hint and restores its mask without admitting appended private text", async () => {
  const hint = document.createElement("p");
  hint.textContent =
    "When enabled, memory helps your trainer carry important details from previous conversations into new chats.";
  document.querySelector(".memory-root-card")!.append(hint);
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(getComputedStyle(hint).visibility).toBe("visible");
  window.__trainerSmokeRestore();
  expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
  hint.textContent += " private unknown details";
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(getComputedStyle(hint).visibility).toBe("hidden");
  window.__trainerSmokeRestore();
  expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
});
it("masks content and preserves geometry for only verified static controls; restores masks and refuses direct ancestor text", async () => {
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(true);
  expect(
    getComputedStyle(document.querySelector(".memory-root-card p")!).visibility,
  ).toBe("hidden");
  expect(
    getComputedStyle(document.querySelector(".memory-root-card button")!)
      .visibility,
  ).toBe("visible");
  expect(getComputedStyle(document.querySelector("textarea")!).visibility).toBe(
    "visible",
  );
  window.__trainerSmokeRestore();
  expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
  document
    .querySelector(".memory-root-card")!
    .append("private direct ancestor text");
  expect(
    (await command({ type: "captureView", view: "memory", preset: "wide" })).ok,
  ).toBe(false);
  expect(document.getElementById("trainer-smoke-sanitizer")).toBeNull();
});
