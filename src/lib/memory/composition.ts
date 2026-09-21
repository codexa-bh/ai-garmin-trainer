import { setAppMetadata } from "../db/repository";
import { DISABLED_METADATA_KEY } from "./config";
import { createMemoryManagement } from "./management";
import { createMemoryStore } from "./application";
import { memoryConfigProblems, memoryRuntimeConfig } from "./config";
import { createEmbedding, stableId } from "./embedding-adapter";
import {
  extractMemoryCandidatesWithLlm,
  memoryExtractionMode,
} from "./extraction-adapter";
import { sqliteMemoryPersistence } from "./sqlite-storage";
import type { TrainerMemoryStore } from "./types";

let singleton: TrainerMemoryStore | null = null;

export function trainerMemoryStore(): TrainerMemoryStore {
  if (!singleton) {
    const config = memoryRuntimeConfig();
    singleton = createMemoryStore({
      settings: {
        configuredEnabled: config.configuredEnabled,
        userDisabled: config.userDisabled,
        effectiveEnabled: config.effectiveEnabled,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        embeddingConfigured:
          config.embeddingProvider === "deterministic" ||
          config.embeddingProvider === "ollama" ||
          Boolean(config.embeddingApiKey),
        problems: memoryConfigProblems(config),
      },
      storage: sqliteMemoryPersistence,
      embedding: createEmbedding(config),
      extractionMode: memoryExtractionMode,
      extract: extractMemoryCandidatesWithLlm,
      stableId,
      now: () => Date.now(),
    });
  }
  return singleton;
}

export function resetTrainerMemoryStore(): void {
  singleton = null;
}

export const memoryManagement = createMemoryManagement({
  store: trainerMemoryStore,
  setEnabled(enabled) {
    setAppMetadata(DISABLED_METADATA_KEY, enabled ? "false" : "true");
    resetTrainerMemoryStore();
  },
});
