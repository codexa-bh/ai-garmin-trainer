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
    restartVisible: false,
    restartFocused: false,
    saveFocused: false,
    editsCancelled: false,
    captureFeedbackRejected: false,
    captureMaskRejected: false,
    catalogReady: false,
    catalogExercised: false,
    catalogWithoutDefaults: false,
    emptyCatalog: false,
    keysReady: false,
    keysEdited: false,
    keysRejected: false,
  });
  const visible = (el) =>
    el instanceof HTMLElement &&
    el.isConnected &&
    !el.closest("[hidden], [inert]") &&
    getComputedStyle(el).display !== "none" &&
    getComputedStyle(el).visibility !== "hidden" &&
    el.getClientRects().length > 0;
  const byId = (id) => document.getElementById(id);
  const providers = ["openai", "deepseek", "ollama", "openrouter"];
  let exercised = false;
  const rows = (provider) =>
    Array.from(byId(`catalog-${provider}-rows`).children);
  const model = (row) => row.querySelector('input[id$="-modelId"]');
  const idOnlyRows = () =>
    Array.from(document.querySelectorAll(".catalog-row")).every(
      (row) => row.querySelectorAll("input").length === 1 && !!model(row),
    );
  function keyState(provider, state) {
    const input = byId(`${provider}_API_KEY`);
    const statuses = {
      absent: "Not configured",
      configured: "Configured — saved key hidden",
      replace: "Replacement pending Save",
      clear: "Removal pending Save",
    };
    return (
      input?.type === "password" &&
      input.value ===
        (state === "replace" ? "synthetic-openai-replacement" : "") &&
      input.placeholder ===
        (state === "configured" ? "••••••••" : "Enter API key") &&
      byId(`${provider}_API_KEY-status`)?.textContent === statuses[state]
    );
  }
  function keyless() {
    return ["OPENAI", "DEEPSEEK", "OPENROUTER"].every((provider) =>
      keyState(provider, "absent"),
    );
  }
  function keysReady() {
    return (
      keyState("OPENAI", "configured") &&
      keyState("DEEPSEEK", "configured") &&
      keyState("OPENROUTER", "absent")
    );
  }
  function keysEdited() {
    return (
      keyState("OPENAI", "replace") &&
      keyState("DEEPSEEK", "clear") &&
      keyState("OPENROUTER", "absent")
    );
  }
  function safeKeys() {
    return (
      keyless() ||
      keysReady() ||
      keysEdited() ||
      (keyState("OPENAI", "configured") &&
        keyState("DEEPSEEK", "absent") &&
        keyState("OPENROUTER", "absent"))
    );
  }
  function exerciseKeys() {
    if (!keysReady()) throw Error("Not exact synthetic provider presence");
    const openai = byId("OPENAI_API_KEY");
    openai.focus();
    openai.setSelectionRange(2, 4);
    edit(openai, "synthetic-openai-replacement");
    const deepseek = byId("DEEPSEEK_API_KEY");
    deepseek.focus();
    deepseek.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      }),
    );
    edit(byId("OPENROUTER_API_KEY"), "synthetic-temporary-draft");
    edit(byId("OPENROUTER_API_KEY"), "");
    if (!keysEdited()) throw Error("Provider edit intents failed");
  }
  function syntheticCatalog() {
    return (
      safeKeys() &&
      idOnlyRows() &&
      !byId("catalog-default") &&
      !document.querySelector('.catalog-row [aria-label^="Default"]') &&
      document.querySelectorAll(".catalog-row").length === 8 &&
      providers.every((provider) => {
        const group = rows(provider);
        return (
          group.length === 2 &&
          group[0].dataset.entryId === `entry_legacy_${provider}` &&
          /^entry_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            group[1].dataset.entryId,
          ) &&
          model(group[0])?.value === `synthetic/${provider}:Case` &&
          model(group[1])?.value === `synthetic/${provider}:Second`
        );
      })
    );
  }
  function click(element) {
    if (
      !visible(element) ||
      element.disabled ||
      (element.id && document.querySelectorAll(`#${element.id}`).length !== 1)
    )
      throw Error("Unavailable control");
    element.click();
  }
  function edit(element, value) {
    if (!visible(element) || element.disabled) throw Error("Unavailable input");
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function exerciseCatalog() {
    const legacyModels = [
      "gpt-6-luna",
      "deepseek-flash",
      "qwen3.5:4b",
      "nvidia/nemotron-3.5-lightning:free",
    ];
    if (
      !safeKeys() ||
      !idOnlyRows() ||
      byId("catalog-default") ||
      document.querySelector('.catalog-row [aria-label^="Default"]') ||
      document.querySelectorAll(".catalog-row").length !== 4 ||
      !providers.every(
        (provider, index) =>
          rows(provider).length === 1 &&
          rows(provider)[0].dataset.entryId === `entry_legacy_${provider}` &&
          model(rows(provider)[0]).value === legacyModels[index],
      )
    )
      throw Error("Not exact legacy catalog");
    // Actual app controls only. No application-state injection or caller input.
    for (const provider of providers) {
      edit(model(rows(provider)[0]), `synthetic/${provider}:Case`);
      click(byId(`catalog-${provider}-add`));
      if (document.activeElement !== model(rows(provider)[1]))
        throw Error("Add focus lost");
      edit(model(rows(provider)[1]), `synthetic/${provider}:Second`);
    }
    edit(model(rows("openai")[1]), "synthetic/openai:Case");
    if (
      model(rows("openai")[1]).validity.valid ||
      !rows("openai")[1]
        .querySelector(".catalog-error")
        .textContent.includes("Duplicate")
    )
      throw Error("Duplicate not explained");
    edit(model(rows("openai")[1]), "synthetic/openai:Second");
    click(byId("catalog-deepseek-add"));
    click(rows("deepseek")[2].querySelector('button[aria-label^="Remove"]'));
    if (
      document.activeElement !== model(rows("deepseek")[1]) ||
      !syntheticCatalog()
    )
      throw Error("Removal/draft identity lost");
    exercised = true;
  }
  function observe() {
    const value = empty();
    value.ready =
      !!byId("AI_PROVIDER") &&
      byId("AI_PROVIDER").value === "ollama" &&
      !!byId("OPENAI_API_KEY-status");
    if (!value.ready) return value;
    value.catalogReady = syntheticCatalog();
    value.catalogExercised = exercised;
    value.catalogWithoutDefaults =
      !byId("catalog-default") &&
      !document.querySelector('.catalog-row [aria-label^="Default"]');
    value.emptyCatalog =
      safeKeys() && document.querySelectorAll(".catalog-row").length === 0;
    value.keysReady = keysReady();
    value.keysEdited = keysEdited();
    value.keysRejected =
      byId("status")?.textContent.startsWith(
        "Settings changed since this form was loaded.",
      ) === true;
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
    value.editsCancelled = feedback.startsWith("Edits cancelled.");
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
    value.restartVisible = byId("restart-required")?.open === true;
    value.restartFocused =
      value.restartVisible &&
      document.activeElement === byId("restart-dismiss");
    value.saveFocused = document.activeElement === byId("save");
    return value;
  }
  const styles = new Map();
  let restoreTimer;
  let scrollPosition;
  let privacyOpen;
  function style(el, key, value) {
    if (!styles.has(el)) styles.set(el, el.style.cssText);
    el.style.setProperty(key, value, "important");
  }
  function restore() {
    clearTimeout(restoreTimer);
    for (const [el, original] of styles) el.style.cssText = original;
    styles.clear();
    if (privacyOpen !== undefined) byId("garmin-privacy").open = privacyOpen;
    privacyOpen = undefined;
    if (scrollPosition) window.scrollTo(...scrollPosition);
    scrollPosition = null;
  }
  function captureProvider(provider) {
    restore();
    if (
      !syntheticCatalog() &&
      !(observe().emptyCatalog && observe().catalogWithoutDefaults)
    )
      throw Error("Not canonical synthetic catalog");
    const root = byId(`catalog-${provider}`);
    const reveal = [root.querySelector("h2"), byId(`catalog-${provider}-add`)];
    if (
      reveal[0].textContent !==
        {
          openai: "OpenAI",
          deepseek: "DeepSeek",
          ollama: "Ollama",
          openrouter: "OpenRouter",
        }[provider] ||
      reveal[0].childElementCount !== 0 ||
      reveal[1].textContent.trim() !== "Add model" ||
      reveal[1].childElementCount !== 0
    )
      throw Error("Unexpected provider header");
    for (const row of rows(provider)) {
      const labels = Array.from(row.querySelectorAll("label"));
      const buttons = Array.from(row.querySelectorAll("button"));
      if (
        labels.length !== 1 ||
        buttons.length !== 1 ||
        row.querySelectorAll("input").length !== 1 ||
        labels.some(
          (label) =>
            label.childElementCount !== 1 || label.textContent !== "Model ID",
        ) ||
        buttons.some(
          (button) =>
            button.childElementCount !== 0 || button.textContent !== "Remove",
        )
      )
        throw Error("Unexpected row content");
      reveal.push(...labels, model(row), ...buttons);
    }
    if (provider !== "ollama") {
      const slot = `${provider.toUpperCase()}_API_KEY`;
      const input = byId(slot),
        state = byId(`${slot}-status`),
        label = input.parentElement;
      if (
        label.firstChild?.textContent !== provider.toUpperCase() ||
        label.childElementCount !== 2 ||
        label.textContent !== `${provider.toUpperCase()}${state.textContent}` ||
        state.childElementCount !== 0 ||
        label.querySelector("select") ||
        !safeKeys()
      )
        throw Error("Unexpected key control");
      reveal.push(label, input, state);
    }
    // No layout mutation/repositioning: scroll a real section into the viewport.
    // Reveal only individually verified nodes; unknown descendants remain masked.
    scrollPosition = [window.scrollX, window.scrollY];
    window.scrollTo(0, window.scrollY + root.getBoundingClientRect().top - 16);
    for (const el of document.body.querySelectorAll("*"))
      if (el instanceof HTMLElement) style(el, "visibility", "hidden");
    for (const el of reveal) style(el, "visibility", "visible");
    if (
      Array.from(document.body.querySelectorAll("*")).some(
        (el) =>
          el instanceof HTMLElement &&
          !reveal.includes(el) &&
          getComputedStyle(el).visibility !== "hidden",
      )
    )
      throw Error("Ineffective mask");
    for (const el of reveal.filter((el) => el.tagName !== "OPTION")) {
      const rect = el.getBoundingClientRect();
      if (
        !visible(el) ||
        rect.left < 0 ||
        rect.right > window.innerWidth ||
        rect.top < 0 ||
        rect.bottom > window.innerHeight
      )
        throw Error("Provider overflow");
    }
    restoreTimer = setTimeout(restore, 5000);
  }
  globalThis.__trainerSetupSmokeRestore = restore;
  globalThis.__trainerSetupSmoke = (action) => {
    try {
      if (!observe().ready) throw Error("Not ready");
      const modalActions = [
        "observe",
        "restartDismiss",
        "restartEscape",
        "restartTab",
        "captureRestartWide",
        "captureRestartNarrow",
      ];
      if (observe().restartVisible && !modalActions.includes(action))
        throw Error("Dismiss modal before another Settings action");
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
        if (action === "save") el.focus();
        el.click();
      } else if (["restartChange", "restartRestore"].includes(action)) {
        if (byId("save").disabled) throw Error("Settings busy");
        const dimensions = byId("MEMORY_EMBEDDING_DIMS");
        if (!["1536", "2048"].includes(dimensions?.value))
          throw Error("Not fixed dimensions");
        dimensions.value = action === "restartChange" ? "2048" : "1536";
        dimensions.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (
        ["restartDismiss", "restartEscape", "restartTab"].includes(action)
      ) {
        if (!observe().restartFocused) throw Error("Modal focus missing");
        const button = byId("restart-dismiss");
        if (action === "restartDismiss") click(button);
        else {
          for (const shiftKey of action === "restartTab"
            ? [false, true]
            : [false]) {
            button.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: action === "restartEscape" ? "Escape" : "Tab",
                shiftKey,
                bubbles: true,
                cancelable: true,
              }),
            );
            if (action === "restartTab" && !observe().restartFocused)
              throw Error("Focus escaped modal");
          }
        }
      } else if (
        ["captureRestartWide", "captureRestartNarrow"].includes(action)
      ) {
        restore();
        const dialog = byId("restart-required");
        const heading = byId("restart-heading");
        const description = byId("restart-description");
        const button = byId("restart-dismiss");
        const reveal = [dialog, heading, description, button];
        if (
          !observe().restartFocused ||
          dialog.tagName !== "DIALOG" ||
          dialog.getAttribute("aria-labelledby") !== heading.id ||
          dialog.getAttribute("aria-describedby") !== description.id ||
          dialog.children.length !== 3 ||
          dialog.children[0] !== heading ||
          dialog.children[1] !== description ||
          dialog.children[2] !== button ||
          button.type !== "button" ||
          [heading, description, button].some(
            (el, index) =>
              el.childElementCount ||
              el.textContent.replace(/\s+/g, " ").trim() !==
                [
                  "Restart required",
                  "Restart the app for these changes to take effect.",
                  "OK",
                ][index],
          )
        )
          throw Error("Unreviewed modal");
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        for (const el of reveal) style(el, "visibility", "visible");
        if (
          Array.from(document.body.querySelectorAll("*")).some(
            (el) =>
              el instanceof HTMLElement &&
              !reveal.includes(el) &&
              getComputedStyle(el).visibility !== "hidden",
          )
        )
          throw Error("Modal mask failed");
        for (const el of reveal) {
          const rect = el.getBoundingClientRect();
          if (
            !visible(el) ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.left < 0 ||
            rect.top < 0 ||
            rect.right > innerWidth ||
            rect.bottom > innerHeight
          )
            throw Error("Modal overflow");
        }
        restoreTimer = setTimeout(restore, 5000);
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
        const allRows = Array.from(document.querySelectorAll(".catalog-row"));
        const openai = byId("entry_legacy_openai-modelId")?.closest(
          ".catalog-row",
        );
        if (action === "liveCatalog") {
          if (allRows.length !== 4 || !openai)
            throw Error("Preset baseline refused");
          change(openai.querySelector("input"), "Synthetic/Live:one");
          change(byId("entry_legacy_ollama-modelId"), "Synthetic/Local:two");
        } else if (action === "liveRotate") {
          change(byId("MEMORY_EMBEDDING_DIMS"), "2048");
        } else {
          const remove = (row) => {
            const button = row.querySelector('button[aria-label^="Remove"]');
            if (!button || button.disabled) throw Error("Remove refused");
            button.click();
          };
          if (action === "liveClear") {
            if (!openai) throw Error("Preset baseline refused");
            remove(openai);
          } else {
            while (document.querySelector(".catalog-row"))
              remove(document.querySelector(".catalog-row"));
          }
        }
        for (const slot of [
          "OPENAI_API_KEY",
          "DEEPSEEK_API_KEY",
          "OPENROUTER_API_KEY",
        ]) {
          const clear = action === "liveClear" || action === "liveEmpty";
          if (clear) {
            byId(slot).dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Backspace",
                bubbles: true,
                cancelable: true,
              }),
            );
            change(byId(slot), "");
          } else {
            change(
              byId(slot),
              `T0257-synthetic-${slot}-${action === "liveCatalog" ? "one" : "two"}`,
            );
          }
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
        // The background WebView may otherwise scroll its retained Save focus
        // back into view after we position the feedback. Focus-return evidence
        // was already observed before this separate masked capture.
        if (document.activeElement === byId("save")) byId("save").blur();
        scrollPosition = [window.scrollX, window.scrollY];
        window.scrollTo(
          0,
          window.scrollY + feedback.getBoundingClientRect().top - 24,
        );
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        style(feedback, "visibility", "visible");
        const rect = feedback.getBoundingClientRect();
        if (
          !visible(feedback) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < 0 ||
          rect.top < 0 ||
          rect.right > innerWidth ||
          rect.bottom > innerHeight
        )
          throw Error("Live feedback overflow");
        if (
          Array.from(document.body.querySelectorAll("*")).some(
            (el) =>
              el instanceof HTMLElement &&
              el !== feedback &&
              getComputedStyle(el).visibility !== "hidden" &&
              // WebKit can retain computed visibility on the just-closed dialog
              // subtree until layout. Non-rendered nodes cannot leak into PNGs;
              // every rendered node other than reviewed feedback must be hidden.
              el.getClientRects().length > 0,
          )
        )
          throw Error("Live mask failed");
        restoreTimer = setTimeout(restore, 5000);
      } else if (action === "keysExercise") {
        exerciseKeys();
      } else if (action === "catalogExercise") {
        exerciseCatalog();
      } else if (action === "catalogEmpty") {
        if (!syntheticCatalog())
          throw Error("Only canonical synthetic catalog may be removed");
        for (const provider of providers) {
          while (rows(provider).length)
            click(
              rows(provider)[0].querySelector('button[aria-label^="Remove"]'),
            );
        }
        if (!observe().emptyCatalog)
          throw Error("Catalog removal did not apply");
      } else if (
        [
          "captureOpenai",
          "captureDeepseek",
          "captureOllama",
          "captureOpenrouter",
        ].includes(action)
      ) {
        captureProvider(action.slice(7).toLowerCase());
      } else if (
        ["captureFooterWide", "captureFooterNarrow"].includes(action)
      ) {
        restore();
        const main = document.querySelector("body > main");
        const footer = byId("save")?.closest(".actions");
        const controls = footer
          ? [...footer.children].filter((el) => visible(el))
          : [];
        if (
          !main ||
          /External uv\/uvx, Python/.test(main.textContent) ||
          !footer ||
          controls.length !== 2 ||
          controls[0] !== byId("save") ||
          controls[1] !== byId("cancel") ||
          controls.some(
            (el, index) =>
              el.childElementCount ||
              el.textContent.trim() !==
                ["Save settings", "Cancel edits"][index],
          ) ||
          [...main.children]
            .slice(-2)
            .some((el) => el.tagName !== "FORM" || el.textContent.trim())
        )
          throw Error("Unexpected Settings footer");
        scrollPosition = [window.scrollX, window.scrollY];
        window.scrollTo(
          0,
          Math.max(0, footer.getBoundingClientRect().top + window.scrollY - 24),
        );
        for (const el of document.body.querySelectorAll("*"))
          if (el instanceof HTMLElement) style(el, "visibility", "hidden");
        for (const el of controls) style(el, "visibility", "visible");
        if (
          [...document.body.querySelectorAll("*")].some(
            (el) =>
              el instanceof HTMLElement &&
              !controls.includes(el) &&
              getComputedStyle(el).visibility !== "hidden",
          ) ||
          controls.some((el) => {
            const r = el.getBoundingClientRect();
            return (
              !visible(el) ||
              r.width <= 0 ||
              r.height <= 0 ||
              r.left < 0 ||
              r.top < 0 ||
              r.right > innerWidth ||
              r.bottom > innerHeight
            );
          })
        )
          throw Error("Footer mask refused");
        restoreTimer = setTimeout(restore, 5000);
      } else if (action === "captureIntro") {
        restore();
        const main = document.querySelector("body > main");
        const intro = main ? Array.from(main.children).slice(0, 1) : [];
        const expected = ["Settings"];
        if (
          intro.length !== 1 ||
          main.children[1] !== byId("status") ||
          byId("keys") ||
          byId("next-launch-guidance") ||
          intro.some(
            (el, index) =>
              el.tagName !== (index === 0 ? "H1" : "P") ||
              el.childElementCount !== 0 ||
              el.textContent.replace(/\s+/g, " ").trim() !== expected[index] ||
              !visible(el),
          )
        )
          throw Error("Unexpected introduction");
        // The removed prose must be absent, not hidden/moved elsewhere.
        if (
          [
            "Settings and API keys are saved locally without encryption.",
            "The app can update the selected database.",
            "Saved keys stay hidden behind a fixed mask.",
            "Choose a model explicitly in Trainer.",
            "Save can apply chat catalog and provider keys now;",
          ].some((text) => main.textContent.replace(/\s+/g, " ").includes(text))
        )
          throw Error("Removed copy remains");
        scrollPosition = [window.scrollX, window.scrollY];
        window.scrollTo(0, 0);
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
      } else if (
        ["capture", "captureWide", "captureNarrow", "capturePrivacy"].includes(
          action,
        )
      ) {
        if (!observe().manualControlsAbsent || !observe().notConnected)
          throw Error("Unsafe capture");
        restore();
        if (visible(byId("connect-later")) !== observe().formVisible)
          throw Error("Unexpected back action visibility");
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
          [byId("connect-later"), "Back"],
          [byId("sign-in"), "Sign in and verify"],
          [
            byId("garmin-privacy").querySelector("summary"),
            "Sign-in and private storage details",
          ],
        ]);
        if (action === "capturePrivacy") {
          const disclosure = byId("garmin-privacy");
          const paragraphs = disclosure.querySelectorAll("p");
          if (disclosure.children.length !== 3 || paragraphs.length !== 2)
            throw Error("Unexpected disclosure structure");
          approved.set(
            paragraphs[0],
            "This unofficial connector is not official OAuth. Account challenges and rate limits may prevent sign-in. Only your explicit action starts login; no automatic retries.",
          );
          approved.set(
            paragraphs[1],
            "Email, password and one supported MFA code stay transient in native sign-in, never saved, logged or sent to AI. Do not enter credentials in chat.",
          );
          privacyOpen = disclosure.open;
          disclosure.open = true;
        }
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
        if (action !== "capturePrivacy" && byId("garmin-privacy").open)
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
    } catch (error) {
      restore();
      return {
        ...empty(),
        ok: false,
        captureFeedbackRejected: error.message === "Unreviewed live feedback",
        captureMaskRejected: error.message === "Live mask failed",
      };
    }
  };
})();
