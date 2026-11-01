import type { ChatModelId } from "@/lib/model-settings/contracts";
import type { useModelSettings } from "./use-model-settings";

export function ModelSettingsCard({
  modelSettings,
}: {
  modelSettings: ReturnType<typeof useModelSettings>;
}) {
  const { snapshot, state, message, choose, retry } = modelSettings;
  const busy = state === "loading" || state === "saving";
  const selected = snapshot?.options.some(
    (option) => option.id === snapshot.selected,
  )
    ? snapshot.selected!
    : "";
  return (
    <details className="settings-card chat-model-control">
      <summary>Trainer model</summary>
      <p>
        Choose the model for subsequent trainer turns without restarting. Only
        providers with configured keys are offered; account access and funding
        are not checked.
      </p>
      <label>
        Trainer model
        <select
          aria-label="Trainer model"
          aria-describedby="trainer-model-status"
          value={selected}
          disabled={busy || !snapshot?.options.length || state === "error"}
          onChange={(event) => choose(event.target.value as ChatModelId)}
        >
          {!selected ? (
            <option value="" disabled>
              Choose a configured model
            </option>
          ) : null}
          {snapshot?.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {snapshot ? (
        <>
          <p id="trainer-model-status" role="status">
            {snapshot.effective.source === "env"
              ? "Configured default (environment)"
              : "Saved preference"}
            : {snapshot.effective.provider ?? "unavailable"} /{" "}
            {snapshot.effective.modelName ?? "unavailable"}
            {!snapshot.effective.available ? " — unavailable" : ""}
          </p>
          {snapshot.unavailableReason ? (
            <p role="alert">{snapshot.unavailableReason}</p>
          ) : null}
          {!snapshot.options.length ? (
            <p>
              No selectable models. Configure a DeepSeek or OpenAI key in native
              Settings, then explicitly quit/reopen the app.
            </p>
          ) : null}
          {snapshot.effective.source === "saved" ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || state === "error"}
              onClick={() => choose(null)}
            >
              Reset to configured default
            </button>
          ) : null}
        </>
      ) : null}
      <p
        className="helper-text"
        role={state === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {state === "loading"
          ? "Loading model settings…"
          : state === "saving"
            ? "Saving model setting…"
            : message}
      </p>
      {state === "error" ? (
        <button type="button" className="secondary-button" onClick={retry}>
          Retry model availability
        </button>
      ) : null}
      <p className="helper-text">
        This control does not change memory extraction or embeddings and never
        edits or exposes provider keys. Native Settings owns configuration.
      </p>
    </details>
  );
}
