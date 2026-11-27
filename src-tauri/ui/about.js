(() => {
  const invoke = window.__TAURI__.core.invoke;
  const status = document.getElementById("status");
  const close = () =>
    invoke("about_close").catch(() => {
      status.textContent =
        "About could not close. Use the window close button.";
    });
  document.getElementById("close").addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  for (const link of document.querySelectorAll("a[data-destination]")) {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      status.textContent = "";
      try {
        await invoke("about_link", { destination: link.dataset.destination });
      } catch {
        status.textContent =
          "Link could not open. Try again from the app menu in an interactive session.";
      }
    });
  }
  invoke("about_metadata")
    .then((metadata) => {
      document.getElementById("app-name").textContent = metadata.name;
      document.getElementById("version").textContent = metadata.version;
      document.getElementById("build").textContent = metadata.build;
    })
    .catch(() => {
      status.textContent = "App bundle metadata unavailable.";
    });
  document.getElementById("close").focus();
})();
