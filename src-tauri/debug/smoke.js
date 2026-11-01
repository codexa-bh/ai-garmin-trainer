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
  function healthObservation() {
    const comparison = document.querySelector(".health-daily-matrix");
    const healthButtons = document.querySelectorAll(
      ".health-daily-actions button",
    );
    const mode = document
      .querySelector('.health-mode-controls [aria-selected="true"]')
      ?.textContent.trim()
      .toLowerCase();
    return {
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
    };
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
      ...(globalThis.__trainerOrdinaryIsolated
        ? {
            tablesReady: [
              ...document.querySelectorAll(".assistant-table"),
            ].some(visible),
          }
        : { ...healthObservation(), llmDebug: debugObservation() }),
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
  const footerEntries = [
    [
      "entry_footer_long",
      "T0246 long descriptive local model selection for narrow composer footer — ollama / T0246/Long-local-model-name:exact-tag",
    ],
    ["entry_footer_other", "T0246 alternate — ollama / T0246/Alternate:Tag"],
  ];
  let composerTextarea;
  let keysNoSend = false;
  const composerDraft = () =>
    `T0246-composer-${globalThis.__trainerOrdinaryIsolated?.runId}`;
  function composerElements() {
    if (!globalThis.__trainerOrdinaryIsolated || observe().view !== "Trainer")
      throw Error("Ordinary isolated Trainer only");
    const textareas = [
      ...document.querySelectorAll(
        '.composer-dock textarea[aria-label="Message"]',
      ),
    ].filter(visible);
    const selects = [
      ...document.querySelectorAll('select[aria-label="Trainer model"]'),
    ].filter(visible);
    const sends = [
      ...document.querySelectorAll(".composer-dock button"),
    ].filter((el) => visible(el) && name(el) === "Send");
    if (textareas.length !== 1 || selects.length !== 1 || sends.length !== 1)
      throw Error("Composer unavailable/ambiguous");
    return { textarea: textareas[0], select: selects[0], send: sends[0] };
  }
  function knownFooterCatalog(select) {
    const options = [...select.options];
    return (
      options.length >= 2 &&
      options.length <= 3 &&
      footerEntries.every(([id, label]) =>
        options.some(
          (option) =>
            option.value === id &&
            option.textContent === label &&
            !option.disabled,
        ),
      ) &&
      options.every(
        (option) =>
          footerEntries.some(
            ([id, label]) =>
              option.value === id && option.textContent === label,
          ) ||
          (option.value === "" &&
            option.disabled &&
            [
              `Default · ${footerEntries[1][1]}`,
              "Unavailable saved entry",
            ].includes(option.textContent)),
      )
    );
  }
  function composerObservation(action) {
    const { textarea, select, send } = composerElements();
    const rects = [textarea, select, send].map((el) =>
      el.getBoundingClientRect(),
    );
    const [field, model, submit] = rects;
    return {
      ok: true,
      action,
      trustedInput: false,
      modelReady: !select.disabled && knownFooterCatalog(select),
      singleControl:
        document.querySelectorAll('select[aria-label="Trainer model"]')
          .length === 1 &&
        !document.querySelector(".trainer-heading-row select"),
      footerOrder:
        textarea.compareDocumentPosition(select) ===
          Node.DOCUMENT_POSITION_FOLLOWING &&
        select.closest(".chat-model-control")?.nextElementSibling === send,
      fitsViewport:
        rects.every(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
        ) &&
        model.top >= field.bottom &&
        model.right <= submit.left &&
        document.documentElement.scrollWidth <= innerWidth,
      draftMatches: textarea.value === composerDraft(),
      textareaStable: textarea === composerTextarea,
      savedChoice:
        select.value === footerEntries[0][0] &&
        Boolean(
          document.querySelector(
            '.chat-model-control button[aria-label="Reset to configured default"]',
          ),
        ),
      defaultChoice:
        select.value === "" &&
        select.selectedOptions[0]?.textContent ===
          `Default · ${footerEntries[1][1]}`,
      keysNoSend,
    };
  }
  function composerAction(command) {
    if (
      Object.keys(command).sort().join(",") !== "action,type" ||
      !["observe", "draft", "choose", "reset", "keys"].includes(command.action)
    )
      throw Error("Unsupported composer action/fields");
    const { textarea, select } = composerElements();
    if (
      command.action !== "observe" &&
      (select.disabled || !knownFooterCatalog(select) || textarea.disabled)
    )
      throw Error("Composer not ready or catalog private");
    if (command.action === "draft") {
      if (textarea.value && textarea.value !== composerDraft())
        throw Error("Existing draft is private");
      composerTextarea = textarea;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      ).set.call(textarea, composerDraft());
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (command.action === "choose") {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set.call(select, footerEntries[0][0]);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (command.action === "reset") {
      target("Reset to configured default").click();
    } else if (command.action === "keys") {
      if (textarea.value !== composerDraft() || textarea !== composerTextarea)
        throw Error("Synthetic draft required");
      const transcript = document.querySelector(".transcript")?.textContent;
      select.focus();
      for (const key of ["Enter", " "]) {
        for (const type of ["keydown", "keypress", "keyup"])
          select.dispatchEvent(
            new KeyboardEvent(type, { key, bubbles: true, cancelable: true }),
          );
      }
      keysNoSend =
        textarea.value === composerDraft() &&
        textarea === composerTextarea &&
        transcript === document.querySelector(".transcript")?.textContent;
      if (!keysNoSend) throw Error("Selector keys changed composer/transcript");
    }
    return composerObservation(command.action);
  }
  function revealComposer() {
    const { textarea, select, send } = composerElements();
    const observation = composerObservation("observe");
    if (
      !observation.modelReady ||
      !observation.draftMatches ||
      !observation.textareaStable
    )
      throw Error("Capture requires canonical synthetic composer");
    const reveal = (el) => el.setAttribute("data-smoke-reveal", "");
    [textarea, select, ...select.options, send].forEach(reveal);
    for (const el of document.querySelectorAll(
      ".trainer-heading-row h2, .trainer-heading-row .section-kicker, .chat-model-control label, .chat-model-control button, .chat-model-save-state",
    )) {
      if (
        [
          "Chat with your private coach",
          "Daily trainer",
          "Model",
          "Default",
          "Saved",
        ].includes(el.textContent.trim())
      )
        reveal(el);
    }
  }
  // T0250 finite conversation scenario: only this run's two synthetic labels.
  const conversationTitle = (slot) =>
    `T0250-${slot}-${globalThis.__trainerOrdinaryIsolated?.runId.replaceAll("-", "")}`;
  function conversationRows() {
    if (!globalThis.__trainerOrdinaryIsolated || observe().view !== "Trainer")
      throw Error("Ordinary Trainer only");
    const rows = [...document.querySelectorAll(".conversation-item")];
    if (
      rows.length > 3 ||
      rows.some(
        (row) =>
          ![
            conversationTitle("first"),
            conversationTitle("second"),
            "New chat",
          ].includes(
            row.querySelector(".conversation-select > span")?.textContent,
          ),
      )
    )
      throw Error("Non-synthetic conversations refused");
    return rows;
  }
  function conversationRow(slot) {
    const rows = conversationRows().filter(
      (row) =>
        row.querySelector(".conversation-select > span")?.textContent ===
        conversationTitle(slot),
    );
    if (rows.length !== 1)
      throw Error("Synthetic conversation missing/ambiguous");
    return rows[0];
  }
  function conversationHistoryVisible() {
    const sidebar = document.querySelector(".conversation-sidebar");
    if (!visible(sidebar)) return false;
    const rect = sidebar.getBoundingClientRect();
    return (
      rect.width >= 200 &&
      rect.left >= 0 &&
      rect.right <= innerWidth &&
      (sidebar.classList.contains("open") ||
        (innerWidth > 960 && !sidebar.closest(".sidebar-collapsed")))
    );
  }
  function conversationObservation(action) {
    const rows = conversationRows();
    const selected = (title) =>
      rows.some(
        (row) =>
          row.querySelector(".conversation-select > span")?.textContent ===
            title &&
          row
            .querySelector(".conversation-select")
            ?.getAttribute("aria-current") === "true",
      );
    const present = (slot) =>
      rows.some(
        (row) =>
          row.querySelector(".conversation-select > span")?.textContent ===
          conversationTitle(slot),
      );
    return {
      ok: true,
      action,
      trustedInput: false,
      selectionReady:
        ![...document.querySelectorAll('[role="alert"] button')].some((el) =>
          el.textContent.includes("Retry selection"),
        ) &&
        ![...document.querySelectorAll('[role="status"]')].some(
          (el) => el.textContent === "Loading conversation selection…",
        ),
      historyVisible: conversationHistoryVisible(),
      historyGeometry: (() => {
        const r = document
          .querySelector(".conversation-sidebar")
          ?.getBoundingClientRect();
        return {
          left: r?.left ?? 0,
          right: r?.right ?? 0,
          width: r?.width ?? 0,
        };
      })(),
      menuReady: !!document.querySelector('[role="menu"]'),
      renameReady: visible(
        document.querySelector("#conversation-rename-title"),
      ),
      renameDraftReady: [
        conversationTitle("first"),
        conversationTitle("second"),
      ].includes(document.querySelector("#conversation-rename-title")?.value),
      historyExpanded:
        !!document.querySelector(".conversation-sidebar.open") ||
        (innerWidth > 960 &&
          !document
            .querySelector(".conversation-sidebar")
            ?.closest(".sidebar-collapsed")),
      historyFitsViewport: (() => {
        const r = document
          .querySelector(".conversation-sidebar")
          ?.getBoundingClientRect();
        return !!r && r.width >= 200 && r.left >= 0 && r.right <= innerWidth;
      })(),
      historyToggleVisible:
        [
          ...document.querySelectorAll(
            'button[aria-label="Toggle conversation history"]',
          ),
        ].filter(visible).length === 1,
      empty: rows.length === 0,
      firstPresent: present("first"),
      secondPresent: present("second"),
      firstSelected: selected(conversationTitle("first")),
      secondSelected: selected(conversationTitle("second")),
      newSelected: selected("New chat"),
      transcriptEmpty:
        document.querySelectorAll(".transcript .chat-message").length === 0,
    };
  }
  function conversationControl(row, selector) {
    const el = row.querySelector(selector);
    if (!el || !visible(el) || el.disabled)
      throw Error("Conversation control unavailable");
    return el;
  }
  let conversationStage = "admission";
  let conversationMenu = null;
  let conversationNaming = null;
  // One rendered action per RPC. React reconciliation is observed only in a
  // subsequent read-only RPC, never awaited inside a pending native callback.
  function conversationAction(command) {
    conversationStage = "admission";
    const actions = [
      "observe",
      "open-menu",
      "open-history",
      "settle-history",
      "new",
      "menu-new",
      "rename-new",
      "title-first",
      "title-second",
      "save-title",
      "menu-first",
      "menu-second",
      "choose-first",
      "choose-second",
      "delete-first",
      "delete-second",
    ];
    if (
      Object.keys(command).sort().join(",") !== "action,type" ||
      !actions.includes(command.action)
    )
      throw Error("Unsupported conversation fields/action");
    conversationRows();
    if (command.action === "observe")
      return conversationObservation(command.action);
    if (command.action === "open-menu") {
      if (innerWidth > 960) throw Error("Mobile menu only");
      target("Menu").click();
    } else if (command.action === "open-history") {
      if (!conversationObservation("observe").historyExpanded)
        target("Toggle conversation history").click();
    } else if (command.action === "settle-history") {
      const sidebar = document.querySelector(".conversation-sidebar");
      if (
        !conversationObservation("observe").historyExpanded ||
        typeof CSSTransition === "undefined"
      )
        throw Error("An explicitly opened history transition is required");
      // Nonactivating WebKit can freeze CSS transitions. Finish only this
      // sidebar's existing finite transition at its real CSS endpoint; no
      // style/transform override, generic animation control or geometry waiver.
      for (const animation of sidebar.getAnimations())
        if (
          animation instanceof CSSTransition &&
          animation.effect?.target === sidebar &&
          ["transform", "width", "padding-left", "padding-right"].includes(
            animation.transitionProperty,
          )
        )
          animation.finish();
    } else {
      if (!conversationHistoryVisible())
        throw Error("History must be visibly open");
      const [operation, slot] = command.action.split("-");
      if (command.action === "new") {
        if (
          conversationRows().some(
            (row) =>
              row.querySelector(".conversation-select > span")?.textContent ===
              "New chat",
          )
        )
          throw Error("Duplicate/ambiguous creation refused");
        conversationStage = "creating";
        target("New chat").click();
      } else if (operation === "menu") {
        const row =
          slot === "new"
            ? conversationRows().filter(
                (item) =>
                  item.querySelector(".conversation-select > span")
                    ?.textContent === "New chat",
              )
            : [conversationRow(slot)];
        if (row.length !== 1) throw Error("Ambiguous menu row");
        conversationMenu = { slot, row: row[0] };
        conversationControl(row[0], ".conversation-menu-trigger").click();
      } else if (command.action === "rename-new") {
        if (
          conversationMenu?.slot !== "new" ||
          !conversationMenu.row.isConnected
        )
          throw Error("Synthetic New menu required");
        conversationStage = "menu";
        target("Rename", '[role="menuitem"]').click();
        conversationNaming = { row: conversationMenu.row, slot: null };
        conversationMenu = null;
      } else if (operation === "title") {
        const input = document.querySelector("#conversation-rename-title");
        if (
          !conversationNaming?.row.isConnected ||
          !visible(input) ||
          input.disabled ||
          input.value !== "New chat" ||
          conversationObservation("observe")[slot + "Present"]
        )
          throw Error("Synthetic New rename required");
        conversationStage = "rename";
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, conversationTitle(slot));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        conversationNaming.slot = slot;
      } else if (command.action === "save-title") {
        const input = document.querySelector("#conversation-rename-title");
        if (
          !conversationNaming?.slot ||
          input?.value !== conversationTitle(conversationNaming.slot)
        )
          throw Error("Known title draft required");
        conversationStage = "saving";
        target("Save", ".rename-dialog button").click();
        conversationNaming = null;
      } else if (operation === "choose") {
        conversationControl(
          conversationRow(slot),
          ".conversation-select",
        ).click();
      } else {
        const row = conversationRow(slot);
        if (conversationMenu?.slot !== slot || conversationMenu.row !== row)
          throw Error("Matching synthetic delete menu required");
        const expected = `Delete local conversation "${conversationTitle(slot)}" and its messages? Garmin data, Profile, and saved memories stay unchanged.`;
        const view = row.ownerDocument.defaultView;
        const original = view.confirm;
        try {
          view.confirm = (text) => {
            if (text !== expected)
              throw Error("Unexpected confirmation refused");
            return true;
          };
          target("Delete", '[role="menuitem"]').click();
        } finally {
          view.confirm = original;
          conversationMenu = null;
        }
      }
    }
    return conversationObservation(command.action);
  }
  function revealConversations() {
    if (!conversationHistoryVisible())
      throw Error("Capture requires visibly open history");
    conversationRows(); // Refuse unknown/copied labels before revealing anything.
    // Preserve WebKit's real scrolled compositing layer, as for table captures.
    // Only empty-text containers are revealed; every child remains masked.
    const sidebar = document.querySelector(".conversation-sidebar");
    for (
      let node = sidebar.querySelector(".conversation-list");
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
        )
      )
        throw Error("Private direct ancestor text refused");
      node.setAttribute("data-smoke-reveal", "");
    }
    for (const row of conversationRows()) {
      for (const el of [
        row,
        row.querySelector(".conversation-select"),
        row.querySelector(".conversation-select > span"),
        row.querySelector(".conversation-menu-trigger"),
      ])
        el?.setAttribute("data-smoke-reveal", "");
    }
    for (const el of document.querySelectorAll(
      ".conversation-sidebar button, .sidebar-header strong, .sidebar-header .section-kicker, .conversation-list .empty-chat",
    ))
      if (
        [
          "New chat",
          "Conversations",
          "History",
          "No saved conversations yet.",
        ].includes(el.textContent.trim())
      )
        el.setAttribute("data-smoke-reveal", "");
  }
  // Fixed synthetic table scenario: never return/reveal arbitrary saved documents.
  const tableProse =
    "Synthetic evidence describes duration and partial credit with explicit limitations; descriptive prose should wrap at word boundaries.";
  const tableToken = `https://example.test/${"unbroken".repeat(50)}`;
  function expectedTable(surface) {
    if (surface === "chat-simple")
      return [
        ["Metric", "Average", "Reference"],
        ["Duration", "42 min", "Synthetic reference"],
        ["Distance", "5 km", "Synthetic reference"],
      ];
    const reordered = surface !== "plan";
    const headers = [
      "KPI",
      "Target",
      "Unit",
      "Evidence",
      reordered ? "Crédit" : "Points",
      "Calculation",
    ];
    const order = reordered ? [4, 3, 5, 0, 2, 1] : [0, 1, 2, 3, 4, 5];
    return [
      headers,
      ...["30 / 30", "25 / 25", "15 / 15", "0 / 10"].map((score) => [
        "Easy work",
        "150",
        "min",
        reordered ? tableToken : tableProse,
        score,
        tableProse,
      ]),
    ].map((row) => order.map((index) => row[index]));
  }
  function syntheticTable(surface) {
    if (
      !globalThis.__trainerOrdinaryIsolated ||
      !["plan", "review", "chat", "chat-simple"].includes(surface)
    )
      throw Error("Ordinary synthetic tables only");
    const inChat = surface.startsWith("chat");
    if (observe().view !== (inChat ? "Trainer" : "Training Plan"))
      throw Error("Wrong table view");
    const roots = inChat
      ? [...document.querySelectorAll(".transcript")]
      : [...document.querySelectorAll(".training-plan-report")].filter(
          (el) =>
            el.querySelector("h3")?.textContent ===
            `T0249 synthetic ${surface}`,
        );
    const expected = expectedTable(surface);
    const tables = roots
      .flatMap((root) => [...root.querySelectorAll(".assistant-table")])
      .filter((table) => {
        const rows = [...table.rows].map((row) =>
          [...row.cells].map((cell) => cell.textContent),
        );
        return JSON.stringify(rows) === JSON.stringify(expected);
      });
    if (
      tables.length !== 1 ||
      !visible(tables[0]) ||
      tables[0].querySelectorAll("td *, th *").length !==
        (surface === "chat-simple" ? 2 : 4) ||
      [...tables[0].querySelectorAll("td *, th *")].some(
        (el) => !["STRONG", "CODE"].includes(el.tagName),
      )
    )
      throw Error("Missing/ambiguous/noncanonical synthetic table");
    return tables[0];
  }
  let selectedTable;
  let selectedSurface;
  function lineCount(cell) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const tops = [];
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects())
        if (rect.width > 0 && !tops.some((top) => Math.abs(top - rect.top) < 1))
          tops.push(rect.top);
    }
    return tops.length;
  }
  function tableHeaderVisible(table) {
    const header = table.tHead.getBoundingClientRect();
    let top = 0,
      bottom = innerHeight;
    for (let node = table.parentElement; node; node = node.parentElement) {
      if (node.clientHeight && getComputedStyle(node).overflowY !== "visible") {
        const rect = node.getBoundingClientRect();
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
      }
    }
    return (
      header.width > 0 && header.top >= top - 1 && header.bottom <= bottom + 1
    );
  }
  async function tablesAction(command) {
    if (
      Object.keys(command).sort().join(",") !== "edge,surface,type" ||
      !["start", "end"].includes(command.edge)
    )
      throw Error("Unsupported table action/fields");
    const table = syntheticTable(command.surface);
    const wrapper = table.closest(".assistant-table-wrapper");
    if (!wrapper) throw Error("Contained table required");
    restore();
    // scrollIntoView also scrolls overflow:hidden ancestors, which can conceal
    // the real panel on desktop. Scroll only user-scrollable table ancestors.
    for (let node = wrapper; node; node = node.parentElement) {
      if (
        ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight
      )
        node.scrollTop +=
          table.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          8;
    }
    wrapper.scrollLeft = command.edge === "end" ? wrapper.scrollWidth : 0;
    selectedTable = table;
    selectedSurface = command.surface;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const compact = [...table.querySelectorAll(".assistant-table-compact")];
    const prose = [...table.querySelectorAll("td")].filter(
      (cell) => cell.textContent === tableProse,
    );
    const rect = wrapper.getBoundingClientRect();
    return {
      ok: true,
      surface: command.surface,
      edge: command.edge,
      trustedInput: false,
      compact:
        compact.length > 0 && compact.every((cell) => lineCount(cell) === 1),
      proseWrapped:
        command.surface === "chat-simple" ||
        prose.some((cell) => lineCount(cell) > 1),
      contained:
        document.documentElement.scrollWidth <= innerWidth &&
        rect.left >= 0 &&
        rect.right <= innerWidth &&
        getComputedStyle(wrapper).overflowX === "auto" &&
        table.getBoundingClientRect().width <= wrapper.scrollWidth + 1,
      scrollable: wrapper.scrollWidth > wrapper.clientWidth,
      edgeReached:
        command.edge === "start"
          ? wrapper.scrollLeft === 0
          : Math.abs(
              wrapper.scrollLeft + wrapper.clientWidth - wrapper.scrollWidth,
            ) <= 1,
      allCells: true,
      headerVisible: tableHeaderVisible(table),
    };
  }
  function revealTables() {
    if (
      !selectedTable ||
      syntheticTable(selectedSurface) !== selectedTable ||
      !tableHeaderVisible(selectedTable)
    )
      throw Error("Canonical selected table with visible header required");
    // WebKit can omit a visible descendant's scrolled compositing layer when
    // its ancestor is visibility:hidden. Reveal only empty-text containers on
    // the selected path; every sibling/child remains independently masked.
    for (
      let node = selectedTable.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
        )
      )
        throw Error("Capture refuses private direct ancestor text");
      node.setAttribute("data-smoke-reveal", "");
    }
    for (const el of [selectedTable, ...selectedTable.querySelectorAll("*")])
      el.setAttribute("data-smoke-reveal", "");
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
      composer: "Trainer",
      conversation: "Trainer",
      sync: "Sync",
      profile: "Profile & data",
    }[command.view];
    if (command.view === "tables") {
      if (!selectedTable || syntheticTable(selectedSurface) !== selectedTable)
        throw Error("Unsafe table capture");
    } else if (!expected || observe().view !== expected)
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
    if (command.view === "composer") revealComposer();
    if (command.view === "conversation") revealConversations();
    if (command.view === "tables") revealTables();
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
    if (
      globalThis.__trainerOrdinaryIsolated &&
      (["debugKey", "captureDebug", "health", "settings"].includes(
        command.type,
      ) ||
        (command.type === "click" &&
          ["LLM debug traces", "First LLM trace"].includes(command.target)))
    )
      throw Error("Debug disclosure controls unavailable to ordinary mode");
    if (command.type !== "observe" && !observe().hydrated)
      throw Error("Renderer not hydrated");
    switch (command.type) {
      case "observe":
        return observe();
      case "composer":
        return composerAction(command);
      case "conversation":
        return conversationAction(command);
      case "tables":
        return tablesAction(command);
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
      case "setViewport": {
        if (!globalThis.__trainerOrdinaryIsolated)
          throw Error("Ordinary isolated mode only");
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (!viewport(command.preset)) throw Error("Viewport not settled");
        return { ok: true, preset: command.preset };
      }
      case "captureView":
        return maskedView(command);
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
      result = {
        ok: false,
        error:
          request.command?.type === "conversation"
            ? `Conversation action failed at ${conversationStage}`
            : "Rendered command refused or failed",
      };
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
