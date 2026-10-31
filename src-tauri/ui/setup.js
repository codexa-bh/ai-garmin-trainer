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
  byId("save").hidden = wizard && step !== 3;
  byId("save").textContent = wizard
    ? onboarding?.settingsCommitted
      ? "Retry opening saved Trainer"
      : "Finish and open Trainer"
    : "Save for next launch";
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
  try {
    const saved = await invoke("read_settings");
    onboarding = await invoke("read_onboarding");
    firstRun = Boolean(onboarding?.eligible && !saved.running);
    for (const field of fields)
      byId(field.key).value =
        saved.fields[field.key] ?? field.default ?? field.options?.[0] ?? "";
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
  } catch {
    status.textContent =
      "Saved settings are invalid or inaccessible. Check private settings permissions/version; no env fallback or key readback. Original data is unchanged.";
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
      option.textContent = value;
      input.append(option);
    }
  } else {
    input.type = ["date", "number"].includes(field.type) ? field.type : "text";
    input.autocomplete = "off";
    // Paths/model identifiers are literal configuration, not prose. WebKit's
    // automatic capitalization/correction must not change what the user enters.
    input.autocapitalize = "off";
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
  }
  label.append(input);
  const parent = byId(
    field.advanced
      ? "advanced"
      : field.key === "GARMIN_MCP_TOKEN_DIR"
        ? "garmin-fields"
        : ["DATABASE_PATH", "GARMIN_HISTORY_START_DATE"].includes(field.key)
          ? "data-fields"
          : "normal",
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
    showAuth(null);
  });
  const message = await invoke("setup_status");
  if (message) status.textContent = message;
}
byId("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  if (firstRun && step !== 3) return;
  setBusy(true);
  status.textContent = firstRun
    ? "Preparing setup and checking local configuration… Cancel retains already committed outputs."
    : "Validating settings…";
  const values = {};
  const keys = {};
  for (const field of fields)
    if (byId(field.key).value) values[field.key] = byId(field.key).value;
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
    } else
      status.textContent =
        "Save refused. Check existing compatible DB, canonical private paths, calendar date, endpoints, advanced values and Keychain access. Prior settings/live backend are unchanged. If Keychain cleanup was denied, inspect the provider.v1 service in Keychain Access. No plaintext fallback.";
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
  await refresh();
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
