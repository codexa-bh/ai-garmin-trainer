import { createHash } from "node:crypto";
import type { MemoryRuntimeConfig } from "./config";
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

export function stableId(prefix: string, parts: string[]): string {
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

export function createEmbedding(config: MemoryRuntimeConfig) {
  return async function embedding(text: string): Promise<number[]> {
    if (config.embeddingProvider === "deterministic") {
      return deterministicEmbedding(text, config.embeddingDims);
    }
    if (config.embeddingProvider === "ollama") {
      const url = joinUrl(config.embeddingBaseUrl!, "/api/embed");
      let response: Response;
      try {
        response = await withTimeout(
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: config.embeddingModel,
              input: text,
            }),
          }),
          config.timeoutMs,
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
            config.embeddingModel,
          ),
        );
      return providerVector(
        body.embeddings?.[0] ?? body.embedding,
        "memory embedding Ollama",
      );
    }
    if (!config.embeddingApiKey)
      throw new Error("memory embedding key missing");
    const url = joinUrl(
      config.embeddingBaseUrl ?? "https://api.openai.com/v1",
      "/embeddings",
    );
    const response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.embeddingApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.embeddingModel,
          input: text,
          dimensions: config.embeddingDims,
        }),
      }),
      config.timeoutMs,
      "memory embedding",
    );
    if (!response.ok)
      throw new Error(`memory embedding HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    return providerVector(body.data?.[0]?.embedding, "memory embedding");
  };
}
