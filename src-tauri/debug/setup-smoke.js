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
  function style(el, key, value) {
    if (!styles.has(el)) styles.set(el, el.style.cssText);
    el.style.setProperty(key, value, "important");
  }
  function restore() {
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
      if (action === "capture") restore();
      return { ...empty(), ok: false };
    }
  };
})();
