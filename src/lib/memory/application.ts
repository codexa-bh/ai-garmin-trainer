import {
  compactText,
  extractMemoryCandidates,
  unsafeMemoryReason,
} from "./filters";
import { mapKind, mapRow, rankMemories } from "./retrieval-policy";
import type { MemoryPorts, MemoryWrite } from "./ports";
import {
  LOCAL_MEMORY_USER_ID,
  type CompletedTurn,
  type MemoryHealth,
  type MemoryPage,
  type MemoryScope,
  type RetrievedMemory,
  type TrainerMemoryStore,
} from "./types";

export function createMemoryStore(ports: MemoryPorts): TrainerMemoryStore {
  return new PersonalizationMemory(ports);
}
class PersonalizationMemory implements TrainerMemoryStore {
  constructor(private readonly ports: MemoryPorts) {}
  private problems(): string[] {
    return this.ports.settings.problems;
  }
  private async upsertMemory(input: MemoryWrite): Promise<void> {
    const safeText = compactText(input.text, 700);
    if (!safeText || unsafeMemoryReason(safeText)) return;
    const embedding = await this.ports.embedding(safeText);
    const now = this.ports.now();
    const createdAt = input.createdAt?.getTime() ?? now;
    this.ports.storage.upsert({
      ...input,
      text: safeText,
      embedding,
      embeddingModel: this.ports.settings.embeddingModel,
      now,
      createdAt: new Date(createdAt),
    });
  }

  private async migrateLegacy(): Promise<void> {
    if (this.ports.storage.migrationDone()) return;
    const rows = this.ports.storage.legacyRows(this.ports.now());
    for (const row of rows) {
      await this.upsertMemory({
        id: this.ports.stableId("semantic-legacy", [row.id]),
        kind: mapKind(row.category),
        text: row.value,
        source: "legacy-confirmed",
        conversationId: null,
        sourceMessageIds: row.sourceRef
          ? [`legacy:${row.sourceRef}`]
          : [`legacy:${row.id}`],
        createdAt: new Date(row.createdAt),
        expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      });
    }
    this.ports.storage.markMigrated();
  }

  async addCompletedTurn(input: CompletedTurn): Promise<void> {
    if (!this.ports.settings.effectiveEnabled) return;
    if (this.problems().length) throw new Error(this.problems().join("; "));
    await this.migrateLegacy();
    const mode = this.ports.extractionMode();
    const llmCandidates =
      mode === "llm" ? await this.ports.extract(input) : null;
    const candidates =
      mode === "off" ? [] : (llmCandidates ?? extractMemoryCandidates(input));
    for (const candidate of candidates) {
      await this.upsertMemory({
        id: this.ports.stableId("semantic-candidate", [
          input.userMessageId,
          candidate.kind,
          candidate.text,
        ]),
        kind: candidate.kind,
        text: candidate.text,
        source: candidate.source,
        conversationId: input.conversationId,
        sourceMessageIds: [input.userMessageId],
        createdAt: input.completedAt,
        expiresAt: candidate.expiresAt ?? null,
      });
    }
  }

  async search(
    query: string,
    scope: MemoryScope,
    limit: number,
  ): Promise<RetrievedMemory[]> {
    if (
      !this.ports.settings.effectiveEnabled ||
      scope.userId !== LOCAL_MEMORY_USER_ID
    )
      return [];
    if (this.problems().length) throw new Error(this.problems().join("; "));
    const safeQuery = compactText(query, 500);
    if (!safeQuery || unsafeMemoryReason(safeQuery)) return [];
    await this.migrateLegacy();
    const queryEmbedding = await this.ports.embedding(safeQuery);
    return rankMemories(
      this.ports.storage.rows(this.ports.now()),
      queryEmbedding,
      limit,
    );
  }

  async list(limit: number): Promise<MemoryPage> {
    if (!this.ports.settings.effectiveEnabled && this.problems().length) {
      return { memories: [], nextCursor: null };
    }
    if (this.ports.settings.effectiveEnabled) await this.migrateLegacy();
    return {
      memories: this.ports.storage
        .rows(this.ports.now())
        .slice(0, Math.min(Math.max(Math.trunc(limit), 1), 80))
        .map((row) => mapRow(row))
        .filter((item): item is RetrievedMemory => Boolean(item)),
      nextCursor: null,
    };
  }

  async update(id: string, text: string): Promise<void> {
    const safeText = compactText(text, 700);
    if (!safeText) throw new Error("Memory text is required");
    const unsafe = unsafeMemoryReason(safeText);
    if (unsafe) throw new Error(`Memory text rejected: ${unsafe}`);
    const embedding = await this.ports.embedding(safeText);
    this.ports.storage.update(
      id,
      safeText,
      embedding,
      this.ports.settings.embeddingModel,
      this.ports.now(),
    );
  }
  async delete(id: string): Promise<void> {
    this.ports.storage.delete(id, this.ports.now());
  }
  async clearAll(): Promise<void> {
    this.ports.storage.clearAll(this.ports.now());
  }

  async health(): Promise<MemoryHealth> {
    const problems = this.problems();
    const embeddingConfigured = this.ports.settings.embeddingConfigured;
    const base = {
      provider: "app-sqlite-vector" as const,
      vectorProvider: "sqlite" as const,
      llmConfigured: false,
      userDisabled: this.ports.settings.userDisabled,
      embeddingProvider: this.ports.settings.embeddingProvider,
      embeddingModel: this.ports.settings.embeddingModel,
    };
    if (!this.ports.settings.configuredEnabled) {
      return {
        ...base,
        enabled: false,
        ready: false,
        status: "disabled",
        detail: "Memory is disabled by MEMORY_ENABLED.",
        embeddingConfigured,
        vectorConfigured: true,
      };
    }
    if (this.ports.settings.userDisabled) {
      return {
        ...base,
        enabled: false,
        ready: false,
        status: "disabled",
        detail: "Memory is disabled in local settings.",
        embeddingConfigured,
        vectorConfigured: true,
        userDisabled: true,
      };
    }
    if (problems.length) {
      return {
        ...base,
        enabled: true,
        ready: false,
        status: "misconfigured",
        detail: problems.join("; "),
        embeddingConfigured: false,
        vectorConfigured: true,
        userDisabled: false,
      };
    }
    try {
      this.ports.storage.probe();
      if (this.ports.settings.embeddingProvider === "ollama")
        await this.ports.embedding("memory readiness probe");
      const detail =
        this.ports.settings.embeddingProvider === "deterministic"
          ? "Embedded SQLite semantic memory is configured with deterministic local embeddings."
          : this.ports.settings.embeddingProvider === "ollama"
            ? `Embedded SQLite semantic memory is configured with local Ollama embeddings using ${this.ports.settings.embeddingModel}.`
            : "Embedded SQLite semantic memory is configured with OpenAI-compatible embeddings via OPENAI_API_KEY.";
      return {
        ...base,
        enabled: true,
        ready: true,
        status: "ready",
        detail,
        embeddingConfigured: true,
        vectorConfigured: true,
        userDisabled: false,
      };
    } catch (error) {
      return {
        ...base,
        enabled: true,
        ready: false,
        status: "degraded",
        detail:
          error instanceof Error ? error.message : "SQLite memory check failed",
        embeddingConfigured: false,
        vectorConfigured:
          !(error instanceof Error) || !error.message.includes("SQLite"),
        userDisabled: false,
      };
    }
  }
}
