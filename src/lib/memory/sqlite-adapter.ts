import { createHash } from "node:crypto";
import { getAppMetadata, getDatabase, setAppMetadata } from "../db/repository";
import {
  memoryConfigProblems,
  memoryRuntimeConfig,
  type MemoryRuntimeConfig,
} from "./config";
import {
  extractMemoryCandidatesWithLlm,
  memoryExtractionMode,
} from "./extractor";
import {
  classifyMemory,
  compactText,
  extractMemoryCandidates,
  memorySafeToRender,
  unsafeMemoryReason,
} from "./filters";
import {
  LOCAL_MEMORY_USER_ID,
  type CompletedTurn,
  type MemoryHealth,
  type MemoryPage,
  type MemoryScope,
  type RetrievedMemory,
  type TrainerMemoryStore,
} from "./types";

const LEGACY_MIGRATION_KEY = "memory.sqlite_legacy_migrated";
const ACTIVE_STATUS = "active";

type SemanticMemoryRow = {
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

type LegacyMemoryRow = {
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

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24)}`;
}

function deterministicEmbedding(text: string, dims: number): number[] {
  const vector = Array.from({ length: dims }, () => 0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    const digest = createHash("sha256").update(word).digest();
    const index = digest.readUInt32BE(0) % dims;
    const sign = digest[4]! % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  return normalize(vector);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function providerVector(vector: unknown, label: string): number[] {
  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    !vector.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw new Error(`${label} response invalid vector`);
  const normalized = normalize(vector);
  if (!normalized.some((value) => value !== 0))
    throw new Error(`${label} response invalid vector`);
  return normalized;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function ollamaFailureMessage(
  status: number,
  error: unknown,
  model: string,
): string {
  const detail = typeof error === "string" ? error.toLowerCase() : "";
  if (status === 404 || detail.includes("not found") || detail.includes("pull"))
    return `memory embedding Ollama model not found; run ollama pull ${model}`;
  return `memory embedding Ollama HTTP ${status}`;
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let score = 0;
  for (let index = 0; index < length; index += 1)
    score += a[index]! * b[index]!;
  return score;
}

function sourceMessageIdsJson(ids: string[]): string {
  return JSON.stringify(ids.slice(0, 8));
}

function parseSourceMessageIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapKind(category: string): RetrievedMemory["kind"] {
  if (category === "temporary_constraint") return "temporary";
  if (category === "commitment") return "saved_preference";
  return "saved_preference";
}

function mapRow(
  row: SemanticMemoryRow,
  score?: number,
): RetrievedMemory | null {
  const item: RetrievedMemory = {
    id: row.id,
    text: row.text,
    kind: classifyMemory({ metadata: { kind: row.kind }, memory: row.text }),
    score,
    conversationId: row.sourceConversationId ?? undefined,
    sourceMessageIds: parseSourceMessageIds(row.sourceMessageIdsJson),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    expiresAt: row.expiresAt
      ? new Date(row.expiresAt).toISOString()
      : undefined,
  };
  return memorySafeToRender(item) ? item : null;
}

export class SqliteTrainerMemoryStore implements TrainerMemoryStore {
  private readonly config: MemoryRuntimeConfig;

  constructor(config: MemoryRuntimeConfig = memoryRuntimeConfig()) {
    this.config = config;
  }

  private problems(): string[] {
    return memoryConfigProblems(this.config);
  }

  private async embedding(text: string): Promise<number[]> {
    if (this.config.embeddingProvider === "deterministic") {
      return deterministicEmbedding(text, this.config.embeddingDims);
    }
    if (this.config.embeddingProvider === "ollama") {
      const url = joinUrl(this.config.embeddingBaseUrl!, "/api/embed");
      let response: Response;
      try {
        response = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: this.config.embeddingModel,
              input: text,
            }),
          }),
          this.config.timeoutMs,
          "memory embedding Ollama",
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("timed out"))
          throw new Error("memory embedding Ollama timed out");
        throw new Error(
          "memory embedding Ollama daemon unavailable; start Ollama",
        );
      }
      const body = (await response.json().catch(() => ({}))) as {
        embeddings?: unknown[];
        embedding?: unknown;
        error?: unknown;
      };
      if (!response.ok)
        throw new Error(
          ollamaFailureMessage(
            response.status,
            body.error,
            this.config.embeddingModel,
          ),
        );
      return providerVector(
        body.embeddings?.[0] ?? body.embedding,
        "memory embedding Ollama",
      );
    }
    if (!this.config.embeddingApiKey)
      throw new Error("memory embedding key missing");
    const url = joinUrl(
      this.config.embeddingBaseUrl ?? "https://api.openai.com/v1",
      "/embeddings",
    );
    const response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.embeddingApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.embeddingModel,
          input: text,
          dimensions: this.config.embeddingDims,
        }),
      }),
      this.config.timeoutMs,
      "memory embedding",
    );
    if (!response.ok)
      throw new Error(`memory embedding HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    return providerVector(body.data?.[0]?.embedding, "memory embedding");
  }

  private rows(): SemanticMemoryRow[] {
    const now = Date.now();
    return getDatabase()
      .prepare(
        `select id, user_id as userId, kind, text, status, embedding_json as embeddingJson,
                embedding_model as embeddingModel, source_conversation_id as sourceConversationId,
                source_message_ids_json as sourceMessageIdsJson, source, created_at as createdAt,
                updated_at as updatedAt, expires_at as expiresAt
         from semantic_memory
         where user_id = ? and status = ? and (expires_at is null or expires_at > ?)
         order by updated_at desc
         limit 200`,
      )
      .all(LOCAL_MEMORY_USER_ID, ACTIVE_STATUS, now) as SemanticMemoryRow[];
  }

  private async upsertMemory(input: {
    id: string;
    kind: RetrievedMemory["kind"];
    text: string;
    source: string;
    conversationId?: string | null;
    sourceMessageIds?: string[];
    createdAt?: Date;
    expiresAt?: Date | null;
  }): Promise<void> {
    const safeText = compactText(input.text, 700);
    if (!safeText || unsafeMemoryReason(safeText)) return;
    const embedding = await this.embedding(safeText);
    const now = Date.now();
    const createdAt = input.createdAt?.getTime() ?? now;
    getDatabase()
      .prepare(
        `insert into semantic_memory (id, user_id, kind, text, status, embedding_json, embedding_model,
                                      source_conversation_id, source_message_ids_json, source,
                                      created_at, updated_at, expires_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set text = excluded.text,
                                      status = excluded.status,
                                      embedding_json = excluded.embedding_json,
                                      embedding_model = excluded.embedding_model,
                                      updated_at = excluded.updated_at,
                                      expires_at = excluded.expires_at`,
      )
      .run(
        input.id,
        LOCAL_MEMORY_USER_ID,
        input.kind,
        safeText,
        ACTIVE_STATUS,
        JSON.stringify(embedding),
        this.config.embeddingModel,
        input.conversationId ?? null,
        sourceMessageIdsJson(input.sourceMessageIds ?? []),
        input.source,
        createdAt,
        now,
        input.expiresAt?.getTime() ?? null,
      );
  }

  private async migrateLegacy(): Promise<void> {
    if (getAppMetadata(LEGACY_MIGRATION_KEY) === "done") return;
    const rows = getDatabase()
      .prepare(
        `select id, category, value, status, source_type as sourceType, source_ref as sourceRef,
                provenance_text as provenanceText, created_at as createdAt, updated_at as updatedAt,
                expires_at as expiresAt
         from trainer_memory
         where status = 'confirmed' and (expires_at is null or expires_at > ?)`,
      )
      .all(Date.now()) as LegacyMemoryRow[];
    for (const row of rows) {
      await this.upsertMemory({
        id: stableId("semantic-legacy", [row.id]),
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
    setAppMetadata(LEGACY_MIGRATION_KEY, "done");
  }

  async addCompletedTurn(input: CompletedTurn): Promise<void> {
    if (!this.config.effectiveEnabled) return;
    if (this.problems().length) throw new Error(this.problems().join("; "));
    await this.migrateLegacy();
    const mode = memoryExtractionMode();
    const llmCandidates =
      mode === "llm" ? await extractMemoryCandidatesWithLlm(input) : null;
    const candidates =
      mode === "off" ? [] : (llmCandidates ?? extractMemoryCandidates(input));
    for (const candidate of candidates) {
      await this.upsertMemory({
        id: stableId("semantic-candidate", [
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
    if (!this.config.effectiveEnabled || scope.userId !== LOCAL_MEMORY_USER_ID)
      return [];
    if (this.problems().length) throw new Error(this.problems().join("; "));
    const safeQuery = compactText(query, 500);
    if (!safeQuery || unsafeMemoryReason(safeQuery)) return [];
    await this.migrateLegacy();
    const queryEmbedding = await this.embedding(safeQuery);
    return this.rows()
      .map((row) => {
        try {
          const embedding = JSON.parse(row.embeddingJson) as number[];
          const score = cosine(queryEmbedding, embedding);
          return { row, score };
        } catch {
          return { row, score: -1 };
        }
      })
      .filter(({ score }) => score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Math.max(Math.trunc(limit), 1), 8))
      .map(({ row, score }) => mapRow(row, score))
      .filter((item): item is RetrievedMemory => Boolean(item));
  }

  async list(limit: number): Promise<MemoryPage> {
    if (!this.config.effectiveEnabled && this.problems().length) {
      return { memories: [], nextCursor: null };
    }
    if (this.config.effectiveEnabled) await this.migrateLegacy();
    return {
      memories: this.rows()
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
    const embedding = await this.embedding(safeText);
    getDatabase()
      .prepare(
        `update semantic_memory
         set text = ?, embedding_json = ?, embedding_model = ?, updated_at = ?
         where id = ? and user_id = ? and status = ?`,
      )
      .run(
        safeText,
        JSON.stringify(embedding),
        this.config.embeddingModel,
        Date.now(),
        id,
        LOCAL_MEMORY_USER_ID,
        ACTIVE_STATUS,
      );
  }

  async delete(id: string): Promise<void> {
    getDatabase()
      .prepare(
        "update semantic_memory set status = 'deleted', updated_at = ? where id = ? and user_id = ?",
      )
      .run(Date.now(), id, LOCAL_MEMORY_USER_ID);
  }

  async clearAll(): Promise<void> {
    getDatabase()
      .prepare(
        "update semantic_memory set status = 'deleted', updated_at = ? where user_id = ?",
      )
      .run(Date.now(), LOCAL_MEMORY_USER_ID);
  }

  async health(): Promise<MemoryHealth> {
    const problems = this.problems();
    const embeddingConfigured =
      this.config.embeddingProvider === "deterministic" ||
      this.config.embeddingProvider === "ollama" ||
      Boolean(this.config.embeddingApiKey);
    const base = {
      provider: "app-sqlite-vector" as const,
      vectorProvider: "sqlite" as const,
      llmConfigured: false,
      userDisabled: this.config.userDisabled,
      embeddingProvider: this.config.embeddingProvider,
      embeddingModel: this.config.embeddingModel,
    };
    if (!this.config.configuredEnabled) {
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
    if (this.config.userDisabled) {
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
      getDatabase()
        .prepare("select count(*) as count from semantic_memory")
        .get();
      if (this.config.embeddingProvider === "ollama")
        await this.embedding("memory readiness probe");
      const detail =
        this.config.embeddingProvider === "deterministic"
          ? "Embedded SQLite semantic memory is configured with deterministic local embeddings."
          : this.config.embeddingProvider === "ollama"
            ? `Embedded SQLite semantic memory is configured with local Ollama embeddings using ${this.config.embeddingModel}.`
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

let singleton: TrainerMemoryStore | null = null;

export function trainerMemoryStore(): TrainerMemoryStore {
  singleton ??= new SqliteTrainerMemoryStore();
  return singleton;
}

export function resetTrainerMemoryStore(): void {
  singleton = null;
}
