const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const slots = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
let fields = [];
let session = null;
let authTimer = null;
let successfulDestination = "";
let tokenSelection = "";
let savedTokenSelection = "";
let authEpoch = 0;
let authPending = false;
let authOpen = false;
let onboarding = null;
let firstRun = false;
let step = 0;
let busy = false;
let unknownOutcome = false;
let legacyRequired = false;
let catalog = { version: 1, entries: [], defaultEntryId: null };
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
function renderKey(slot) {
  const state = keyStates.get(slot);
  const input = byId(slot);
  input.placeholder =
    state?.present && state.intent === "unchanged"
      ? keyPresence
      : "Enter API key";
  input.disabled = catalogLocked() || !state?.available;
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
  if (catalogLocked() || !state?.available) return;
  state.replacement = byId(slot).value;
  state.intent = state.replacement
    ? "replace"
    : state.present
      ? "clear"
      : "unchanged";
  renderKey(slot);
  renderSummaryModels();
}
function deleteKeyPresence(slot, event) {
  const state = keyStates.get(slot);
  if (
    catalogLocked() ||
    !state?.available ||
    !state.present ||
    state.intent !== "unchanged"
  )
    return;
  event.preventDefault();
  state.intent = "clear";
  renderKey(slot);
  renderSummaryModels();
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
  return `ChatGPT plan · ${index < 0 ? "unavailable account" : `account ${index + 1}`} / ${name}`;
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
    const added = catalog.entries.some(
      (entry) =>
        entry.provider === "chatgpt" &&
        entry.registrationId === connection?.id &&
        entry.modelId === input.value,
    );
    input.disabled =
      catalogLocked() || chatgptPending || !connection?.planEnabled || added;
    if (added) input.checked = false;
    input.closest("label").querySelector(".chatgpt-model-note").textContent =
      added ? "Already in catalog" : "";
  }
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
      ? `${selected.length} selected; only ${remaining} catalog slots available. Deselect models before adding; nothing will be added partially.`
      : `${selected.length} selected${inputs.length ? "" : " — refresh models to load available choices"}.`;
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
function renderChatgpt(message) {
  const input = byId("chatgpt-account");
  const selected = input.value;
  input.replaceChildren(
    ...[
      {
        id: "",
        label: chatgptConnections.length
          ? "Connect another account…"
          : "Connect a ChatGPT account",
      },
      ...chatgptConnections,
    ].map((connection) => {
      const option = document.createElement("option");
      option.value = connection.id;
      option.textContent = connection.label;
      return option;
    }),
  );
  input.value =
    (chatgptSelectionMade || chatgptConnections.length === 1) &&
    chatgptConnections.some((connection) => connection.id === selected)
      ? selected
      : !chatgptSelectionMade && chatgptConnections.length === 1
        ? chatgptConnections[0].id
        : "";
  const connection = selectedChatgpt();
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
    ...(connection?.models ?? []).map((model) => {
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
  byId("chatgpt-models").hidden = !connection?.planEnabled;
  byId("chatgpt-disconnect").hidden = !connection;
  for (const id of [
    "chatgpt-connect",
    "chatgpt-consent",
    "chatgpt-models",
    "chatgpt-disconnect",
    "chatgpt-usage",
  ])
    byId(id).disabled =
      busy ||
      chatgptPending ||
      chatgptContext === null ||
      (id !== "chatgpt-connect" && id !== "chatgpt-usage" && !connection);
  byId("chatgpt-consent").hidden = !connection || connection.planEnabled;
  byId("chatgpt-models").disabled ||= !connection?.planEnabled;
  byId("chatgpt-cancel").hidden = !chatgptPending || !chatgptAuthorizing;
  byId("chatgpt-cancel").disabled = !chatgptPending || !chatgptAuthorizing;
  byId("chatgpt-status").textContent =
    message ??
    (connection
      ? `${connection.label} — ${connection.state === "connected" ? "plan permission enabled" : connection.state === "identity-only" ? "signed in; plan permission required" : connection.state === "reconnect-required" ? "reconnect required" : connection.state === "unavailable" ? "connection state unavailable; reload before retry" : "disconnected"}.`
      : "Choose a saved registration or continue in your system browser.");
  byId("chatgpt-connect").hidden = Boolean(
    connection && connection.state === "connected",
  );
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
    renderChatgpt();
    return true;
  } catch {
    if (read !== chatgptRead || epoch !== settingsEpoch) return false;
    chatgptContext = context;
    chatgptConnections = [];
    renderChatgpt(
      "Connection status unavailable. Reload before choosing a registration; no paid fallback.",
    );
    return false;
  }
}
async function chatgptOperation(operation) {
  if (chatgptPending || busy || chatgptContext === null) return;
  const selection = byId("chatgpt-account").value || null;
  const previous = new Map(
    chatgptConnections.map((connection) => [connection.id, connection.epoch]),
  );
  const epoch = settingsEpoch;
  chatgptPending = true;
  chatgptAuthorizing = operation === "connect" || operation === "consent";
  const context = chatgptContext;
  setBusy(true);
  renderChatgpt(
    operation === "connect" || operation === "consent"
      ? "Complete sign-in privately in your system browser. This attempt expires in three minutes."
      : "Updating the selected ChatGPT registration…",
  );
  let message;
  let connectedRegistration = null;
  try {
    const result =
      operation === "connect" || operation === "consent"
        ? await invoke("chatgpt_connect", {
            registrationId: selection,
            consent: operation === "consent",
            context,
          })
        : await invoke("chatgpt_action", {
            action: operation,
            registrationId: selection,
            context,
          });
    if (operation === "connect" || operation === "consent") {
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
        } else if (
          (operation === "connect" || operation === "consent") &&
          changed.length === 1
        ) {
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
      field.key === "GARMIN_MCP_TOKEN_DIR"
        ? tokenSelection
        : field.key === "GARMIN_HISTORY_START_DATE" &&
            !byId("history-limited").checked
          ? ""
          : byId(field.key).value,
    ]),
  );
}
function retainDraft(values) {
  tokenSelection = values.GARMIN_MCP_TOKEN_DIR ?? "";
  renderSummaryModels(values.SUMMARY_MODEL);
  for (const field of fields)
    if (field.key !== "GARMIN_MCP_TOKEN_DIR")
      byId(field.key).value = values[field.key];
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
  byId("history-options").hidden = wizard && step !== 3;
  renderMemory();
  renderHistory();
  byId("review-summary").textContent =
    `${byId("database-selection").value === "create-new" ? "Create new" : "Use existing"} database. Chat catalog: ${catalog.entries.length} entries (choose a model explicitly in Trainer). Garmin: ${tokenSelection ? "connection selected (activation on Finish)" : "not connected"}. Memory: ${byId("SUMMARY_ENABLED").value === "true" ? "On" : "Off"}. Database committed: ${Boolean(onboarding?.databaseCommitted)}. Settings committed: ${Boolean(onboarding?.settingsCommitted)}.`;
}
function renderConnection() {
  const verified = tokenSelection && tokenSelection === successfulDestination;
  byId("connection-status").textContent = verified
    ? `Connected — verified during this sign-in only. ${tokenSelection === savedTokenSelection ? "Saved for next explicit launch" : `Pending ${firstRun ? "Finish" : "Save and next explicit launch"}`}; current backend unchanged.`
    : tokenSelection
      ? "Configured — not verified. Saved connection preserved; no network probe performed."
      : "Not connected. Connect now or later; chat and offline history remain available.";
  byId("connect").textContent = tokenSelection
    ? "Reconnect Garmin"
    : "Connect Garmin";
  renderAuthPresentation();
}
function renderAuthPresentation() {
  const focused = document.activeElement;
  const active = authActive();
  const selected = Boolean(
    session?.destination && tokenSelection === session.destination,
  );
  const visible = authOpen && !selected;
  byId("auth-section").hidden = !visible;
  byId("connect-later").hidden = !firstRun && !visible;
  byId("connect-later").textContent = firstRun
    ? tokenSelection
      ? "Continue with selected connection"
      : "Continue without Garmin"
    : tokenSelection
      ? "Back — keep current connection"
      : "Back";
  byId("connection-status").hidden = visible;
  byId("connect").hidden =
    visible && !["failed", "cancelled"].includes(session?.state);
  byId("connect").disabled = busy || authPending || active;
  byId("connect-later").disabled = busy || authPending || active;
  byId("auth").hidden = !visible || authPending || Boolean(session);
  byId("mfa-form").hidden = !visible || session?.state !== "needs-mfa";
  byId("sign-in").disabled = busy || authPending || active;
  byId("email").disabled = byId("password").disabled =
    busy || authPending || active || byId("auth").hidden;
  byId("mfa").disabled = busy || byId("mfa-form").hidden;
  byId("auth-cancel").hidden = !visible || !active;
  byId("auth-cancel").disabled = busy || !active;
  byId("use-tokens").hidden =
    !visible || session?.state !== "succeeded" || !session.destination;
  byId("auth-status").hidden = !visible || (!session && !authPending);
  // Move focus only when this projection retires the focused Garmin control.
  if (byId("garmin-fields").contains(focused) && focused.closest("[hidden]")) {
    const target = !visible
      ? byId("connection-status")
      : session?.state === "needs-mfa"
        ? byId("mfa")
        : byId("auth-status");
    target.focus();
  }
}
function setBusy(value) {
  busy = value;
  byId("settings").setAttribute("aria-busy", String(value));
  const committed = firstRun && onboarding?.settingsCommitted;
  for (const element of document.querySelectorAll(
    "#settings input, #settings select, #settings button, #auth-section input, #auth-section button",
  ))
    if (element.id !== "cancel")
      element.disabled = value || (committed && element.id !== "save");
  for (const slot of slots) renderKey(slot);
  for (const add of document.querySelectorAll(".catalog-add"))
    add.disabled = value || committed || catalog.entries.length >= 32;
  renderHistory();
  renderAuthPresentation();
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
  clearAuthSecrets();
}
function clearAuthSecrets() {
  for (const id of ["email", "password", "mfa"]) byId(id).value = "";
}
function showAuth(value) {
  const previousState = session?.state;
  session = value;
  const active =
    value &&
    ["authenticating", "needs-mfa", "submitting-mfa", "verifying"].includes(
      value.state,
    );
  byId("sign-in").disabled = busy || Boolean(active);
  byId("connect").disabled = busy || Boolean(active);
  byId("auth-cancel").disabled = !active;
  byId("email").disabled = byId("password").disabled = Boolean(active);
  byId("mfa-form").hidden = value?.state !== "needs-mfa";
  const failures = {
    "credentials-rejected":
      "Reconnect needed: Garmin rejected this sign-in. Check credentials privately before another explicit attempt; saved connection unchanged.",
    "mfa-rejected":
      "Garmin rejected the MFA code. No second submission or automatic retry; saved connection unchanged.",
    "unsupported-challenge":
      "This account challenge is unsupported or repeated. No bypass or automatic retry.",
    "auth-unavailable":
      "Authentication could not start or finish; its cause is unknown. See README Installation for uv/Python setup and recovery. No automatic retry; saved connections and offline data remain available.",
    "network-service":
      "Network or Garmin service unavailable. This does not establish credential expiry; try later explicitly.",
    "rate-limited":
      "Garmin rate limit reached. Wait before another explicit attempt; this does not establish credential expiry.",
    timeout:
      "Sign-in timed out after its bounded deadline. No automatic retry; saved connection unchanged.",
    "publication-refused":
      "Private publication refused or outcome uncertain. Original stores preserved; independently committed new tokens may remain. Reconcile native state before another explicit attempt.",
    "protocol-refused":
      "Authentication protocol refused. No automatic retry; saved connection unchanged.",
  };
  byId("auth-status").textContent =
    value?.state === "failed"
      ? failures[value.code] ||
        "Authentication unavailable. No automatic retry; saved connection unchanged."
      : value
        ? `Sign-in: ${value.state}.`
        : "Idle. No automatic login attempts.";
  if (!active) {
    clearTimeout(authTimer);
    authTimer = null;
    clearAuthSecrets();
  }
  renderAuthPresentation();
  if (value?.state === "succeeded" && value.destination) {
    successfulDestination = value.destination;
    byId("auth-status").textContent =
      `Connected — authenticated tokens verified during this sign-in and saved privately, not a guarantee of future validity. Choose Use this verified connection, then ${firstRun ? "Review and Finish" : "Save and explicitly quit/reopen"}. The running account is unchanged.`;
  }
  if (
    authOpen &&
    value?.state !== previousState &&
    byId("garmin-fields").contains(document.activeElement)
  ) {
    if (value?.state === "needs-mfa") byId("mfa").focus();
    else if (value?.state === "succeeded") byId("use-tokens").focus();
  }
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
    loadedRevision = saved.revision;
    await refreshChatgpt();
    renderCatalog();
    onboarding = await invoke("read_onboarding");
    legacyRequired = saved.storage === "legacy-required";
    byId("storage-status").textContent = legacyRequired
      ? "Storage: legacy settings preserved. Explicit adoption or private re-entry required."
      : "";
    firstRun = Boolean(onboarding?.eligible && !saved.running);
    savedTokenSelection = tokenSelection =
      saved.fields.GARMIN_MCP_TOKEN_DIR ?? "";
    for (const field of fields) {
      if (field.key === "GARMIN_MCP_TOKEN_DIR") continue;
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
    status.textContent =
      "Saved settings are invalid or inaccessible. Check private settings permissions/version; no env fallback or key readback. Original data is unchanged.";
    return false;
  }
}
function createField(field) {
  // Decoder/activation inventory remains compatible; no manual token control.
  if (field.key === "GARMIN_MCP_TOKEN_DIR") return;
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
  const preserved = field.legacy || field.key.endsWith("_COMMAND");
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
    authEpoch++;
    authPending = false;
    successfulDestination = "";
    clearSecrets();
    authOpen = false;
    showAuth(null);
  });
  const message = await invoke("setup_status");
  if (message) status.textContent = message;
}
async function adoptProviders(readLegacy) {
  if (
    busy ||
    !legacyRequired ||
    loadedRevision === null ||
    authPending ||
    authActive()
  )
    return;
  setBusy(true);
  const values = fieldValues();
  const catalogDraft = structuredClone(catalog);
  const keys = takeKeyUpdates();
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
  if (
    busy ||
    restartDialog.open ||
    legacyRequired ||
    loadedRevision === null ||
    authPending ||
    authActive()
  )
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
              },
            }
          : {
              fields: values,
              keys,
              chatCatalog: catalog,
              expectedRevision: loadedRevision,
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
    clearKeyDrafts();
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
      "Cancellation requested. Wait for the operation to settle; committed database/settings/tokens remain saved.";
    try {
      await invoke("cancel_onboarding", { id: onboarding.id });
    } catch {
      status.textContent =
        "Cancellation outcome unknown. Quit to stop owned work; inspect retained state before retry.";
    }
    return;
  }
  authEpoch++;
  authPending = false;
  if (session) {
    try {
      showAuth(await invoke("cancel_auth", { id: session.id }));
    } catch {
      /* Already ended; no new attempt. */
    }
  }
  authOpen = false;
  successfulDestination = "";
  showAuth(null);
  const reconciled = await refresh();
  if (!reconciled) return;
  unknownOutcome = false;
  setBusy(false);
  step = 0;
  renderStep();
  status.textContent =
    "Edits cancelled. Saved settings and current backend unchanged; any independently committed database or tokens are retained.";
});
function authActive() {
  return [
    "authenticating",
    "needs-mfa",
    "submitting-mfa",
    "verifying",
  ].includes(session?.state);
}
function currentAuth(epoch, id) {
  return epoch === authEpoch && session?.id === id;
}
async function pollAuth(epoch, id) {
  if (!currentAuth(epoch, id) || !authActive()) return;
  try {
    const value = await invoke("auth_status");
    if (!currentAuth(epoch, id) || value?.id !== id) return;
    showAuth(value);
    if (authActive()) authTimer = setTimeout(() => pollAuth(epoch, id), 500);
  } catch {
    if (!currentAuth(epoch, id)) return;
    byId("auth-status").textContent =
      "Native auth status unavailable. Cancel this session or quit to stop owned authentication; no automatic retry.";
  }
}
byId("connect").addEventListener("click", () => {
  if (busy || authPending || authActive()) return;
  if (tokenSelection && tokenSelection === session?.destination) showAuth(null);
  else if (session?.state !== "succeeded") showAuth(null);
  authOpen = true;
  renderAuthPresentation();
  (session?.state === "succeeded" ? byId("use-tokens") : byId("email")).focus();
});
byId("connect-later").addEventListener("click", () => {
  if (busy || authPending || authActive()) return;
  clearAuthSecrets();
  authOpen = false;
  renderAuthPresentation();
  if (firstRun && step === 2) {
    step = 3;
    renderStep();
    byId("step-heading").focus();
  }
  status.textContent =
    "No new sign-in. Current connection selection and provider draft preserved; chat and offline history remain available.";
});
byId("garmin-auth").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || authPending || authActive()) return;
  const epoch = ++authEpoch;
  authPending = true;
  byId("auth-status").textContent =
    "Starting private sign-in… Outcome not yet known.";
  renderAuthPresentation();
  const input = {
    email: byId("email").value,
    password: byId("password").value,
  };
  clearAuthSecrets();
  try {
    const value = await invoke("start_auth", input);
    if (epoch !== authEpoch) {
      // Closing/cancelling while start was in flight must not leak an active worker.
      await invoke("cancel_auth", { id: value.id });
      return;
    }
    authPending = false;
    showAuth(value);
    if (authActive())
      authTimer = setTimeout(() => pollAuth(epoch, value.id), 500);
  } catch (error) {
    if (epoch !== authEpoch) return;
    const dependency = new Map([
      [
        "dependency-uv-unavailable",
        "Sign-in cannot execute uv or its configured override. See README Installation to manage external tools, then explicitly retry. Saved connections and offline data remain available.",
      ],
      [
        "dependency-python-unavailable",
        "Sign-in requires installed Python 3.12; none was found by the selected uv. See README Installation to manage Python separately, then explicitly retry. Saved connections and offline data remain available.",
      ],
    ]).get(typeof error === "string" ? error : "");
    if (dependency) {
      // These native refusals precede worker creation; retry is explicit, not automatic.
      authPending = false;
      renderAuthPresentation();
    }
    // Other refusal/interruption remains ambiguous; do not start another login blindly.
    byId("auth-status").textContent =
      dependency ||
      "Sign-in could not start or its outcome is unknown. Check uv/Python and app-private storage; quit/reopen to reconcile before another attempt. Existing connections are preserved.";
  } finally {
    input.email = input.password = "";
  }
});
byId("garmin-mfa").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (session?.state !== "needs-mfa" || busy) return;
  const { id } = session;
  const epoch = ++authEpoch;
  clearTimeout(authTimer);
  const code = byId("mfa").value;
  clearAuthSecrets();
  showAuth({ ...session, state: "submitting-mfa" });
  try {
    const value = await invoke("submit_mfa", { id, code });
    if (currentAuth(epoch, id) && value?.id === id) {
      showAuth(value);
      if (authActive()) authTimer = setTimeout(() => pollAuth(epoch, id), 500);
    }
  } catch {
    if (currentAuth(epoch, id))
      byId("auth-status").textContent =
        "MFA submission refused or outcome unknown. Cancel or quit; do not submit again.";
  }
});
byId("auth-cancel").addEventListener("click", async () => {
  if (!session || !authActive()) return;
  const { id } = session;
  const epoch = ++authEpoch;
  clearTimeout(authTimer);
  clearAuthSecrets();
  try {
    const value = await invoke("cancel_auth", { id });
    if (currentAuth(epoch, id) && value?.id === id) showAuth(value);
  } catch {
    if (currentAuth(epoch, id))
      byId("auth-status").textContent =
        "Cancellation unavailable. Quit to stop owned authentication; do not retry login.";
  }
});
byId("use-tokens").addEventListener("click", () => {
  if (
    busy ||
    authPending ||
    session?.state !== "succeeded" ||
    !successfulDestination ||
    session.destination !== successfulDestination
  )
    return;
  tokenSelection = successfulDestination;
  renderConnection();
  renderStep();
  authOpen = false;
  renderAuthPresentation();
  byId("connection-status").focus();
  // The focused connection summary is the sole selection announcement.
  status.textContent = "";
});
initialize().catch(() => {
  status.textContent =
    "Native settings unavailable. Quit and rebuild/reopen; no data was changed.";
});
