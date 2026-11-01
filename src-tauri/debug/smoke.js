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
    for (
      let node = el;
      node instanceof HTMLElement;
      node = node.parentElement
    ) {
      if (
        node instanceof HTMLDetailsElement &&
        !node.open &&
        node !== el &&
        !node.querySelector(":scope > summary")?.contains(el)
      )
        return false;
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
  function debugCard() {
    const cards = [
      ...document.querySelectorAll(".settings-sheet .llm-debug-card"),
    ];
    if (cards.length !== 1 || !visible(cards[0]))
      throw Error("Debug disclosure unavailable");
    return cards[0];
  }
  function debugSummary(inner = false) {
    const card = debugCard();
    const el = card.querySelector(
      inner ? ".debug-trace-item > summary" : ":scope > summary",
    );
    if (!el || !visible(el)) throw Error("Debug summary hidden/unavailable");
    return el;
  }
  let nativeKeyReceived = false;
  function debugObservation() {
    try {
      const card = debugCard();
      const summary = debugSummary();
      const traces = [...card.querySelectorAll(".debug-trace-item")];
      return {
        available: true,
        open: card.open,
        summaryVisible: visible(summary),
        nativeMarker: getComputedStyle(summary).display === "list-item",
        focused: document.activeElement === summary,
        focusVisible: summary.matches(":focus-visible"),
        focusMatches: summary.matches(":focus"),
        documentFocused: document.hasFocus(),
        nativeKeyReceived,
        warningVisible: visible(card.querySelector(":scope > p")),
        innerOpen: traces.map((el) => el.open),
        previewsVisible: traces.map((el) =>
          visible(el.querySelector("summary")),
        ),
        bodiesVisible: traces.map((el) => visible(el.querySelector("pre,p"))),
      };
    } catch {
      return { available: false };
    }
  }
  function requireSyntheticDebug() {
    const card = debugCard();
    const summaries = [...card.querySelectorAll(".debug-trace-item > summary")];
    const json = card.querySelector("pre");
    const fallback = card.querySelector(".debug-trace-item > p");
    if (
      card.querySelectorAll("*").length !== 10 ||
      card.querySelector(":scope > summary").textContent.trim() !==
        "LLM debug traces 2 assistant turns" ||
      card
        .querySelector(":scope > p")
        .textContent.replace(/\s+/g, " ")
        .trim() !==
        "Local developer diagnostics are enabled by application policy. Traces may include private normalized Garmin/chat/tool context; keep them local and out of screenshots or support artifacts." ||
      summaries.length !== 2 ||
      summaries[0].textContent !==
        `${new Date(1000).toLocaleString()} — T0243 synthetic trace` ||
      summaries[1].textContent !==
        `${new Date(0).toLocaleString()} — T0243 synthetic missing trace` ||
      json?.textContent !==
        JSON.stringify(
          { schemaVersion: 1, finalAnswer: "T0243 synthetic diagnostic only" },
          null,
          2,
        ) ||
      fallback?.textContent !==
        "No debug trace captured for this assistant message."
    )
      throw Error("Capture refuses noncanonical/private diagnostic contents");
    return card;
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
      llmDebug: debugObservation(),
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
        if (["LLM debug traces", "First LLM trace"].includes(command.target)) {
          debugSummary(command.target === "First LLM trace").click();
          return { ok: true, action: command.target, trustedInput: false };
        }
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
      case "debugKey": {
        if (!["Enter", "Space"].includes(command.key))
          throw Error("Unsupported disclosure key");
        const summary = debugSummary();
        nativeKeyReceived = false;
        summary.addEventListener(
          "keydown",
          (event) => {
            nativeKeyReceived = event.isTrusted && event.target === summary;
          },
          { once: true },
        );
        summary.focus({ preventScroll: true });
        if (document.activeElement !== summary)
          throw Error("Disclosure focus failed");
        return { ok: true, readyForNativeKey: true };
      }
      case "captureDebug": {
        requireSyntheticDebug();
        restore();
        const style = document.createElement("style");
        style.id = "trainer-smoke-sanitizer";
        style.textContent = `body * {visibility:hidden !important} .llm-debug-card {position:fixed !important; top:24px !important; left:24px !important; width:800px !important; z-index:2147483647 !important; background:#101c2c !important} .llm-debug-card, .llm-debug-card * {visibility:visible !important}`;
        document.head.append(style);
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
          ok: true,
          boundary: "sanitized actual synthetic LLM disclosure subtree",
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
