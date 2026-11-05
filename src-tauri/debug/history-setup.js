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
      automaticHistory:
        !byId("history-limited")?.checked &&
        date?.disabled === true &&
        date?.closest("label")?.hidden === true,
      historyDateVisible: visible(date),
      historyDateRequired: date?.required === true,
      technicalControlsAbsent: technicalControlsAbsent(),
      legacyLimit:
        byId("history-limited")?.checked === true &&
        date?.value === "2024-01-01",
      summaryOn:
        byId("SUMMARY_ENABLED")?.value === "true" &&
        byId("SUMMARY_MODEL")?.value === "gpt-6-luna" &&
        byId("SUMMARY_CHAR_LIMIT")?.value === "6000",
      summaryOff:
        byId("SUMMARY_ENABLED")?.value === "false" &&
        ["unselected", "gpt-6-luna"].includes(byId("SUMMARY_MODEL")?.value) &&
        byId("SUMMARY_CHAR_LIMIT")?.value === "6000",
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
      savedForNextLaunch: [
        "Settings committed. Quit and reopen to apply; the running backend is unchanged.",
        "Settings committed. Live fields applied for subsequent operations; captured work is unchanged. Other saved settings are pending explicit quit/reopen.",
      ].includes(status),
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
  const technicalControlsAbsent = () =>
    [
      "advanced-settings",
      "memory-configuration",
      "memory-technical",
      "external-tools",
      "advanced",
      "extraction-compatibility",
      "memory-active",
      "memory-check",
    ].every((id) => !byId(id)) &&
    [
      ...document.querySelectorAll(
        "#preserved-fields input, #preserved-fields select",
      ),
    ].length === 19 &&
    byId("preserved-fields")?.matches("[hidden][inert]") === true;
  const summarySection = () => {
    if (!visible(byId("memory-section"))) throw Error("Unavailable Memory");
  };
  const staticCopy = (id, text) => {
    const el = byId(id);
    if (
      !el ||
      el.childElementCount ||
      el.textContent.replace(/\s+/g, " ").trim() !== text
    )
      throw Error("Unknown static copy");
    return el;
  };
  function summaryLabels() {
    const specs = [
      [
        "SUMMARY_ENABLED",
        "Remember across chats",
        [
          ["false", "Off"],
          ["true", "On"],
        ],
      ],
      [
        "SUMMARY_MODEL",
        "Memory and automatic chat-title model",
        [
          ["unselected", "Unselected"],
          ["gpt-6-luna", "OpenAI · gpt-6-luna"],
        ],
      ],
      ["SUMMARY_CHAR_LIMIT", "Memory size (characters)", null],
    ];
    return specs.map(([id, text, options]) => {
      const control = byId(id),
        label = control?.parentElement;
      if (
        !label ||
        label.tagName !== "LABEL" ||
        label.childNodes.length !== 2 ||
        label.firstChild.textContent !== text ||
        label.childElementCount !== 1 ||
        label.firstElementChild !== control
      )
        throw Error("Unknown summary copy/nesting");
      if (options) {
        if (
          !(control instanceof HTMLSelectElement) ||
          control.options.length !== options.length ||
          [...control.options].some(
            (option, index) =>
              option.childElementCount ||
              option.value !== options[index][0] ||
              option.textContent !== options[index][1],
          )
        )
          throw Error("Unknown summary options");
      } else if (
        !(control instanceof HTMLInputElement) ||
        control.type !== "number" ||
        control.value !== "6000"
      )
        throw Error("Noncanonical summary cap");
      return label;
    });
  }
  globalThis.__trainerHistoryRestore = restore;
  globalThis.__trainerHistorySetup = (action) => {
    try {
      if (action === "observe") return observe();
      if (!observe().ready) throw Error("Not ready");
      if (byId("restart-required")?.open && action !== "dismissRestart")
        throw Error("Dismiss restart notice first");
      switch (action) {
        case "dismissRestart":
          if (
            !byId("restart-required")?.open ||
            document.activeElement !== byId("restart-dismiss")
          )
            throw Error("No focused restart notice");
          click("restart-dismiss");
          break;
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
        case "summaryOn":
        case "summaryOff":
          if (observe().firstRun)
            throw Error("Existing-installation summary scope required");
          summarySection();
          set(
            byId("SUMMARY_ENABLED"),
            action === "summaryOn" ? "true" : "false",
          );
          set(byId("SUMMARY_MODEL"), "gpt-6-luna");
          set(byId("SUMMARY_CHAR_LIMIT"), "6000");
          break;
        case "automatic":
        case "legacyLimit":
        case "historyRequired":
          if (byId("history-limited").checked !== (action !== "automatic"))
            click("history-limited");
          if (action !== "automatic")
            set(
              byId("GARMIN_HISTORY_START_DATE"),
              action === "legacyLimit" ? "2024-01-01" : "",
            );
          break;
        case "captureSummaryWide":
        case "captureSummaryNarrow":
        case "captureHistoryWide":
        case "captureHistoryNarrow": {
          const state = observe();
          if (
            !state.privateControlsAbsent ||
            !state.technicalControlsAbsent ||
            state.firstRun ||
            (!state.summaryOn && !state.summaryOff)
          )
            throw Error("Noncanonical summary capture");
          restore();
          scroll = window.scrollY;
          summarySection();
          const history = action.startsWith("captureHistory");
          let labels;
          if (history) {
            const choice = byId("history-limited"),
              date = byId("GARMIN_HISTORY_START_DATE");
            const label = choice?.parentElement;
            if (
              !label ||
              label.tagName !== "LABEL" ||
              label.childNodes.length !== 2 ||
              label.firstElementChild !== choice ||
              label.childElementCount !== 1 ||
              label.lastChild.textContent.replace(/\s+/g, " ").trim() !==
                "Limit how far back to import" ||
              choice.type !== "checkbox" ||
              date.type !== "text" ||
              date.placeholder !== "YYYY-MM-DD" ||
              date.pattern !== "[0-9]{4}-[0-9]{2}-[0-9]{2}" ||
              date.closest("label").firstChild.textContent !== "Import from" ||
              date.closest("label").childNodes.length !== 2 ||
              (!state.automaticHistory &&
                !state.legacyLimit &&
                !(
                  state.historyDateVisible &&
                  state.historyDateRequired &&
                  date.value === ""
                ))
            )
              throw Error("Noncanonical history copy/state");
            labels = [
              byId("history-options").querySelector("legend"),
              label,
              staticCopy(
                "history-help",
                "Limits older exploration, not latest sync. Off allows automatic discovery; a limit does not prove remote coverage. Save, then quit and reopen to apply.",
              ),
            ];
            if (
              labels[0].childElementCount ||
              labels[0].textContent !== "Garmin history"
            )
              throw Error("Unknown history heading");
            if (choice.checked) labels.push(date.closest("label"));
            // History is at the end of Settings; after a resize, stale scroll
            // geometry can leave it below the viewport. Native settles resize
            // before this fixed scroll, without changing page layout.
          } else {
            labels = [
              ...summaryLabels(),
              staticCopy(
                "memory-help",
                "Keep useful decisions, preferences and constraints between chats. Eligible conversation context may be sent to the selected provider. Larger memory can cost more; automatic summaries have no daily spending cap.",
              ),
              staticCopy(
                "memory-model-help",
                "Shared by memory summaries and automatic chat titles, separate from Trainer’s chat model. Memory is used in supported OpenAI gpt-6-luna chats.",
              ),
              staticCopy(
                "memory-size-help",
                "1,000–20,000 Unicode characters.",
              ),
              staticCopy(
                "memory-off-help",
                "Off stops summary use and new processing. Stored data stays; automatic titles continue. Trainer → Memory disables memory immediately; saving On does not undo it.",
              ),
            ];
            const legend = byId("memory-section").querySelector("legend");
            if (legend.childElementCount || legend.textContent !== "Memory")
              throw Error("Unknown Memory heading");
            labels.push(legend);
            const draft = byId("memory-draft");
            if (
              !draft ||
              draft.childElementCount ||
              !/^Draft: (On|Off)\. Saved startup setting: (On|Off)\. (Unsaved changes\. )?Save, then quit and reopen to apply memory changes\.$/.test(
                draft.textContent,
              )
            )
              throw Error("Unknown draft copy");
            labels.push(draft);
          }
          byId(history ? "history-options" : "memory-section").scrollIntoView({
            block: "start",
          });
          for (const el of document.body.querySelectorAll("*"))
            if (el instanceof HTMLElement) style(el, "visibility", "hidden");
          // WebKit can omit visible descendants of a hidden scrolling ancestor.
          // Reveal containers only after excluding all direct text; siblings stay masked.
          const containers = new Set();
          for (const label of labels) {
            for (
              let parent = label.parentElement;
              parent && parent !== document.body;
              parent = parent.parentElement
            ) {
              if (
                [...parent.childNodes].some(
                  (node) =>
                    node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
                )
              )
                throw Error("Summary capture refuses direct ancestor text");
              containers.add(parent);
            }
            for (const el of [label, ...label.querySelectorAll("*")])
              style(el, "visibility", "visible");
          }
          for (const container of containers)
            style(container, "visibility", "visible");
          if (
            [...document.body.querySelectorAll("*")].some(
              (el) =>
                el instanceof HTMLElement &&
                visible(el) &&
                !containers.has(el) &&
                !labels.some((label) => el === label || label.contains(el)),
            )
          )
            throw Error("Summary mask refused");
          timer = setTimeout(restore, 10000);
          break;
        }
        case "capture": {
          const state = observe();
          if (
            !state.privateControlsAbsent ||
            (!state.automaticHistory && !state.legacyLimit)
          )
            throw Error("Unsafe capture");
          restore();
          scroll = window.scrollY;
          (state.dataStep
            ? byId("data-step")
            : state.firstRun
              ? byId("review")
              : byId("history-options")
          ).scrollIntoView({ block: "start" });
          for (const el of document.body.querySelectorAll("*"))
            if (el instanceof HTMLElement) style(el, "visibility", "hidden");
          // The closed database-operation labels are public too. Hiding option
          // children can make WebKit snapshots paint a stale first-option label.
          for (const el of document.querySelectorAll(
            "h1, #wizard, #wizard p, #data-step legend, #data-step label, #database-selection, #database-selection option, #history-options, #history-options *, #review h2, #save, #back, #next, #cancel",
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
      if (
        [
          "capture",
          "captureSummaryWide",
          "captureSummaryNarrow",
          "captureHistoryWide",
          "captureHistoryNarrow",
        ].includes(action)
      )
        restore();
      return { ...observe(), ok: false };
    }
  };
})();
