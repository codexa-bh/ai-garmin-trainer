// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, waitFor } from "@testing-library/dom";

const invoke = vi.fn();
it("registers only About's local capability, separate from Settings/trainer", () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const capability = JSON.parse(
    readFileSync("src-tauri/capabilities/about.json", "utf8"),
  );
  expect(config.app.security.capabilities).toContain(capability.identifier);
  expect(capability.windows).toEqual(["about"]);
  expect(capability.permissions).toEqual(["allow-about"]);
  expect(capability.remote).toBeUndefined();
});
function mount() {
  document.documentElement.innerHTML = readFileSync(
    "src-tauri/ui/about.html",
    "utf8",
  ).replace(/<script[^>]*>.*?<\/script>/gs, "");
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke } },
  });
  window.eval(readFileSync("src-tauri/ui/about.js", "utf8"));
}
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command) =>
    command === "about_metadata"
      ? {
          name: "AI Trainer for Garmin Connect",
          version: "9.8.7",
          build: "2802a3e modified",
        }
      : undefined,
  );
});
it("reads independent running metadata without starting or reading Settings/backend", async () => {
  mount();
  await waitFor(() =>
    expect(document.getElementById("version")?.textContent).toBe("9.8.7"),
  );
  expect(document.getElementById("build")?.textContent).toBe(
    "2802a3e modified",
  );
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "about_metadata",
  ]);
  expect(document.activeElement?.id).toBe("close");
  expect(document.querySelector("form")).toBeNull();
});
it("opens only the explicit fixed link action, preventing WebView navigation", async () => {
  mount();
  for (const destination of ["repository", "licence"]) {
    const link = document.querySelector(`[data-destination="${destination}"]`)!;
    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("about_link", { destination }),
    );
    await waitFor(() =>
      expect(document.getElementById("status")?.textContent).toBe(
        "Opened in your browser.",
      ),
    );
  }
  expect(document.querySelectorAll("a")).toHaveLength(2);
});
it("dismisses using Close or Escape and reinitializes on reopen", async () => {
  mount();
  fireEvent.click(document.getElementById("close")!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("about_close"));
  invoke.mockClear();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("about_close"));
  mount();
  await waitFor(() =>
    expect(document.getElementById("version")?.textContent).toBe("9.8.7"),
  );
  expect(document.activeElement?.id).toBe("close");
});
it("keeps failure truthful and never renders metadata as HTML", async () => {
  invoke.mockResolvedValue({
    name: "<img src=x>",
    version: "<b>version</b>",
    build: "42",
  });
  mount();
  await waitFor(() =>
    expect(document.getElementById("version")?.textContent).toBe(
      "<b>version</b>",
    ),
  );
  expect(document.querySelector("img")).toBeNull();
  invoke.mockRejectedValue(new Error("native failure"));
  fireEvent.click(document.querySelector("a")!);
  await waitFor(() =>
    expect(document.getElementById("status")?.textContent).toContain(
      "Link could not open",
    ),
  );
  mount();
  await waitFor(() =>
    expect(document.getElementById("status")?.textContent).toBe(
      "App bundle metadata unavailable.",
    ),
  );
  expect(document.getElementById("version")?.textContent).toBe("Unavailable");
});
