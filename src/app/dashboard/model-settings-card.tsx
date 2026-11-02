import type { ChatModelId } from "@/lib/model-settings/contracts";
import type { useModelSettings } from "./use-model-settings";

export function ModelSettingsCard({
  modelSettings,
}: {
  modelSettings: ReturnType<typeof useModelSettings>;
}) {
  const { snapshot, state, message, choose, retry } = modelSettings;
  const busy = state === "loading" || state === "saving";
  const eligibleOptions =
    snapshot?.options.filter((option) => option.available) ?? [];
  const selected = eligibleOptions.some(
    (option) => option.id === snapshot?.selected,
  )
    ? snapshot!.selected!
    : "";
  const entry = snapshot?.options.find(
    (option) => option.id === snapshot.selected,
  );
  const placeholder = snapshot
    ? snapshot.status === "unselected"
      ? "Choose a model"
      : "Unavailable selected model"
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
        title={`${entry?.provider ?? "Model"} / ${entry?.modelId ?? "unavailable"}. Applies to subsequent turns; running turns, memory extraction and embeddings are unchanged. Native catalog/key edits need quit/reopen.`}
        value={selected}
        disabled={busy || !eligibleOptions.length || state === "error"}
        onChange={(event) => choose(event.target.value as ChatModelId)}
      >
        {!selected ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {eligibleOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <span id="trainer-model-status" className="visually-hidden" role="status">
        {snapshot
          ? `${entry ? `${entry.provider} / ${entry.modelId}` : placeholder}${!snapshot.available ? " — unavailable" : ""}`
          : null}
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
      {snapshot && !eligibleOptions.length ? (
        <p>
          {snapshot.options.length
            ? "No available entries. Configure provider keys or eligible local models in native Settings, then quit/reopen."
            : "No configured entries. Add chat models in native Settings, then quit/reopen."}
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
