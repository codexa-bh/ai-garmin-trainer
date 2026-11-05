/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
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
  document.body.innerHTML = `<section aria-label="AI trainer dashboard" data-renderer-ready="true"></section><aside class="settings-sheet memory-sheet" role="dialog" aria-labelledby="memory-sheet-heading"><h2 id="memory-sheet-heading">Memory</h2><div class="memory-root-card"><h2>Cross-chat memory</h2><p>private copied sentinel</p><button>Add manual preference</button><button>Reload memory</button><button>Clear summary</button><section aria-label="Saved summary items"><h3>Saved summary</h3></section><section aria-label="Rebuild from chat history"><h3>Rebuild from chat history</h3><p>private counts and cost</p><button disabled>Start rebuild</button><button disabled>Cancel rebuild</button></section><label>Manual memory text<textarea></textarea></label><button>Save manual edit</button></div></aside>`;
  window.eval(source);
});
afterEach(() => {
  window.__trainerSmokeRestore();
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
  let confirmed = false;
  document.querySelectorAll("button")[2].addEventListener("click", () => {
    confirmed = window.confirm(
      "Clear summary, manual items and chat pins? Transcripts, Profile, Garmin, plans and preserved legacy records remain. Future new turns may create memory; backups/provider logs are not erased.",
    );
  });
  expect((await command({ type: "memory", action: "clear" })).ok).toBe(true);
  expect(confirmed).toBe(true);
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
it("only scrolls the fixed preflight; it cannot start/cancel paid work or return source/count/cost text", async () => {
  const section = document.querySelector(
    '[aria-label="Rebuild from chat history"]',
  ) as HTMLElement;
  section.scrollIntoView = vi.fn();
  const clicked = vi.fn();
  section.addEventListener("click", clicked);
  const result = await command({ type: "memory", action: "rebuild-preflight" });
  expect(result.ok).toBe(true);
  expect(section.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(clicked).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("private");
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
    "hidden",
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
