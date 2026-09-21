import { classifyMemory, memorySafeToRender } from "./filters";
import type { SemanticMemoryRow } from "./ports";
import type { RetrievedMemory } from "./types";
function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let score = 0;
  for (let index = 0; index < length; index += 1)
    score += a[index]! * b[index]!;
  return score;
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

export function mapKind(category: string): RetrievedMemory["kind"] {
  if (category === "temporary_constraint") return "temporary";
  if (category === "commitment") return "saved_preference";
  return "saved_preference";
}

export function mapRow(
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

export function rankMemories(
  rows: SemanticMemoryRow[],
  queryEmbedding: number[],
  limit: number,
): RetrievedMemory[] {
  return rows
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
