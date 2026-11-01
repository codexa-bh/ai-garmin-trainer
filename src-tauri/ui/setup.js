const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const slots = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
let fields = [];
let session = null;
let authTimer = null;
let successfulDestination = "";
let onboarding = null;
let firstRun = false;
let step = 0;
let busy = false;
let unknownOutcome = false;
let legacyRequired = false;
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
function renderMemory() {
  const on = byId("MEMORY_ENABLED").value === "true";
  byId("memory-draft").textContent =
    `Draft: ${on ? "On" : "Off"}. Saved startup setting: ${savedMemoryEnabled === "true" ? "On" : "Off"}. ` +
    (firstRun
      ? "Finish applies the committed startup configuration."
      : "Save applies only after explicit quit/reopen; the active runtime is unchanged.");
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
  return Object.fromEntries(
    fields.map((field) => [field.key, byId(field.key).value]),
  );
}
function retainDraft(values) {
  for (const field of fields) byId(field.key).value = values[field.key];
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
    "Optional Garmin — skip with Next",
    "Review",
  ][step];
  byId("data-step").hidden = wizard && step !== 0;
  byId("normal").hidden = byId("keys").hidden = wizard && step !== 1;
  byId("garmin-fields").hidden = byId("auth-section").hidden =
    wizard && step !== 2;
  byId("review").hidden = !wizard || step !== 3;
  byId("next-launch-guidance").hidden = wizard;
  byId("back").hidden = !wizard || step === 0 || committed;
  byId("next").hidden = !wizard || step === 3 || committed;
  byId("save").hidden = legacyRequired || (wizard && step !== 3);
  byId("migration").hidden = !legacyRequired;
  byId("save").textContent = wizard
    ? onboarding?.settingsCommitted
      ? "Retry opening saved Trainer"
      : "Finish and open Trainer"
    : "Save for next launch";
  byId("memory-section").hidden = wizard && step !== 3;
  byId("advanced-settings").hidden = wizard && step !== 3;
  renderMemory();
  byId("review-summary").textContent =
    `${byId("database-selection").value === "create-new" ? "Create new" : "Use existing"} database. Provider: ${byId("AI_PROVIDER")?.value || "auto"}. Garmin: ${byId("GARMIN_MCP_TOKEN_DIR")?.value ? "selected existing store" : "skipped"}. Memory: ${byId("MEMORY_ENABLED")?.value || "false"}. Database committed: ${Boolean(onboarding?.databaseCommitted)}. Settings committed: ${Boolean(onboarding?.settingsCommitted)}.`;
}
function setBusy(value) {
  busy = value;
  byId("settings").setAttribute("aria-busy", String(value));
  const committed = firstRun && onboarding?.settingsCommitted;
  for (const element of document.querySelectorAll(
    "#settings input, #settings select, #settings button, #auth-section button",
  ))
    if (element.id !== "cancel")
      element.disabled = value || (committed && element.id !== "save");
  if (!value)
    for (const slot of slots)
      byId(slot).disabled =
        committed || byId(`${slot}-intent`).value !== "replace";
}
async function reconcileOnboarding() {
  onboarding = await invoke("read_onboarding");
  if (onboarding?.databaseCommitted)
    byId("DATABASE_PATH").value = onboarding.database;
  renderStep();
}

function clearSecrets() {
  for (const slot of slots) byId(slot).value = "";
  clearAuthSecrets();
}
function clearAuthSecrets() {
  for (const id of ["email", "password", "mfa"]) byId(id).value = "";
}
function showAuth(value) {
  session = value;
  const active =
    value &&
    ["authenticating", "needs-mfa", "submitting-mfa", "verifying"].includes(
      value.state,
    );
  byId("sign-in").disabled = Boolean(active);
  byId("auth-cancel").disabled = !active;
  byId("destination").disabled = Boolean(active);
  byId("auth-parent").disabled = Boolean(active);
  byId("mfa-form").hidden = value?.state !== "needs-mfa";
  byId("auth-status").textContent = value
    ? `Sign-in: ${value.state}${value.code ? ` — ${value.code}` : ""}.`
    : "Idle. No automatic login attempts.";
  if (!active) {
    clearInterval(authTimer);
    authTimer = null;
    clearAuthSecrets();
  }
  byId("use-tokens").hidden = value?.state !== "succeeded";
  if (value?.state === "succeeded") {
    successfulDestination = byId("destination").value;
    byId("auth-status").textContent =
      "Authenticated tokens independently verified and saved privately. This does not guarantee future validity. Choose Use new store, then Save; applies after quit/reopen.";
  }
}
async function refresh() {
  clearSecrets();
  invalidateMemoryStatus();
  try {
    const saved = await invoke("read_settings");
    onboarding = await invoke("read_onboarding");
    legacyRequired = saved.storage === "legacy-required";
    byId("storage-status").textContent = legacyRequired
      ? "Storage: legacy settings preserved. Explicit adoption or private re-entry required."
      : "Storage: owner-private plaintext file; saved values are never returned.";
    firstRun = Boolean(onboarding?.eligible && !saved.running);
    for (const field of fields) {
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
    savedMemoryEnabled = byId("MEMORY_ENABLED").value;
    for (const slot of slots) {
      byId(`${slot}-intent`).value = "unchanged";
      byId(slot).disabled = true;
      byId(`${slot}-status`).textContent = saved.keys[slot];
    }
    if (firstRun && !saved.saved) {
      byId("DATABASE_PATH").value = onboarding.database;
      byId("destination").value = onboarding.tokens;
      byId("GARMIN_HISTORY_START_DATE").value = new Date()
        .toISOString()
        .slice(0, 10);
    }
    renderStep();
    status.textContent = firstRun
      ? "First run: choose new or existing data, configure a provider, optionally add Garmin, then Finish and open Trainer. Old env files are never imported."
      : saved.saved
        ? "Saved settings loaded; keys are masked. Changes require explicit quit/reopen."
        : "Existing installation recovery: settings are inaccessible or unsupported. Preserve them and reopen with a compatible build; no blank-install overwrite.";
    return true;
  } catch {
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
    memoryGroup ||
      (field.key.endsWith("_COMMAND")
        ? "external-tools"
        : field.advanced
          ? "advanced"
          : field.key === "GARMIN_MCP_TOKEN_DIR"
            ? "garmin-fields"
            : ["DATABASE_PATH", "GARMIN_HISTORY_START_DATE"].includes(field.key)
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
    const intent = document.createElement("select");
    intent.id = `${slot}-intent`;
    for (const value of ["unchanged", "replace", "clear"]) {
      const option = document.createElement("option");
      option.value = option.textContent = value;
      intent.append(option);
    }
    const input = document.createElement("input");
    input.type = "password";
    input.id = slot;
    input.autocomplete = "new-password";
    input.disabled = true;
    intent.addEventListener("change", () => {
      input.value = "";
      input.disabled = intent.value !== "replace";
    });
    label.append(intent, input);
    byId("keys").append(label);
  }
  await refresh();
  await window.__TAURI__.event.listen("desktop-status", (event) => {
    status.textContent = event.payload;
  });
  await window.__TAURI__.event.listen("desktop-settings-closed", () => {
    clearSecrets();
    invalidateMemoryStatus();
    showAuth(null);
  });
  const message = await invoke("setup_status");
  if (message) status.textContent = message;
}
async function adoptProviders(readLegacy) {
  if (busy || !legacyRequired) return;
  invalidateMemoryStatus();
  setBusy(true);
  const values = fieldValues();
  const keys = {};
  for (const slot of slots) {
    const intent = byId(`${slot}-intent`).value;
    keys[slot] =
      intent === "replace" ? { intent, value: byId(slot).value } : { intent };
    byId(slot).value = "";
  }
  status.textContent = readLegacy
    ? "Explicit adoption in progress; macOS may request access. No automatic retry."
    : "Validating private re-entry; no Keychain access.";
  try {
    const message = await invoke("adopt_provider_settings", {
      input: { fields: values, keys },
      readLegacy,
    });
    await refresh();
    status.textContent = message;
  } catch (error) {
    // Reconcile commit metadata, never retry the mutation or read legacy again.
    unknownOutcome = !(await refresh());
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
byId("memory-check").addEventListener("click", readMemoryStatus);
byId("settings").addEventListener("invalid", revealInvalid, true);
byId("adopt-provider").addEventListener("click", () => adoptProviders(true));
byId("reenter-provider").addEventListener("click", () => adoptProviders(false));
byId("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || legacyRequired) return;
  if (firstRun && step !== 3) return;
  invalidateMemoryStatus();
  setBusy(true);
  status.textContent = firstRun
    ? "Preparing setup and checking local configuration… Cancel retains already committed outputs."
    : "Validating settings…";
  const values = fieldValues();
  const keys = {};
  for (const slot of slots) {
    const intent = byId(`${slot}-intent`).value;
    const value = byId(slot).value;
    keys[slot] =
      intent === "replace" && value
        ? { intent, value }
        : { intent: intent === "clear" ? "clear" : "unchanged" };
    byId(slot).value = "";
  }
  try {
    const message = await invoke(
      firstRun ? "finish_onboarding" : "save_settings",
      {
        input: firstRun
          ? {
              id: onboarding.id,
              selection: byId("database-selection").value,
              settings: { fields: values, keys },
            }
          : { fields: values, keys },
      },
    );
    await refresh();
    status.textContent = message;
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
      retainDraft(values);
      status.textContent =
        (typeof error === "string"
          ? error
          : "Save outcome unknown; live backend unchanged.") +
        " Non-secret draft retained; check expanded controls. Keys were cleared from the form. " +
        (unknownOutcome
          ? "Reload failed: quit/reopen to reconcile before another write."
          : "Saved metadata reloaded; no automatic retry.");
    }
  } finally {
    for (const slot of slots) if (keys[slot].value) keys[slot].value = "";
    setBusy(unknownOutcome);
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
  if (session) {
    try {
      showAuth(await invoke("cancel_auth", { id: session.id }));
    } catch {
      /* Already ended; no new attempt. */
    }
  }
  const reconciled = await refresh();
  if (!reconciled) return;
  unknownOutcome = false;
  setBusy(false);
  step = 0;
  renderStep();
  status.textContent =
    "Edits cancelled. Saved settings and current backend unchanged; any independently committed database or tokens are retained.";
});
byId("auth-parent").addEventListener("click", async () => {
  try {
    const parent = await invoke("choose_path", { kind: "directory" });
    if (parent) byId("destination").value = `${parent}/new-garmin-tokens`;
  } catch {
    byId("auth-status").textContent = "Folder selection unavailable.";
  }
});
byId("auth").addEventListener("submit", async (event) => {
  event.preventDefault();
  byId("sign-in").disabled = true;
  const input = {
    destination: byId("destination").value,
    email: byId("email").value,
    password: byId("password").value,
  };
  byId("email").value = byId("password").value = "";
  try {
    if (firstRun && input.destination === onboarding.tokens)
      await invoke("prepare_onboarding_auth", { id: onboarding.id });
    showAuth(await invoke("start_auth", input));
    authTimer = setInterval(async () => {
      try {
        showAuth(await invoke("auth_status"));
      } catch {
        clearInterval(authTimer);
        byId("auth-status").textContent =
          "Native auth status unavailable. Quit to cancel owned authentication; no automatic retry.";
      }
    }, 500);
  } catch {
    byId("sign-in").disabled = false;
    byId("auth-status").textContent =
      "Sign-in refused. Check uv/Python, private parent folder and unused destination; existing credentials are never replaced. No automatic retry.";
  } finally {
    input.email = input.password = "";
  }
});
byId("mfa-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = byId("mfa").value;
  byId("mfa").value = "";
  byId("mfa-form").hidden = true;
  try {
    showAuth(await invoke("submit_mfa", { id: session.id, code }));
  } catch {
    byId("auth-status").textContent =
      "MFA submission refused or session expired. Cancel; start again explicitly only when appropriate.";
  }
});
byId("auth-cancel").addEventListener("click", async () => {
  clearAuthSecrets();
  try {
    showAuth(await invoke("cancel_auth", { id: session.id }));
  } catch {
    byId("auth-status").textContent =
      "Cancellation unavailable. Quit to stop owned authentication.";
  }
});
byId("use-tokens").addEventListener("click", () => {
  byId("GARMIN_MCP_TOKEN_DIR").value = successfulDestination;
  status.textContent = firstRun
    ? "New tokens are committed independently. Store selected; continue to Review and Finish. Cancellation never deletes these tokens."
    : "New token store selected in this form only. Save settings, then explicitly quit/reopen to use it.";
});
initialize().catch(() => {
  status.textContent =
    "Native settings unavailable. Quit and rebuild/reopen; no data was changed.";
});
