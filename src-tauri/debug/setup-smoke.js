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
    catalogReady: false,
    catalogExercised: false,
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
  const name = (row) => row.querySelector('input[id$="-displayName"]');
  function keyless() {
    return ["OPENAI", "DEEPSEEK", "OPENROUTER"].every(
      (provider) =>
        byId(`${provider}_API_KEY-status`)?.textContent === "not configured" &&
        byId(`${provider}_API_KEY-intent`)?.value === "unchanged" &&
        byId(`${provider}_API_KEY`)?.value === "",
    );
  }
  function syntheticCatalog() {
    return (
      keyless() &&
      byId("catalog-default")?.value === "entry_legacy_ollama" &&
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
          name(group[0])?.value === "Synthetic model" &&
          model(group[1])?.value === `synthetic/${provider}:Second` &&
          name(group[1])?.value === ""
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
      !keyless() ||
      byId("catalog-default").value !== "entry_legacy_ollama" ||
      document.querySelectorAll(".catalog-row").length !== 4 ||
      !providers.every(
        (provider, index) =>
          rows(provider).length === 1 &&
          rows(provider)[0].dataset.entryId === `entry_legacy_${provider}` &&
          model(rows(provider)[0]).value === legacyModels[index] &&
          name(rows(provider)[0]).value === "",
      )
    )
      throw Error("Not exact legacy catalog");
    // Actual app controls only. No application-state injection or caller input.
    click(rows("ollama")[0].querySelector('button[aria-label^="Remove"]'));
    if (
      document.activeElement !== byId("catalog-default") ||
      rows("ollama").length !== 1 ||
      !byId("status").textContent.includes("explicitly clear")
    )
      throw Error("Default removal was not guarded");
    for (const provider of providers) {
      edit(model(rows(provider)[0]), `synthetic/${provider}:Case`);
      edit(name(rows(provider)[0]), "Synthetic model");
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
    click(rows("openrouter")[1].querySelector('button[aria-label^="Default"]'));
    if (byId("catalog-default").value !== rows("openrouter")[1].dataset.entryId)
      throw Error("Global default lost");
    byId("catalog-default").value = "";
    byId("catalog-default").dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    if (
      document.querySelectorAll('.catalog-row [aria-pressed="true"]').length !==
      0
    )
      throw Error("Clear failed");
    click(rows("ollama")[0].querySelector('button[aria-label^="Default"]'));
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
      ["configured", "not configured"].includes(
        byId("OPENAI_API_KEY-status")?.textContent,
      );
    if (!value.ready) return value;
    value.catalogReady = syntheticCatalog();
    value.catalogExercised = exercised;
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
  function captureProvider(provider) {
    restore();
    if (!syntheticCatalog()) throw Error("Not canonical synthetic catalog");
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
        labels.length !== 2 ||
        buttons.length !== 2 ||
        row.querySelectorAll("input").length !== 2 ||
        labels.some(
          (label, index) =>
            label.childElementCount !== 1 ||
            label.textContent !== ["Model ID", "Name (optional)"][index],
        ) ||
        buttons.some(
          (button, index) =>
            button.childElementCount !== 0 ||
            button.textContent !==
              (index === 1
                ? "Remove"
                : button.getAttribute("aria-pressed") === "true"
                  ? "Default ✓"
                  : "Default"),
        )
      )
        throw Error("Unexpected row content");
      reveal.push(...labels, model(row), name(row), ...buttons);
    }
    if (provider !== "ollama") {
      const slot = `${provider.toUpperCase()}_API_KEY`;
      const input = byId(slot),
        intent = byId(`${slot}-intent`),
        state = byId(`${slot}-status`),
        label = input.parentElement;
      if (
        label.firstChild?.textContent !== provider.toUpperCase() ||
        label.childElementCount !== 3 ||
        label.textContent !==
          `${provider.toUpperCase()}not configuredunchangedreplaceclear` ||
        state.childElementCount !== 0 ||
        intent.options.length !== 3 ||
        Array.from(intent.options).some(
          (option, index) =>
            option.value !== ["unchanged", "replace", "clear"][index] ||
            option.textContent !== option.value,
        )
      )
        throw Error("Unexpected key control");
      reveal.push(label, input, intent, state, ...intent.options);
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
        const allRows = Array.from(document.querySelectorAll(".catalog-row"));
        const openai = byId("entry_legacy_openai-modelId")?.closest(
          ".catalog-row",
        );
        if (action === "liveCatalog") {
          if (allRows.length !== 4 || !openai)
            throw Error("Preset baseline refused");
          change(openai.querySelector("input"), "Synthetic/Live:one");
          change(byId("catalog-default"), "entry_legacy_openai");
        } else if (action === "liveRotate") {
          change(byId("catalog-default"), "entry_legacy_deepseek");
          change(byId("MEMORY_EMBEDDING_DIMS"), "2048");
        } else {
          change(byId("catalog-default"), "");
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
        scrollPosition = [window.scrollX, window.scrollY];
        window.scrollTo(
          0,
          window.scrollY + feedback.getBoundingClientRect().top - 24,
        );
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
      } else if (action === "catalogExercise") {
        exerciseCatalog();
      } else if (
        [
          "captureOpenai",
          "captureDeepseek",
          "captureOllama",
          "captureOpenrouter",
        ].includes(action)
      ) {
        captureProvider(action.slice(7).toLowerCase());
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
      if (typeof action === "string" && action.startsWith("capture")) restore();
      return { ...empty(), ok: false };
    }
  };
})();
