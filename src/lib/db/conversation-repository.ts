import type {
  ChatRole,
  ChatGrounding,
  StoredChatMessage,
  StoredConversation,
  ConversationSummary,
  ChatMessagePage,
  ChatPageRequest,
} from "@/lib/chat/contracts";
import {
  DEFAULT_CONVERSATION_ID,
  GENERIC_CONVERSATION_TITLES,
  safeConversationId,
  normalizeConversationTitle,
  initialConversationTitle,
} from "@/lib/chat/conversation-policy";
export type {
  ChatRole,
  ChatGrounding,
  StoredChatMessage,
  StoredConversation,
  ConversationSummary,
  ChatMessagePage,
} from "@/lib/chat/contracts";
import { getDatabase } from "./connection";
import { adoptSummaryPin } from "./conversation-summary-pin";
import { safeFailureDiagnostic } from "../diagnostics/provider-failure";

let lastChatMessageTimestamp = 0;

function nextChatMessageTimestamp(): number {
  lastChatMessageTimestamp = Math.max(Date.now(), lastChatMessageTimestamp + 1);
  return lastChatMessageTimestamp;
}

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
  titlePending?: number;
};

/** Revalidate just the closed failure contract; full debug context remains private. */
function projectFailures(grounding: ChatGrounding): ChatGrounding {
  if (!Array.isArray(grounding?.debugTrace?.providerCalls)) return grounding;
  return {
    ...grounding,
    debugTrace: {
      ...grounding.debugTrace!,
      providerCalls: grounding.debugTrace!.providerCalls.map((call) =>
        call && typeof call === "object" && call.failure !== undefined
          ? { ...call, failure: safeFailureDiagnostic(call.failure) }
          : call,
      ),
    },
  };
}
function parseGrounding(value: string | null): ChatGrounding | null {
  if (!value) return null;
  try {
    return projectFailures(JSON.parse(value) as ChatGrounding);
  } catch {
    return null;
  }
}

function truncateJsonString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function compactGroundingForStorage(grounding: ChatGrounding): ChatGrounding {
  const trace = grounding.debugTrace;
  return {
    ...grounding,
    summary: grounding.summary
      ? truncateJsonString(grounding.summary, 300)
      : undefined,
    privacy: grounding.privacy
      ? truncateJsonString(grounding.privacy, 300)
      : undefined,
    toolSteps: grounding.toolSteps?.map((step) => ({
      index: step.index,
      tool: step.tool,
      status: step.status,
      summary: truncateJsonString(step.summary, 160),
      privacy: truncateJsonString(step.privacy, 100),
      reason: step.reason,
    })),
    ...(trace
      ? {
          debugTrace: {
            ...trace,
            userRequest: undefined,
            finalAnswer:
              "Omitted under storage pressure; see assistant message.",
            // Keep the chronological measurement spine, not just the first few calls.
            providerCalls: trace.providerCalls.slice(0, 30).map((call) => ({
              index: call.index,
              purpose: call.purpose,
              ...(call.elapsedMs !== undefined
                ? { elapsedMs: call.elapsedMs }
                : {}),
              ...(call.outcome ? { outcome: call.outcome } : {}),
              ...(call.tokenUsage ? { tokenUsage: call.tokenUsage } : {}),
              ...(call.toolCalls?.length
                ? {
                    toolCalls: [
                      ...new Set(
                        call.toolCalls.map(({ toolName }) => toolName),
                      ),
                    ]
                      .slice(0, 3)
                      .map((toolName) => ({
                        toolName: truncateJsonString(toolName, 80),
                        input: "omitted",
                      })),
                  }
                : {}),
              ...(call.error
                ? { error: truncateJsonString(call.error, 160) }
                : {}),
              ...(call.failure ? { failure: call.failure } : {}),
              truncated: true,
            })),
            toolSteps: trace.toolSteps.slice(0, 4).map((step) => ({
              index: step.index,
              tool: step.tool,
              status: step.status,
              summary: step.summary
                ? truncateJsonString(step.summary, 160)
                : undefined,
              reason: step.reason,
              truncated: true,
            })),
            truncated: true,
          },
        }
      : {}),
  };
}

function groundingJsonForStorage(
  grounding: ChatGrounding | null | undefined,
): string | null {
  if (!grounding) return null;
  const candidate = projectFailures(grounding);
  const json = JSON.stringify(candidate);
  if (json.length <= MAX_GROUNDING_JSON_CHARS) return json;
  const compact = compactGroundingForStorage(candidate);
  const compactJson = JSON.stringify(compact);
  if (compactJson.length <= MAX_GROUNDING_JSON_CHARS) return compactJson;
  // Oversized non-debug grounding must not evict long-turn timing/usage.
  const minimal = {
    conversationContext: compact.conversationContext,
    debugTrace: compact.debugTrace,
    toolSteps: compact.toolSteps?.map(({ index, tool, status, reason }) => ({
      index,
      tool,
      status,
      reason,
    })),
    summary: "Grounding details omitted under storage pressure.",
  };
  const minimalJson = JSON.stringify(minimal);
  return minimalJson.length <= MAX_GROUNDING_JSON_CHARS
    ? minimalJson
    : JSON.stringify({
        summary: "Grounding unavailable: exceeded storage envelope.",
      });
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
    ...(row.titlePending === undefined
      ? {}
      : { titlePending: row.titlePending === 1 }),
  };
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
  return getDatabase().transaction(() => {
    const inserted = getDatabase()
      .prepare(
        `insert into conversation (id, title, manual_title, created_at, updated_at)
         values (?, ?, 0, ?, ?)
         on conflict(id) do nothing`,
      )
      .run(conversationId, initialConversationTitle(title), now, now);
    if (inserted.changes) adoptSummaryPin(conversationId);
    return getConversation(conversationId)!;
  })();
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
      `select c.id, c.title, c.created_at as createdAt, c.updated_at as updatedAt,
          coalesce(a.pending, 0) as titlePending
       from conversation c left join conversation_title_attempt a on a.conversation_id = c.id
       order by c.updated_at desc, c.id desc
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
  getDatabase()
    .prepare(
      `insert into conversation_title_attempt (conversation_id, message_id, claimed, pending)
     select ?, id, 0, 0 from message where conversation_id = ?
     on conflict(conversation_id) do nothing`,
    )
    .run(conversationId, conversationId);
}

// A durable reservation is created only by the first generic-title fallback.
// Claiming it once prevents retries/overlapping requests from scheduling twice.
export function claimConversationTitle(message: StoredChatMessage): boolean {
  return (
    getDatabase()
      .prepare(
        `update conversation_title_attempt set claimed = 1, pending = 1
     where conversation_id = ? and message_id = ? and claimed = 0`,
      )
      .run(message.conversationId, message.id).changes === 1
  );
}

export function finishConversationTitle(
  message: StoredChatMessage,
  title: string | null,
): void {
  const db = getDatabase();
  db.transaction(() => {
    if (title)
      db.prepare(
        `update conversation set title = ?
       where id = ? and manual_title = 0 and title = ?
       and exists (select 1 from conversation_title_attempt a join message m on m.id = a.message_id
         where a.conversation_id = conversation.id and a.message_id = ? and a.pending = 1
         and m.conversation_id = conversation.id and m.role = 'user')`,
      ).run(
        normalizeConversationTitle(title),
        message.conversationId,
        initialConversationTitle(message.content),
        message.id,
      );
    db.prepare(
      `update conversation_title_attempt set pending = 0 where conversation_id = ? and message_id = ?`,
    ).run(message.conversationId, message.id);
  })();
}

export function appendChatMessage(input: {
  conversationId?: string;
  role: ChatRole;
  content: string;
  grounding?: ChatGrounding | null;
}): StoredChatMessage {
  return getDatabase().transaction(() => {
    const conversationId = safeConversationId(input.conversationId);
    ensureConversation(conversationId, "New chat");
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
  })();
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

export function listChatMessagePage(input: ChatPageRequest): ChatMessagePage {
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
