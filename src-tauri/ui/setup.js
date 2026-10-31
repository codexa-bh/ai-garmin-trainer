const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const byId = (id) => document.getElementById(id);
const status = byId("status");
const slots = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
let fields = [];
let session = null;
let authTimer = null;
let successfulDestination = "";

function clearSecrets() {
  for (const slot of slots) byId(slot).value = "";
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
    clearSecrets();
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
    for (const field of fields)
      byId(field.key).value =
        saved.fields[field.key] ?? field.default ?? field.options?.[0] ?? "";
    for (const slot of slots) {
      byId(`${slot}-intent`).value = "unchanged";
      byId(slot).disabled = true;
      byId(`${slot}-status`).textContent = saved.keys[slot];
    }
    status.textContent = saved.saved
      ? "Saved settings loaded; keys are masked. Changes require explicit quit/reopen."
      : "First run: enter settings and save, then quit and reopen. Old env files/pointers are never imported.";
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
  }
  label.append(input);
  const parent = byId(field.advanced ? "advanced" : "normal");
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
  byId("save").disabled = true;
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
    const message = await invoke("save_settings", {
      input: { fields: values, keys },
    });
    await refresh();
    status.textContent = message;
  } catch {
    status.textContent =
      "Save refused. Check existing compatible DB, canonical private paths, calendar date, endpoints, advanced values and Keychain access. Prior settings/live backend are unchanged. If Keychain cleanup was denied, inspect the provider.v1 service in Keychain Access. No plaintext fallback.";
  } finally {
    for (const slot of slots) if (keys[slot].value) keys[slot].value = "";
    byId("save").disabled = false;
  }
});
byId("cancel").addEventListener("click", async () => {
  if (session) {
    try {
      showAuth(await invoke("cancel_auth", { id: session.id }));
    } catch {
      /* Already ended; no new attempt. */
    }
  }
  await refresh();
  status.textContent =
    "Edits cancelled. Saved settings and current backend unchanged.";
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
  clearSecrets();
  try {
    showAuth(await invoke("cancel_auth", { id: session.id }));
  } catch {
    byId("auth-status").textContent =
      "Cancellation unavailable. Quit to stop owned authentication.";
  }
});
byId("use-tokens").addEventListener("click", () => {
  byId("GARMIN_MCP_TOKEN_DIR").value = successfulDestination;
  status.textContent =
    "New token store selected in this form only. Save settings, then explicitly quit/reopen to use it.";
});
initialize().catch(() => {
  status.textContent =
    "Native settings unavailable. Quit and rebuild/reopen; no data was changed.";
});
