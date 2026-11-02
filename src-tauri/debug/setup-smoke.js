// Native-installed in the admitted debug setup window only. No IPC or general input API.
(() => {
  const empty = () => ({
    ok: true,
    ready: false,
    formVisible: false,
    manualControlsAbsent: false,
    notConnected: false,
    savedForNextLaunch: false,
  });
  const visible = (el) =>
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.closest("[hidden], [inert]") &&
    getComputedStyle(el).display !== "none" &&
    getComputedStyle(el).visibility !== "hidden" &&
    el.getClientRects().length > 0;
  const byId = (id) => document.getElementById(id);
  function observe() {
    const value = empty();
    value.ready =
      !!byId("AI_PROVIDER") &&
      byId("AI_PROVIDER").value === "ollama" &&
      byId("OPENAI_API_KEY-status")?.textContent === "not configured";
    if (!value.ready) return value;
    value.formVisible = visible(byId("auth"));
    value.manualControlsAbsent = [
      "GARMIN_MCP_TOKEN_DIR",
      "destination",
      "auth-parent",
    ].every((id) => !byId(id));
    value.notConnected =
      byId("connection-status")?.textContent.startsWith("Not connected.") ===
      true;
    value.savedForNextLaunch =
      byId("status")?.textContent.startsWith(
        "Settings committed. Quit and reopen to apply; the running backend is unchanged.",
      ) === true;
    return value;
  }
  const styles = new Map();
  let restoreTimer;
  let scrollPosition;
  function style(el, key, value) {
    if (!styles.has(el)) styles.set(el, el.style.cssText);
    el.style.setProperty(key, value, "important");
  }
  function restore() {
    clearTimeout(restoreTimer);
    for (const [el, original] of styles) el.style.cssText = original;
    styles.clear();
    if (scrollPosition) window.scrollTo(...scrollPosition);
    scrollPosition = null;
  }
  globalThis.__trainerSetupSmokeRestore = restore;
  globalThis.__trainerSetupSmoke = (action) => {
    try {
      if (!observe().ready) throw Error("Not ready");
      const clicks = {
        connect: "connect",
        later: "connect-later",
        save: "save",
        cancel: "cancel",
      };
      if (action in clicks) {
        const el = byId(clicks[action]);
        if (
          !visible(el) ||
          el.disabled ||
          document.querySelectorAll(`#${el.id}`).length !== 1
        )
          throw Error("Unavailable");
        el.click();
      } else if (action === "captureIntro") {
        restore();
        const main = document.querySelector("body > main");
        const intro = main ? Array.from(main.children).slice(0, 3) : [];
        const expected = [
          "Settings",
          "Settings and API keys are saved locally without encryption. Saved keys are hidden.",
          "The app can update the selected database. Close other apps using it first. Existing databases won’t be upgraded automatically.",
        ];
        if (
          intro.length !== 3 ||
          intro.some(
            (el, index) =>
              el.tagName !== (index === 0 ? "H1" : "P") ||
              el.childElementCount !== 0 ||
              el.textContent.replace(/\s+/g, " ").trim() !== expected[index] ||
              !visible(el),
          )
        )
          throw Error("Unexpected introduction");
        // Reveal only verified static text at its actual geometry, never status/form values.
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        for (const el of intro) style(el, "visibility", "visible");
        if (
          Array.from(document.body.querySelectorAll("*")).some(
            (el) =>
              el instanceof HTMLElement &&
              !intro.includes(el) &&
              getComputedStyle(el).visibility !== "hidden",
          ) ||
          intro.some((el) => {
            const rect = el.getBoundingClientRect();
            return (
              !visible(el) ||
              rect.width <= 0 ||
              rect.height <= 0 ||
              rect.left < 0 ||
              rect.top < 0 ||
              rect.right > window.innerWidth ||
              rect.bottom > window.innerHeight
            );
          })
        )
          throw Error("Introduction sanitization did not apply");
        restoreTimer = setTimeout(restore, 5000);
      } else if (["capture", "captureWide", "captureNarrow"].includes(action)) {
        if (!observe().manualControlsAbsent || !observe().notConnected)
          throw Error("Unsafe capture");
        restore();
        const root = byId("garmin-fields");
        // Fixed static allowlist only. Never reveal arbitrary subtree text or input values.
        const approved = new Map([
          [root.querySelector("legend"), "Garmin connection"],
          [
            byId("connection-status"),
            "Not connected. Connect now or later; chat and offline history remain available.",
          ],
          [
            root.querySelector(":scope > p:not([id])"),
            "Connect for fresh Garmin data and coaching grounded in it. Configured-provider chat and saved/offline history remain available without Garmin.",
          ],
          [byId("connect"), "Connect Garmin"],
          [byId("connect-later"), "Connect later — keep current selection"],
          [byId("sign-in"), "Sign in and verify"],
          [
            byId("garmin-privacy").querySelector("summary"),
            "Sign-in and private storage details",
          ],
        ]);
        for (const [element, text] of approved) {
          if (
            !element ||
            element.childElementCount ||
            element.textContent.replace(/\s+/g, " ").trim() !== text
          )
            throw Error("Unexpected Garmin text");
        }
        const labels = Array.from(byId("auth").querySelectorAll("label"));
        if (
          labels.length !== 2 ||
          labels.some(
            (el, index) =>
              el.textContent.trim() !== ["Email", "Password"][index] ||
              el.children.length !== 1 ||
              el.firstElementChild !== byId(["email", "password"][index]),
          )
        )
          throw Error("Unexpected credential labels");
        if (byId("garmin-privacy").open)
          throw Error("Disclosure must be collapsed");
        scrollPosition = [window.scrollX, window.scrollY];
        window.scrollTo(
          0,
          Math.max(0, root.getBoundingClientRect().top + window.scrollY - 24),
        );
        const before = root.getBoundingClientRect();
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        for (const el of [root, ...approved.keys(), ...labels])
          style(el, "visibility", "visible");
        const after = root.getBoundingClientRect();
        if (
          Array.from(document.body.querySelectorAll("*")).some(
            (el) =>
              el instanceof HTMLElement &&
              ![root, ...approved.keys(), ...labels].includes(el) &&
              getComputedStyle(el).visibility !== "hidden",
          ) ||
          ["left", "top", "width", "height"].some(
            (key) => before[key] !== after[key],
          ) ||
          after.left < 0 ||
          after.right > window.innerWidth ||
          after.top < 0 ||
          after.bottom > window.innerHeight
        )
          throw Error("Garmin mask or viewport refused");
        restoreTimer = setTimeout(restore, 5000);
      } else if (action !== "observe") throw Error("Unsupported");
      return observe();
    } catch {
      if (
        ["capture", "captureWide", "captureNarrow", "captureIntro"].includes(
          action,
        )
      )
        restore();
      return { ...empty(), ok: false };
    }
  };
})();
