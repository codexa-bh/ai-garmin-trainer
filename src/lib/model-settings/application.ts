import type { ChatEntry, ModelConfiguration } from "./contracts";
import {
  decodeChoice,
  isChatModelId,
  modelSettingsSnapshot,
  priorChoice,
} from "./policy";

export class ModelSettingsValidationError extends Error {}

export function createModelSettings(ports: {
  readChoice: () => string | null;
  initializeChoice: (value: string) => void;
  writeChoice: (value: string) => void;
  readPreference: () => string | null;
  readLegacyPreference: () => string | null;
  configuration: () => ModelConfiguration;
}) {
  function current(config: ModelConfiguration) {
    let raw = ports.readChoice();
    if (raw === null) {
      const choice = priorChoice(
        ports.readPreference(),
        ports.readLegacyPreference(),
        config,
      );
      ports.initializeChoice(JSON.stringify(choice));
      // Read the committed winner, never the in-memory candidate: concurrent
      // explicit selection and failed initialization must not be clobbered.
      raw = ports.readChoice();
      if (raw === null)
        throw new Error("Trainer choice could not be initialized.");
    }
    return decodeChoice(raw);
  }
  function read() {
    const config = ports.configuration();
    return modelSettingsSnapshot(current(config), config);
  }
  function save(body: unknown) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !("modelId" in body) ||
      !isChatModelId(body.modelId)
    )
      throw new ModelSettingsValidationError(
        "Choose an activated catalog entry explicitly.",
      );
    const config = ports.configuration();
    const choice = {
      version: 1 as const,
      status: "selected" as const,
      entryId: body.modelId,
    };
    if (!modelSettingsSnapshot(choice, config).available)
      throw new ModelSettingsValidationError(
        "That entry is absent or ineligible. Refresh the activated catalog; native edits require quit/reopen.",
      );
    current(config); // Refuse unsupported authority, including before replacement.
    ports.writeChoice(JSON.stringify(choice));
    return modelSettingsSnapshot(current(config), config);
  }
  function selection(config = ports.configuration()): ChatEntry {
    const state = modelSettingsSnapshot(current(config), config);
    if (!state.available) throw new Error(state.unavailableReason);
    const entry = config.catalog.entries.find(
      (value) => value.id === state.selected,
    );
    if (!entry) throw new Error("Select an activated chat entry.");
    return { ...entry };
  }
  return { read, save, selection };
}
