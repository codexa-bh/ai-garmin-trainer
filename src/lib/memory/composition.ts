import { setAppMetadata } from "../db/repository";
import { getOptionalEnv, withConfiguration, type AppEnv } from "../env";
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
let credentialSnapshot: AppEnv | null = null;
let activeConfig: ReturnType<typeof memoryRuntimeConfig> | null = null;
let observation: { ready: boolean; at: number } | null = null;

export function trainerMemoryStore(): TrainerMemoryStore {
  const env = getOptionalEnv();
  // Only credentials rotate here. Native live state retains the entire startup
  // nonlive base; no Save-time store construction, migration or readiness probe.
  if (
    credentialSnapshot &&
    ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"].some(
      (slot) =>
        credentialSnapshot![slot as keyof AppEnv] !== env[slot as keyof AppEnv],
    )
  ) {
    singleton = null;
    observation = null;
  }
  if (!singleton) {
    credentialSnapshot = env;
    const config = memoryRuntimeConfig(env);
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
      extract: (...args) =>
        withConfiguration(env, () => extractMemoryCandidatesWithLlm(...args)),
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
  credentialSnapshot = null;
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
