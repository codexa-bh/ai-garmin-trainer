// Fixed native-installed debug bootstrap. Not shipped/installed in ordinary release.
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
    typeof value === "string" && /^T0231-smoke-[a-zA-Z0-9-]{1,87}$/.test(value);
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
  let rememberedHealthRange = null;
  const healthTable = () => {
    const tables = [
      ...document.querySelectorAll(".health-daily-matrix"),
    ].filter(visible);
    if (
      tables.length !== 1 ||
      tables[0].querySelectorAll("thead time").length !== 7
    )
      throw Error("Daily Health comparison not ready");
    return tables[0];
  };
  function observe() {
    const comparison = document.querySelector(".health-daily-matrix");
    const healthButtons = document.querySelectorAll(
      ".health-daily-actions button",
    );
    const mode = document
      .querySelector('.health-mode-controls [aria-selected="true"]')
      ?.textContent.trim()
      .toLowerCase();
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
      healthMode: ["daily", "weekly", "monthly"].includes(mode) ? mode : null,
      healthReady: Boolean(
        comparison &&
        visible(comparison) &&
        comparison.querySelectorAll("thead time").length === 7,
      ),
      healthPreviousEnabled: Boolean(
        healthButtons[0] &&
        visible(healthButtons[0]) &&
        !healthButtons[0].disabled,
      ),
      healthNextEnabled: Boolean(
        healthButtons[1] &&
        visible(healthButtons[1]) &&
        !healthButtons[1].disabled,
      ),
      healthLatestEnabled: Boolean(
        healthButtons[2] &&
        visible(healthButtons[2]) &&
        !healthButtons[2].disabled,
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
  function restore() {
    document.getElementById("trainer-smoke-sanitizer")?.remove();
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
      case "health": {
        if (Object.keys(command).sort().join(",") !== "action,type")
          throw Error("Unknown Health fields");
        const labels = {
          daily: "Daily",
          weekly: "Weekly",
          monthly: "Monthly",
          previous: "← Previous 7 days",
          next: "Next 7 days →",
          latest: "Latest 7 days",
        };
        if (Object.hasOwn(labels, command.action)) {
          const panel = document.querySelector(".health-dashboard-panel");
          const el = target(labels[command.action]);
          if (!panel || !panel.contains(el))
            throw Error("Health-only target required");
          el.click();
          return { ok: true, action: command.action, trustedInput: false };
        }
        const table = healthTable();
        if (
          command.action === "remember-range" ||
          command.action === "assert-range"
        ) {
          const dates = [...table.querySelectorAll("thead time")]
            .map((el) => el.dateTime)
            .join(",");
          if (command.action === "remember-range") {
            rememberedHealthRange = dates;
            return { ok: true, remembered: true };
          }
          const matches =
            rememberedHealthRange !== null && rememberedHealthRange === dates;
          return { ok: matches, matches };
        }
        if (!["capture-wide", "capture-narrow"].includes(command.action))
          throw Error("Unsupported Health action");
        restore();
        const style = document.createElement("style");
        style.id = "trainer-smoke-sanitizer";
        // Hide copied dates, values and coverage without changing their layout/width.
        // Nothing is repositioned; no private text/DOM is returned by this command.
        style.textContent = `body * {visibility:hidden !important} .health-dashboard-panel, .health-dashboard-panel * {visibility:visible !important} .health-dashboard-panel .health-daily-matrix td, .health-dashboard-panel .health-daily-matrix time, .health-dashboard-panel .health-daily-matrix caption, .health-dashboard-panel #health-daily-range, .health-dashboard-panel [role="status"] {visibility:hidden !important; position:relative} .health-dashboard-panel .health-daily-matrix td::after, .health-dashboard-panel .health-daily-matrix time::after, .health-dashboard-panel .health-daily-matrix caption::after, .health-dashboard-panel #health-daily-range::after, .health-dashboard-panel [role="status"]::after {content:"Masked"; visibility:visible !important; position:absolute; inset:0; color:var(--muted)}`;
        document.head.append(style);
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
          ok: true,
          boundary: "geometry-preserving masked actual Daily Health comparison",
        };
      }
      case "capture": {
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
      result = { ok: false, error: "Rendered command refused or failed" };
    }
    try {
      await globalThis.__TAURI_INTERNALS__.invoke("smoke_result", {
        runId: request.expectedRunId,
        requestId: request.requestId,
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
