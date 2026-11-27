const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const slots = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
let fields = [];
// Status-only Garmin metadata from native; never key material.
let garminStatus = "not configured";
let garminOpen = false;
let onboarding = null;
let firstRun = false;
let step = 0;
let busy = false;
let unknownOutcome = false;
let legacyRequired = false;
let catalog = { version: 1, entries: [], defaultEntryId: null };
let savedChatgptEntries = [];
let loadedRevision = null;
let settingsEpoch = 0;
let restartFocus = null;
const restartDialog = byId("restart-required");
function closeRestart() {
  if (restartDialog.open) restartDialog.close();
}
restartDialog.addEventListener("close", () => {
  const target = restartFocus;
  restartFocus = null;
  if (target?.isConnected && !target.disabled && !target.closest("[hidden]"))
    target.focus();
});
byId("restart-dismiss").addEventListener("click", closeRestart);
restartDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeRestart();
  } else if (event.key === "Tab") {
    event.preventDefault();
    byId("restart-dismiss").focus();
  }
});

// Presence is metadata, never an input value. Only genuine input events create
// replacement drafts; the fixed placeholder cannot enter any native payload.
const keyStates = new Map();
const keyPresence = "••••••••";
const GARMIN_SLOT = "GARMIN_API_KEY";
function renderKey(slot) {
  const state = keyStates.get(slot);
  const input = byId(slot);
  input.placeholder =
    state?.present && state.intent === "unchanged"
      ? keyPresence
      : "Enter API key";
  input.disabled =
    (slot === GARMIN_SLOT ? busy : catalogLocked()) || !state?.available;
  byId(`${slot}-status`).textContent = !state?.available
    ? "Unavailable — reload before editing"
    : state.intent === "replace"
      ? "Replacement pending Save"
      : state.intent === "clear"
        ? "Removal pending Save"
        : state.legacy
          ? "Legacy key — adoption or re-entry required"
          : state.present
            ? "Configured — saved key hidden"
            : "Not configured";
}
function resetGarminKey(status) {
  keyStates.set(GARMIN_SLOT, {
    available: ["configured", "not configured", "reconnect-required"].includes(
      status,
    ),
    present: status === "configured",
    legacy: false,
    intent: "unchanged",
    replacement: "",
  });
  byId(GARMIN_SLOT).value = "";
  renderKey(GARMIN_SLOT);
}
function takeGarminKeyUpdate() {
  const state = keyStates.get(GARMIN_SLOT);
  const update =
    state?.intent === "replace"
      ? { intent: "replace", value: state.replacement }
      : { intent: state?.intent === "clear" ? "clear" : "unchanged" };
  clearGarminDraft();
  return update;
}
function clearGarminDraft() {
  const state = keyStates.get(GARMIN_SLOT);
  if (state) {
    state.intent = "unchanged";
    state.replacement = "";
  }
  byId(GARMIN_SLOT).value = "";
  renderKey(GARMIN_SLOT);
}
function resetKeys(metadata) {
  for (const slot of slots) {
    const presence = metadata?.[slot];
    keyStates.set(slot, {
      available: [
        "configured",
        "not configured",
        "legacy — adoption or re-entry required",
      ].includes(presence),
      present:
        presence === "configured" ||
        presence === "legacy — adoption or re-entry required",
      legacy: presence === "legacy — adoption or re-entry required",
      intent: "unchanged",
      replacement: "",
    });
    byId(slot).value = "";
    renderKey(slot);
  }
}
function clearKeyDrafts() {
  for (const slot of slots) {
    const state = keyStates.get(slot);
    if (state) {
      state.intent = "unchanged";
      state.replacement = "";
    }
    byId(slot).value = "";
    renderKey(slot);
  }
}
function takeKeyUpdates() {
  const keys = Object.fromEntries(
    slots.map((slot) => {
      const state = keyStates.get(slot);
      return [
        slot,
        state?.intent === "replace"
          ? { intent: "replace", value: state.replacement }
          : { intent: state?.intent === "clear" ? "clear" : "unchanged" },
      ];
    }),
  );
  clearKeyDrafts();
  return keys;
}
function editKey(slot) {
  const state = keyStates.get(slot);
  if ((slot === GARMIN_SLOT ? busy : catalogLocked()) || !state?.available)
    return;
  state.replacement = byId(slot).value;
  state.intent = state.replacement
    ? "replace"
    : state.present
      ? "clear"
      : "unchanged";
  renderKey(slot);
  if (slot === GARMIN_SLOT) renderConnection();
  else renderSummaryModels();
}
function deleteKeyPresence(slot, event) {
  const state = keyStates.get(slot);
  if (
    (slot === GARMIN_SLOT ? busy : catalogLocked()) ||
    !state?.available ||
    !state.present ||
    state.intent !== "unchanged"
  )
    return;
  event.preventDefault();
  state.intent = "clear";
  renderKey(slot);
  if (slot === GARMIN_SLOT) renderConnection();
  else renderSummaryModels();
}

const providers = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  ollama: "Ollama",
  openrouter: "OpenRouter",
  chatgpt: "ChatGPT plan",
};
let chatgptConnections = [];
let chatgptPending = false;
let chatgptAuthorizing = false;
let chatgptContext = null;
let chatgptRead = 0;
let chatgptWelcomeRegistration = null;
let chatgptSelectionMade = false;
const chatgptWelcome = byId("chatgpt-welcome");
function selectedChatgpt() {
  return chatgptConnections.find(
    (connection) => connection.id === byId("chatgpt-account").value,
  );
}
function chatgptAvailable(entry) {
  return chatgptConnections.some(
    (connection) =>
      connection.id === entry.registrationId &&
      connection.planEnabled &&
      connection.state === "connected" &&
      connection.models.some((model) => model.slug === entry.modelId),
  );
}
function chatgptEntryLabel(entry) {
  if (entry.provider !== "chatgpt")
    return `${providers[entry.provider]} / ${entry.modelId}`;
  const index = chatgptConnections.findIndex(
    (connection) => connection.id === entry.registrationId,
  );
  const connection = chatgptConnections[index];
  const model = connection?.models.find(
    (model) => model.slug === entry.modelId,
  );
  const name =
    model &&
    connection.models.filter(
      (candidate) => candidate.displayName === model.displayName,
    ).length === 1
      ? model.displayName
      : entry.modelId;
  const account =
    index < 0
      ? " · unavailable account"
      : chatgptConnections.length > 1
        ? ` ${index + 1}`
        : "";
  return `ChatGPT plan${account} / ${name}`;
}
function selectedChatgptModels() {
  return [...byId("chatgpt-model").querySelectorAll("input:checked")]
    .filter((input) => !input.disabled)
    .map((input) => input.value);
}
function updateChatgptModelControls() {
  const connection = selectedChatgpt();
  const inputs = [...byId("chatgpt-model").querySelectorAll("input")];
  for (const input of inputs) {
    const matches = (entry) =>
      entry.provider === "chatgpt" &&
      entry.registrationId === connection?.id &&
      entry.modelId === input.value;
    const added = catalog.entries.find(matches);
    const saved = savedChatgptEntries.find(matches);
    input.disabled =
      catalogLocked() || chatgptPending || !connection?.planEnabled || added;
    if (added) input.checked = false;
    const label = input.closest("label");
    label.hidden = Boolean(added);
    label.querySelector(".chatgpt-model-note").textContent = added
      ? saved?.id === added.id
        ? "Saved in catalog"
        : "Added — Save pending"
      : saved
        ? "Removed — Save pending"
        : "";
  }
  const hasNewModels =
    connection?.planEnabled &&
    inputs.some((input) => !input.closest("label").hidden);
  byId("chatgpt-model-picker").hidden = !hasNewModels;
  byId("catalog-chatgpt-add").hidden = !hasNewModels;
  const available = inputs.filter((input) => !input.disabled);
  const selected = selectedChatgptModels();
  const remaining = 32 - catalog.entries.length;
  byId("chatgpt-select-all").disabled = available.length === 0;
  byId("chatgpt-select-all").textContent =
    available.length && selected.length === available.length
      ? "Clear selection"
      : "Select all";
  byId("chatgpt-model-selection").textContent =
    selected.length > remaining
      ? `${selected.length} selected to add; only ${remaining} catalog slots available. Deselect models before adding; nothing will be added partially.`
      : `${selected.length} selected to add${inputs.length ? "" : " — refresh models to load available choices"}.`;
  byId("catalog-chatgpt-add").textContent = selected.length
    ? `Add selected (${selected.length})`
    : "Add selected";
  byId("catalog-chatgpt-add").disabled =
    catalogLocked() ||
    chatgptPending ||
    !connection?.planEnabled ||
    !selected.length ||
    selected.length > remaining;
}
let chatgptSwitchChoices = null;
const NEW_CHATGPT_ACCOUNT = "new-account";
function renderChatgpt(message) {
  const switching = chatgptSwitchChoices !== null;
  const connections = chatgptSwitchChoices ?? chatgptConnections;
  const input = byId("chatgpt-account");
  const selected = input.value;
  input.replaceChildren(
    ...[
      {
        id: "",
        label:
          chatgptConnections.length > 1
            ? "Choose a connection…"
            : "Connect a ChatGPT account",
      },
      ...connections,
      ...(switching
        ? [
            {
              id: NEW_CHATGPT_ACCOUNT,
              label: "New account/workspace",
            },
          ]
        : []),
    ].map((connection) => {
      const option = document.createElement("option");
      option.value = connection.id;
      option.textContent = connection.label;
      return option;
    }),
  );
  input.value = switching
    ? [...connections, { id: NEW_CHATGPT_ACCOUNT }].some(
        (item) => item.id === selected,
      )
      ? selected
      : (chatgptConnections[0]?.id ?? "")
    : (chatgptSelectionMade || chatgptConnections.length === 1) &&
        chatgptConnections.some((connection) => connection.id === selected)
      ? selected
      : !chatgptSelectionMade && chatgptConnections.length === 1
        ? chatgptConnections[0].id
        : "";
  const connection = selectedChatgpt();
  const reconcile = chatgptConnections.length > 1 || switching;
  input.closest("label").hidden = !reconcile;
  byId("chatgpt-account-label").textContent = switching
    ? "Account to use"
    : "Connection to keep";
  byId("chatgpt-switch").hidden = !connection || reconcile;
  byId("chatgpt-switch-continue").hidden = !switching;
  byId("chatgpt-switch-continue").disabled =
    busy || chatgptPending || !input.value;
  byId("chatgpt-switch-back").hidden = !switching;
  byId("chatgpt-switch-back").disabled = busy || chatgptPending;
  byId("chatgpt-activate").hidden = !reconcile || switching;
  byId("chatgpt-activate").disabled = busy || chatgptPending || !connection;
  const models = byId("chatgpt-model");
  const previous = new Set(
    models.dataset.registration === connection?.id
      ? [...models.querySelectorAll("input:checked")].map(
          (input) => input.value,
        )
      : [],
  );
  models.dataset.registration = connection?.id ?? "";
  models.replaceChildren(
    ...(!reconcile ? (connection?.models ?? []) : []).map((model) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = model.slug;
      checkbox.checked = previous.has(model.slug);
      checkbox.addEventListener("change", updateChatgptModelControls);
      const text = document.createElement("span");
      text.textContent = model.displayName;
      const note = document.createElement("span");
      note.className = "chatgpt-model-note";
      text.append(note);
      label.append(checkbox, text);
      return label;
    }),
  );
  input.disabled = busy || chatgptPending;
  byId("chatgpt-model-picker").hidden = !connection?.planEnabled;
  byId("catalog-chatgpt-add").hidden = !connection?.planEnabled;
  byId("chatgpt-models").hidden = switching || !connection?.planEnabled;
  byId("chatgpt-usage").hidden = switching;
  byId("chatgpt-disconnect").hidden = !connection || switching;
  for (const id of [
    "chatgpt-connect",
    "chatgpt-switch",
    "chatgpt-consent",
    "chatgpt-models",
    "chatgpt-disconnect",
    "chatgpt-usage",
  ])
    byId(id).disabled =
      busy ||
      chatgptPending ||
      chatgptContext === null ||
      (id !== "chatgpt-connect" &&
        id !== "chatgpt-usage" &&
        (!connection || switching));
  byId("chatgpt-consent").hidden =
    reconcile || !connection || connection.planEnabled;
  byId("chatgpt-models").disabled ||= !connection?.planEnabled;
  byId("chatgpt-cancel").hidden = !chatgptPending || !chatgptAuthorizing;
  byId("chatgpt-cancel").disabled = !chatgptPending || !chatgptAuthorizing;
  byId("chatgpt-status").textContent =
    message ??
    (switching
      ? input.value === NEW_CHATGPT_ACCOUNT
        ? "This creates a connected app. To reconnect, choose a saved connection instead. Existing access stays active until sign-in succeeds."
        : "Continue privately in your browser to reuse this saved connection. Local labels do not identify remote app entries."
      : reconcile
        ? "Choose one connection to keep active. Other records remain private for recovery; existing model choices will not switch accounts."
        : connection
          ? `${connection.label} — ${connection.state === "connected" ? (connection.planEnabled ? "plan permission enabled" : "signed in; plan permission required") : connection.state === "identity-only" ? "signed in; plan permission required" : connection.state === "reconnect-required" ? "reconnect required" : connection.state === "unavailable" ? "connection state unavailable; reload before retry" : "disconnected"}.`
          : "Choose a saved registration or continue in your system browser.");
  byId("chatgpt-connect").hidden =
    reconcile || Boolean(connection && connection.state === "connected");
  updateChatgptModelControls();
  renderSummaryModels();
}
function showChatgptWelcome(
  connection = chatgptConnections.find(
    (connection) => connection.planEnabled && !connection.disclosed,
  ),
) {
  if (!connection?.planEnabled || connection.disclosed || chatgptWelcome.open)
    return;
  chatgptWelcomeRegistration = connection.id;
  chatgptWelcome.showModal();
  byId("chatgpt-welcome-dismiss").focus();
}
async function refreshChatgpt() {
  const read = ++chatgptRead,
    epoch = settingsEpoch;
  let context = null;
  try {
    const value = await invoke("chatgpt_context");
    if (!Number.isSafeInteger(value) || value < 0)
      throw Error("Connection context unavailable");
    context = value;
    const connections = await invoke("chatgpt_connections");
    if (read !== chatgptRead || epoch !== settingsEpoch) return false;
    if (!Array.isArray(connections))
      throw Error("Connection metadata unavailable");
    chatgptContext = context;
    chatgptConnections = connections;
    if (chatgptSwitchChoices !== null) chatgptSelectionMade = false;
    chatgptSwitchChoices = null;
    renderChatgpt();
    return true;
  } catch {
    if (read !== chatgptRead || epoch !== settingsEpoch) return false;
    chatgptContext = null;
    chatgptConnections = [];
    chatgptSwitchChoices = null;
    renderChatgpt(
      "Connection status unavailable. Reload before choosing a registration; no paid fallback.",
    );
    return false;
  }
}
async function beginChatgptSwitch() {
  if (chatgptPending || busy || chatgptContext === null) return;
  const epoch = settingsEpoch;
  let message;
  setBusy(true);
  try {
    const choices = await invoke("chatgpt_connections", { switching: true });
    if (epoch !== settingsEpoch) return;
    if (!Array.isArray(choices) || !choices.length) throw Error("Unavailable");
    chatgptSwitchChoices = choices;
    renderChatgpt();
  } catch {
    message =
      "Saved connection choices unavailable. Reload before switching; no new registration was started.";
  } finally {
    if (epoch === settingsEpoch) {
      setBusy(false);
      renderChatgpt(message);
      byId(
        chatgptSwitchChoices === null ? "chatgpt-switch" : "chatgpt-account",
      ).focus();
    }
  }
}
async function chatgptOperation(operation) {
  if (chatgptPending || busy || chatgptContext === null) return;
  const selected = byId("chatgpt-account").value;
  if (operation === "switch" && (chatgptSwitchChoices === null || !selected))
    return;
  const selection = selected === NEW_CHATGPT_ACCOUNT ? null : selected || null;
  const authorizing = ["connect", "consent", "switch"].includes(operation);
  const previous = new Map(
    chatgptConnections.map((connection) => [connection.id, connection.epoch]),
  );
  const epoch = settingsEpoch;
  chatgptPending = true;
  chatgptAuthorizing = authorizing;
  const context = chatgptContext;
  setBusy(true);
  renderChatgpt(
    authorizing
      ? "Complete sign-in privately in your system browser. This attempt expires in three minutes."
      : "Updating the selected ChatGPT registration…",
  );
  let message;
  let connectedRegistration = null;
  try {
    const result = authorizing
      ? await invoke("chatgpt_connect", {
          registrationId: selection,
          newAccount: selection === null,
          consent: operation === "consent",
          context,
        })
      : await invoke("chatgpt_action", {
          action: operation,
          registrationId: selection,
          context,
        });
    if (authorizing) {
      connectedRegistration = result?.registrationId;
      message =
        result?.message ?? "Connection outcome unknown; reload saved state.";
    } else message = result;
  } catch (error) {
    message =
      typeof error === "string"
        ? error
        : "Connection outcome unknown. Reload committed state before another attempt.";
  } finally {
    if (epoch === settingsEpoch) {
      chatgptPending = false;
      chatgptAuthorizing = false;
      await refreshChatgpt();
      if (epoch === settingsEpoch) {
        const changed = chatgptConnections.filter(
          (connection) => previous.get(connection.id) !== connection.epoch,
        );
        if (
          chatgptConnections.some(
            (connection) => connection.id === connectedRegistration,
          )
        ) {
          byId("chatgpt-account").value = connectedRegistration;
          chatgptSelectionMade = true;
        } else if (authorizing && changed.length === 1) {
          byId("chatgpt-account").value = changed[0].id;
          chatgptSelectionMade = true;
        }
        setBusy(false);
        renderChatgpt(message);
        byId("chatgpt-status").focus();
        showChatgptWelcome(selectedChatgpt());
      }
    }
  }
}
async function dismissChatgptWelcome() {
  const id = chatgptWelcomeRegistration;
  if (!id) return;
  try {
    await invoke("chatgpt_action", {
      action: "disclose",
      registrationId: id,
      context: chatgptContext,
    });
    chatgptWelcomeRegistration = null;
    chatgptWelcome.close();
    await refreshChatgpt();
    byId(
      byId("chatgpt-connect").hidden ? "chatgpt-models" : "chatgpt-connect",
    ).focus();
  } catch {
    byId("chatgpt-status").textContent =
      "Disclosure acknowledgment was not saved. Reload connection status.";
  }
}
byId("chatgpt-welcome-dismiss").addEventListener(
  "click",
  dismissChatgptWelcome,
);
chatgptWelcome.addEventListener("cancel", (event) => {
  event.preventDefault();
  dismissChatgptWelcome();
});
chatgptWelcome.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    byId("chatgpt-welcome-dismiss").focus();
  }
});
byId("chatgpt-account").addEventListener("change", () => {
  chatgptSelectionMade = true;
  renderChatgpt();
});
byId("chatgpt-select-all").addEventListener("click", () => {
  const inputs = [...byId("chatgpt-model").querySelectorAll("input")].filter(
    (input) => !input.disabled,
  );
  const select = inputs.some((input) => !input.checked);
  for (const input of inputs) input.checked = select;
  updateChatgptModelControls();
});
byId("chatgpt-connect").addEventListener("click", () =>
  chatgptOperation("connect"),
);
byId("chatgpt-switch").addEventListener("click", beginChatgptSwitch);
byId("chatgpt-switch-continue").addEventListener("click", () =>
  chatgptOperation("switch"),
);
byId("chatgpt-switch-back").addEventListener("click", async () => {
  await refreshChatgpt();
  byId("chatgpt-switch").focus();
});
byId("chatgpt-activate").addEventListener("click", () =>
  chatgptOperation("activate"),
);
byId("chatgpt-consent").addEventListener("click", () =>
  chatgptOperation("consent"),
);
for (const action of ["models", "disconnect", "usage"])
  byId(`chatgpt-${action}`).addEventListener("click", () =>
    chatgptOperation(action),
  );
byId("chatgpt-cancel").addEventListener("click", () => {
  const epoch = settingsEpoch;
  invoke("chatgpt_action", {
    action: "cancel",
    registrationId: null,
    context: chatgptContext,
  }).catch(() => {
    if (epoch === settingsEpoch)
      byId("chatgpt-status").textContent =
        "Cancellation outcome unknown; wait for connection settlement.";
  });
});
function catalogLocked() {
  return busy || Boolean(firstRun && onboarding?.settingsCommitted);
}
function updateCatalogControls() {
  for (const entry of catalog.entries) {
    const model = byId(`${entry.id}-modelId`);
    const duplicate = catalog.entries.some(
      (other) =>
        other.id !== entry.id &&
        other.provider === entry.provider &&
        other.registrationId === entry.registrationId &&
        other.modelId === entry.modelId,
    );
    // Early correction cue only; native catalog validation remains authoritative.
    model.setCustomValidity(
      duplicate
        ? "This provider and exact model ID already exist. Edit or remove this row."
        : "",
    );
    model.setAttribute("aria-invalid", String(duplicate));
    byId(`${entry.id}-error`).textContent = duplicate
      ? "Duplicate model ID in this provider."
      : "";
  }
  for (const add of document.querySelectorAll(".catalog-add"))
    add.disabled = catalogLocked() || catalog.entries.length >= 32;
  updateChatgptModelControls();
  byId("catalog-limit").textContent =
    `${catalog.entries.length}/32 models${catalog.entries.length >= 32 ? " — remove a model before adding another." : ""}`;
}
function renderSummaryModels(
  value = byId("SUMMARY_MODEL")?.value || "unselected",
) {
  const input = byId("SUMMARY_MODEL");
  if (!input) return;
  const matches =
    value === "gpt-6-luna"
      ? catalog.entries.filter(
          (entry) =>
            entry.provider === "openai" && entry.modelId === "gpt-6-luna",
        )
      : [];
  const exactMatch = matches.length === 1 ? matches[0] : null;
  const bind = byId("memory-bind-catalog");
  if (bind) {
    bind.hidden = !exactMatch;
    bind.disabled = catalogLocked();
    bind.onclick = exactMatch
      ? () => {
          renderSummaryModels(
            JSON.stringify({
              version: 1,
              entryId: exactMatch.id,
              provider: exactMatch.provider,
              modelId: exactMatch.modelId,
            }),
          );
          renderMemory();
          input.focus();
        }
      : null;
  }
  const choices = [{ value: "unselected", label: "Unselected" }];
  for (const entry of catalog.entries) {
    if (!entry.modelId.trim()) continue;
    const state = keyStates.get(`${entry.provider.toUpperCase()}_API_KEY`);
    const available =
      (entry.provider === "chatgpt" && chatgptAvailable(entry)) ||
      entry.provider === "ollama" ||
      (state?.available &&
        (state.intent === "replace" ||
          (state.present && state.intent !== "clear" && !state.legacy)));
    choices.push({
      value:
        entry === exactMatch
          ? value
          : JSON.stringify({
              version: entry.provider === "chatgpt" ? 2 : 1,
              ...(entry.provider === "chatgpt"
                ? { registrationId: entry.registrationId }
                : {}),
              entryId: entry.id,
              provider: entry.provider,
              modelId: entry.modelId,
            }),
      label: `${chatgptEntryLabel(entry)}${available ? "" : entry.provider === "chatgpt" ? " — connection unavailable" : " — key unavailable"}`,
    });
  }
  if (!choices.some((choice) => choice.value === value)) {
    let label = "Unavailable saved choice — reselect explicitly";
    if (value === "gpt-6-luna") label = "OpenAI / gpt-6-luna — fixed model";
    else {
      try {
        const saved = JSON.parse(value);
        if (
          [1, 2].includes(saved.version) &&
          providers[saved.provider] &&
          typeof saved.modelId === "string" &&
          saved.modelId.length <= 256
        )
          label = `${providers[saved.provider]} / ${saved.modelId} — unavailable; reselect explicitly`;
      } catch {
        /* Unsupported records stay explicit, never a default. */
      }
    }
    choices.push({ value, label });
  }
  input.replaceChildren(
    ...choices.map((choice) => {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      return option;
    }),
  );
  input.value = value;
}
function renderCatalog() {
  // Shared controls stay mounted: row operations never clear secret drafts.
  // Grouping never sorts or reconstructs the serialized catalog.
  for (const provider of Object.keys(providers)) {
    const rows = byId(`catalog-${provider}-rows`);
    rows.replaceChildren();
    catalog.entries
      .filter((entry) => entry.provider === provider)
      .forEach((entry, index) => {
        const context = `${providers[provider]} model ${index + 1}`;
        const row = document.createElement("div");
        row.className = "catalog-row";
        row.dataset.entryId = entry.id;
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", context);
        {
          const wrapper = document.createElement("label");
          wrapper.textContent = "Model ID";
          const input = document.createElement("input");
          input.id = `${entry.id}-modelId`;
          input.setAttribute("aria-label", `Model ID — ${context}`);
          input.type = "text";
          input.autocomplete = "off";
          input.autocapitalize = "off";
          input.setAttribute("autocorrect", "off");
          input.spellcheck = false;
          input.maxLength = 256;
          input.required = true;
          input.disabled = catalogLocked();
          input.value = entry.modelId;
          input.readOnly = provider === "chatgpt";
          if (provider === "chatgpt") {
            const account = document.createElement("span");
            account.textContent =
              chatgptConnections.find(
                (connection) => connection.id === entry.registrationId,
              )?.label ?? "Unavailable saved registration";
            wrapper.append(account);
          }
          input.setAttribute("aria-describedby", `${entry.id}-error`);
          const edit = () => {
            if (catalogLocked() || provider === "chatgpt") return;
            const draft = catalog.entries.find(
              (value) => value.id === entry.id,
            );
            // Legacy names remain inert, untouched compatibility metadata.
            draft.modelId = input.value;
            updateCatalogControls();
            renderSummaryModels();
          };
          input.addEventListener("input", edit);
          input.addEventListener("change", edit);
          wrapper.append(input);
          row.append(wrapper);
        }
        const actions = document.createElement("div");
        actions.className = "catalog-row-actions";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove — ${context}`);
        remove.disabled = catalogLocked();
        remove.addEventListener("click", () => {
          if (catalogLocked()) return;
          const peers = catalog.entries.filter(
            (value) => value.provider === provider && value.id !== entry.id,
          );
          const neighbor = peers[Math.min(index, peers.length - 1)];
          catalog.entries = catalog.entries.filter(
            (value) => value.id !== entry.id,
          );
          renderCatalog();
          (neighbor
            ? byId(`${neighbor.id}-modelId`)
            : byId(`catalog-${provider}-add`)
          ).focus();
          status.textContent = `${context} removed from draft; saved settings unchanged.`;
        });
        actions.append(remove);
        row.append(actions);
        const error = document.createElement("span");
        error.id = `${entry.id}-error`;
        error.className = "catalog-error";
        error.setAttribute("aria-live", "polite");
        row.append(error);
        rows.append(row);
      });
  }
  updateCatalogControls();
  renderSummaryModels();
}
for (const provider of Object.keys(providers)) {
  byId(`catalog-${provider}-add`).addEventListener("click", () => {
    if (catalogLocked() || catalog.entries.length >= 32) return;
    const connection = selectedChatgpt();
    if (provider === "chatgpt") {
      const selected = new Set(selectedChatgptModels());
      const models =
        connection?.planEnabled && !chatgptPending
          ? connection.models.filter(
              (model) =>
                selected.has(model.slug) &&
                !catalog.entries.some(
                  (entry) =>
                    entry.provider === "chatgpt" &&
                    entry.registrationId === connection.id &&
                    entry.modelId === model.slug,
                ),
            )
          : [];
      if (!models.length || catalog.entries.length + models.length > 32) return;
      const entries = models.map((model) => ({
        id: `entry_${crypto.randomUUID()}`,
        provider,
        registrationId: connection.id,
        modelId: model.slug,
      }));
      catalog.entries.push(...entries);
      renderCatalog();
      byId(`${entries[0].id}-modelId`).focus();
      status.textContent = `${entries.length} ChatGPT models added to draft; Save settings to apply.`;
      return;
    }
    const entry = { id: `entry_${crypto.randomUUID()}`, provider, modelId: "" };
    catalog.entries.push(entry);
    renderCatalog();
    byId(`${entry.id}-modelId`).focus();
  });
}

let savedMemory = {};
function renderHistory() {
  const choice = byId("history-limited");
  const date = byId("GARMIN_HISTORY_START_DATE");
  if (!choice || !date) return;
  const unavailable =
    busy || Boolean(firstRun && onboarding?.settingsCommitted);
  choice.disabled = unavailable;
  date.closest("label").hidden = !choice.checked;
  date.disabled = unavailable || !choice.checked;
  date.required = choice.checked;
  const value = date.value;
  const parsed = new Date(`${value}T00:00:00Z`);
  const valid =
    !value ||
    (Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      parsed <= new Date());
  date.setCustomValidity(
    choice.checked && !valid
      ? "Enter a calendar date no later than today (YYYY-MM-DD)."
      : "",
  );
}
function renderMemory() {
  const on = byId("SUMMARY_ENABLED").value === "true";
  const changed = Object.entries(savedMemory).some(
    ([key, value]) => byId(key).value !== value,
  );
  byId("memory-draft").textContent = firstRun
    ? `Draft: ${on ? "On" : "Off"}. Finish applies these settings.`
    : `Draft: ${on ? "On" : "Off"}. Saved startup setting: ${savedMemory.SUMMARY_ENABLED === "true" ? "On" : "Off"}. ${changed ? "Unsaved changes. " : ""}Save, then quit and reopen to apply memory changes.`;
}

function fieldValues() {
  // Visibility and disabled state never decide persistence. Empty explicit values
  // reach the validator instead of silently resetting a custom model to default.
  // Only the explicit history-mode choice decides whether its date is active.
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.key === "GARMIN_HISTORY_START_DATE" &&
      !byId("history-limited").checked
        ? ""
        : byId(field.key).value,
    ]),
  );
}
function retainDraft(values) {
  renderSummaryModels(values.SUMMARY_MODEL);
  for (const field of fields) byId(field.key).value = values[field.key];
  byId("history-limited").checked = Boolean(values.GARMIN_HISTORY_START_DATE);
  renderHistory();
  renderConnection();
  renderMemory();
}
function revealInvalid(event) {
  for (
    let parent = event.target.parentElement;
    parent;
    parent = parent.parentElement
  )
    if (parent.tagName === "DETAILS") parent.open = true;
}

function renderStep() {
  const wizard = firstRun;
  const committed = wizard && onboarding?.settingsCommitted;
  if (committed) step = 3;
  byId("wizard").hidden = !wizard;
  byId("database-choice").hidden = !wizard;
  byId("step-heading").textContent = [
    "Local data",
    "Provider",
    "Connect Garmin or continue without Garmin",
    "Review",
  ][step];
  byId("data-step").hidden = wizard && step !== 0;
  byId("normal").hidden = wizard && step !== 1;
  byId("garmin-fields").hidden = wizard && step !== 2;
  byId("review").hidden = !wizard || step !== 3;
  byId("back").hidden = !wizard || step === 0 || committed;
  byId("next").hidden = !wizard || step === 3 || committed;
  byId("save").hidden = legacyRequired || (wizard && step !== 3);
  byId("migration").hidden = !legacyRequired;
  byId("save").textContent = wizard
    ? onboarding?.settingsCommitted
      ? "Retry opening saved Trainer"
      : "Finish and open Trainer"
    : "Save settings";
  byId("memory-section").hidden = wizard && step !== 3;
  byId("auto-sync-options").hidden = wizard && step !== 3;
  byId("history-options").hidden = wizard && step !== 3;
  renderMemory();
  renderHistory();
  byId("review-summary").textContent =
    `${byId("database-selection").value === "create-new" ? "Create new" : "Use existing"} database. Chat catalog: ${catalog.entries.length} entries (choose a model explicitly in Trainer). Garmin: ${garminDraftSummary()}. Memory: ${byId("SUMMARY_ENABLED").value === "true" ? "On" : "Off"}. Database committed: ${Boolean(onboarding?.databaseCommitted)}. Settings committed: ${Boolean(onboarding?.settingsCommitted)}.`;
}
function garminDraft() {
  const state = keyStates.get(GARMIN_SLOT);
  return state?.intent ?? "unchanged";
}
function garminDraftSummary() {
  const intent = garminDraft();
  if (intent === "replace") return "new key pending Finish";
  if (intent === "clear") return "key removal pending Finish";
  return garminStatus === "configured"
    ? "key saved"
    : "not connected (connect later in Settings)";
}
function renderConnection() {
  const intent = garminDraft();
  const pending = firstRun ? "Finish" : "Save, then quit and reopen";
  byId("connection-status").textContent =
    intent === "replace"
      ? `New key entered — pending ${pending}. Not yet checked with Garmin; the running connection is unchanged.`
      : intent === "clear"
        ? `Key removal pending ${pending}. Saved history stays available.`
        : garminStatus === "configured"
          ? "Key saved — not checked by opening Settings. Sync or Garmin maintenance → Verify connection checks it explicitly."
          : garminStatus === "reconnect-required"
            ? "Reconnect needed: Garmin access now uses your own official Personal API key. Your saved history and earlier connection files are kept unchanged."
            : "Not connected. Connect now or later; chat and offline history remain available.";
  byId("connect").textContent =
    garminStatus === "configured" ? "Replace Garmin key" : "Connect Garmin";
  renderGarminPresentation();
}
function renderGarminPresentation() {
  const focused = document.activeElement;
  const visible = garminOpen || garminDraft() !== "unchanged";
  byId("garmin-key-section").hidden = !visible;
  byId("connect").hidden = visible;
  byId("connect").disabled = busy;
  byId("connect-later").hidden = !firstRun && !visible;
  byId("connect-later").textContent = firstRun
    ? garminDraft() === "replace" || garminStatus === "configured"
      ? "Continue"
      : "Continue without Garmin"
    : "Back — keep saved connection";
  byId("connect-later").disabled = busy;
  byId("garmin-key-link").toggleAttribute("aria-disabled", busy);
  if (byId("garmin-fields").contains(focused) && focused.closest("[hidden]"))
    byId("connection-status").focus();
}
function setBusy(value) {
  busy = value;
  byId("settings").setAttribute("aria-busy", String(value));
  const committed = firstRun && onboarding?.settingsCommitted;
  for (const element of document.querySelectorAll(
    "#settings input, #settings select, #settings button",
  ))
    if (element.id !== "cancel")
      element.disabled = value || (committed && element.id !== "save");
  for (const slot of slots) renderKey(slot);
  renderKey(GARMIN_SLOT);
  for (const add of document.querySelectorAll(".catalog-add"))
    add.disabled = value || committed || catalog.entries.length >= 32;
  renderHistory();
  renderGarminPresentation();
  renderChatgpt();
}
async function reconcileOnboarding() {
  onboarding = await invoke("read_onboarding");
  if (onboarding?.databaseCommitted)
    byId("DATABASE_PATH").value = onboarding.database;
  renderStep();
}

function clearSecrets() {
  clearKeyDrafts();
  clearGarminDraft();
}
async function refresh() {
  closeRestart();
  clearSecrets();
  chatgptSelectionMade = false;
  try {
    const saved = await invoke("read_settings");
    if (!saved.chatCatalog || typeof saved.revision !== "string")
      throw new Error("Unsupported settings snapshot");
    catalog = { ...structuredClone(saved.chatCatalog), defaultEntryId: null };
    savedChatgptEntries = catalog.entries.filter(
      (entry) => entry.provider === "chatgpt",
    );
    loadedRevision = saved.revision;
    await refreshChatgpt();
    renderCatalog();
    onboarding = await invoke("read_onboarding");
    legacyRequired = saved.storage === "legacy-required";
    byId("storage-status").textContent = legacyRequired
      ? "Storage: legacy settings preserved. Explicit adoption or private re-entry required."
      : "";
    firstRun = Boolean(onboarding?.eligible && !saved.running);
    garminStatus = saved.garmin;
    for (const field of fields) {
      const input = byId(field.key);
      const value =
        saved.fields[field.key] ?? field.default ?? field.options?.[0] ?? "";
      if (field.key === "SUMMARY_MODEL") renderSummaryModels(value);
      if (
        field.key !== "SUMMARY_MODEL" &&
        field.options &&
        !field.options.includes(value)
      ) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = "Unsupported saved value — change explicitly";
        input.append(option);
      }
      input.value = value;
    }
    // Nonempty invalid saved dates stay in Limited mode and require correction.
    byId("history-limited").checked = Boolean(
      saved.fields.GARMIN_HISTORY_START_DATE,
    );
    renderHistory();
    savedMemory = Object.fromEntries(
      ["SUMMARY_ENABLED", "SUMMARY_MODEL", "SUMMARY_CHAR_LIMIT"].map((key) => [
        key,
        byId(key).value,
      ]),
    );
    resetKeys(saved.keys);
    resetGarminKey(saved.garmin);
    renderSummaryModels();
    if (firstRun && !saved.saved) {
      byId("DATABASE_PATH").value = onboarding.database;
    }
    byId("catalog-migration").hidden = ![
      "catalog-migration-required",
      "legacy-required",
    ].includes(saved.storage);
    renderStep();
    renderConnection();
    status.textContent = firstRun
      ? "First run: choose new or existing data, configure a provider, connect Garmin now or later, then Finish and open Trainer."
      : saved.saved
        ? `Saved settings loaded; keys are masked. ${saved.activation || "Live status unknown; no automatic retry."}`
        : "Existing installation recovery: settings are inaccessible or unsupported. Preserve them and reopen with a compatible build; no blank-install overwrite.";
    showChatgptWelcome();
    return true;
  } catch {
    loadedRevision = null;
    resetKeys(null);
    resetGarminKey(null);
    status.textContent =
      "Saved settings are invalid or inaccessible. Check private settings permissions/version; no env fallback or key readback. Original data is unchanged.";
    return false;
  }
}
function createField(field) {
  const label = document.createElement("label");
  label.textContent = field.label;
  const input = document.createElement(field.options ? "select" : "input");
  input.id = field.key;
  if (field.options) {
    for (const value of field.options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent =
        {
          GARMIN_AUTO_SYNC: { true: "On", false: "Off" },
          MEMORY_ENABLED: { true: "On", false: "Off" },
          SUMMARY_ENABLED: { true: "On", false: "Off" },
          SUMMARY_MODEL: {
            unselected: "Unselected",
            "gpt-6-luna": "OpenAI · gpt-6-luna",
          },
          MEMORY_EMBEDDING_PROVIDER: {
            openai: "OpenAI-compatible",
            ollama: "Local Ollama",
            deterministic: "Deterministic (test only)",
          },
          MEMORY_EXTRACTION_MODE: {
            llm: "Cloud AI with rule-based fallback",
            deterministic: "Local rules only",
            off: "Off — no new ingestion",
          },
        }[field.key]?.[value] ?? value;
      input.append(option);
    }
  } else {
    input.type = field.type === "number" ? "number" : "text";
    if (field.type === "date") {
      // WebKit can paint today's date in an empty native date editor even while
      // valueMissing is true. Literal ISO text keeps the empty state unambiguous
      // and preserves invalid saved text for correction, never a manufactured date.
      input.placeholder = "YYYY-MM-DD";
      input.pattern = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
      input.maxLength = 10;
      input.addEventListener("input", renderHistory);
      input.addEventListener("change", renderHistory);
    }
    if (field.type === "number") {
      input.required = true;
      input.min =
        field.key === "SUMMARY_CHAR_LIMIT"
          ? "1000"
          : field.key === "MEMORY_EMBEDDING_DIMS"
            ? "8"
            : "1";
      input.max =
        field.key === "SUMMARY_CHAR_LIMIT"
          ? "20000"
          : field.key === "MEMORY_EMBEDDING_DIMS"
            ? "65536"
            : "300000";
      input.step = "1";
    }
    if (field.key.endsWith("_MODEL")) input.required = true;
    input.autocomplete = "off";
    // Paths/model identifiers are literal configuration, not prose. WebKit's
    // automatic capitalization/correction must not change what the user enters.
    input.autocapitalize = "off";
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
  }
  const preserved = field.legacy;
  if (preserved) {
    if (!field.options) input.type = "hidden";
    label.hidden = true;
  }
  label.append(input);
  if (field.key.startsWith("SUMMARY_")) {
    input.addEventListener("input", renderMemory);
    input.addEventListener("change", renderMemory);
  }
  const help = {
    SUMMARY_ENABLED: "memory-off-help",
    SUMMARY_MODEL: "memory-model-help",
    SUMMARY_CHAR_LIMIT: "memory-size-help",
    GARMIN_AUTO_SYNC: "auto-sync-help",
    GARMIN_HISTORY_START_DATE: "history-help",
  }[field.key];
  if (help) input.setAttribute("aria-describedby", help);
  const parent = byId(
    preserved
      ? "preserved-fields"
      : field.key.startsWith("SUMMARY_")
        ? "memory-control"
        : field.key === "OLLAMA_BASE_URL"
          ? "catalog-ollama-config"
          : field.key === "GARMIN_AUTO_SYNC"
            ? "auto-sync-options"
            : field.key === "GARMIN_HISTORY_START_DATE"
              ? "history-options"
              : field.key === "DATABASE_PATH"
                ? "data-fields"
                : "normal",
  );
  parent.append(label);
  if (help && field.key.startsWith("SUMMARY_")) parent.append(byId(help));
  if (["path", "directory"].includes(field.type)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Choose…";
    button.addEventListener("click", async () => {
      try {
        const selected = await invoke("choose_path", { kind: field.type });
        if (selected) input.value = selected;
      } catch {
        status.textContent = "Path selection unavailable. No settings changed.";
      }
    });
    parent.append(button);
  }
}
async function initialize() {
  closeRestart();
  fields = await fetch("settings-fields.json").then((response) =>
    response.json(),
  );
  fields.forEach(createField);
  for (const slot of slots) {
    const label = document.createElement("label");
    label.textContent = slot.replace("_API_KEY", "");
    const state = document.createElement("span");
    state.id = `${slot}-status`;
    label.append(state);
    state.setAttribute("aria-live", "polite");
    const input = document.createElement("input");
    input.type = "password";
    input.id = slot;
    input.autocomplete = "new-password";
    input.autocapitalize = "off";
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.disabled = true;
    input.setAttribute("aria-describedby", `${slot}-status`);
    input.addEventListener("input", () => editKey(slot));
    input.addEventListener("keydown", (event) => {
      if (["Backspace", "Delete"].includes(event.key))
        deleteKeyPresence(slot, event);
    });
    input.addEventListener("beforeinput", (event) => {
      if (event.inputType?.startsWith("delete")) deleteKeyPresence(slot, event);
    });
    label.append(input);
    const provider = slot.replace("_API_KEY", "").toLowerCase();
    input.setAttribute("aria-label", `${providers[provider]} API key`);
    label.className = "provider-key";
    byId(`catalog-${provider}-config`).append(label);
  }
  const garminInput = byId(GARMIN_SLOT);
  garminInput.setAttribute("autocorrect", "off");
  garminInput.addEventListener("input", () => editKey(GARMIN_SLOT));
  garminInput.addEventListener("keydown", (event) => {
    if (["Backspace", "Delete"].includes(event.key))
      deleteKeyPresence(GARMIN_SLOT, event);
  });
  garminInput.addEventListener("beforeinput", (event) => {
    if (event.inputType?.startsWith("delete"))
      deleteKeyPresence(GARMIN_SLOT, event);
  });
  // Dynamic fields exist before asynchronous native snapshots arrive. Keep the
  // form noninteractive until the complete initial snapshot has been applied.
  setBusy(true);
  await refresh();
  setBusy(false);
  await window.__TAURI__.event.listen("desktop-status", (event) => {
    status.textContent = event.payload;
  });
  await window.__TAURI__.event.listen("desktop-settings-closed", () => {
    settingsEpoch++;
    chatgptPending = false;
    chatgptAuthorizing = false;
    chatgptContext = null;
    chatgptWelcomeRegistration = null;
    if (chatgptWelcome.open) chatgptWelcome.close();
    closeRestart();
    clearSecrets();
    garminOpen = false;
    renderConnection();
  });
  const message = await invoke("setup_status");
  if (message) status.textContent = message;
}
async function adoptProviders(readLegacy) {
  if (busy || !legacyRequired || loadedRevision === null) return;
  setBusy(true);
  const values = fieldValues();
  const catalogDraft = structuredClone(catalog);
  const keys = takeKeyUpdates();
  const garminKey = takeGarminKeyUpdate();
  status.textContent = readLegacy
    ? "Explicit adoption in progress; macOS may request access. No automatic retry."
    : "Validating private re-entry; no Keychain access.";
  try {
    const message = await invoke("adopt_provider_settings", {
      input: {
        fields: values,
        keys,
        chatCatalog: catalog,
        expectedRevision: loadedRevision,
        garminKey,
      },
      readLegacy,
    });
    await refresh();
    status.textContent = message;
  } catch (error) {
    // Reconcile commit metadata, never retry the mutation or read legacy again.
    unknownOutcome = !(await refresh());
    catalog = catalogDraft;
    renderCatalog();
    retainDraft(values);
    status.textContent =
      (typeof error === "string"
        ? error
        : "Adoption outcome unknown; originals retained.") +
      " Non-secret draft retained; review the reported configuration error. Keys were cleared from the form. " +
      (unknownOutcome
        ? "Reload failed: quit/reopen to reconcile before another write."
        : "Saved metadata reloaded; no automatic retry.");
  } finally {
    for (const slot of slots) if (keys[slot].value) keys[slot].value = "";
    if (garminKey.value) garminKey.value = "";
    clearSecrets();
    setBusy(unknownOutcome);
  }
}
byId("history-limited").addEventListener("change", renderHistory);
byId("settings").addEventListener("invalid", revealInvalid, true);
byId("adopt-provider").addEventListener("click", () => adoptProviders(true));
byId("reenter-provider").addEventListener("click", () => adoptProviders(false));
byId("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || restartDialog.open || legacyRequired || loadedRevision === null)
    return;
  if (firstRun && step !== 3) return;
  const epoch = settingsEpoch;
  const ordinarySave = !firstRun;
  const priorFocus = document.activeElement;
  let showRestart = false;
  setBusy(true);
  status.textContent = firstRun
    ? "Preparing setup and checking local configuration… Cancel retains already committed outputs."
    : "Validating settings…";
  const values = fieldValues();
  const catalogDraft = structuredClone(catalog);
  const keys = takeKeyUpdates();
  const garminKey = takeGarminKeyUpdate();
  try {
    const result = await invoke(
      firstRun ? "finish_onboarding" : "save_settings",
      {
        input: firstRun
          ? {
              id: onboarding.id,
              selection: byId("database-selection").value,
              settings: {
                fields: values,
                keys,
                chatCatalog: catalog,
                expectedRevision: loadedRevision,
                garminKey,
              },
            }
          : {
              fields: values,
              keys,
              chatCatalog: catalog,
              expectedRevision: loadedRevision,
              garminKey,
            },
      },
    );
    const refreshed = await refresh();
    const message = ordinarySave ? result.message : result;
    if (refreshed) {
      status.textContent = message;
      showRestart = ordinarySave && result.restartRequired === true;
    } else {
      unknownOutcome = true;
      status.textContent = `${message} Saved metadata reload failed; quit/reopen to reconcile before another write.`;
    }
  } catch (error) {
    if (firstRun) {
      // Errors are native allowlisted messages, never vendor output/secret values.
      status.textContent =
        typeof error === "string"
          ? error
          : "Setup result unknown. Inspect native commit state; do not blindly retry.";
      try {
        await reconcileOnboarding();
      } catch {
        status.textContent +=
          " Native operation still unknown: quit/reopen explicitly to reconcile; do not repeat Finish.";
        unknownOutcome = true;
        return;
      }
    } else {
      unknownOutcome = !(await refresh());
      catalog = catalogDraft;
      renderCatalog();
      retainDraft(values);
      status.textContent =
        (typeof error === "string"
          ? error
          : "Save outcome unknown; saved and live state must be reconciled before another action.") +
        " Non-secret draft retained; review the reported configuration error. Keys were cleared from the form. " +
        (unknownOutcome
          ? "Reload failed: quit/reopen to reconcile before another write."
          : "Saved metadata reloaded; no automatic retry.");
    }
  } finally {
    for (const slot of slots) if (keys[slot].value) keys[slot].value = "";
    if (garminKey.value) garminKey.value = "";
    clearKeyDrafts();
    clearGarminDraft();
    garminOpen = false;
    renderConnection();
    setBusy(unknownOutcome);
  }
  if (showRestart && epoch === settingsEpoch && !restartDialog.open) {
    restartFocus =
      priorFocus instanceof HTMLElement && priorFocus !== document.body
        ? priorFocus
        : byId("save");
    restartDialog.showModal();
    byId("restart-dismiss").focus();
  }
});
byId("back").addEventListener("click", () => {
  if (!busy && step > 0) {
    step--;
    renderStep();
    byId("step-heading").focus();
  }
});
byId("next").addEventListener("click", () => {
  if (!busy && step < 3) {
    step++;
    renderStep();
    byId("step-heading").focus();
  }
});
byId("database-selection").addEventListener("change", () => {
  status.textContent =
    byId("database-selection").value === "create-new"
      ? "Create new never overwrites an existing file, sidecar or writer lease. A custom destination needs an existing owner-private parent."
      : "Select an existing current-schema database; missing, old or owned targets are refused, never initialized.";
});
byId("cancel").addEventListener("click", async () => {
  if (chatgptPending) {
    settingsEpoch++;
    try {
      await invoke("chatgpt_action", {
        action: "cancel",
        registrationId: null,
        context: chatgptContext,
      });
    } catch {
      byId("chatgpt-status").textContent =
        "Cancellation outcome unknown. Wait for settlement or quit; saved connections are retained.";
      return;
    }
    chatgptPending = false;
    chatgptAuthorizing = false;
    chatgptContext = null;
    setBusy(false);
  }
  if (busy && firstRun) {
    status.textContent =
      "Cancellation requested. Wait for the operation to settle; committed database/settings remain saved.";
    try {
      await invoke("cancel_onboarding", { id: onboarding.id });
    } catch {
      status.textContent =
        "Cancellation outcome unknown. Quit to stop owned work; inspect retained state before retry.";
    }
    return;
  }
  garminOpen = false;
  const reconciled = await refresh();
  if (!reconciled) return;
  unknownOutcome = false;
  setBusy(false);
  step = 0;
  renderStep();
  status.textContent =
    "Edits cancelled. Saved settings and current backend unchanged; any independently committed database is retained.";
});
byId("connect").addEventListener("click", () => {
  if (busy) return;
  garminOpen = true;
  renderConnection();
  byId(GARMIN_SLOT).focus();
});
byId("connect-later").addEventListener("click", () => {
  if (busy) return;
  const keep = !firstRun || garminDraft() === "unchanged";
  // Back discards only the Garmin key draft; the saved connection is unchanged.
  if (!firstRun) clearGarminDraft();
  garminOpen = false;
  renderConnection();
  if (firstRun && step === 2) {
    step = 3;
    renderStep();
    byId("step-heading").focus();
  } else byId("connect").focus();
  status.textContent = keep
    ? "Garmin connection unchanged; chat and offline history remain available."
    : "";
});
byId("garmin-key-link").addEventListener("click", async (event) => {
  event.preventDefault();
  if (busy) return;
  try {
    await invoke("open_garmin_key_page");
    status.textContent =
      "Opened Garmin Connect in your browser. Create the key there, then paste it here.";
  } catch {
    status.textContent =
      "Garmin key page could not open. Visit connect.garmin.com → Settings → Personal API key in your browser.";
  }
});
initialize().catch(() => {
  status.textContent =
    "Native settings unavailable. Quit and rebuild/reopen; no data was changed.";
});
