// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
const answer =
  "Authored weekday hike: 6543 m in 4321 s, 321 m ascent, mean HR 123. The elevation section averages 10% across 1000 m. Keep weekday climbing practice manageable; surface and technicality remain unknown.";
const source = readFileSync("src-tauri/debug/smoke.js", "utf8");
const invoke = vi.fn(async (_command: string, _args: unknown) => {});
const smoke = window as unknown as {
  __trainerOrdinaryIsolated?: object;
  __trainerSmoke: (value: unknown) => Promise<void>;
  __trainerSmokeRestore: () => void;
};
function fixture(text = answer) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: { invoke },
    configurable: true,
  });
  Object.defineProperty(window, "innerWidth", {
    value: 1280,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 850,
    configurable: true,
  });
  document.body.innerHTML =
    '<section aria-label="AI trainer dashboard" data-renderer-ready="true"><div class="chat-message assistant"><div class="assistant-content"><p></p></div><span>Private adjacent evidence</span></div></section>';
  document.querySelector("p")!.textContent = text;
  smoke.__trainerOrdinaryIsolated = { runId: "run" };
  window.eval(source);
}
async function capture(extra: Record<string, unknown> = {}) {
  await smoke.__trainerSmoke({
    requestId: "request",
    expectedRunId: "run",
    command: {
      type: "captureView",
      view: "ordinary-chat",
      preset: "wide",
      ...extra,
    },
  });
  return (invoke.mock.calls.at(-1)![1] as { result: { ok: boolean } }).result;
}
afterEach(() => {
  smoke.__trainerSmokeRestore?.();
  document.body.replaceChildren();
  delete smoke.__trainerOrdinaryIsolated;
  invoke.mockReset();
});
it("reveals only the exact authored answer without private siblings or geometry changes, then restores", async () => {
  fixture();
  expect((await capture()).ok).toBe(true);
  expect(document.querySelector("p")!.hasAttribute("data-smoke-reveal")).toBe(
    true,
  );
  expect(
    document.querySelector("span")!.hasAttribute("data-smoke-reveal"),
  ).toBe(false);
  expect(
    document.querySelector("#trainer-smoke-sanitizer")!.textContent,
  ).not.toMatch(/width|height|display|position/);
  smoke.__trainerSmokeRestore();
  expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
});
it.each(["private model answer", "", answer + " private suffix"])(
  "refuses noncanonical text: %s",
  async (text) => {
    fixture(text);
    expect((await capture()).ok).toBe(false);
    expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  },
);
it("refuses duplicate answers, private direct ancestors, caller selectors and debug/default mode", async () => {
  fixture();
  document
    .querySelector("section")!
    .append(document.querySelector(".chat-message")!.cloneNode(true));
  expect((await capture()).ok).toBe(false);
  fixture();
  document
    .querySelector("section")!
    .append(document.createTextNode("Private ancestor"));
  expect((await capture()).ok).toBe(false);
  fixture();
  expect((await capture({ selector: "body" })).ok).toBe(false);
  delete smoke.__trainerOrdinaryIsolated;
  expect((await capture()).ok).toBe(false);
});
