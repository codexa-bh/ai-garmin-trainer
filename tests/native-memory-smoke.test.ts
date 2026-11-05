/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import React from "react";
import { render, cleanup } from "@testing-library/react";
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
  document.body.innerHTML = `<section aria-label="AI trainer dashboard" data-renderer-ready="true"></section><aside class="settings-sheet memory-sheet" role="dialog" aria-labelledby="memory-sheet-heading"><h2 id="memory-sheet-heading">Memory</h2><div class="memory-root-card" data-memory-ready="true" data-memory-view="manage"><h3>What your trainer remembers</h3><p>private copied sentinel</p><button>Add memory</button><button>Check saved memory</button><button>Clear saved memory</button><section aria-label="Saved summary items"><h4>Saved memories</h4></section><section aria-label="Rebuild from chat history"><h3>Update memory from chat history</h3><p>private counts and cost</p><button disabled>Review and update</button></section><label>Memory<textarea></textarea></label><button>Save memory</button></div></aside>`;
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
});
it("returns closed booleans, uses only fixed run draft and preserves exact confirmation ownership", async () => {
  expect(await command({ type: "memory", action: "observe" })).toEqual({
    ok: true,
    action: "observe",
    trustedInput: false,
    visible: true,
    loaded: true,
    presentationFixture: false,
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
    "T0272-unit: Short weekdays chosen for time; long weekdays rejected.",
  );
  expect(inputEvent).toHaveBeenCalledOnce();
  const confirm = window.confirm;
  const clicked = vi.fn();
  document.querySelectorAll("button")[2].addEventListener("click", clicked);
  expect((await command({ type: "memory", action: "clear" })).ok).toBe(true);
  expect(clicked).toHaveBeenCalledOnce();
  expect(window.confirm).toBe(confirm);
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
    .querySelector('[aria-label="Saved summary items"]')!
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
    "fixture-unknown",
  ]) {
    const result = await command({ type: "memory", action });
    expect(result.ok).toBe(true);
    expect(result.presentationFixture).toBe(true);
    const value = await fetch("/api/cross-chat-summary?view=content");
    expect(value.status).toBe(action === "fixture-unknown" ? 503 : 200);
    if (value.ok) {
      const dto = (await value.json()) as {
        stored: { items: unknown[] };
        rebuild: { counts: { excludedUserMessages: number } };
      };
      expect(dto.stored.items).toHaveLength(3);
      expect(dto.rebuild.counts.excludedUserMessages).toBe(184);
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
it("captures actual production Memory components with fixed authored content across secondary views", async () => {
  document.querySelector("textarea")!.remove();
  document.querySelector('[aria-label="Rebuild from chat history"]')!.remove();
  await command({ type: "memory", action: "fixture-populated" });
  const dto = (await (
    await fetch("/api/cross-chat-summary?view=content")
  ).json()) as SummaryInspection;
  const aside = document.querySelector("aside")!;
  aside.querySelector(".memory-root-card")!.remove();
  render(
    React.createElement(MemoryContent, {
      memory: dto,
      memoryMessage: "",
      isMemoryLoading: false,
      pendingMemoryAction: null,
      loadMemories: vi.fn(),
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
  for (const action of [
    null,
    "chat-details",
    "back",
    "rebuild-preflight",
    "history-effects",
    "back",
    "forget",
  ]) {
    if (action)
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
  }
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
    "T0272-unit: Short weekdays chosen for time; long weekdays rejected.";
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
    "T0272-unit: Short weekdays chosen for time; long weekdays rejected.";
  document.querySelector('[aria-label="Saved summary items"]')!.append(text);
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
