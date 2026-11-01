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
  const inheritedLabel = snapshot
    ? `${snapshot.effective.source === "env" ? "Default" : "Unavailable"} · ${snapshot.effective.modelName ?? "unknown model"}`
    : state === "error"
      ? "Model unavailable"
      : "Loading…";
  return (
    <div className="chat-model-control">
      <label htmlFor="trainer-model">Model</label>
      <select
        id="trainer-model"
        aria-label="Trainer model"
        aria-describedby="trainer-model-status"
        title={`${snapshot?.effective.provider ?? "Model"} / ${snapshot?.effective.modelName ?? "unavailable"}. Applies to subsequent turns; running turns, memory extraction and embeddings are unchanged. Configure keys in native Settings.`}
        value={selected}
        disabled={busy || !snapshot?.options.length || state === "error"}
        onChange={(event) => choose(event.target.value as ChatModelId)}
      >
        {!selected ? (
          <option value="" disabled>
            {inheritedLabel}
          </option>
        ) : null}
        {snapshot?.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {snapshot?.effective.source === "saved" ? (
        <button
          type="button"
          aria-label="Reset to configured default"
          title="Reset to configured default"
          disabled={busy || state === "error"}
          onClick={() => choose(null)}
        >
          Default
        </button>
      ) : null}
      <span id="trainer-model-status" className="visually-hidden" role="status">
        {snapshot ? (
          <>
            {snapshot.effective.source === "env"
              ? "Configured default (environment)"
              : "Saved preference"}
            : {snapshot.effective.provider ?? "unavailable"} /{" "}
            {snapshot.effective.modelName ?? "unavailable"}
            {!snapshot.effective.available ? " — unavailable" : ""}
          </>
        ) : null}
      </span>
      {busy || (state === "ready" && message) ? (
        <span
          className="chat-model-save-state"
          role="status"
          aria-live="polite"
        >
          {state === "loading"
            ? "Loading model settings…"
            : state === "saving"
              ? "Saving model setting…"
              : "Saved"}
        </span>
      ) : null}
      {snapshot?.unavailableReason ? (
        <p role="alert">{snapshot.unavailableReason}</p>
      ) : null}
      {snapshot && !snapshot.options.length ? (
        <p>
          No selectable models. Configure a DeepSeek or OpenAI key in native
          Settings, then quit/reopen.
        </p>
      ) : null}
      {state === "error" ? (
        <p role="alert">
          {message}{" "}
          <button
            type="button"
            aria-label="Retry model availability"
            onClick={retry}
          >
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}
