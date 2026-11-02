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
}

const providers = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  ollama: "Ollama",
  openrouter: "OpenRouter",
};
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
  byId("catalog-limit").textContent =
    `${catalog.entries.length}/32 models${catalog.entries.length >= 32 ? " — remove a model before adding another." : ""}`;
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
          input.setAttribute("aria-describedby", `${entry.id}-error`);
          const edit = () => {
            if (catalogLocked()) return;
            const draft = catalog.entries.find(
              (value) => value.id === entry.id,
            );
            // Legacy names remain inert, untouched compatibility metadata.
            draft.modelId = input.value;
            updateCatalogControls();
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
}
for (const provider of Object.keys(providers)) {
  byId(`catalog-${provider}-add`).addEventListener("click", () => {
    if (catalogLocked() || catalog.entries.length >= 32) return;
    const entry = { id: `entry_${crypto.randomUUID()}`, provider, modelId: "" };
    catalog.entries.push(entry);
    renderCatalog();
    byId(`${entry.id}-modelId`).focus();
  });
}

let savedMemoryEnabled = "false";
let memoryRead = 0;
let memoryExpiry = null;

function invalidateMemoryStatus() {
  memoryRead++;
  clearTimeout(memoryExpiry);
  byId("memory-check").disabled =
    busy || Boolean(firstRun && onboarding?.settingsCommitted);
  byId("memory-active").textContent =
    "Active memory: unknown — read status again. Saved/draft settings do not prove runtime readiness.";
}
function renderHistory() {
  const choice = byId("history-limited");
  const date = byId("GARMIN_HISTORY_START_DATE");
  if (!choice || !date) return;
  const unavailable =
    busy || Boolean(firstRun && onboarding?.settingsCommitted);
  choice.disabled = unavailable;
  date.disabled = unavailable || !choice.checked;
  date.required = choice.checked;
}
function renderMemory() {
  const on = byId("MEMORY_ENABLED").value === "true";
  byId("memory-draft").textContent =
    `Draft: ${on ? "On" : "Off"}. Saved startup setting: ${savedMemoryEnabled === "true" ? "On" : "Off"}. ` +
    (firstRun
      ? "Finish applies the committed startup configuration."
      : "Memory topology changes need explicit quit/reopen. Shared provider-key changes can apply now; status is not a readiness check.");
  const provider = byId("MEMORY_EMBEDDING_PROVIDER").value;
  const embedding =
    {
      ollama:
        "Embedding step: local Ollama daemon/model; availability not checked.",
      openai:
        "Embedding step: OpenAI-compatible processing using the OpenAI key, potentially external and paid. A custom endpoint changes who receives data; its address is not included in status.",
      deterministic:
        "Embedding step: deterministic local test vectors, not semantic-provider embeddings.",
    }[provider] ||
    "Embedding step: unsupported configuration; choose a supported provider.";
  const mode = byId("MEMORY_EXTRACTION_MODE").value;
  const extraction =
    {
      off: "Extraction: Off — no new candidate ingestion; existing retrieval/list/delete behavior remains.",
      deterministic:
        "Extraction: local rule-based candidate selection; no extraction LLM call.",
      llm: "Fact selection: configured DeepSeek/OpenAI cloud AI, otherwise local rules; timeout/invalid output also falls back. Local embeddings do not make extraction local. Trainer model preference is independent. Availability is not checked.",
    }[mode] ||
    "Extraction: unsupported configuration; choose a supported mode.";
  byId("memory-processing").textContent = `${embedding} ${extraction}`;
}
async function readMemoryStatus() {
  const generation = ++memoryRead;
  clearTimeout(memoryExpiry);
  byId("memory-check").disabled = true;
  byId("memory-active").textContent = "Reading active local memory status…";
  try {
    const value = await invoke("read_memory_status");
    if (generation !== memoryRead) return;
    const embeddings = {
      ollama: "local Ollama",
      openai: "OpenAI-compatible (may be external/paid)",
      deterministic: "local test vectors (not semantic)",
    };
    const extractors = {
      deepseek: "DeepSeek cloud (not remotely checked)",
      openai: "OpenAI cloud (not remotely checked)",
      deterministic: "local rule-based selection",
      off: "Off — no new ingestion",
    };
    const health = {
      "not-checked":
        "Embedding/storage readiness unknown or stale; open Memory in Trainer for an existing health check.",
      attention:
        "Embedding/storage needs attention. Check configuration, key, daemon/model and compatible dimensions in Memory; no reset is performed.",
      "local-observed":
        "Local Ollama embedding/storage check observed recently; this does not certify extraction.",
      "test-only":
        "Local deterministic storage check observed; not semantic-provider readiness.",
      disabled:
        "Embedding/storage check not applicable while memory is disabled.",
    };
    if (
      !embeddings[value.embeddingProvider] ||
      !extractors[value.extractionProvider] ||
      !health[value.health]
    )
      throw new Error("Invalid status");
    byId("memory-active").textContent =
      `Active runtime configuration: ${value.configuredEnabled ? "On" : "Off"}. ` +
      (value.userDisabled
        ? "Disabled by the separate Memory panel preference; enable there deliberately. "
        : "No separate runtime disable preference. ") +
      `Memory use: ${value.effectiveEnabled ? "On" : "Off"}. Embeddings: ${embeddings[value.embeddingProvider]}. Extraction: ${extractors[value.extractionProvider]}. ${health[value.health]} ` +
      "This is an observation of the active backend, not this draft or a saved next-launch setting.";
    const remaining = Math.max(1, 60000 - (value.ageMs ?? 0));
    memoryExpiry = setTimeout(invalidateMemoryStatus, remaining);
  } catch {
    if (generation === memoryRead)
      byId("memory-active").textContent =
        "Active memory: unavailable or not running; readiness and runtime preference are unknown. Open Trainer's Memory panel after explicit launch/restart. No provider or content check was made.";
  } finally {
    if (generation === memoryRead)
      byId("memory-check").disabled =
        busy || Boolean(firstRun && onboarding?.settingsCommitted);
  }
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
  for (const field of fields)
    if (field.key !== "GARMIN_MCP_TOKEN_DIR")
      byId(field.key).value = values[field.key];
  byId("history-limited").checked = Boolean(values.GARMIN_HISTORY_START_DATE);
  renderHistory();
  renderConnection();
  byId("memory-configuration").open = true;
  byId("advanced-settings").open = true;
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
  byId("advanced-settings").hidden = wizard && step !== 3;
  renderMemory();
  renderHistory();
  byId("review-summary").textContent =
    `${byId("database-selection").value === "create-new" ? "Create new" : "Use existing"} database. Chat catalog: ${catalog.entries.length} entries (choose a model explicitly in Trainer). Garmin: ${tokenSelection ? "connection selected (activation on Finish)" : "not connected"}. Memory: ${byId("MEMORY_ENABLED")?.value || "false"}. Database committed: ${Boolean(onboarding?.databaseCommitted)}. Settings committed: ${Boolean(onboarding?.settingsCommitted)}.`;
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
  byId("connect-later").textContent = firstRun
    ? tokenSelection
      ? "Continue with selected connection"
      : "Continue without Garmin"
    : "Connect later — keep current selection";
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
      "Authentication tooling unavailable. Manage uv/Python separately; this does not establish token expiry.",
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
  invalidateMemoryStatus();
  try {
    const saved = await invoke("read_settings");
    if (!saved.chatCatalog || typeof saved.revision !== "string")
      throw new Error("Unsupported settings snapshot");
    catalog = { ...structuredClone(saved.chatCatalog), defaultEntryId: null };
    loadedRevision = saved.revision;
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
      if (field.options && !field.options.includes(value)) {
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
    savedMemoryEnabled = byId("MEMORY_ENABLED").value;
    resetKeys(saved.keys);
    if (firstRun && !saved.saved) {
      byId("DATABASE_PATH").value = onboarding.database;
    }
    byId("catalog-migration").hidden = ![
      "catalog-migration-required",
      "legacy-required",
    ].includes(saved.storage);
    byId("extraction-compatibility").textContent =
      `Extraction and automatic titles retain the independent legacy policy ${byId("AI_PROVIDER").value}; OpenAI ${byId("AI_MODEL").value}, DeepSeek ${byId("DEEPSEEK_MODEL").value}. Catalog edits do not change these inputs or embeddings.`;
    renderStep();
    renderConnection();
    status.textContent = firstRun
      ? "First run: choose new or existing data, configure a provider, connect Garmin now or later, then Finish and open Trainer."
      : saved.saved
        ? `Saved settings loaded; keys are masked. ${saved.activation || "Live status unknown; no automatic retry."}`
        : "Existing installation recovery: settings are inaccessible or unsupported. Preserve them and reopen with a compatible build; no blank-install overwrite.";
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
    input.type = ["date", "number"].includes(field.type) ? field.type : "text";
    if (field.type === "number") {
      input.required = true;
      input.min = field.key === "MEMORY_EMBEDDING_DIMS" ? "8" : "1";
      input.max = field.key === "MEMORY_EMBEDDING_DIMS" ? "65536" : "300000";
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
  if (field.legacy) {
    if (!field.options) input.type = "hidden";
    label.hidden = true;
  }
  label.append(input);
  if (field.key.startsWith("MEMORY_"))
    input.addEventListener("change", renderMemory);
  const memoryGroup =
    field.key === "MEMORY_ENABLED"
      ? "memory-control"
      : [
            "MEMORY_EMBEDDING_DIMS",
            "MEMORY_TIMEOUT_MS",
            "MEMORY_EXTRACTION_TIMEOUT_MS",
          ].includes(field.key)
        ? "memory-technical"
        : field.key.startsWith("MEMORY_")
          ? "memory-fields"
          : null;
  const parent = byId(
    (field.key === "OLLAMA_BASE_URL" ? "catalog-ollama-config" : memoryGroup) ||
      (field.key === "GARMIN_HISTORY_START_DATE"
        ? "history-options"
        : field.key.endsWith("_COMMAND")
          ? "external-tools"
          : field.advanced
            ? "advanced"
            : field.key === "DATABASE_PATH"
              ? "data-fields"
              : "normal"),
  );
  parent.append(label);
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
  await refresh();
  await window.__TAURI__.event.listen("desktop-status", (event) => {
    status.textContent = event.payload;
  });
  await window.__TAURI__.event.listen("desktop-settings-closed", () => {
    settingsEpoch++;
    closeRestart();
    authEpoch++;
    authPending = false;
    successfulDestination = "";
    clearSecrets();
    authOpen = false;
    invalidateMemoryStatus();
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
  invalidateMemoryStatus();
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
      " Non-secret draft retained; check expanded controls. Keys were cleared from the form. " +
      (unknownOutcome
        ? "Reload failed: quit/reopen to reconcile before another write."
        : "Saved metadata reloaded; no automatic retry.");
  } finally {
    for (const slot of slots) if (keys[slot].value) keys[slot].value = "";
    clearSecrets();
    setBusy(unknownOutcome);
  }
}
byId("history-limited").addEventListener("change", () => {
  if (!byId("history-limited").checked)
    byId("GARMIN_HISTORY_START_DATE").value = "";
  renderHistory();
});
byId("memory-check").addEventListener("click", readMemoryStatus);
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
  invalidateMemoryStatus();
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
        " Non-secret draft retained; check expanded controls. Keys were cleared from the form. " +
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
  } catch {
    if (epoch !== authEpoch) return;
    // Refusal/interruption can be ambiguous; do not start another login blindly.
    byId("auth-status").textContent =
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
