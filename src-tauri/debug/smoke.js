// Fixed native-installed controller. Dormant on default launches; never accepts caller code/selectors.
(() => {
  const allowedClicks = new Set([
    "Activities",
    "Health",
    "Training Plan",
    "Sync",
    "Profile & data",
    "Back to chat",
    "Close Profile & data",
    "Save Profile",
    "Reload saved Profile",
  ]);
  const sentinel = (value) =>
    typeof value === "string" &&
    /^T0231-smoke-[a-zA-Z0-9-]{1,87}$/.test(value) &&
    (!globalThis.__trainerOrdinaryIsolated ||
      value === `T0231-smoke-${globalThis.__trainerOrdinaryIsolated.runId}`);
  const visible = (el) => {
    if (
      !(el instanceof HTMLElement) ||
      !el.isConnected ||
      el.closest("[hidden], [inert]")
    )
      return false;
    if (el.closest("details:not([open])") && el.tagName !== "SUMMARY")
      return false;
    for (
      let node = el;
      node instanceof HTMLElement;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
    }
    return el.getClientRects().length > 0;
  };
  const name = (el) => el.getAttribute("aria-label") || el.textContent.trim();
  function target(label, selector = "button") {
    const found = [...document.querySelectorAll(selector)].filter(
      (el) => name(el) === label && visible(el),
    );
    if (found.length !== 1) throw Error("Missing/ambiguous/hidden target");
    const el = found[0];
    if (
      el.matches(":disabled") ||
      el.readOnly ||
      el.closest('[aria-disabled="true"]')
    )
      throw Error("Disabled/readonly target");
    return el;
  }
  function observe() {
    const goals = document.querySelector('textarea[aria-label="Goals"]');
    return {
      ok: true,
      dashboard: Boolean(
        document.querySelector('[aria-label="AI trainer dashboard"]'),
      ),
      hydrated: Boolean(
        document.querySelector(
          '[aria-label="AI trainer dashboard"][data-renderer-ready="true"]',
        ),
      ),
      navigation: [...document.querySelectorAll("nav button")]
        .filter(visible)
        .map(name)
        .filter((n) => allowedClicks.has(n)),
      headings: [...document.querySelectorAll("h1,h2")]
        .filter(visible)
        .map((el) => el.textContent.trim())
        .filter((s) =>
          [
            "Garmin AI Trainer",
            "Activities",
            "Daily health",
            "Health",
            "Training Plan",
            "Sync",
            "Profile & data",
          ].includes(s),
        ),
      profileReady: Boolean(goals && visible(goals) && !goals.disabled),
      profileSaved:
        document
          .querySelector(".profile-settings-card .pill")
          ?.textContent.trim() === "Profile saved",
      view: document.querySelector(".settings-sheet")
        ? "Profile & data"
        : document.querySelector(".activity-dashboard-active")
          ? "Activities"
          : document.querySelector(".health-dashboard-active")
            ? "Health"
            : document.querySelector(".training-plan-active")
              ? "Training Plan"
              : document.querySelector(".sync-view-active")
                ? "Sync"
                : "Trainer",
      // No copied text, control values, transcripts or diagnostics leave the renderer.
    };
  }
  let maskExpiry;
  function restore() {
    clearTimeout(maskExpiry);
    document.getElementById("trainer-smoke-sanitizer")?.remove();
    for (const el of document.querySelectorAll("[data-smoke-reveal]"))
      el.removeAttribute("data-smoke-reveal");
  }
  const viewport = (preset) => {
    const width = preset === "wide" ? 1280 : preset === "narrow" ? 420 : 0;
    return width && innerWidth === width && innerHeight === 850;
  };
  async function maskedView(command) {
    if (!globalThis.__trainerOrdinaryIsolated || !viewport(command.preset))
      throw Error("Unsupported viewport/mode");
    const expected = {
      trainer: "Trainer",
      sync: "Sync",
      profile: "Profile & data",
    }[command.view];
    if (!expected || observe().view !== expected)
      throw Error("Unsafe capture view");
    if (command.view === "profile") {
      const goals = target("Goals", "textarea");
      if (!sentinel(goals.value) || !observe().profileSaved)
        throw Error("Capture requires saved synthetic Goals");
    }
    restore();
    const labels = new Set([
      "Garmin AI Trainer",
      "Activities",
      "Health",
      "Training Plan",
      "Sync",
      "Profile & data",
      "Back to chat",
      "Close Profile & data",
      "Save Profile",
      "Reload saved Profile",
      "Menu",
      "Run Garmin sync",
      "Verify connector",
      "Refresh summary",
      "Activity detail maintenance",
    ]);
    // Hide by default; reveal only reviewed exact static text at its real geometry.
    // No top/left/width/position/display/reparenting overrides or copied facts.
    for (const el of document.querySelectorAll(
      ".app-brand .app-title, .app-mobile-menu .app-menu-toggle, nav button, .sync-view-header h1, .sync-view-header button, .sync-view-panel h2, .sheet-header h2, .sheet-header button, .profile-settings-card .button-row button",
    )) {
      if (visible(el) && labels.has(el.textContent.trim()))
        el.setAttribute("data-smoke-reveal", "");
    }
    if (command.view === "profile") {
      const goals = target("Goals", "textarea");
      goals.setAttribute("data-smoke-reveal", "");
      goals.closest("label").setAttribute("data-smoke-reveal", "");
      const pill = document.querySelector(".profile-settings-card .pill");
      if (pill?.textContent.trim() === "Profile saved")
        pill.setAttribute("data-smoke-reveal", "");
    }
    const style = document.createElement("style");
    style.id = "trainer-smoke-sanitizer";
    style.textContent =
      "body * {visibility:hidden !important} [data-smoke-reveal] {visibility:visible !important}";
    document.head.append(style);
    maskExpiry = setTimeout(restore, 10000);
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      ok: true,
      view: command.view,
      preset: command.preset,
      boundary: "geometry-preserving redacted own-WebView",
    };
  }
  globalThis.__trainerSmokeRestore = restore;
  async function execute(command) {
    if (!command || typeof command !== "object") throw Error("Invalid command");
    if (command.type !== "observe" && !observe().hydrated)
      throw Error("Renderer not hydrated");
    switch (command.type) {
      case "observe":
        return observe();
      case "click": {
        if (!allowedClicks.has(command.target))
          throw Error("Private/unsupported control");
        if (command.target === "Close Profile & data") {
          const buttons = [
            ...document.querySelectorAll(
              ".settings-sheet .sheet-header button",
            ),
          ].filter(visible);
          if (buttons.length !== 1 || buttons[0].disabled)
            throw Error("Profile & data close unavailable");
          buttons[0].click();
        } else {
          target(command.target).click();
        }
        return { ok: true, action: command.target, trustedInput: false };
      }
      case "input":
      case "assert": {
        if (command.target !== "Goals" || !sentinel(command.value))
          throw Error("Private/unsupported input");
        const el = target("Goals", "textarea");
        if (command.type === "assert")
          return {
            ok: el.value === command.value,
            matches: el.value === command.value,
          };
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        ).set;
        setter.call(el, command.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, action: "Goals input", trustedInput: false };
      }
      case "setViewport": {
        if (!globalThis.__trainerOrdinaryIsolated)
          throw Error("Ordinary isolated mode only");
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (!viewport(command.preset)) throw Error("Viewport not settled");
        return { ok: true, preset: command.preset };
      }
      case "captureView":
        return maskedView(command);
      case "capture": {
        if (globalThis.__trainerOrdinaryIsolated)
          throw Error("Legacy capture unavailable");
        const el = target("Goals", "textarea");
        if (!sentinel(el.value) || !observe().profileSaved)
          throw Error("Capture requires saved synthetic Goals");
        restore();
        const style = document.createElement("style");
        style.id = "trainer-smoke-sanitizer";
        style.textContent = `body * {visibility:hidden !important} .profile-settings-card {display:block !important; position:fixed !important; top:24px !important; left:24px !important; width:800px !important; z-index:2147483647 !important; background:white !important} .profile-settings-card>summary, .profile-settings-card>summary *, .profile-settings-card label:has([aria-label="Goals"]), .profile-settings-card [aria-label="Goals"], .profile-settings-card .button-row, .profile-settings-card .button-row * {visibility:visible !important}`;
        document.head.append(style);
        // Background WebViews can throttle animation frames; allow a bounded compositor turn.
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { ok: true, boundary: "sanitized actual Profile Goals subtree" };
      }
      default:
        throw Error("Unsupported command");
    }
  }
  globalThis.__trainerSmoke = async (request) => {
    let result;
    try {
      result = await execute(request.command);
    } catch {
      restore();
      result = { ok: false, error: "Rendered command refused or failed" };
    }
    try {
      await globalThis.__TAURI_INTERNALS__.invoke("smoke_result", {
        runId: request.expectedRunId,
        requestId: request.requestId,
        boot: request.expectedBoot ?? null,
        result,
      });
      globalThis.__trainerSmokeResultStatus = "completed";
    } catch (error) {
      const message = String(error);
      globalThis.__trainerSmokeResultStatus = message.includes("not allowed")
        ? "permission-refused"
        : message.includes("not found")
          ? "command-not-found"
          : message.includes("Wrong renderer")
            ? "renderer-identity-refused"
            : "result-refused";
      restore();
    }
  };
})();
