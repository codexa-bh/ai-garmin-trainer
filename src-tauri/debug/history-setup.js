// Installed only in an explicitly admitted history-setup local native document.
// Finite synthetic semantic actions; no caller input, paths, secrets or IPC grant.
(() => {
  const byId = (id) => document.getElementById(id);
  const visible = (el) =>
    el instanceof HTMLElement &&
    !el.closest("[hidden], [inert]") &&
    getComputedStyle(el).display !== "none" &&
    getComputedStyle(el).visibility !== "hidden" &&
    el.getClientRects().length > 0;
  let saveSubmitted = false;
  let saveRequested = false;
  let historyValidationBlocked = false;
  let historyBadInput = false;
  let historyValueMissing = false;
  let otherValidationBlocked = false;
  document.addEventListener(
    "invalid",
    (event) => {
      if (event.target?.closest("form") !== byId("settings")) return;
      if (event.target === byId("GARMIN_HISTORY_START_DATE")) {
        historyValidationBlocked = true;
        historyBadInput = event.target.validity.badInput;
        historyValueMissing = event.target.validity.valueMissing;
      } else otherValidationBlocked = true;
    },
    true,
  );
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target === byId("settings")) saveSubmitted = true;
    },
    true,
  );
  function observe() {
    const date = byId("GARMIN_HISTORY_START_DATE");
    const status = byId("status")?.textContent ?? "";
    return {
      ok: true,
      ready: !!date && !!byId("DATABASE_PATH") && !byId("save").disabled,
      formValid: [
        ...document.querySelectorAll("#settings input, #settings select"),
      ].every((el) => !el.willValidate || el.validity.valid),
      firstRun: visible(byId("wizard")),
      dataStep: visible(byId("database-choice")) && visible(byId("data-step")),
      reviewStep: visible(byId("review")),
      automaticHistory: !byId("history-limited")?.checked && date?.value === "",
      legacyLimit:
        byId("history-limited")?.checked === true &&
        date?.value === "2024-01-01",
      saveSubmitted,
      saveRequested,
      historyValidationBlocked,
      historyBadInput,
      historyValueMissing,
      otherValidationBlocked,
      documentVisible: document.visibilityState === "visible",
      formConnected: byId("settings")?.isConnected === true,
      saveRejected: status.includes("Non-secret draft retained;"),
      settingsUnavailable: status.startsWith(
        "Saved settings are invalid or inaccessible.",
      ),
      commandPermissionDenied: status.includes("not allowed"),
      commandArgumentsInvalid: status.startsWith("invalid args"),
      savedForNextLaunch:
        byId("status")?.textContent.startsWith(
          "Settings committed. Quit and reopen to apply; the running backend is unchanged.",
        ) === true,
      privateControlsAbsent: [
        "GARMIN_MCP_TOKEN_DIR",
        "destination",
        "auth-parent",
      ].every((id) => !byId(id)),
    };
  }
  const styles = new Map();
  let scroll = 0;
  let timer;
  function restore() {
    clearTimeout(timer);
    for (const [el, css] of styles) el.style.cssText = css;
    styles.clear();
    window.scrollTo(0, scroll);
  }
  const style = (el, property, value) => {
    if (!styles.has(el)) styles.set(el, el.style.cssText);
    el.style.setProperty(property, value, "important");
  };
  const click = (id) => {
    const el = byId(id);
    if (!visible(el) || el.disabled) throw Error("Unavailable");
    el.click();
  };
  const set = (el, value) => {
    if (!visible(el) || el.disabled || el.readOnly) throw Error("Unavailable");
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const technical = () => {
    const details = byId("advanced-settings");
    if (!details.open) details.querySelector(":scope > summary").click();
  };
  globalThis.__trainerHistoryRestore = restore;
  globalThis.__trainerHistorySetup = (action) => {
    try {
      if (action === "observe") return observe();
      if (!observe().ready) throw Error("Not ready");
      switch (action) {
        case "observe":
          break;
        case "createNew":
          set(byId("database-selection"), "create-new");
          break;
        case "useExisting":
          set(byId("database-selection"), "use-existing");
          break;
        case "next":
          click("next");
          break;
        case "finish":
          if (
            !observe().firstRun ||
            !observe().reviewStep ||
            !observe().automaticHistory
          )
            throw Error("Wrong first run");
          click("save");
          break;
        case "save":
          if (observe().firstRun) throw Error("Finish required");
          saveSubmitted = false;
          saveRequested = true;
          historyValidationBlocked = false;
          historyBadInput = false;
          historyValueMissing = false;
          otherValidationBlocked = false;
          {
            const form = byId("settings");
            const button = byId("save");
            if (
              !visible(button) ||
              button.matches(":disabled") ||
              button.form !== form
            )
              throw Error("Unavailable");
            // The normal semantic submit path still performs browser constraint
            // validation and invokes the real existing handler; never form.submit().
            form.requestSubmit(button);
          }
          break;
        case "automatic":
        case "legacyLimit":
          technical();
          if (byId("history-limited").checked !== (action === "legacyLimit"))
            click("history-limited");
          if (action === "legacyLimit")
            set(byId("GARMIN_HISTORY_START_DATE"), "2024-01-01");
          break;
        case "capture": {
          const state = observe();
          if (
            !state.privateControlsAbsent ||
            (!state.automaticHistory && !state.legacyLimit)
          )
            throw Error("Unsafe capture");
          restore();
          scroll = window.scrollY;
          if (!state.firstRun) technical();
          (state.dataStep
            ? byId("data-step")
            : state.firstRun
              ? byId("review")
              : byId("history-options")
          ).scrollIntoView({ block: "start" });
          for (const el of document.body.querySelectorAll("*"))
            if (el instanceof HTMLElement) style(el, "visibility", "hidden");
          for (const el of document.querySelectorAll(
            "h1, #wizard, #wizard p, #data-step legend, #data-step label, #database-selection, #advanced-settings > summary, #history-options, #history-options *, #review h2, #save, #back, #next, #cancel",
          )) {
            if (el instanceof HTMLElement) style(el, "visibility", "visible");
          }
          // Never reveal selected paths, key/status/private connection text or credential controls.
          for (const el of document.querySelectorAll(
            "input:not(#GARMIN_HISTORY_START_DATE):not(#history-limited), #connection-status, #review-summary, #status, #auth-section, #keys, #catalog-entries",
          ))
            style(el, "visibility", "hidden");
          if (getComputedStyle(byId("DATABASE_PATH")).visibility !== "hidden")
            throw Error("Mask refused");
          timer = setTimeout(restore, 10000);
          break;
        }
        default:
          throw Error("Unsupported");
      }
      return observe();
    } catch {
      if (action === "capture") restore();
      return { ...observe(), ok: false };
    }
  };
})();
