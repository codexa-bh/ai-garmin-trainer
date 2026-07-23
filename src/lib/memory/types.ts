export const LOCAL_MEMORY_USER_ID = "local-default" as const;

export type MemoryScope = {
  userId: typeof LOCAL_MEMORY_USER_ID;
  conversationId?: string;
};

export type MemoryKind =
  "conversation" | "saved_preference" | "correction" | "temporary";

export type RetrievedMemory = {
  id: string;
  text: string;
  kind: MemoryKind;
  score?: number;
  conversationId?: string;
  sourceMessageIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type MemoryPage = {
  memories: RetrievedMemory[];
  nextCursor: string | null;
};

export type MemoryHealth = {
  enabled: boolean;
  ready: boolean;
  status: "disabled" | "ready" | "degraded" | "misconfigured";
  detail: string;
  provider: "app-sqlite-vector";
  vectorProvider: "sqlite";
  llmConfigured: boolean;
  embeddingConfigured: boolean;
  vectorConfigured: boolean;
  userDisabled: boolean;
  embeddingProvider?: "openai" | "deterministic" | "ollama";
  embeddingModel?: string;
};

export type CompletedTurn = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  userText: string;
  assistantText: string;
  completedAt: Date;
};

export interface TrainerMemoryStore {
  addCompletedTurn(input: CompletedTurn): Promise<void>;
  search(
    query: string,
    scope: MemoryScope,
    limit: number,
  ): Promise<RetrievedMemory[]>;
  list(limit: number, cursor?: string): Promise<MemoryPage>;
  update(id: string, text: string): Promise<void>;
  delete(id: string): Promise<void>;
  clearAll(): Promise<void>;
  health(): Promise<MemoryHealth>;
}
