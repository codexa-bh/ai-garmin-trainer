import type { CompletedTurn, MemoryCandidate, RetrievedMemory } from "./types";
export type SemanticMemoryRow = {
  id: string;
  userId: string;
  kind: string;
  text: string;
  status: string;
  embeddingJson: string;
  embeddingModel: string;
  sourceConversationId: string | null;
  sourceMessageIdsJson: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
};

export type LegacyMemoryRow = {
  id: string;
  category: string;
  value: string;
  status: string;
  sourceType: string;
  sourceRef: string | null;
  provenanceText: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
};

type MemorySettings = {
  configuredEnabled: boolean;
  userDisabled: boolean;
  effectiveEnabled: boolean;
  embeddingProvider: "openai" | "ollama" | "deterministic";
  embeddingModel: string;
  embeddingConfigured: boolean;
  problems: string[];
};
export type MemoryWrite = {
  id: string;
  kind: RetrievedMemory["kind"];
  text: string;
  source: string;
  conversationId?: string | null;
  sourceMessageIds?: string[];
  createdAt?: Date;
  expiresAt?: Date | null;
};
type SemanticWrite = MemoryWrite & {
  embedding: number[];
  embeddingModel: string;
  now: number;
};
export interface MemoryPersistence {
  rows(now: number): SemanticMemoryRow[];
  upsert(input: SemanticWrite): void;
  legacyRows(now: number): LegacyMemoryRow[];
  migrationDone(): boolean;
  markMigrated(): void;
  update(
    id: string,
    text: string,
    embedding: number[],
    model: string,
    now: number,
  ): void;
  delete(id: string, now: number): void;
  clearAll(now: number): void;
  probe(): void;
}
export type MemoryPorts = {
  settings: MemorySettings;
  storage: MemoryPersistence;
  embedding(text: string): Promise<number[]>;
  extractionMode(): "llm" | "deterministic" | "off";
  extract(input: CompletedTurn): Promise<MemoryCandidate[] | null>;
  stableId(prefix: string, parts: string[]): string;
  now(): number;
};
