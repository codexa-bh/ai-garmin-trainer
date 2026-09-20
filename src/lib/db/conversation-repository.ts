import type { LlmDebugTrace } from "@/lib/ai/debug-trace";
import { getDatabase } from "./connection";

let lastChatMessageTimestamp = 0;

function nextChatMessageTimestamp(): number {
  lastChatMessageTimestamp = Math.max(Date.now(), lastChatMessageTimestamp + 1);
  return lastChatMessageTimestamp;
}

export const DEFAULT_CONVERSATION_ID = "default";
const GENERIC_CONVERSATION_TITLES = new Set(["Trainer chat", "New chat"]);

export type ChatRole = "user" | "assistant";

export type ChatGrounding = {
  debugTrace?: LlmDebugTrace;
  tool?: string;
  activityId?: string;
  activityName?: string | null;
  activityDate?: string | null;
  privacy?: string;
  summary?: string;
  toolSteps?: Array<{
    index: number;
    tool: string;
    status: "succeeded" | "rejected" | "failed";
    summary: string;
    activityIds?: string[];
    privacy: string;
    reason?: string;
    selection?: {
      reason: "multiple_tool_calls";
      count: number;
      toolNames: string[];
      selectedTool?: string;
    };
  }>;
};

export type StoredChatMessage = {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  grounding: ChatGrounding | null;
  createdAt: Date;
};

export type StoredConversation = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationSummary = StoredConversation;

export type ChatMessagePage = {
  conversationId: string;
  messages: StoredChatMessage[];
  nextCursor: string | null;
};

const MAX_GROUNDING_JSON_CHARS = 24000;

type StoredMessageRow = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  groundingJson: string | null;
  createdAt: number;
};

type StoredConversationRow = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

function parseGrounding(value: string | null): ChatGrounding | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ChatGrounding;
  } catch {
    return null;
  }
}

function truncateJsonString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function compactGroundingForStorage(grounding: ChatGrounding): ChatGrounding {
  if (!grounding.debugTrace) return grounding;
  const trace = grounding.debugTrace;
  return {
    ...grounding,
    debugTrace: {
      ...trace,
      userRequest: trace.userRequest
        ? truncateJsonString(trace.userRequest, 1200)
        : trace.userRequest,
      finalAnswer: truncateJsonString(trace.finalAnswer, 2400),
      providerCalls: trace.providerCalls.slice(0, 8).map((call) => ({
        ...call,
        text: call.text ? truncateJsonString(call.text, 700) : call.text,
        truncated:
          call.truncated || trace.providerCalls.length > 8 || undefined,
      })),
      toolSteps: trace.toolSteps.slice(0, 4).map((step) => ({
        ...step,
        result: step.result,
        summary: step.summary
          ? truncateJsonString(step.summary, 700)
          : step.summary,
        privacy: step.privacy
          ? truncateJsonString(step.privacy, 500)
          : step.privacy,
      })),
      truncated: trace.truncated || trace.providerCalls.length > 8 || undefined,
    },
  };
}

function groundingJsonForStorage(
  grounding: ChatGrounding | null | undefined,
): string | null {
  if (!grounding) return null;
  let candidate: ChatGrounding = grounding;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const json = JSON.stringify(candidate);
    if (json.length <= MAX_GROUNDING_JSON_CHARS) return json;
    candidate = compactGroundingForStorage(candidate);
    if (candidate.debugTrace) {
      candidate = {
        ...candidate,
        debugTrace: {
          ...candidate.debugTrace,
          userRequest: candidate.debugTrace.userRequest
            ? truncateJsonString(candidate.debugTrace.userRequest, 600)
            : candidate.debugTrace.userRequest,
          finalAnswer: truncateJsonString(
            candidate.debugTrace.finalAnswer,
            1200,
          ),
          providerCalls: candidate.debugTrace.providerCalls.slice(0, 4),
          toolSteps: candidate.debugTrace.toolSteps.map((step) => ({
            index: step.index,
            tool: step.tool,
            status: step.status,
            summary: step.summary
              ? truncateJsonString(step.summary, 300)
              : step.summary,
            reason: step.reason,
            truncated: true,
          })),
          truncated: true,
        },
      };
    }
  }
  const fallback = { ...candidate, debugTrace: undefined };
  return JSON.stringify(fallback);
}

function mapStoredMessage(row: StoredMessageRow): StoredChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    grounding: parseGrounding(row.groundingJson),
    createdAt: new Date(row.createdAt),
  };
}

function mapStoredConversation(row: StoredConversationRow): StoredConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function safeConversationId(value: string | null | undefined): string {
  const candidate = value?.trim() || DEFAULT_CONVERSATION_ID;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(candidate)) {
    throw new Error(
      "Conversation id must be a local opaque id with letters, numbers, dashes, underscores, dots, or colons only",
    );
  }
  return candidate;
}

export function normalizeConversationTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) throw new Error("Conversation title cannot be empty");
  return compact.length > 48 ? `${compact.slice(0, 47)}…` : compact;
}

export function initialConversationTitle(value: string): string {
  try {
    return normalizeConversationTitle(value);
  } catch {
    return "New chat";
  }
}

function conversationCursor(
  row: Pick<StoredMessageRow, "createdAt" | "id">,
): string {
  return Buffer.from(`${row.createdAt}:${row.id}`, "utf8").toString(
    "base64url",
  );
}

function parseConversationCursor(cursor: string | null | undefined): {
  createdAt: number;
  id: string;
} | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf(":");
    const createdAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!Number.isFinite(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function getConversation(
  id = DEFAULT_CONVERSATION_ID,
): StoredConversation | null {
  const row = getDatabase()
    .prepare(
      "select id, title, created_at as createdAt, updated_at as updatedAt from conversation where id = ?",
    )
    .get(safeConversationId(id)) as StoredConversationRow | undefined;
  return row ? mapStoredConversation(row) : null;
}

export function ensureConversation(
  id = DEFAULT_CONVERSATION_ID,
  title = "Trainer chat",
): StoredConversation {
  const conversationId = safeConversationId(id);
  const now = Date.now();
  getDatabase()
    .prepare(
      `insert into conversation (id, title, manual_title, created_at, updated_at)
       values (?, ?, 0, ?, ?)
       on conflict(id) do nothing`,
    )
    .run(conversationId, initialConversationTitle(title), now, now);
  return getConversation(conversationId)!;
}

export function createConversation(input?: {
  id?: string;
  title?: string;
}): StoredConversation {
  const id = safeConversationId(
    input?.id ??
      `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  return ensureConversation(id, input?.title ?? "New chat");
}

export function listConversations(limit = 40): ConversationSummary[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 80);
  const rows = getDatabase()
    .prepare(
      `select id, title, created_at as createdAt, updated_at as updatedAt
       from conversation
       order by updated_at desc, id desc
       limit ?`,
    )
    .all(safeLimit) as StoredConversationRow[];
  return rows.map(mapStoredConversation);
}

export function renameConversation(
  id: string,
  title: string,
): StoredConversation | null {
  const conversationId = safeConversationId(id);
  const normalizedTitle = normalizeConversationTitle(title);
  const now = Date.now();
  const changes = getDatabase()
    .prepare(
      "update conversation set title = ?, manual_title = 1, updated_at = ? where id = ?",
    )
    .run(normalizedTitle, now, conversationId).changes;
  return changes > 0 ? getConversation(conversationId) : null;
}

function retitleInitialConversationIfNeeded(
  conversationId: string,
  role: ChatRole,
  content: string,
  createdAt: number,
): void {
  if (role !== "user") return;
  const row = getDatabase()
    .prepare(
      `select c.title as title, c.manual_title as manualTitle, count(m.id) as messageCount
       from conversation c left join message m on m.conversation_id = c.id
       where c.id = ?
       group by c.id`,
    )
    .get(conversationId) as
    { title: string; manualTitle: number; messageCount: number } | undefined;
  if (
    !row ||
    row.manualTitle === 1 ||
    row.messageCount !== 1 ||
    !GENERIC_CONVERSATION_TITLES.has(row.title)
  )
    return;
  getDatabase()
    .prepare("update conversation set title = ?, updated_at = ? where id = ?")
    .run(initialConversationTitle(content), createdAt, conversationId);
}

export function appendChatMessage(input: {
  conversationId?: string;
  role: ChatRole;
  content: string;
  grounding?: ChatGrounding | null;
}): StoredChatMessage {
  const conversationId = safeConversationId(input.conversationId);
  ensureConversation(conversationId, input.content.slice(0, 80));
  const createdAt = nextChatMessageTimestamp();
  const id = `${conversationId}-${input.role}-${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
  getDatabase()
    .prepare(
      `insert into message (id, conversation_id, role, content, grounding_json, created_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      conversationId,
      input.role,
      input.content.slice(0, 12000),
      groundingJsonForStorage(input.grounding),
      createdAt,
    );
  retitleInitialConversationIfNeeded(
    conversationId,
    input.role,
    input.content,
    createdAt,
  );
  getDatabase()
    .prepare("update conversation set updated_at = ? where id = ?")
    .run(createdAt, conversationId);
  return {
    id,
    conversationId,
    role: input.role,
    content: input.content.slice(0, 12000),
    grounding: input.grounding ?? null,
    createdAt: new Date(createdAt),
  };
}

export function listRecentChatMessages(
  conversationId = DEFAULT_CONVERSATION_ID,
  limit = 12,
): StoredChatMessage[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 40);
  const rows = getDatabase()
    .prepare(
      `select id, conversation_id as conversationId, role, content, grounding_json as groundingJson, created_at as createdAt
       from message
       where conversation_id = ?
       order by created_at desc, id desc
       limit ?`,
    )
    .all(safeConversationId(conversationId), safeLimit) as StoredMessageRow[];
  return rows.reverse().map(mapStoredMessage);
}

export function listChatMessagePage(input: {
  conversationId?: string;
  cursor?: string | null;
  limit?: number;
}): ChatMessagePage {
  const conversationId = safeConversationId(input.conversationId);
  const safeLimit = Math.min(Math.max(Math.trunc(input.limit ?? 30), 1), 60);
  const cursor = parseConversationCursor(input.cursor);
  const sql = cursor
    ? `select id, conversation_id as conversationId, role, content, grounding_json as groundingJson, created_at as createdAt
       from message
       where conversation_id = ? and (created_at < ? or (created_at = ? and id < ?))
       order by created_at desc, id desc
       limit ?`
    : `select id, conversation_id as conversationId, role, content, grounding_json as groundingJson, created_at as createdAt
       from message
       where conversation_id = ?
       order by created_at desc, id desc
       limit ?`;
  const params = cursor
    ? [
        conversationId,
        cursor.createdAt,
        cursor.createdAt,
        cursor.id,
        safeLimit + 1,
      ]
    : [conversationId, safeLimit + 1];
  const rows = getDatabase()
    .prepare(sql)
    .all(...params) as StoredMessageRow[];
  const visibleRows = rows.slice(0, safeLimit);
  const nextCursor =
    rows.length > safeLimit && visibleRows.length
      ? conversationCursor(visibleRows[visibleRows.length - 1]!)
      : null;
  return {
    conversationId,
    messages: [...visibleRows].reverse().map(mapStoredMessage),
    nextCursor,
  };
}
