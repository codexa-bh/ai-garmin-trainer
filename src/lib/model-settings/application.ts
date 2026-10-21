import type { ChatModelId, ModelConfiguration } from "./contracts";
import { isChatModelId, modelSettingsSnapshot } from "./policy";

export class ModelSettingsValidationError extends Error {}

export function createModelSettings(ports: {
  readPreference: () => string | null;
  writePreference: (value: string) => void;
  configuration: () => ModelConfiguration;
}) {
  function read() {
    return modelSettingsSnapshot(ports.readPreference(), ports.configuration());
  }
  function save(body: unknown) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("modelId" in body) ||
      (body.modelId !== null && !isChatModelId(body.modelId))
    ) {
      throw new ModelSettingsValidationError(
        "Choose an available model or reset to the configured default.",
      );
    }
    const modelId = body.modelId as ChatModelId | null;
    const config = ports.configuration();
    if (
      modelId !== null &&
      !modelSettingsSnapshot(modelId, config).effective.available
    ) {
      throw new ModelSettingsValidationError(
        "That model's provider key is not configured. Refresh Settings and choose an available model.",
      );
    }
    ports.writePreference(modelId ?? "");
    return read();
  }
  function selection(): ChatModelId | null {
    const snapshot = read();
    if (
      snapshot.effective.source === "saved" &&
      !snapshot.effective.available
    ) {
      throw new Error(snapshot.unavailableReason);
    }
    return snapshot.selected;
  }
  return { read, save, selection };
}
