import { setAppMetadata } from "../db/repository";
import { memoryExtractionSelection } from "../ai/providers";
import { memoryStatusProjection } from "./status";
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
let activeConfig: ReturnType<typeof memoryRuntimeConfig> | null = null;
let observation: { ready: boolean; at: number } | null = null;

export function trainerMemoryStore(): TrainerMemoryStore {
  if (!singleton) {
    const config = memoryRuntimeConfig();
    activeConfig = config;
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
    const store = singleton;
    const health = store.health.bind(store);
    store.health = async () => {
      const result = await health();
      // A superseded check cannot repopulate a reset singleton's observation.
      if (singleton === store)
        observation = { ready: result.ready, at: Date.now() };
      return result;
    };
  }
  return singleton;
}

export function resetTrainerMemoryStore(): void {
  singleton = null;
  activeConfig = null;
  observation = null;
}

export function activeMemoryStatus() {
  trainerMemoryStore(); // Config + existing metadata only; no health/list/migration.
  const config = activeConfig!;
  const selection = memoryExtractionSelection();
  return memoryStatusProjection({
    ...config,
    extractionMode: memoryExtractionMode(),
    extractionProvider:
      selection.selected === "deepseek" || selection.selected === "openai"
        ? selection.selected
        : null,
    observation,
    now: Date.now(),
  });
}

export const memoryManagement = createMemoryManagement({
  store: trainerMemoryStore,
  setEnabled(enabled) {
    setAppMetadata(DISABLED_METADATA_KEY, enabled ? "false" : "true");
    resetTrainerMemoryStore();
  },
});
