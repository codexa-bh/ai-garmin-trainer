/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const source = readFileSync("src-tauri/debug/smoke.js", "utf8");
const invoke = vi.fn(async (_name: string, _args: unknown) => {});
const first = "T0250-first-unit";
const second = "T0250-second-unit";
const smoke = window;
const nativeConfirm = document.defaultView!.confirm;
async function command(command: unknown) {
  await smoke.__trainerSmoke({
    requestId: "unit",
    expectedRunId: "unit",
    command,
  });
  return (invoke.mock.calls.at(-1)?.[1] as { result: Record<string, unknown> })
    .result;
}
function row(title: string, selected = false) {
  const item = document.createElement("div");
  item.className = "conversation-item";
  const choose = document.createElement("button");
  choose.className = "conversation-select";
  if (selected) choose.setAttribute("aria-current", "true");
  const label = document.createElement("span");
  label.textContent = title;
  choose.append(label);
  const date = document.createElement("small");
  date.textContent = "private copied date";
  choose.append(date);
  const menu = document.createElement("button");
  menu.className = "conversation-menu-trigger";
  menu.textContent = "⋯";
  choose.onclick = () => {
    document
      .querySelectorAll(".conversation-select")
      .forEach((el) => el.removeAttribute("aria-current"));
    choose.setAttribute("aria-current", "true");
  };
  menu.onclick = () => {
    const choices = document.createElement("div");
    choices.setAttribute("role", "menu");
    const rename = document.createElement("button");
    rename.setAttribute("role", "menuitem");
    rename.textContent = "Rename";
    rename.onclick = () => {
      choices.remove();
      const form = document.createElement("div");
      form.className = "rename-dialog";
      const input = document.createElement("input");
      input.id = "conversation-rename-title";
      input.value = label.textContent!;
      const save = document.createElement("button");
      save.textContent = "Save";
      save.onclick = () => {
        label.textContent = input.value;
        form.remove();
      };
      form.append(input, save);
      document.body.append(form);
    };
    const remove = document.createElement("button");
    remove.setAttribute("role", "menuitem");
    remove.textContent = "Delete";
    remove.onclick = () => {
      if (
        item.ownerDocument.defaultView!.confirm(
          `Delete local conversation "${label.textContent}" and its messages? Garmin data, Profile, and saved memories stay unchanged.`,
        )
      ) {
        const active = choose.getAttribute("aria-current") === "true";
        item.remove();
        if (active) {
          const remaining = document.querySelector<HTMLButtonElement>(
            ".conversation-select",
          );
          if (remaining) remaining.click();
          else
            document
              .querySelector(".conversation-list")!
              .append(row("New chat", true));
        }
      }
      choices.remove();
    };
    choices.append(rename, remove);
    document.body.append(choices);
  };
  item.append(choose, menu);
  return item;
}
beforeEach(() => {
  invoke.mockReset();
  smoke.__trainerOrdinaryIsolated = { runId: "unit" };
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: { invoke },
    configurable: true,
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    () => [{ width: 10 }] as unknown as DOMRectList,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      width: 300,
      height: 700,
      top: 0,
      bottom: 700,
      left: 0,
      right: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  );
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 850);
  document.body.innerHTML =
    '<section aria-label="AI trainer dashboard" data-renderer-ready="true"></section><aside class="conversation-sidebar"><button id="new">New chat</button><div class="conversation-list"></div></aside><div class="transcript">private copied transcript</div>';
  document.getElementById("new")!.onclick = () => {
    document
      .querySelectorAll(".conversation-select")
      .forEach((el) => el.removeAttribute("aria-current"));
    document.querySelector(".conversation-list")!.append(row("New chat", true));
  };
  window.eval(source);
});
afterEach(() => {
  smoke.__trainerSmokeRestore();
  document.defaultView!.confirm = nativeConfirm;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function named(slot: "first" | "second") {
  expect(
    (await command({ type: "conversation", action: "new" })).newSelected,
  ).toBe(true);
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  for (const action of [
    "menu-new",
    "rename-new",
    "title-" + slot,
    "save-title",
  ])
    expect((await command({ type: "conversation", action })).ok).toBe(true);
  expect(
    (await command({ type: "conversation", action: "observe" }))[
      slot + "Selected"
    ],
  ).toBe(true);
}
it("drives only fixed run-created New/rename/selection/delete semantics with scoped synthetic confirmation", async () => {
  const original = vi.fn(() => false);
  document.defaultView!.confirm = original;
  expect(
    (await command({ type: "conversation", action: "observe" })).empty,
  ).toBe(true);
  await named("first");
  await named("second");
  expect(
    (await command({ type: "conversation", action: "delete-second" })).ok,
  ).toBe(false);
  expect(
    (await command({ type: "conversation", action: "save-title" })).ok,
  ).toBe(false);
  expect(
    (await command({ type: "conversation", action: "choose-first" }))
      .firstSelected,
  ).toBe(true);
  await command({ type: "conversation", action: "menu-second" });
  const deleted = await command({
    type: "conversation",
    action: "delete-second",
  });
  expect(deleted).toMatchObject({ ok: true, firstSelected: true });
  await command({ type: "conversation", action: "menu-first" });
  const result = await command({
    type: "conversation",
    action: "delete-first",
  });
  expect(result.newSelected).toBe(true);
  expect(original).not.toHaveBeenCalled();
  expect(document.defaultView!.confirm).toBe(original);
  expect(JSON.stringify(result)).not.toMatch(/private|T0250|conversationId/);
});
it("returns each mutation before delayed UI reconciliation and observes completion in a later RPC", async () => {
  vi.useFakeTimers();
  document.getElementById("new")!.onclick = () => {
    setTimeout(
      () =>
        document
          .querySelector(".conversation-list")!
          .append(row("New chat", true)),
      100,
    );
  };
  const pending = await command({ type: "conversation", action: "new" });
  expect(pending.ok).toBe(true);
  expect(pending.newSelected).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(
    (await command({ type: "conversation", action: "observe" })).newSelected,
  ).toBe(true);
});
it("refuses debug/prehydration/private/extra/hidden/disabled or ambiguous targets before mutation", async () => {
  for (const value of [
    { type: "conversation", action: "delete-all" },
    { type: "conversation", action: "choose-first", id: "private" },
    { type: "conversation", action: "new", selector: "body" },
  ])
    expect((await command(value)).ok).toBe(false);
  delete smoke.__trainerOrdinaryIsolated;
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  smoke.__trainerOrdinaryIsolated = { runId: "unit" };
  document.querySelector("section")!.removeAttribute("data-renderer-ready");
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  document
    .querySelector("section")!
    .setAttribute("data-renderer-ready", "true");
  const button = document.getElementById("new") as HTMLButtonElement;
  button.disabled = true;
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  button.disabled = false;
  button.hidden = true;
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  button.hidden = false;
  document
    .querySelector(".conversation-list")!
    .append(row("private operator title"));
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  expect(document.querySelectorAll(".conversation-item")).toHaveLength(1);
  document
    .querySelector(".conversation-list")!
    .replaceChildren(row(first), row(first));
  expect(
    (await command({ type: "conversation", action: "choose-first" })).ok,
  ).toBe(false);
});
it("refuses clipped or collapsed history until a rendered history toggle opens it", async () => {
  const sidebar = document.querySelector<HTMLElement>(".conversation-sidebar")!;
  const wrapper = document.createElement("div");
  wrapper.className = "sidebar-collapsed";
  sidebar.before(wrapper);
  wrapper.append(sidebar);
  expect(
    (await command({ type: "conversation", action: "observe" })).historyVisible,
  ).toBe(false);
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
  const toggle = document.createElement("button");
  toggle.setAttribute("aria-label", "Toggle conversation history");
  toggle.onclick = () => wrapper.classList.remove("sidebar-collapsed");
  document.body.append(toggle);
  expect(
    (await command({ type: "conversation", action: "open-history" }))
      .historyVisible,
  ).toBe(true);
  vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue({
    width: 0,
    height: 700,
    top: 0,
    bottom: 700,
    left: 0,
    right: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  expect((await command({ type: "conversation", action: "new" })).ok).toBe(
    false,
  );
});
it("settles only the opened sidebar's existing finite CSS transitions without overriding layout or visibility", async () => {
  const sidebar = document.querySelector<HTMLElement>(".conversation-sidebar")!;
  let left = -385;
  vi.spyOn(sidebar, "getBoundingClientRect").mockImplementation(() => ({
    width: 350,
    height: 700,
    top: 0,
    bottom: 700,
    left,
    right: left + 350,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }));
  vi.stubGlobal("innerWidth", 420);
  class Transition {
    effect: { target: Element };
    transitionProperty: string;
    finish = vi.fn(() => {
      left = 0;
    });
    constructor(target: Element, property: string) {
      this.effect = { target };
      this.transitionProperty = property;
    }
  }
  vi.stubGlobal("CSSTransition", Transition);
  const drawer = new Transition(sidebar, "transform");
  const other = new Transition(document.body, "transform");
  const opacity = new Transition(sidebar, "opacity");
  Object.defineProperty(sidebar, "getAnimations", {
    value: () => [drawer, other, opacity],
    configurable: true,
  });
  expect(
    (await command({ type: "conversation", action: "settle-history" })).ok,
  ).toBe(false);
  sidebar.classList.add("open");
  expect(
    (await command({ type: "conversation", action: "observe" })).historyVisible,
  ).toBe(false);
  const style = sidebar.getAttribute("style");
  expect(
    (await command({ type: "conversation", action: "settle-history" }))
      .historyVisible,
  ).toBe(true);
  expect(drawer.finish).toHaveBeenCalledOnce();
  expect(other.finish).not.toHaveBeenCalled();
  expect(opacity.finish).not.toHaveBeenCalled();
  expect(sidebar.getAttribute("style")).toBe(style);
});
it("reveals only run-synthetic history labels, masks copied dates/transcript without reflow and restores on failure", async () => {
  document
    .querySelector(".conversation-list")!
    .append(row(first, true), row(second));
  const result = await command({
    type: "captureView",
    view: "conversation",
    preset: "wide",
  });
  expect(result.ok).toBe(true);
  expect(
    getComputedStyle(document.querySelector(".conversation-select > span")!)
      .visibility,
  ).toBe("visible");
  expect(
    getComputedStyle(document.querySelector(".conversation-select > small")!)
      .visibility,
  ).toBe("hidden");
  expect(
    getComputedStyle(document.querySelector(".transcript")!).visibility,
  ).toBe("hidden");
  expect(
    document.getElementById("trainer-smoke-sanitizer")!.textContent,
  ).not.toMatch(/position|width|height|display|top:|left:/);
  smoke.__trainerSmokeRestore();
  invoke.mockRejectedValueOnce(new Error("result refused"));
  await command({ type: "captureView", view: "conversation", preset: "wide" });
  expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  const direct = document.createTextNode("private direct ancestor text");
  document.querySelector(".conversation-list")!.append(direct);
  expect(
    (
      await command({
        type: "captureView",
        view: "conversation",
        preset: "wide",
      })
    ).ok,
  ).toBe(false);
  expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
  direct.remove();
  document
    .querySelector(".conversation-list")!
    .append(row("private operator title"));
  expect(
    (
      await command({
        type: "captureView",
        view: "conversation",
        preset: "wide",
      })
    ).ok,
  ).toBe(false);
  expect(document.querySelector("[data-smoke-reveal]")).toBeNull();
});
