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
let onboarding = null;
let firstRun = false;
let step = 0;
let busy = false;
let unknownOutcome = false;
let legacyRequired = false;

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
  byId("review-summary").textContent =
    `${byId("database-selection").value === "create-new" ? "Create new" : "Use existing"} database. Provider: ${byId("AI_PROVIDER")?.value || "auto"}. Garmin: ${tokenSelection ? "connection selected (activation on Finish)" : "not connected"}. Memory: ${byId("MEMORY_ENABLED")?.value || "false"}. Database committed: ${Boolean(onboarding?.databaseCommitted)}. Settings committed: ${Boolean(onboarding?.settingsCommitted)}.`;
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
}
function fieldValues() {
  const values = {};
  for (const field of fields) {
    const value =
      field.key === "GARMIN_MCP_TOKEN_DIR"
        ? tokenSelection
        : byId(field.key).value;
    if (value) values[field.key] = value;
  }
  return values;
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
  byId("use-tokens").hidden =
    value?.state !== "succeeded" || !value.destination;
  if (value?.state === "succeeded" && value.destination) {
    successfulDestination = value.destination;
    byId("auth-status").textContent =
      `Connected — authenticated tokens verified during this sign-in and saved privately, not a guarantee of future validity. Choose Use this verified connection, then ${firstRun ? "Review and Finish" : "Save and explicitly quit/reopen"}. The running account is unchanged.`;
  }
}
async function refresh() {
  clearSecrets();
  try {
    const saved = await invoke("read_settings");
    onboarding = await invoke("read_onboarding");
    legacyRequired = saved.storage === "legacy-required";
    byId("storage-status").textContent = legacyRequired
      ? "Storage: legacy settings preserved. Explicit adoption or private re-entry required."
      : "Storage: owner-private plaintext file; saved values are never returned.";
    firstRun = Boolean(onboarding?.eligible && !saved.running);
    savedTokenSelection = tokenSelection =
      saved.fields.GARMIN_MCP_TOKEN_DIR ?? "";
    for (const field of fields)
      if (field.key !== "GARMIN_MCP_TOKEN_DIR")
        byId(field.key).value =
          saved.fields[field.key] ?? field.default ?? field.options?.[0] ?? "";
    for (const slot of slots) {
      byId(`${slot}-intent`).value = "unchanged";
      byId(slot).disabled = true;
      byId(`${slot}-status`).textContent = saved.keys[slot];
    }
    if (firstRun && !saved.saved) {
      byId("DATABASE_PATH").value = onboarding.database;
      byId("GARMIN_HISTORY_START_DATE").value = new Date()
        .toISOString()
        .slice(0, 10);
    }
    renderStep();
    renderConnection();
    status.textContent = firstRun
      ? "First run: choose new or existing data, configure a provider, connect Garmin now or later, then Finish and open Trainer. Old env files are never imported."
      : saved.saved
        ? "Saved settings loaded; keys are masked. Changes require explicit quit/reopen."
        : "Existing installation recovery: settings are inaccessible or unsupported. Preserve them and reopen with a compatible build; no blank-install overwrite.";
  } catch {
    status.textContent =
      "Saved settings are invalid or inaccessible. Check private settings permissions/version; no env fallback or key readback. Original data is unchanged.";
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
    authEpoch++;
    authPending = false;
    successfulDestination = "";
    clearSecrets();
    byId("auth").hidden = true;
    showAuth(null);
  });
  const message = await invoke("setup_status");
  if (message) status.textContent = message;
}
async function adoptProviders(readLegacy) {
  if (busy || !legacyRequired || authPending || authActive()) return;
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
    await refresh();
    status.textContent =
      typeof error === "string"
        ? error
        : "Adoption outcome unknown. Inspect saved state before retry; originals retained.";
  } finally {
    clearSecrets();
    setBusy(false);
  }
}
byId("adopt-provider").addEventListener("click", () => adoptProviders(true));
byId("reenter-provider").addEventListener("click", () => adoptProviders(false));
byId("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || legacyRequired || authPending || authActive()) return;
  if (firstRun && step !== 3) return;
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
      await refresh();
      status.textContent =
        typeof error === "string"
          ? error
          : "Save outcome unknown. Reload and reconcile private settings before retry; live backend is unchanged. No env or Keychain fallback.";
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
  authEpoch++;
  authPending = false;
  if (session) {
    try {
      showAuth(await invoke("cancel_auth", { id: session.id }));
    } catch {
      /* Already ended; no new attempt. */
    }
  }
  byId("auth").hidden = true;
  successfulDestination = "";
  showAuth(null);
  await refresh();
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
  byId("auth").hidden = false;
  byId("email").focus();
});
byId("connect-later").addEventListener("click", () => {
  if (busy || authPending || authActive()) return;
  clearAuthSecrets();
  byId("auth").hidden = true;
  if (firstRun && step === 2) {
    step = 3;
    renderStep();
  }
  status.textContent =
    "No new sign-in. Current connection selection and provider draft preserved; chat and offline history remain available.";
});
byId("auth").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || authPending || authActive()) return;
  const epoch = ++authEpoch;
  authPending = true;
  byId("sign-in").disabled = byId("connect").disabled = true;
  byId("use-tokens").hidden = true;
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
byId("mfa-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (session?.state !== "needs-mfa" || busy) return;
  const { id } = session;
  const epoch = ++authEpoch;
  clearTimeout(authTimer);
  const code = byId("mfa").value;
  clearAuthSecrets();
  session.state = "submitting-mfa";
  byId("mfa-form").hidden = true;
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
  byId("auth").hidden = true;
  status.textContent = firstRun
    ? "Verified connection selected in draft. Tokens committed independently; continue to Review and Finish. Cancellation never deletes them."
    : "Verified connection selected in draft only. Save, then explicitly quit/reopen; running account unchanged.";
});
initialize().catch(() => {
  status.textContent =
    "Native settings unavailable. Quit and rebuild/reopen; no data was changed.";
});
