import type { ChatEntry, ModelConfiguration } from "./contracts";
import { isChatModelId, modelSettingsSnapshot } from "./policy";

export class ModelSettingsValidationError extends Error {}

export function createModelSettings(ports: {
  readPreference: () => string | null;
  readLegacyPreference: () => string | null;
  writePreference: (value: string) => void;
  configuration: () => ModelConfiguration;
}) {
  function snapshot(config: ModelConfiguration) {
    return modelSettingsSnapshot(
      ports.readPreference(),
      config,
      ports.readLegacyPreference(),
    );
  }
  function read() {
    return snapshot(ports.configuration());
  }
  function save(body: unknown) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("modelId" in body) ||
      (body.modelId !== null && !isChatModelId(body.modelId))
    )
      throw new ModelSettingsValidationError(
        "Choose an activated catalog entry or reset to its explicit default.",
      );
    const config = ports.configuration();
    const id = body.modelId as string | null;
    if (id !== null && !modelSettingsSnapshot(id, config).effective.available)
      throw new ModelSettingsValidationError(
        "That entry is absent or ineligible. Refresh the activated catalog; native edits require quit/reopen.",
      );
    ports.writePreference(id ?? "");
    return snapshot(config);
  }
  function selection(config = ports.configuration()): ChatEntry {
    const state = snapshot(config);
    if (!state.effective.available) throw new Error(state.unavailableReason);
    const entry = config.catalog.entries.find(
      (value) => value.id === state.effective.entryId,
    );
    if (!entry) throw new Error("Select an activated chat entry.");
    return { ...entry };
  }
  return { read, save, selection };
}
