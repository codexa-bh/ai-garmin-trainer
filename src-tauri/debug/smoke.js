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
  let syntheticCalories = false;
  const dailyChartTitles = [
    "Calories",
    "Sleep duration",
    "Sleep score",
    "Steps",
    "Resting HR",
    "HRV",
    "Stress avg",
    "Intensity minutes",
    "Deep sleep",
    "Light sleep",
    "REM sleep",
    "Awake sleep",
    "Nap sleep",
  ];
  // Closed authored recipe only; never infer permission from merely populated data.
  function canonicalCalories(comparison) {
    const card = comparison.querySelector(".health-calories-chart");
    const buttons = [
      ...(card?.querySelectorAll("button[data-source-date]") ?? []),
    ];
    const values = [
      [1700, 400, 2100],
      [1700, 400, null],
      [null, null, 1800],
      [null, null, null],
      [1700, null, 1900],
      [0, 0, 0],
      [1700, 400, 2150],
    ];
    const kcal = (value) =>
      value === null
        ? "Unavailable"
        : `${value.toLocaleString(undefined, { maximumFractionDigits: 20 })} kcal`;
    const expected = values.map(([resting, active, total], index) => {
      const date = buttons[index]?.dataset.sourceDate;
      const label = new Date(`${date}T00:00:00Z`).toLocaleDateString(
        undefined,
        { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
      );
      const context =
        resting === null || active === null
          ? "Breakdown incomplete; no stack shown."
          : total !== null && resting + active !== total
            ? `Component sum ${kcal(resting + active)}; differs from recorded total.`
            : "";
      return {
        name: `${label}: Resting: ${kcal(resting)} · Active: ${kcal(active)} · Recorded total: ${kcal(total)}${context ? ` · ${context}` : ""}`,
        readout: `${label}Resting${kcal(resting)}Active${kcal(active)}Recorded total${kcal(total)}${context}`,
      };
    });
    if (
      !card ||
      buttons.length !== 7 ||
      buttons.some(
        (button, index) =>
          button.getAttribute("aria-label") !== expected[index].name,
      ) ||
      card.querySelector(".health-calories-legend")?.textContent !==
        "RestingActive" ||
      card.querySelectorAll(".recharts-bar").length !== 2 ||
      card.querySelectorAll(".recharts-bar-rectangle path").length < 4
    )
      throw Error("Noncanonical/private Calories refused");
    return { card, buttons, expected };
  }
  const healthComparison = () => {
    const comparisons = [
      ...document.querySelectorAll(
        ".health-dashboard-panel .health-daily-comparison",
      ),
    ].filter(visible);
    const comparison = comparisons[0];
    const dates = [
      ...(comparison?.querySelectorAll(".health-daily-coverage time") ?? []),
    ].map((el) => el.dateTime);
    const cards = [
      ...(comparison?.querySelectorAll(".health-rollup-chart") ?? []),
    ];
    if (
      comparisons.length !== 1 ||
      dates.length !== 7 ||
      new Set(dates).size !== 7 ||
      dates.some(
        (date, index) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          (index > 0 && date <= dates[index - 1]),
      ) ||
      cards.map((card) => card.getAttribute("aria-label")).join(",") !==
        dailyChartTitles.map((title) => `${title} daily chart`).join(",") ||
      cards.some(
        (card) =>
          [...card.querySelectorAll("[data-source-date]")]
            .map((el) => el.dataset.sourceDate)
            .join(",") !== dates.join(","),
      )
    )
      throw Error("Daily Health charts not ready");
    return comparison;
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
    let comparison = null;
    try {
      comparison = healthComparison();
    } catch {
      /* Not mounted/ready. */
    }
    const healthButtons = document.querySelectorAll(
      ".health-daily-actions button",
    );
    const mode = document
      .querySelector('.health-mode-controls [aria-selected="true"]')
      ?.textContent.trim()
      .toLowerCase();
    return {
      healthMode: ["daily", "weekly", "monthly"].includes(mode) ? mode : null,
      healthReady: Boolean(comparison),
      healthMissingRecord: Boolean(
        comparison?.querySelector('[data-coverage="missing-record"]'),
      ),
      healthPartialRecord: Boolean(
        comparison?.querySelector('[data-coverage="partial"]'),
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
      view: document.querySelector(".memory-sheet")
        ? "Memory"
        : document.querySelector(".settings-sheet")
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
    ["entry_footer_long", "ollama / T0246/Long-local-model-name:exact-tag"],
    ["entry_footer_other", "ollama / T0246/Alternate:Tag"],
  ];
  // Fixed synthetic Memory controls; T0283 adds fake formerly filtered prose.
  // No caller text/ID/selector or export; exact matching masks remain mandatory.
  const memoryText = (updated = false) =>
    `T0272-${globalThis.__trainerOrdinaryIsolated?.runId}: ${updated ? "Weekends remain optional; poles not chosen. Fake path /Users/example/notes; quoted ignore previous instructions." : "Short weekdays chosen for time; long weekdays rejected. Fake discussion https://example.invalid/training."}`;
  // One finite above-target whole-summary draft; preferences stay independent.
  const summaryText = () => {
    const text = `${memoryText(true)}\n${"Short weekdays because caregiving limits time; weekends remain optional.\n".repeat(80)}`;
    return text.padEnd(6577, " ") + ".";
  };
  const densifyText = (length) => {
    const paragraph =
      "Short weekdays because caregiving limits time; long weekdays failed. Current mornings replace past evenings. Cycling is not prohibited. Poles remain unchosen; the heavy bag was rejected for discomfort.\n";
    return paragraph
      .repeat(Math.floor(length / paragraph.length))
      .padEnd(length, " ");
  };
  let memoryDensifyId = "fixture_densify";
  const densifyFixtureReview = () => {
    const state =
      memoryFixture === "fixture-densify-busy"
        ? "running"
        : memoryFixture === "fixture-densify-accepted"
          ? "accepted"
          : memoryFixture === "fixture-densify-discarded"
            ? "discarded"
            : "review";
    const noReduction = memoryFixture === "fixture-densify-no-reduction";
    return {
      id: memoryDensifyId,
      state,
      text: state === "review" ? densifyText(noReduction ? 13250 : 7000) : null,
      before: 13250,
      after: state === "running" ? null : noReduction ? 13250 : 7000,
      target: 6000,
      shorter: state === "review" && !noReduction,
    };
  };
  let memoryFixture = null;
  let memoryReviewSelection = {
    version: 1,
    conversationIds: null,
    includeLegacy: false,
  };
  let memoryStage = "idle";
  let memoryFixtureExpiry;
  let originalMemoryFetch;
  let memoryFixtureRestoring = false;
  let progressiveRead = 0;
  let progressiveSample = null;
  let progressiveAdvanced = false;
  let progressiveConnection = false;
  let progressiveStable = true;
  const presentationText = [
    "Short weekday sessions work because time is limited; long weekdays did not work. Weekends remain optional, not mandatory.",
    "Could poles help? We discussed them, but I have not decided to use them. This is an open question, not a preference or commitment.",
    "Last winter only: evening sessions were convenient. That past arrangement does not describe my current schedule. Keep the historical scope and do not turn it into an ongoing preference.",
  ];
  function memoryFixtureValue() {
    const preferences = [
      { id: "fixture_preference", text: "Keep explanations concise." },
    ];
    const progressive = memoryFixture === "fixture-progressive";
    const running =
      memoryFixture === "fixture-running" ||
      (progressive && progressiveRead < 7);
    const operationState = running
      ? "active"
      : memoryFixture === "fixture-complete" || progressive
        ? "complete"
        : ["fixture-interrupted", "fixture-failed"].includes(memoryFixture)
          ? "interrupted"
          : memoryFixture === "fixture-cancelled"
            ? "cancelled"
            : null;
    const off = memoryFixture === "fixture-off";
    const empty = memoryFixture === "fixture-empty";
    const selectedChat = memoryReviewSelection.conversationIds !== null;
    const included = selectedChat
      ? memoryReviewSelection.includeLegacy
        ? 19
        : 1
      : memoryReviewSelection.includeLegacy
        ? 196
        : 16;
    return {
      version: 1,
      state: off ? "disabled" : "fresh",
      reason:
        memoryFixture === "fixture-error" ? "summary_invalid_output" : null,
      revision: 3,
      frontier: 4,
      pending: 0,
      items: empty ? 0 : 1,
      characters: memoryFixture?.startsWith("fixture-densify-")
        ? memoryFixture === "fixture-densify-accepted"
          ? 7000
          : 13250
        : empty
          ? 0
          : [...presentationText.join("\n")].length,
      cap: 6000,
      publishedAt: null,
      enabled: !off,
      model: "gpt-6-luna",
      usedByChat: false,
      attemptsToday: 1,
      reservedUsdToday: 0.04,
      unpricedAttempts: 2,
      estimatedUsdToday: 0.002,
      unknownReservedUsd: 0.01,
      priceBasis: "authored-presentation-only",
      expected: { revision: 3, privacy: 0, control: 1, manual: 0 },
      stored: {
        version: 2,
        text: memoryFixture?.startsWith("fixture-densify-")
          ? densifyText(
              memoryFixture === "fixture-densify-accepted" ? 7000 : 13250,
            )
          : empty
            ? ""
            : presentationText.join("\n"),
      },
      densify: {
        available: memoryFixture === "fixture-densify-ready",
        review:
          memoryFixture?.startsWith("fixture-densify-") &&
          memoryFixture !== "fixture-densify-ready"
            ? densifyFixtureReview()
            : null,
      },
      preferences: empty ? [] : preferences,
      legacy: [],
      historical: {
        candidates: [],
        manifests: [],
        exclusions: "Authored fixture: no earlier linked sources selected.",
      },
      selectedChat: {
        conversationId: "fixture_chat",
        segmentRevision: 1,
        reason: null,
        pin: {
          version: 2,
          value: {
            version: 2,
            text: "Earlier chat snapshot: weekends were still undecided.",
          },
          preferences: [],
          stamp: {
            version: 1,
            revision: 2,
            privacyGeneration: 0,
            controlGeneration: 1,
            manualRevision: 0,
            validUntil: null,
          },
          omitted: 0,
          tokens: null,
        },
      },
      authority: "Authored fixture continuity, not provider evidence.",
      rebuild: {
        version: 1,
        snapshot: "a".repeat(64),
        selection: memoryReviewSelection,
        conversations: Array.from({ length: 12 }, (_, i) => ({
          id: `fixture_chat_${i}`,
          title: `Authored conversation ${i + 1}`,
        })),
        ready: !off && !running,
        complete: true,
        limitExceeded: false,
        configuredProvider: "openai",
        model: "gpt-6-luna",
        enabled: !off,
        capability: "configured-not-probed",
        counts: {
          chats: 12,
          selectedChats: selectedChat ? 1 : 12,
          legacyUserMessages: memoryReviewSelection.includeLegacy
            ? selectedChat
              ? 18
              : 180
            : 0,
          messages: 400,
          userMessages: 200,
          assistantMessages: 200,
          includedChats: selectedChat
            ? 1
            : memoryReviewSelection.includeLegacy
              ? 12
              : 4,
          excludedChats: selectedChat
            ? 11
            : memoryReviewSelection.includeLegacy
              ? 0
              : 8,
          includedUserMessages: included,
          assistantContext: 3,
          excludedUserMessages: 200 - included,
          excludedMessages: 400 - included - 3,
        },
        reasons: {
          ...(selectedChat ? { "not-selected": 180 } : {}),
          ...(!memoryReviewSelection.includeLegacy
            ? { "unproven-legacy-or-cleared-original": selectedChat ? 18 : 180 }
            : {}),
          suppressed: selectedChat ? 1 : 4,
        },
        estimatedUsd: {
          low: 0,
          conservativeMaximum: null,
          priceBasis: "authored-presentation-only",
          uncertainty: "Authored conservative estimate, not billing evidence.",
        },
        semantics: "Manual overlays and originals remain.",
        operation: operationState
          ? {
              id: "fixture_operation",
              state: operationState,
              reason:
                memoryFixture === "fixture-failed"
                  ? "summary_invalid_output"
                  : operationState === "interrupted"
                    ? "summary_interrupted"
                    : null,
              processed: progressive
                ? [20, 20, 40, 60, 60, 80, 184][
                    Math.min(6, Math.max(0, progressiveRead - 1))
                  ]
                : operationState === "complete"
                  ? 16
                  : 8,
              total: progressive ? 184 : 16,
              dispositions: {},
              createdAt: 0,
              deadline: 9999999999999,
            }
          : null,
      },
    };
  }
  function resetMemoryFixture() {
    clearTimeout(memoryFixtureExpiry);
    if (originalMemoryFetch) globalThis.fetch = originalMemoryFetch;
    originalMemoryFetch = undefined;
    memoryFixtureRestoring = memoryFixture !== null;
    memoryFixture = null;
    progressiveSample = null;
    progressiveRead = 0;
    progressiveAdvanced = progressiveConnection = false;
    progressiveStable = true;
  }
  function selectMemoryFixture(action) {
    if (!originalMemoryFetch) {
      originalMemoryFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (
          url === "/api/cross-chat-summary" ||
          url?.startsWith("/api/cross-chat-summary?")
        ) {
          if ((init?.method ?? "GET") !== "GET") {
            try {
              const command = JSON.parse(String(init?.body));
              if (
                memoryFixture?.startsWith("fixture-densify-") &&
                init?.method === "POST" &&
                command.version === 2 &&
                Object.keys(command).sort().join() ===
                  "action,expected,id,version" &&
                /^[a-zA-Z0-9_-]{1,80}$/.test(command.id) &&
                JSON.stringify(command.expected) ===
                  JSON.stringify(memoryFixtureValue().expected)
              ) {
                if (
                  command.action === "densify-request" &&
                  memoryFixture === "fixture-densify-ready"
                ) {
                  memoryDensifyId = command.id;
                  memoryFixture = "fixture-densify-review";
                } else if (
                  command.id === memoryDensifyId &&
                  command.action === "densify-accept" &&
                  memoryFixture === "fixture-densify-review"
                )
                  memoryFixture = "fixture-densify-accepted";
                else if (
                  command.id === memoryDensifyId &&
                  ["densify-discard", "densify-cancel"].includes(command.action)
                )
                  memoryFixture = "fixture-densify-discarded";
                else throw Error("Unsupported fixed densify review");
                return Promise.resolve(
                  new Response(
                    JSON.stringify({ densify: densifyFixtureReview() }),
                    { headers: { "content-type": "application/json" } },
                  ),
                );
              }
              const s = command.selection;
              if (
                init?.method !== "POST" ||
                ["fixture-unknown", "fixture-progressive"].includes(
                  memoryFixture,
                ) ||
                Object.keys(command).sort().join() !==
                  "action,expected,selection,version" ||
                command.action !== "rebuild-review" ||
                command.version !== 2 ||
                JSON.stringify(command.expected) !==
                  JSON.stringify(memoryFixtureValue().expected) ||
                !s ||
                Object.keys(s).sort().join() !==
                  "conversationIds,includeLegacy,version" ||
                s.version !== 1 ||
                typeof s.includeLegacy !== "boolean" ||
                !(
                  s.conversationIds === null ||
                  JSON.stringify(s.conversationIds) === '["fixture_chat_0"]'
                )
              )
                throw Error("Unsupported fixed review");
              memoryReviewSelection = {
                version: 1,
                conversationIds: s.conversationIds,
                includeLegacy: s.includeLegacy,
              };
              return Promise.resolve(
                new Response(
                  JSON.stringify({ rebuild: memoryFixtureValue().rebuild }),
                  { headers: { "content-type": "application/json" } },
                ),
              );
            } catch {
              return Promise.reject(
                Error(
                  "Presentation fixtures cannot mutate or contact a provider",
                ),
              );
            }
          }
          if (memoryFixture === "fixture-progressive") progressiveRead++;
          const unavailable =
            memoryFixture === "fixture-unknown" ||
            (memoryFixture === "fixture-progressive" && progressiveRead === 5);
          return Promise.resolve(
            new Response(
              JSON.stringify(
                unavailable
                  ? { error: "Authored unavailable inspection" }
                  : memoryFixtureValue(),
              ),
              {
                status: unavailable ? 503 : 200,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
        return originalMemoryFetch.call(globalThis, input, init);
      };
    }
    memoryFixture = action;
    memoryFixtureRestoring = false;
    progressiveRead = 0;
    progressiveSample = null;
    progressiveAdvanced = progressiveConnection = false;
    progressiveStable = true;
    memoryReviewSelection = {
      version: 1,
      conversationIds: null,
      includeLegacy: false,
    };
    clearTimeout(memoryFixtureExpiry);
    memoryFixtureExpiry = setTimeout(resetMemoryFixture, 120000);
  }
  function memoryPanel() {
    return document.querySelector(
      '.memory-sheet[role="dialog"][aria-labelledby="memory-sheet-heading"] .memory-root-card',
    );
  }
  function memoryObservation(action) {
    const panel = memoryPanel();
    if (
      [...(panel?.querySelectorAll("button,h3,h4") ?? [])].some((node) =>
        [
          "How memory works & costs",
          "Technical details",
          "View chat memory",
          "Update this chat",
          "This chat’s memory",
        ].includes(name(node)),
      )
    )
      throw Error("Removed Memory controls remain");
    const rows = [
      ...(panel?.querySelectorAll(
        '[aria-label="Manual preferences"] .memory-text',
      ) ?? []),
    ];
    if (
      memoryFixtureRestoring &&
      !rows.some((row) => row.textContent === "Keep explanations concise.")
    )
      memoryFixtureRestoring = false;
    if (
      rows.some(
        (row) =>
          ![
            memoryText(),
            memoryText(true),
            ...(memoryFixture || memoryFixtureRestoring
              ? ["Keep explanations concise."]
              : []),
          ].includes(row.textContent),
      )
    )
      throw Error("Noncanonical Memory source refused");
    const generatedRows = [
      ...(panel?.querySelectorAll(
        '[aria-label="Generated summary"] .memory-text',
      ) ?? []),
    ];
    const generated = generatedRows.at(-1);
    if (
      generatedRows.some(
        (row) =>
          ![
            "No generated summary yet. Update from chat history to build one.",
            summaryText(),
            memoryText(),
            memoryText(true),
            ...(memoryFixture || memoryFixtureRestoring
              ? [
                  presentationText.join("\n"),
                  densifyText(13250),
                  densifyText(7000),
                ]
              : []),
          ].includes(row.textContent),
      )
    )
      throw Error("Noncanonical generated summary refused");
    const buttons = [...(panel?.querySelectorAll("button") ?? [])];
    const state = panel
      ?.querySelector("[data-history-state]")
      ?.getAttribute("data-history-state");
    if (
      memoryFixture === "fixture-progressive" &&
      ["active", "unreadable"].includes(state)
    ) {
      const cancel = buttons.find((b) => name(b) === "Cancel");
      const progress = panel.querySelector("progress");
      const scroller =
        panel.closest(".memory-sheet-groups") ||
        panel.closest(".settings-sheet");
      if (!progressiveSample && cancel && progress) {
        cancel.focus({ preventScroll: true });
        progressiveSample = {
          panel,
          cancel,
          progress,
          scroller,
          scroll: scroller.scrollTop,
        };
      }
      if (progressiveSample) {
        const s = progressiveSample;
        progressiveStable &&=
          s.panel === panel &&
          s.cancel === cancel &&
          s.progress === progress &&
          s.scroller.scrollTop === s.scroll &&
          document.activeElement === cancel &&
          !panel.textContent.includes("Checking saved memory…");
        progressiveAdvanced ||= Number(progress?.value) >= 40;
        progressiveConnection ||= state === "unreadable";
      }
    }
    return {
      ok: true,
      action,
      trustedInput: false,
      visible: !!panel && visible(panel),
      loaded:
        panel?.getAttribute("data-memory-ready") === "true" &&
        !memoryFixtureRestoring &&
        (!memoryFixture ||
          memoryFixture === "fixture-off" ||
          !!panel?.querySelector(".memory-confirm, .memory-editor") ||
          panel?.getAttribute("data-memory-view") !== "overview" ||
          generated?.textContent ===
            (memoryFixtureValue().stored.text ||
              "No generated summary yet. Update from chat history to build one.")) &&
        // This finite native recipe has retained chats. Wait for their startup
        // selection inspection before opening a snapshot-bound confirmation.
        // Global content itself remains usable while that passive read settles.
        (memoryFixture !== null ||
          panel?.getAttribute("data-memory-chat-ready") === "true"),
      presentationFixture: memoryFixture !== null || memoryFixtureRestoring,
      progressiveComplete:
        memoryFixture === "fixture-progressive" &&
        state === "complete" &&
        progressiveAdvanced &&
        progressiveConnection &&
        progressiveStable,
      confirmationVisible: !!panel?.querySelector(".memory-confirm"),
      hasManual: rows.some((row) =>
        [memoryText(), memoryText(true)].includes(row.textContent),
      ),
      updatedManual:
        rows.length === 1 && rows[0].textContent === memoryText(true),
      off: buttons.some((button) => name(button) === "Turn On"),
      editing: !!panel?.querySelector("textarea"),
      rebuildVisible: visible(
        panel?.querySelector('[aria-label="Rebuild from chat history"]'),
      ),
      rebuildStartDisabled: buttons.some(
        (button) => name(button) === "Review and update" && button.disabled,
      ),
      rebuildCancelDisabled:
        buttons.some(
          (button) => name(button) === "Cancel" && button.disabled,
        ) || !buttons.some((button) => name(button) === "Cancel"),
    };
  }
  function memoryAction(command) {
    memoryStage = "action";
    if (
      !globalThis.__trainerOrdinaryIsolated ||
      Object.keys(command).sort().join(",") !== "action,type" ||
      ![
        "observe",
        "open",
        "close",
        "reload",
        "add",
        "edit",
        "summary-edit",
        "draft",
        "draft-update",
        "save",
        "forget",
        "clear",
        "disable",
        "enable",
        "retry",
        "rebuild-preflight",
        "history-select",
        "history-legacy",
        "back",
        "manage",
        "earlier-sources",
        "older-records",
        "item-details",
        "cancel-edit",
        "confirm",
        "cancel-confirm",
        "history-effects",
        "fixture-densify-ready",
        "fixture-densify-busy",
        "fixture-densify-review",
        "fixture-densify-no-reduction",
        "fixture-densify-accepted",
        "fixture-densify-discarded",
        "densify",
        "densify-cancel",
        "densify-accept",
        "densify-discard",
        "fixture-populated",
        "fixture-empty",
        "fixture-error",
        "fixture-off",
        "fixture-history",
        "fixture-running",
        "fixture-progressive",
        "fixture-complete",
        "fixture-interrupted",
        "fixture-failed",
        "fixture-cancelled",
        "fixture-unknown",
        "fixture-reset",
      ].includes(command.action)
    )
      throw Error("Unsupported Memory action/fields");
    const before = memoryObservation(command.action);
    if (command.action === "observe") return before;
    if (command.action === "open") {
      if (before.visible) throw Error("Memory already open");
      target("Memory").click();
    } else {
      const panel = memoryPanel();
      if (!before.visible) throw Error("Memory not visible");
      if (command.action.startsWith("fixture-")) {
        if (before.editing || before.confirmationVisible)
          throw Error("Settle editor/confirmation before fixture selection");
        if (command.action === "fixture-reset") resetMemoryFixture();
        else selectMemoryFixture(command.action);
        const refresh = [...panel.querySelectorAll("button")].find((button) =>
          ["Refresh", "Retry loading", "Retry connection"].includes(
            name(button),
          ),
        );
        if (!refresh || refresh.disabled)
          throw Error("Passive refresh unavailable; return to memory first");
        refresh.click();
      } else if (
        memoryFixture &&
        ![
          "densify",
          "densify-cancel",
          "densify-accept",
          "densify-discard",
          "close",
          "back",
          "manage",
          "earlier-sources",
          "older-records",
          "item-details",
          "history-select",
          "history-legacy",
          "cancel-edit",
          "cancel-confirm",
          "rebuild-preflight",
          "history-effects",
          "reload",
          "add",
          "edit",
          "summary-edit",
          "draft",
          "draft-update",
          "forget",
          "clear",
        ].includes(command.action)
      )
        throw Error("Presentation-only action refused");
      else if (command.action === "close") {
        resetMemoryFixture();
        target("Close memory").click();
      } else if (command.action === "rebuild-preflight") {
        memoryStage = "history-navigation";
        if (!panel.querySelector('[aria-label="Rebuild from chat history"]'))
          target(
            [...panel.querySelectorAll("button")].some(
              (button) => name(button) === "Update from chat history · running",
            )
              ? "Update from chat history · running"
              : "Update from chat history",
          ).click();
      } else if (
        command.action === "history-select" ||
        command.action === "history-legacy"
      ) {
        if (
          !memoryFixture ||
          panel.getAttribute("data-memory-view") !== "history"
        )
          throw Error("Fixed presentation history only");
        if (command.action === "history-select") {
          const radio = panel.querySelectorAll('input[type="radio"]')[1];
          if (!radio) throw Error("History selection unavailable");
          radio.click();
          queueMicrotask(() =>
            panel.querySelector(".memory-chat-choices input")?.click(),
          );
        } else {
          const boxes = panel.querySelectorAll(
            'fieldset > label input[type="checkbox"]',
          );
          if (boxes.length !== 1) throw Error("Legacy review unavailable");
          boxes[0].click();
        }
      } else if (command.action === "history-effects") {
        if (!memoryFixture) throw Error("Fixed presentation confirmation only");
        const review = [...panel.querySelectorAll("button")].find(
          (node) => name(node) === "Review selected history",
        );
        if (review) review.click();
        else target("Review and update").click();
      } else if (command.action === "confirm") {
        const confirmButton = panel.querySelector(
          ".memory-confirm .button-row button:last-child",
        );
        if (
          !confirmButton ||
          ![
            "Remove preference",
            "Clear saved memory",
            "Turn memory On",
          ].includes(name(confirmButton)) ||
          confirmButton.disabled
        )
          throw Error("Unsupported confirmation");
        confirmButton.click();
      } else if (command.action === "cancel-confirm") target("Cancel").click();
      else if (
        [
          "densify",
          "densify-cancel",
          "densify-accept",
          "densify-discard",
        ].includes(command.action)
      ) {
        if (!memoryFixture?.startsWith("fixture-densify-"))
          throw Error(
            "Densify actions require fixed presentation; no provider authority",
          );
        target(
          {
            densify: "Densify summary",
            "densify-cancel": "Cancel densify",
            "densify-accept": "Use shorter summary",
            "densify-discard": "Discard",
          }[command.action],
        ).click();
      } else if (command.action === "back") target("Back to memory").click();
      else if (
        command.action === "clear" &&
        panel.getAttribute("data-memory-view") === "overview"
      )
        target("Manage memory").click();
      else if (["draft", "draft-update"].includes(command.action)) {
        const input = panel.querySelector("textarea");
        if (
          !input ||
          !visible(input) ||
          input.disabled ||
          (input.value &&
            ![
              memoryText(),
              memoryText(true),
              summaryText(),
              ...(memoryFixture ? [presentationText.join("\n")] : []),
            ].includes(input.value))
        )
          throw Error("Noncanonical Memory draft refused");
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        ).set.call(
          input,
          panel.querySelector('[aria-label="Edit generated summary"]') &&
            command.action === "draft-update"
            ? summaryText()
            : memoryText(command.action === "draft-update"),
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        memoryStage = "ready-before-control";
        if (!before.loaded) throw Error("Memory is busy or unavailable");
        const labels = {
          reload: "Refresh",
          back: "Back to memory",
          manage: "Manage memory",
          "earlier-sources": "Review earlier sources",
          "older-records": "Older saved records",
          "item-details": "Source & details",
          "cancel-edit": "Cancel edit",
          add: "Add preference",
          edit: "Edit preference",
          "summary-edit": "Edit summary",
          save: panel.querySelector('[aria-label="Edit generated summary"]')
            ? "Save summary"
            : "Save preference",
          forget: "Remove preference",
          clear: "Clear saved memory",
          disable: "Turn Off",
          enable: "Turn On",
          retry: "Retry summary processing",
        };
        const label = labels[command.action];
        memoryStage = "canonical-control-lookup";
        const matches = [...panel.querySelectorAll("button")].filter(
          (button) =>
            name(button) === label && visible(button) && !button.disabled,
        );
        memoryStage = "canonical-control-target";
        const button = ["edit", "forget", "item-details"].includes(
          command.action,
        )
          ? matches[0]
          : target(label);
        if (!button) throw Error("Missing canonical memory action");
        if (!panel.contains(button))
          throw Error("Memory-only control required");
        const confirm = window.confirm;
        try {
          window.confirm = (message) => {
            const exact =
              command.action === "forget"
                ? "Remove this separately authored preference? Conversations and generated summary remain. This does not surgically erase meaning from history."
                : command.action === "clear"
                  ? "Clear summary, manual items and chat pins? Transcripts, Profile, Garmin, plans and preserved legacy records remain. Future new turns may create memory; backups/provider logs are not erased."
                  : command.action === "cancel-edit"
                    ? "Discard unsaved memory changes? Cancel keeps editing."
                    : null;
            if (message !== exact)
              throw Error("Unexpected Memory confirmation refused");
            return true;
          };
          memoryStage = "canonical-control-click";
          button.click();
        } finally {
          window.confirm = confirm;
        }
      }
    }
    memoryStage = "post-action-observation";
    return memoryObservation(command.action);
  }
  function revealMemory() {
    memoryStage = "inspection";
    const observation = memoryObservation("observe");
    if (
      !observation.visible ||
      (!observation.loaded && memoryFixture !== "fixture-unknown")
    )
      throw Error("Memory capture requires settled canonical state");
    const panel = memoryPanel();
    memoryStage = "anchor";
    const anchor =
      panel.querySelector(".memory-confirm, .memory-editor") ||
      panel.querySelector("h3");
    anchor?.scrollIntoView({ block: "start", behavior: "instant" });
    const labels = new Set([
      "What your trainer remembers",
      "When enabled, memory helps your trainer carry important details from previous conversations into new chats.",
      "Generated summary",
      "Densify summary",
      "Cancel densify",
      "Review densified summary",
      "Use shorter summary",
      "Discard",
      "One paid AI request using your configured memory model. Review before saving; the target is guidance.",
      "Needs a usable saved summary, configured native memory model and no running memory update.",
      "Save or cancel your edit first.",
      "Densifying… Your saved summary stays in use. Cancellation cannot recall sent text or costs.",
      "13250 → 7000 characters · target 6000",
      "13250 → 13250 characters · target 6000",
      "6250 fewer characters. Check meaning before saving.",
      "No reduction. This result cannot replace your summary; no automatic retry.",
      "The original saved summary remains below for comparison.",
      "Shorter generated summary saved. Separate preferences and existing chat snapshots are unchanged.",
      "Candidate discarded. Saved summary unchanged.",
      ...(memoryFixture?.startsWith("fixture-densify-")
        ? [
            densifyText(13250).trim(),
            densifyText(7000).trim(),
            "13250 characters · target 6000 · generated text only",
            "7000 characters · target 6000 · generated text only",
          ]
        : []),
      "Your preferences",
      "Add preference",
      "Edit preference",
      "Remove preference",
      "Remove this preference?",
      "Edit summary",
      "Edit generated summary",
      "Add preference",
      "Edit preference",
      "Save preference",
      "Save summary",
      "Complete generated summary",
      "Preference",
      "No generated summary yet. Update from chat history to build one.",
      "Add your own preferences or restrictions here. History updates do not rewrite them.",
      "Saved summary is not in use. Turn memory On to use it again.",
      "Off · Saved summary and preferences retained, not in use",
      "Preference added.",
      "Preference edited.",
      "Preference removed. Conversations and generated summary remain.",
      "Complete generated summary saved. A future regeneration replaces it; separate preferences are unchanged.",
      "Saved separately as your own preference; history regeneration preserves it and it does not count toward the generated target. This text may be sent to your AI provider.",
      "This replaces the complete generated text. The 6000-character target is guidance, not a maximum. Regeneration replaces direct summary edits too. This text may be sent to your AI provider.",
      ...[
        "",
        memoryText(),
        memoryText(true),
        summaryText(),
        ...(memoryFixture ? [presentationText.join("\n")] : []),
      ].map(
        (text) =>
          `${[...text].length} characters · target 6000 · generated text only`,
      ),
      `Preference${memoryText()}`,
      `Preference${memoryText(true)}`,
      `Complete generated summary${memoryText()}`,
      `Complete generated summary${memoryText(true)}`,
      summaryText(),
      `Complete generated summary${summaryText()}`,
      ...(memoryFixture
        ? [`Complete generated summary${presentationText.join("\n")}`]
        : []),
      `“${memoryText(true)}”\n\nRemove only this separately authored preference. This does not delete conversations or surgically remove related meaning from the generated summary.`,
      `“Keep explanations concise.”\n\nRemove only this separately authored preference. This does not delete conversations or surgically remove related meaning from the generated summary.`,
      "Keep explanations concise.",
      presentationText.join("\n"),
      "Update memory from chat history",
      "Manage memory",
      "Memory details",
      "Add memory",
      "Edit",
      "Forget",
      "Source & details",
      "Refresh",
      "Retry loading",
      "Retry connection",
      "Turn Off",
      "Turn On",
      "Update from chat history",
      "Update from chat history · running",
      "Manage memory",
      "Back to memory",
      "Conversations to review",
      "All retained conversations",
      "Choose conversations",
      "Include older conversations that need permission to reuse",
      "Review selected history",
      "Start reviewed history update?",
      "Start update",
      "Review and update",
      "Review a new update",
      "History update failed",
      "Update status unavailable",
      "Cancel edit",
      "Save memory",
      "Forget this memory?",
      "Forget memory",
      "Clear saved memory?",
      "Clear saved memory",
      "Cancel",
      "Updating from history",
      "Saved memory updated",
      "History update interrupted",
      "History update cancelled",
      "The AI response did not meet memory's structure, size or source rules. It was not saved.",
      "Further work was stopped. Text already sent and charges cannot be recalled.",
      "View saved memory",
      "Constraint · User-stated",
      "Open question · Discussed · not decided",
      "Temporary · User-stated",
      "Decision · User-stated",
      "Nothing saved here yet. Add something you want your trainer to remember, or update from past conversations below.",
      "On · Add the provider key in Settings to process memory.",
      "Off · Saved items retained",
      "On · No saved memories",
      "Includes your own saved text.",
      "Manually saved",
      "Saved from conversations",
      "Source unavailable; the conversation cannot be reconstructed.",
      "Memory added.",
      "Memory edited.",
      "Item forgotten. Original transcripts remain.",
      "Memory is Off. Saved items stay; automatic titles are separate.",
      "Memory is On. Earlier Off history was not automatically imported.",
      "Review is local; nothing is sent until you confirm. Memory keeps useful context, not every detail.",
      "Keep the app open. Cancelling stops further work, not text already sent or charges incurred. Uncertain requests are not automatically repeated.",
      "Saved as your own memory. Keep it concise; this text may be sent to your AI provider.",
      "Keeps its existing sources and expiry. Keep it concise; this text may be sent to your AI provider.",
      "Memory",
      "Review earlier sources",
      "Older saved records",
      "Choose earlier messages to add to memory. Only usable completed sources are offered; originals remain.",
      "No usable earlier messages available. To recover older conversations, use Update from chat history.",
      "Process reviewed selection (0)",
      "Older records are read-only and not used by chat. Up to 200 are shown; nothing is automatically imported.",
      "No older records loaded.",
      "Remove saved memory, including manual entries. Future new turns can create memory. Conversations, Profile, Garmin, plans and older records remain. Backups and text already sent to providers are not erased. To pause without deleting, turn memory Off instead.",
      memoryText(),
      memoryText(true),
      `Memory${memoryText()}`,
      `Memory${memoryText(true)}`,
      `“${memoryText(true)}”\n\nRemove this memory and keep its sources from recreating it. The original conversation remains. New statements can still become new memories.`,
      ...(memoryFixture
        ? [
            ...presentationText,
            "On · Saved memory available",
            "On · The update could not be safely saved.",
            ...Array.from(
              { length: 12 },
              (_, i) => `Authored conversation ${i + 1}`,
            ),
            "16 messages included from 4 conversations; 184 excluded from retained history.",
            "196 messages included from 12 conversations; 4 excluded from retained history.",
            "1 message included from 1 conversation; 199 excluded from retained history.",
            "19 messages included from 1 conversation; 181 excluded from retained history.",
            "180 — Older messages need explicit permission to reuse",
            "18 — Older messages need explicit permission to reuse",
            "180 — Outside your selected conversations",
            "4 — Sources you asked memory to forget",
            "1 — Sources you asked memory to forget",
            "Older conversations may include things once cleared. You allowed their reuse. Known forgotten sources and recorded clears stay excluded.",
            "Updates send selected usable text to your selected AI provider (openai) and may incur charges. Cost is not known in advance. The previous generated summary stays until the update succeeds. A successful update replaces all generated text, including direct summary edits. Separately authored preferences and conversations are preserved.",
            "8 of 16 included messages processed.",
            "16 of 16 included messages processed.",
            ...[20, 40, 60, 80, 184].map(
              (n) => `${n} of 184 included messages processed.`,
            ),
            "Last known: 60 of 184 included messages processed.",
            "Previous memory stays available. Keep the app open; progress updates automatically.",
            "The complete replacement was saved. Separate preferences and conversations remain; new chat turns use available valid memory.",
            "The app or request stopped before the update finished.",
            "No completed replacement was saved by this update. Previous memory was not replaced; independent Clear, privacy or Off changes still apply. Earlier request costs may be unknown. Nothing is repeated automatically.",
            "Off · Saved items retained",
            "Connection lost. Shown memory and progress are last known, not current. Reconnecting automatically; no update is repeated.",
            "Connection lost. Reconnecting automatically to the same operation; no work is repeated. Its current outcome is unknown.",
            `“${presentationText[0]}”\n\nRemove this memory and keep its sources from recreating it. The original conversation remains. New statements can still become new memories.`,
          ]
        : []),
    ]);
    const header = panel
      .closest(".memory-sheet")
      ?.querySelector(".sheet-header");
    if (
      header &&
      header.textContent.replace(/\s+/g, "") === "MemoryClose" &&
      [...header.querySelectorAll("*")].every((node) =>
        ["DIV", "H2", "BUTTON"].includes(node.tagName),
      )
    ) {
      header.setAttribute("data-smoke-reveal", "");
      for (const node of header.querySelectorAll("*"))
        node.setAttribute("data-smoke-reveal", "");
    }
    memoryStage = "canonical-copy";
    for (const progress of panel.querySelectorAll("progress")) {
      if (
        !memoryFixture ||
        ![16, 184].includes(progress.max) ||
        ![8, 20, 40, 60, 80].includes(progress.value) ||
        progress.getAttribute("aria-label") !== "Included messages processed"
      )
        throw Error("Noncanonical progress capture refused");
      progress.setAttribute("data-smoke-reveal", "");
    }
    for (const node of panel.querySelectorAll(
      'h2,h3,h4,p,li,button,label,legend,div[aria-label="Complete candidate summary"]',
    )) {
      if (!labels.has(node.textContent.trim()) || !visible(node)) continue;
      if (
        node.querySelector("textarea") &&
        !["", memoryText(), memoryText(true), summaryText()].includes(
          node.querySelector("textarea").value,
        )
      )
        throw Error("Private editor capture refused");
      for (const child of [node, ...node.querySelectorAll("*")])
        child.setAttribute("data-smoke-reveal", "");
      for (
        let parent = node.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        if (
          [...parent.childNodes].some(
            (child) =>
              child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
          )
        ) {
          restore();
          memoryStage = "private-ancestor";
          throw Error("Memory capture refuses direct ancestor text");
        }
        parent.setAttribute("data-smoke-reveal", "");
      }
    }
  }

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
  const footerUnavailable = ["Unavailable selected model"];
  const footerUnselected = "Choose a model";
  const footerWarning =
    "Provider key is not configured. Save in native Settings and confirm live application; retry availability.";
  const footerEmpty =
    "No available entries. Configure provider keys or eligible local models in native Settings, confirm live application and retry availability.";
  function knownFooterCatalog(select) {
    const options = [...select.options];
    const choices = options.filter((option) => option.value !== "");
    return (
      options.length >= 1 &&
      options.length <= 3 &&
      (choices.length === 0 ||
        (choices.length === 2 &&
          footerEntries.every(
            ([id, label], index) =>
              choices[index].value === id &&
              choices[index].textContent === label &&
              !choices[index].disabled,
          ))) &&
      options.every(
        (option) =>
          footerEntries.some(
            ([id, label]) =>
              option.value === id && option.textContent === label,
          ) ||
          (option.value === "" &&
            option.disabled &&
            [footerUnselected, ...footerUnavailable].includes(
              option.textContent,
            )),
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
      catalogKnown: knownFooterCatalog(select),
      unavailableChoice:
        knownFooterCatalog(select) &&
        select.value === "" &&
        select.selectedOptions[0]?.disabled &&
        footerUnavailable.includes(select.selectedOptions[0]?.textContent) &&
        document.querySelector(".chat-model-control [role=alert]")
          ?.textContent === footerWarning,
      noEligibleChoices:
        knownFooterCatalog(select) &&
        select.disabled &&
        select.options.length === 1 &&
        [...document.querySelectorAll(".chat-model-control p")].some(
          (el) => el.textContent === footerEmpty,
        ),
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
        !document.querySelector(
          '.chat-model-control button[aria-label="Reset to configured default"]',
        ),
      unselectedChoice:
        select.value === "" &&
        select.selectedOptions[0]?.textContent === footerUnselected,
      keysNoSend,
    };
  }
  function composerAction(command) {
    if (
      Object.keys(command).sort().join(",") !== "action,type" ||
      !["observe", "draft", "choose", "keys"].includes(command.action)
    )
      throw Error("Unsupported composer action/fields");
    const { textarea, select } = composerElements();
    if (
      command.action !== "observe" &&
      (!knownFooterCatalog(select) ||
        textarea.disabled ||
        (select.disabled && command.action !== "draft"))
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
      !(
        observation.modelReady ||
        (observation.noEligibleChoices && observation.unavailableChoice)
      ) ||
      !observation.draftMatches ||
      !observation.textareaStable
    )
      throw Error("Capture requires canonical synthetic composer");
    const reveal = (el) => el.setAttribute("data-smoke-reveal", "");
    [textarea, select, ...select.options, send].forEach(reveal);
    for (const el of document.querySelectorAll(".chat-model-control p")) {
      if (
        [
          footerWarning,
          footerEmpty,
          "Choose a model explicitly to use Trainer chat.",
        ].includes(el.textContent)
      )
        reveal(el);
    }
    for (const el of document.querySelectorAll(
      ".trainer-heading-row h2, .trainer-heading-row .section-kicker, .chat-model-control label, .chat-model-control button, .chat-model-save-state",
    )) {
      if (
        [
          "Chat with your private coach",
          "Daily trainer",
          "Model",
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
  // Fixed authored Activity labels only; never accept caller text or selectors.
  const labelSports = {
    strength: "strength_training",
    gravel: "gravel_cycling",
    hiking: "hiking",
  };
  let labelVariant = null;
  function labelElements() {
    const entries = Object.entries(labelSports).map(([key, sport]) => {
      const rows = [...document.querySelectorAll(".activity-list-item")].filter(
        (el) =>
          visible(el) &&
          el.querySelector("strong")?.textContent ===
            `T0295 synthetic ${sport}`,
      );
      const row = rows.length === 1 ? rows[0] : null;
      const small = row?.querySelector("small");
      const expected = sport.replaceAll("_", " ");
      const date = {
        strength: "2026-01-03",
        gravel: "2026-01-02",
        hiking: "2026-01-01",
      }[key];
      return {
        key,
        sport,
        row,
        title: row?.querySelector("strong"),
        small,
        valid:
          !!small &&
          !small.children.length &&
          small.textContent === `${date} · ${expected}`,
      };
    });
    const chosen = entries.find((entry) => entry.key === labelVariant);
    const heading = document.querySelector(".selected-activity-heading");
    const title = heading?.querySelector("h2");
    const metadata = heading?.querySelector("p");
    const ready =
      !!chosen &&
      chosen.valid &&
      chosen.row.classList.contains("selected") &&
      title?.textContent === `T0295 synthetic ${chosen.sport}` &&
      metadata?.textContent ===
        `${chosen.small.textContent} · Garmin ID T0295-${chosen.sport}` &&
      !metadata.children.length;
    return { entries, chosen, title, metadata, ready };
  }
  function labelsObservation(action) {
    const state = labelElements();
    return {
      ok: true,
      action,
      trustedInput: false,
      choicesReady: state.entries.every((entry) => entry.valid),
      ready: !!state.ready,
      contained: document.documentElement.scrollWidth <= innerWidth,
    };
  }
  async function labelsAction(command) {
    if (
      !globalThis.__trainerOrdinaryIsolated ||
      Object.keys(command).sort().join(",") !== "action,type" ||
      !["observe", "list", ...Object.keys(labelSports)].includes(command.action)
    )
      throw Error("Unsupported Activity labels action");
    restore();
    if (command.action === "list") {
      const state = labelElements();
      const list = state.chosen?.row?.closest(".activity-list");
      if (!state.ready || !list)
        throw Error("Authored selected activity required");
      list.scrollTop +=
        state.chosen.row.getBoundingClientRect().top -
        list.getBoundingClientRect().top;
    } else if (command.action !== "observe") {
      const state = labelElements();
      const entry = state.entries.find((item) => item.key === command.action);
      if (
        !state.entries.every((item) => item.valid) ||
        !entry?.row ||
        entry.row.disabled
      )
        throw Error("Authored labels unavailable");
      labelVariant = command.action;
      entry.row.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    return labelsObservation(command.action);
  }
  function revealActivityLabels() {
    const state = labelElements();
    if (!state.ready || !state.entries.every((entry) => entry.valid))
      throw Error("Canonical Activity labels required");
    const leaves = [
      ...state.entries.flatMap((entry) => [entry.title, entry.small]),
      state.title,
      state.metadata,
    ];
    for (const leaf of leaves) {
      if (!leaf || leaf.children.length) throw Error("Unsafe Activity text");
      leaf.setAttribute("data-smoke-reveal", "");
      for (
        let node = leaf.parentElement;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (
          [...node.childNodes].some(
            (child) =>
              child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
          )
        )
          throw Error("Private direct Activity ancestor refused");
        node.setAttribute("data-smoke-reveal", "");
      }
    }
  }
  // Finite authored Terrain seed only. No caller IDs/selectors/values or raw observations.
  let terrainVariant = null;
  const terrainCopy =
    "Approximate elevation, not surface or technical difficulty: smoothing hides short features and gaps are excluded. Movement times are estimates; pace uses elapsed time and HR is averaged per section. Missing data isn’t zero; selection highlights only aligned elevation.";
  function terrainRegion() {
    const heading = document.querySelector(".selected-activity-heading h2");
    const region = document.querySelector('[aria-label="Terrain sections"]');
    if (
      !terrainVariant ||
      heading?.textContent !== `T0293 synthetic ${terrainVariant}` ||
      !region ||
      !visible(region)
    )
      return null;
    const text = region.querySelector("p")?.textContent;
    const suffix = {
      supported: "",
      partial: " Partial coverage.",
      capped:
        " Partial coverage. Showing 100 of 105 sections; not all sections are shown.",
    }[terrainVariant];
    if (
      text !== terrainCopy + suffix ||
      region.querySelector("details, ul") ||
      region.querySelectorAll("p").length !== 1
    )
      throw Error("Noncanonical Terrain copy refused");
    return region;
  }
  function terrainObservation(action) {
    const region = terrainRegion();
    const paragraph = region?.querySelector("p");
    const rect = paragraph?.getBoundingClientRect();
    const wrapper = region?.querySelector(".lap-table-wrap");
    const bounds = wrapper?.getBoundingClientRect();
    return {
      ok: true,
      action,
      trustedInput: false,
      choicesReady: ["supported", "partial", "capped"].every((variant) =>
        [...document.querySelectorAll(".activity-list-item strong")].some(
          (el) =>
            visible(el) && el.textContent === `T0293 synthetic ${variant}`,
        ),
      ),
      ready: !!region,
      selected:
        region?.querySelector('button[aria-pressed="true"]') !== null &&
        !!region,
      highlighted: !!document.querySelector(
        '[aria-label="Selected terrain section elevation interval"]',
      ),
      compact:
        !!region &&
        region.querySelectorAll("p").length === 1 &&
        !region.querySelector("details, ul"),
      partial: !!paragraph?.textContent.includes("Partial coverage."),
      capped: !!paragraph?.textContent.includes("Showing 100 of 105 sections"),
      contained:
        !!bounds &&
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        document.documentElement.scrollWidth <= innerWidth,
      paragraphVisible: !!rect && rect.top >= 0 && rect.bottom <= innerHeight,
      headerVisible:
        !!region && tableHeaderVisible(region.querySelector("table")),
    };
  }
  async function terrainAction(command) {
    if (
      !globalThis.__trainerOrdinaryIsolated ||
      Object.keys(command).sort().join(",") !== "action,type" ||
      ![
        "observe",
        "supported",
        "partial",
        "capped",
        "toggle",
        "start",
        "end",
      ].includes(command.action)
    )
      throw Error("Unsupported Terrain action/mode");
    restore();
    if (["supported", "partial", "capped"].includes(command.action)) {
      const choices = [
        ...document.querySelectorAll(".activity-list-item"),
      ].filter(
        (el) =>
          visible(el) &&
          el.querySelector("strong")?.textContent ===
            `T0293 synthetic ${command.action}`,
      );
      if (choices.length !== 1 || choices[0].disabled)
        throw Error("Authored activity unavailable");
      terrainVariant = command.action;
      choices[0].click();
    } else if (command.action !== "observe") {
      const region = terrainRegion();
      if (!region) throw Error("Authored Terrain required");
      if (command.action === "toggle") {
        const button = region.querySelector("button");
        if (!visible(button) || button.disabled)
          throw Error("Terrain selection unavailable");
        button.click();
      } else {
        // Scroll real user-scrollable ancestors only; no layout/style substitution.
        for (let node = region.parentElement; node; node = node.parentElement) {
          if (
            ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight
          )
            node.scrollTop +=
              region.getBoundingClientRect().top -
              node.getBoundingClientRect().top -
              8;
        }
        const wrapper = region.querySelector(".lap-table-wrap");
        wrapper.scrollLeft = command.action === "end" ? wrapper.scrollWidth : 0;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    return terrainObservation(command.action);
  }
  function revealTerrain() {
    const region = terrainRegion();
    const observation = terrainObservation("observe");
    if (!region || !observation.paragraphVisible || !observation.headerVisible)
      throw Error("Visible canonical Terrain required");
    const safe = new Set([
      "Terrain sections",
      terrainCopy +
        {
          supported: "",
          partial: " Partial coverage.",
          capped:
            " Partial coverage. Showing 100 of 105 sections; not all sections are shown.",
        }[terrainVariant],
      "Estimated elevation-profile sections",
      "Select",
      "Kind",
      "Distance interval (m)",
      "Distance (m)",
      "Ascent / descent (m)",
      "Signed grade (%)",
      "≥10% up / down (m)",
      "Elapsed",
      "Est. moving / stationary",
      "Elapsed pace",
      "Avg HR (bpm)",
      "Data notes",
      "climb",
      "descent",
      "flat",
      "rolling",
      "Avg HR unavailable",
      "Timing incomplete",
      "Timing unavailable",
      "HR coverage incomplete",
      "Unavailable",
      "—",
    ]);
    for (const el of [region, ...region.querySelectorAll("*")]) {
      if (
        ![...el.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
        ) ||
        (!el.children.length &&
          (safe.has(el.textContent) ||
            (el.tagName === "BUTTON" &&
              /^Section (?:[1-9]\d?|100)$/.test(el.textContent))))
      )
        el.setAttribute("data-smoke-reveal", "");
    }
    for (
      let node = region.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
        )
      )
        throw Error("Private direct Terrain ancestor refused");
      node.setAttribute("data-smoke-reveal", "");
    }
  }
  let maskExpiry;
  let maskScroll = [];
  function restore() {
    clearTimeout(maskExpiry);
    for (const [node, left, top] of maskScroll) {
      node.scrollLeft = left;
      node.scrollTop = top;
    }
    maskScroll = [];
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
      memory: "Memory",
      sync: "Sync",
      profile: "Profile & data",
    }[command.view];
    if (command.view === "activityLabels") {
      if (!labelElements().ready) throw Error("Unsafe Activity capture");
    } else if (command.view === "terrain") {
      if (!terrainRegion()) throw Error("Unsafe Terrain capture");
    } else if (command.view === "tables") {
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
      "Sync now",
      "Sync / continue history",
      "Resume history",
      "Sync latest",
      "Import older data",
      "Continue historical import",
      "Technical details",
      "Sync in progress",
      "Cancel sync",
      "Ready",
      "Syncing",
      "Complete",
      "Paused",
      "Failed",
      "Verify connector",
      "Refresh summary",
      "Activity detail maintenance",
    ]);
    // Hide by default; reveal only reviewed exact static text at its real geometry.
    // No top/left/width/position/display/reparenting overrides or copied facts.
    for (const el of document.querySelectorAll(
      ".app-brand .app-title, .app-mobile-menu .app-menu-toggle, nav button, .sync-view-header h1, .sync-view-header button, .sync-view-panel h2, [aria-labelledby='sync-action-heading'] button, [aria-labelledby='sync-action-heading'] summary, [aria-labelledby='sync-action-heading'] .pill, .sheet-header h2, .sheet-header button, .profile-settings-card .button-row button",
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
    if (command.view === "sync") {
      for (const details of document.querySelectorAll(
        ".sync-action-card details:not([open])",
      )) {
        if (
          [...details.children].some(
            (child) =>
              child.tagName !== "SUMMARY" && child.getClientRects().length,
          )
        ) {
          restore();
          throw Error("Collapsed Sync details leaked rendered content");
        }
      }
      const safeStates = new Set([
        "Ready to refresh recent data.",
        "Status unavailable. Refresh import summary before syncing.",
        "Older history needs attention.",
        "Syncing…",
        "Sync paused. Refresh import summary to confirm settlement.",
        "Selected older range checked; remote earliest history unknown.",
        "Latest refresh in progress…",
        "Historical import in progress…",
        "Cancellation requested. Refresh import summary to confirm settlement.",
        ...["Latest refresh", "Historical import", "Sync"].flatMap((label) => [
          `${label} finished.`,
          `${label} failed. Refresh import summary for status.`,
          `${label} cancelled. Saved progress is retained.`,
          `${label} paused at its safety limit.`,
          `${label} interrupted. Refresh import summary before continuing.`,
          `${label} outcome unknown. Refresh import summary.`,
        ]),
        "A sync is active. Wait for settlement, then refresh summary.",
        "Summary truth is not confirmed. Refresh import summary before starting or continuing.",
        "Historical eligibility is unknown. Refresh import summary.",
        "Older work is available within the selected exploration scope.",
        "Previous historical import was interrupted; committed progress is retained.",
        "Selected exploration range checked. Remote earliest history remains unknown.",
      ]);
      for (const status of document.querySelectorAll(
        ".sync-history-status, .sync-current-status",
      )) {
        if (visible(status)) {
          const cue = status.firstElementChild;
          const busyCue =
            status.textContent === "Syncing…" &&
            status.childElementCount === 1 &&
            cue.tagName === "SPAN" &&
            cue.className === "sync-busy-cue" &&
            cue.getAttribute("aria-hidden") === "true" &&
            !cue.childNodes.length;
          if (
            !safeStates.has(status.textContent) ||
            (status.childElementCount && !busyCue)
          ) {
            restore();
            throw Error("Unrecognized Sync status");
          }
          status.setAttribute("data-smoke-reveal", "");
          if (busyCue) cue.setAttribute("data-smoke-reveal", "");
        }
      }
      const help = document.querySelector(
        '[aria-labelledby="sync-dependency-heading"]',
      );
      if (help && visible(help)) {
        const children = [...help.children];
        const summaries = [
          "The Garmin connector launcher cannot execute. Check uvx or its configured override, then explicitly retry.",
          "The Garmin connector could not start. Its cause, including Python availability, is unknown.",
        ];
        if (
          children.length !== 3 ||
          children.some((el) => el.childElementCount) ||
          children[0].tagName !== "H3" ||
          children[0].textContent !== "Garmin action setup" ||
          children[1].tagName !== "P" ||
          !summaries.includes(children[1].textContent) ||
          children[2].tagName !== "P" ||
          children[2].textContent !==
            "See README → Installation → Garmin access for setup. Check the executable path in native Settings → Troubleshooting / technical controls; manage uvx and compatible Python separately, then explicitly retry this action. Sign-in is not a tooling fix. Saved data remains available."
        ) {
          restore();
          throw Error("Unrecognized dependency guidance");
        }
        for (let node = help.parentElement; node; node = node.parentElement)
          maskScroll.push([node, node.scrollLeft, node.scrollTop]);
        help.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        const rect = help.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < 0 ||
          rect.top < 0 ||
          rect.right > innerWidth ||
          rect.bottom > innerHeight
        ) {
          restore();
          throw Error("Dependency guidance outside viewport");
        }
        help.setAttribute("data-smoke-reveal", "");
        for (const el of children) el.setAttribute("data-smoke-reveal", "");
      }
      // Like table captures, WebKit's scroll layer needs visible containers.
      // Validate all ancestors before revealing them; siblings remain masked.
      const containers = new Set();
      for (const revealed of document.querySelectorAll("[data-smoke-reveal]")) {
        for (
          let node = revealed.parentElement;
          node && node !== document.body;
          node = node.parentElement
        ) {
          if (
            [...node.childNodes].some(
              (child) =>
                child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
            ) &&
            !(
              node.matches(".sync-current-status[data-smoke-reveal]") &&
              node.textContent === "Syncing…"
            )
          ) {
            restore();
            throw Error("Sync capture refuses private direct ancestor text");
          }
          containers.add(node);
        }
      }
      for (const container of containers)
        container.setAttribute("data-smoke-reveal", "");
    }
    if (command.view === "memory") revealMemory();
    if (command.view === "composer") revealComposer();
    if (command.view === "conversation") revealConversations();
    if (command.view === "tables") revealTables();
    if (command.view === "terrain") revealTerrain();
    if (command.view === "activityLabels") revealActivityLabels();
    const style = document.createElement("style");
    style.id = "trainer-smoke-sanitizer";
    style.textContent =
      "body * {visibility:hidden !important} [data-smoke-reveal] {visibility:visible !important}";
    document.head.append(style);
    maskExpiry = setTimeout(restore, 10000);
    // Memory's changing subviews/scroll layers need a bounded background paint
    // turn after resize and masks; 120ms produced partial cached native frames.
    await new Promise((resolve) =>
      setTimeout(resolve, command.view === "memory" ? 350 : 120),
    );
    return {
      ok: true,
      view: command.view,
      preset: command.preset,
      boundary: "geometry-preserving redacted own-WebView",
    };
  }
  // Native invokes this after every capture. Fixture lifetime is independent:
  // resetting it here would revoke canonical authority between wide/narrow images.
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
      case "sync": {
        if (Object.keys(command).sort().join(",") !== "action,type")
          throw Error("Unknown Sync fields");
        const panel = document.querySelector(
          '[aria-labelledby="sync-action-heading"]',
        );
        if (
          !visible(panel) ||
          ![
            "observe",
            "start",
            "continue",
            "cancel",
            "refresh",
            "details",
          ].includes(command.action)
        )
          throw Error("Sync unavailable");
        if (command.action === "details") {
          const summaries = [...panel.querySelectorAll("summary")].filter(
            (el) => visible(el) && name(el) === "Technical details",
          );
          if (
            summaries.length !== 1 ||
            summaries[0].parentElement?.tagName !== "DETAILS"
          )
            throw Error("Technical disclosure unavailable");
          summaries[0].click();
        } else if (command.action !== "observe") {
          const labels = {
            start: "Sync now — import latest Garmin data",
            continue: [...panel.querySelectorAll("button")].some(
              (el) => name(el) === "Continue historical import",
            )
              ? "Continue historical import"
              : "Import older data",
            cancel: "Cancel sync",
            refresh: "Refresh import summary",
          };
          const el = target(labels[command.action]);
          if (!el.closest(".sync-view-content"))
            throw Error("Sync-only target required");
          el.click();
        }
        const start = panel.querySelector(
          '[aria-label="Sync now — import latest Garmin data"]',
        );
        const cancel = [...panel.querySelectorAll("button")].find(
          (el) => name(el) === "Cancel sync",
        );
        return {
          ok: true,
          running: panel.dataset.syncRunning === "true",
          paused: panel.dataset.syncKind === "paused",
          completed: panel.dataset.syncKind === "completed",
          failed: panel.dataset.syncKind === "failed",
          startEnabled: !!start && visible(start) && !start.disabled,
          cancelEnabled: !!cancel && visible(cancel) && !cancel.disabled,
          progressStarted: panel.querySelectorAll(".sync-log-entry").length > 0,
        };
      }
      case "composer":
        return composerAction(command);
      case "conversation":
        return conversationAction(command);
      case "memory":
        return memoryAction(command);
      case "tables":
        return tablesAction(command);
      case "terrain":
        return terrainAction(command);
      case "activityLabels":
        return labelsAction(command);
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
        const comparison = healthComparison();
        if (command.action === "calories") {
          syntheticCalories = false;
          const { card, buttons, expected } = canonicalCalories(comparison);
          for (const [index, button] of buttons.entries()) {
            button.dispatchEvent(new Event("pointerover", { bubbles: true }));
            button.focus({ preventScroll: true });
            button.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (
              card.querySelector(".health-rollup-readout")?.textContent !==
              expected[index].readout
            )
              throw Error("Synthetic shared Calories readout failed");
          }
          syntheticCalories = true;
          return { ok: true, action: command.action, trustedInput: false };
        }
        if (
          command.action === "remember-range" ||
          command.action === "assert-range"
        ) {
          const dates = [
            ...comparison.querySelectorAll(".health-daily-coverage time"),
          ]
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
        // Hide by default, revealing only fixed static Health controls/card chrome.
        // Helper boxes retain their chrome with transparent text and fixed overlays.
        // Source-derived dates, values, plot marks/ticks, coverage and HRV context
        // stay hidden at unchanged geometry; even unexpected descendants stay private.
        style.textContent = `body * {visibility:hidden !important}
          .health-dashboard-panel, .health-dashboard-header, .health-dashboard-header h1,
          .health-dashboard-header button, .health-mode-controls, .health-mode-controls button,
          .health-daily-actions, .health-daily-actions button, .health-rollup-chart,
          .health-rollup-heading, .health-rollup-heading > strong, .health-rollup-heading > span,
          .health-rollup-plot .recharts-cartesian-grid line,
          .health-rollup-values button, .health-daily-coverage,
          .health-daily-coverage > summary {visibility:visible !important}
          .health-dashboard-panel [role="status"], .health-dashboard-panel #health-daily-help
          {visibility:visible !important; color:transparent !important; text-shadow:none !important; position:relative}
          .health-dashboard-panel #health-daily-range, .health-dashboard-panel [role="status"],
          .health-daily-comparison .health-rollup-readout, .health-daily-comparison .health-rollup-value {position:relative}
          .health-dashboard-panel #health-daily-range::after, .health-dashboard-panel [role="status"]::after,
          .health-daily-comparison .health-rollup-readout::after, .health-daily-comparison .health-rollup-value::after
          {content:"Masked"; visibility:visible !important; position:absolute; inset:0; color:var(--muted)}
          .health-dashboard-panel [role="status"]::after, .health-dashboard-panel #health-daily-help::after
          {content:"Masked"; visibility:visible !important; position:absolute; inset:12px; color:var(--muted)}`;
        if (syntheticCalories) {
          const { card, buttons, expected } = canonicalCalories(comparison);
          const selected = buttons.findIndex(
            (button) => button.getAttribute("aria-pressed") === "true",
          );
          if (
            selected !== 6 ||
            card.querySelector(".health-rollup-readout")?.textContent !==
              expected[6].readout
          )
            throw Error("Canonical Calories selection changed");
          // Only known canonical Calories descendants are visible; unexpected content stays hidden.
          style.textContent += `
            .health-calories-chart .health-calories-legend,
            .health-calories-chart .health-calories-legend > span,
            .health-calories-chart .health-calories-legend > span > i,
            .health-calories-chart .health-rollup-plot svg,
            .health-calories-chart .recharts-bar-rectangle path,
            .health-calories-chart .health-rollup-readout,
            .health-calories-chart .health-rollup-readout > span,
            .health-calories-chart .health-calories-breakdown dt,
            .health-calories-chart .health-calories-breakdown dd,
            .health-calories-chart button > span {visibility:visible !important}
            .health-calories-chart .health-rollup-readout::after,
            .health-calories-chart .health-rollup-value::after {content:none !important}`;
          // Keep real geometry, scrolling only user-scrollable Health ancestors.
          for (let node = card.parentElement; node; node = node.parentElement) {
            if (
              ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
              node.scrollHeight > node.clientHeight
            )
              node.scrollTop +=
                card.getBoundingClientRect().top -
                node.getBoundingClientRect().top -
                8;
          }
        }
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
            : request.command?.type === "memory" ||
                request.command?.view === "memory"
              ? `Memory action failed at ${memoryStage}`
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
