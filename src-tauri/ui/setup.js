const status = document.getElementById("status");
const choose = document.getElementById("choose");
window.__TAURI__.event
  .listen("desktop-status", (event) => {
    status.textContent = event.payload;
    choose.disabled = false;
  })
  .then(() => window.__TAURI__.core.invoke("setup_status"))
  .then((message) => {
    status.textContent =
      message ||
      "Choose a configuration if no saved runtime opens. Missing integrations do not prevent offline views.";
  })
  .catch(() => {
    status.textContent = "Native status unavailable. Quit and reopen the app.";
  });
choose.addEventListener("click", () => {
  choose.disabled = true;
  status.textContent =
    "Select your private configuration; startup may take up to 90 seconds.";
  window.__TAURI__.core.invoke("select_configuration").then(
    (message) => {
      status.textContent = message;
      choose.disabled = false;
    },
    () => {
      status.textContent =
        "Startup refused. Check configuration privacy, database schema/ownership and packaged resources. Originals were not relocated.";
      choose.disabled = false;
    },
  );
});
