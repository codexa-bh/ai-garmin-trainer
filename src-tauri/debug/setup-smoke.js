// Native-installed in the admitted debug setup window only. No IPC or general input API.
(() => {
  const empty = () => ({
    ok: true,
    ready: false,
    formVisible: false,
    manualControlsAbsent: false,
    notConnected: false,
    saved: false,
    liveApplied: false,
    liveUnknown: false,
    savedUnapplied: false,
    pendingRestart: false,
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
      ["configured", "not configured"].includes(
        byId("OPENAI_API_KEY-status")?.textContent,
      );
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
    const feedback = byId("status")?.textContent ?? "";
    value.saved = feedback.startsWith("Settings committed.");
    value.liveApplied =
      value.saved &&
      feedback.includes("Live fields applied for subsequent operations");
    value.liveUnknown =
      value.saved && feedback.includes("live outcome unknown");
    value.savedUnapplied =
      value.saved && feedback.includes("live fields not applied");
    value.pendingRestart =
      value.saved && feedback.includes("pending explicit quit/reopen");
    return value;
  }
  const styles = new Map();
  let restoreTimer;
  function style(el, key, value) {
    if (!styles.has(el)) styles.set(el, el.style.cssText);
    el.style.setProperty(key, value, "important");
  }
  function restore() {
    clearTimeout(restoreTimer);
    for (const [el, original] of styles) el.style.cssText = original;
    styles.clear();
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
      } else if (
        ["liveCatalog", "liveRotate", "liveClear", "liveEmpty"].includes(action)
      ) {
        // Finite authored presets, actual semantic form events, never arbitrary
        // values/selectors, private readback, state injection or provider requests.
        if (byId("save").disabled) throw Error("Settings busy");
        const change = (element, value) => {
          if (!element || element.disabled) throw Error("Preset unavailable");
          element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const rows = Array.from(
          byId("catalog-entries").querySelectorAll("fieldset"),
        );
        const provider = (row) => row.querySelector("select")?.value;
        const openai = rows.find((row) => provider(row) === "openai");
        if (action === "liveCatalog") {
          if (rows.length !== 4 || !openai)
            throw Error("Preset baseline refused");
          change(openai.querySelector("input"), "Synthetic/Live:one");
          change(byId("catalog-default"), "entry_legacy_openai");
        } else if (action === "liveRotate") {
          change(byId("catalog-default"), "entry_legacy_deepseek");
          change(byId("MEMORY_EMBEDDING_DIMS"), "2048");
        } else {
          change(byId("catalog-default"), "");
          const remove = (row) => {
            const button = row.querySelector("button");
            if (!button || button.disabled) throw Error("Remove refused");
            button.click();
          };
          if (action === "liveClear") {
            if (!openai) throw Error("Preset baseline refused");
            remove(openai);
          } else {
            while (byId("catalog-entries").querySelector("fieldset"))
              remove(byId("catalog-entries").querySelector("fieldset"));
          }
        }
        for (const slot of [
          "OPENAI_API_KEY",
          "DEEPSEEK_API_KEY",
          "OPENROUTER_API_KEY",
        ]) {
          const clear = action === "liveClear" || action === "liveEmpty";
          change(byId(`${slot}-intent`), clear ? "clear" : "replace");
          if (!clear)
            change(
              byId(slot),
              `T0257-synthetic-${slot}-${action === "liveCatalog" ? "one" : "two"}`,
            );
        }
      } else if (action === "captureLive") {
        restore();
        const feedback = byId("status");
        const outcome = observe();
        // Reveal only an exact allowlisted fixed message, never arbitrary status
        // text or draft fields. Unknown/vendor/private text fails closed.
        const allowed = [
          "Settings committed. Live fields applied for subsequent operations; captured work is unchanged.",
          "Settings committed. Live fields applied for subsequent operations; captured work is unchanged. Other saved settings are pending explicit quit/reopen.",
          "Settings committed. Live fields applied for subsequent operations; captured work is unchanged. Catalog migration committed; original v2 retained unchanged.",
        ];
        const message = feedback.textContent;
        // Migration suffix precedes the live result in native commit reporting.
        const migrated =
          "Settings committed. Catalog migration committed; original v2 retained unchanged. Live fields applied for subsequent operations; captured work is unchanged.";
        if (
          !outcome.liveApplied ||
          ![
            ...allowed,
            migrated,
            migrated +
              " Other saved settings are pending explicit quit/reopen.",
          ].includes(message)
        )
          throw Error("Unreviewed live feedback");
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        style(feedback, "visibility", "visible");
        if (
          Array.from(document.body.querySelectorAll("*")).some(
            (el) =>
              el instanceof HTMLElement &&
              el !== feedback &&
              getComputedStyle(el).visibility !== "hidden",
          )
        )
          throw Error("Live mask failed");
        restoreTimer = setTimeout(restore, 5000);
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
      } else if (action === "capture") {
        if (!observe().manualControlsAbsent || !observe().notConnected)
          throw Error("Unsafe capture");
        restore();
        // Trusted fixed CSSOM changes respect the existing CSP; no inline stylesheet
        // injection or policy relaxation. Keep exact original styles for finally restore.
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        for (const [id, top] of [
          ["garmin-fields", "24px"],
          ["auth-section", "240px"],
        ]) {
          const root = byId(id);
          for (const el of [root, ...root.querySelectorAll("*")])
            if (el instanceof HTMLElement) style(el, "visibility", "visible");
          for (const [key, value] of Object.entries({
            position: "fixed",
            top,
            left: "24px",
            width: "800px",
            "box-sizing": "border-box",
            "background-color": "#12251c",
            "font-size": "14px",
            "line-height": "1.35",
          }))
            style(root, key, value);
        }
        style(
          byId("auth-section"),
          "top",
          `${Math.ceil(byId("garmin-fields").getBoundingClientRect().bottom + 16)}px`,
        );
        for (const el of document.querySelectorAll(
          "#auth-section input, #auth-status",
        ))
          style(el, "visibility", "hidden");
        if (
          ["DATABASE_PATH", "OPENAI_API_KEY", "email", "password", "mfa"].some(
            (id) => getComputedStyle(byId(id)).visibility !== "hidden",
          ) ||
          getComputedStyle(byId("garmin-fields")).position !== "fixed" ||
          byId("auth-section").getBoundingClientRect().bottom >
            window.innerHeight - 8
        )
          throw Error("Sanitization did not apply");
      } else if (action !== "observe") throw Error("Unsupported");
      return observe();
    } catch {
      if (["capture", "captureIntro", "captureLive"].includes(action))
        restore();
      return { ...empty(), ok: false };
    }
  };
})();
