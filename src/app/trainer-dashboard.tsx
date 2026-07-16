"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = { kind: "idle" | "ok" | "error" | "busy"; message: string };
type ChatRole = "user" | "assistant";
type ChatGrounding = {
  tool?: string;
  activityId?: string;
  activityName?: string | null;
  activityDate?: string | null;
  privacy?: string;
  summary?: string;
};
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  grounding?: ChatGrounding | null;
};
type ChatPayload = {
  conversationId: string;
  messages: ChatMessage[];
  contextWindow?: number;
  historyLimit?: number;
  toolEvidence?: ChatGrounding | null;
};

async function readResponse(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.ok ? "OK" : `HTTP ${response.status}`;
  try {
    const json = JSON.parse(text) as unknown;
    return JSON.stringify(json, null, 2);
  } catch {
    return text;
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    try {
      const json = JSON.parse(text) as { error?: string };
      throw new Error(json.error ?? `HTTP ${response.status}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message !== "Unexpected end of JSON input"
      )
        throw error;
      throw new Error(text || `HTTP ${response.status}`);
    }
  }
  return JSON.parse(text) as T;
}

export function TrainerDashboard() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Ready. Sign in first, then verify the connector.",
  });
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState("default");
  const [contextWindow, setContextWindow] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(12);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState("");
  const [profileGoals, setProfileGoals] = useState("");
  const [profileSports, setProfileSports] = useState("");
  const [profileConstraints, setProfileConstraints] = useState("");
  const [detailGarminId, setDetailGarminId] = useState("");

  const latestToolEvidence = useMemo(
    () => [...chatMessages].reverse().find((item) => item.grounding)?.grounding,
    [chatMessages],
  );

  useEffect(() => {
    void loadChatHistory(false);
  }, []);

  async function loadChatHistory(showStatus = true) {
    if (showStatus)
      setStatus({ kind: "busy", message: "Chat: loading local history…" });
    try {
      const payload = await readJsonResponse<ChatPayload>(
        await fetch("/api/chat", { method: "GET" }),
      );
      setConversationId(payload.conversationId);
      setChatMessages(payload.messages);
      setContextWindow(payload.contextWindow ?? 0);
      setHistoryLimit(payload.historyLimit ?? 12);
      setLastFailedMessage("");
      if (showStatus)
        setStatus({
          kind: "ok",
          message: `Chat: loaded ${payload.messages.length} local messages.`,
        });
    } catch (error) {
      if (showStatus)
        setStatus({
          kind: "error",
          message: `Chat history failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
    }
  }

  async function runAction(label: string, request: () => Promise<Response>) {
    setStatus({ kind: "busy", message: `${label}…` });
    try {
      const response = await request();
      const body = await readResponse(response);
      setStatus({
        kind: response.ok ? "ok" : "error",
        message: `${label}: ${response.ok ? "success" : `failed (${response.status})`}\n${body}`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `${label}: ${error instanceof Error ? error.message : "failed"}`,
      });
    }
  }

  async function localDevLogin(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await runAction("Local allowlist sign-in", () =>
      fetch("/api/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(email.trim() ? { email } : {}),
      }),
    );
    await loadChatHistory(false);
  }

  async function syncNow() {
    setStatus({ kind: "busy", message: "Sync now: starting…" });
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        setStatus({
          kind: "error",
          message: `Sync now: failed (${response.status})\n${body}`,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let log = "";
      let finalKind: Status["kind"] = "ok";

      const appendLine = (line: string) => {
        log = `${log}${line}\n`.split("\n").slice(-20).join("\n");
        setStatus({
          kind: finalKind === "error" ? "error" : "busy",
          message: log.trim(),
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type?: string;
            status?: string;
            stage?: string;
            message?: string;
            detail?: string;
            activitiesImported?: number;
            healthDaysImported?: number;
          };
          if (event.type === "result") {
            finalKind = event.status === "completed" ? "ok" : "error";
            appendLine(
              `Result: ${event.status}. Activities: ${event.activitiesImported ?? 0}; health days: ${event.healthDaysImported ?? 0}. ${event.detail ?? ""}`,
            );
          } else {
            appendLine(
              `${event.stage ?? "progress"}: ${event.message ?? "working"} (activities ${event.activitiesImported ?? 0}, health days ${event.healthDaysImported ?? 0})`,
            );
          }
        }
      }
      setStatus({ kind: finalKind, message: log.trim() || "Sync complete." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Sync now failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function refreshSummary() {
    await runAction("Import summary", () => fetch("/api/summary"));
  }

  async function refreshDetailCoverage() {
    await runAction("Activity detail coverage", () =>
      fetch("/api/activity-detail"),
    );
  }

  async function backfillDetail() {
    const garminId = detailGarminId.trim();
    if (!garminId) {
      setStatus({
        kind: "error",
        message: "Enter an imported Garmin activity ID first.",
      });
      return;
    }
    await runAction("Detailed activity backfill", () =>
      fetch("/api/activity-detail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ garminId }),
      }),
    );
  }

  async function clearChatHistory() {
    setStatus({ kind: "busy", message: "Chat: clearing local history…" });
    try {
      const payload = await readJsonResponse<ChatPayload>(
        await fetch("/api/chat", { method: "DELETE" }),
      );
      setConversationId(payload.conversationId);
      setChatMessages([]);
      setContextWindow(0);
      setLastFailedMessage("");
      setStatus({
        kind: "ok",
        message: "Chat: local conversation history cleared.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Chat clear failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  async function saveProfile() {
    await runAction("Save profile", () =>
      fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goals: profileGoals,
          sports: profileSports,
          constraints: profileConstraints,
          preferences: {},
        }),
      }),
    );
  }

  async function submitChat(text: string) {
    if (!text.trim() || isChatLoading) return;
    const trimmed = text.trim();
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessage("");
    setLastFailedMessage("");
    setIsChatLoading(true);
    setChatMessages((items) => [...items, optimistic]);
    setStatus({ kind: "busy", message: "Chat: trainer is thinking…" });
    try {
      const payload = await readJsonResponse<ChatPayload>(
        await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message: trimmed }),
        }),
      );
      setConversationId(payload.conversationId);
      setChatMessages(payload.messages);
      setContextWindow(payload.contextWindow ?? payload.messages.length);
      setHistoryLimit(payload.historyLimit ?? historyLimit);
      setStatus({
        kind: "ok",
        message: `Chat: response complete. Context used ${payload.contextWindow ?? payload.messages.length}/${payload.historyLimit ?? historyLimit} recent local turns${payload.toolEvidence?.tool ? ` with ${payload.toolEvidence.tool}` : ""}.`,
      });
    } catch (error) {
      setLastFailedMessage(trimmed);
      setChatMessages((items) =>
        items.filter((item) => item.id !== optimistic.id),
      );
      setStatus({
        kind: "error",
        message: `Chat failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    } finally {
      setIsChatLoading(false);
    }
  }

  async function sendChat() {
    await submitChat(message);
  }

  return (
    <section className="grid">
      <article>
        <h2>Sign in</h2>
        <p>
          For this local MVP smoke, use one-click local sign-in with the first
          configured <code>ALLOWED_GOOGLE_EMAILS</code> entry. Google OAuth
          remains configured through <code>/api/auth</code>.
        </p>
        <button type="button" onClick={() => localDevLogin()}>
          Use configured local session
        </button>
        <form onSubmit={localDevLogin} className="stack">
          <input
            aria-label="Allowlisted email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit">Use typed local session</button>
        </form>
      </article>

      <article>
        <h2>Connector</h2>
        <p>
          Run <code>garmin-mcp-auth</code> outside the app, then use Sync now.
          The app uses only pinned stdio read operations and never sees your
          Garmin password.
        </p>
        <button
          type="button"
          onClick={() =>
            runAction("Verify connector", () => fetch("/api/sync"))
          }
        >
          Verify connector
        </button>
        <button type="button" onClick={syncNow}>
          Sync now
        </button>
      </article>

      <article>
        <h2>Import summary</h2>
        <p>
          Check imported totals, latest activity date, and health coverage
          before asking the trainer to reason about trends.
        </p>
        <button type="button" onClick={refreshSummary}>
          Refresh import summary
        </button>
      </article>

      <article>
        <h2>Activity detail</h2>
        <p>
          Backfill one imported activity at a time into local SQLite detail
          tables. Raw FIT payloads are discarded after normalization; trainer
          tools expose only bounded computed summaries/slices.
        </p>
        <input
          aria-label="Garmin activity ID"
          placeholder="Garmin activity ID"
          value={detailGarminId}
          onChange={(event) => setDetailGarminId(event.target.value)}
        />
        <button type="button" onClick={backfillDetail}>
          Backfill detail
        </button>
        <button type="button" onClick={refreshDetailCoverage}>
          Show detail coverage
        </button>
      </article>

      <article className="wide">
        <div className="chat-header">
          <div>
            <h2>Trainer chat</h2>
            <p>
              Responses cite relevant dates, activities, trends, and
              deterministic analytics tool results when activity detail is
              needed. Conversation history and profile memory persist locally.
            </p>
          </div>
          <div className="context-card" aria-label="Recent context window">
            <strong>Recent context</strong>
            <span>
              {contextWindow}/{historyLimit} local messages sent to grounding
            </span>
            <span>Conversation: {conversationId}</span>
            {latestToolEvidence ? (
              <span>
                Last tool: {latestToolEvidence.tool}
                {latestToolEvidence.activityName
                  ? ` — ${latestToolEvidence.activityName}`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="transcript" aria-live="polite">
          {chatMessages.length === 0 && !isChatLoading ? (
            <p className="empty-chat">
              No local chat history yet. Ask for an activity analysis, then ask
              a follow-up; the latest bounded turns and tool evidence will be
              used.
            </p>
          ) : null}
          {chatMessages.map((item) => (
            <div key={item.id} className={`chat-message ${item.role}`}>
              <div className="chat-meta">
                <strong>{item.role === "user" ? "You" : "Trainer"}</strong>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </div>
              <p>{item.content}</p>
              {item.grounding ? (
                <div className="tool-evidence">
                  <span>Tool evidence: {item.grounding.tool}</span>
                  {item.grounding.activityId ? (
                    <span>Activity {item.grounding.activityId}</span>
                  ) : null}
                  {item.grounding.summary ? (
                    <span>{item.grounding.summary}</span>
                  ) : null}
                  {item.grounding.privacy ? (
                    <span>Privacy: {item.grounding.privacy}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {isChatLoading ? (
            <div className="chat-message assistant pending">
              <div className="chat-meta">
                <strong>Trainer</strong>
                <span>pending</span>
              </div>
              <p>Trainer is thinking with bounded local history…</p>
            </div>
          ) : null}
        </div>

        <textarea
          aria-label="Message"
          placeholder="Ask about my latest hike, then try: what should I do tomorrow based on that?"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void sendChat();
            }
          }}
        />
        <button type="button" onClick={sendChat} disabled={isChatLoading}>
          {isChatLoading ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={() => loadChatHistory()}
          disabled={isChatLoading}
        >
          Reload history
        </button>
        <button
          type="button"
          onClick={clearChatHistory}
          disabled={isChatLoading}
        >
          Clear local history
        </button>
        {lastFailedMessage ? (
          <button
            type="button"
            onClick={() => submitChat(lastFailedMessage)}
            disabled={isChatLoading}
          >
            Retry last message
          </button>
        ) : null}
      </article>

      <article>
        <h2>Profile memory</h2>
        <p>
          Set one item per line. The trainer uses this profile together with
          imported Garmin facts.
        </p>
        <label>
          Goals
          <textarea
            aria-label="Goals"
            value={profileGoals}
            onChange={(event) => setProfileGoals(event.target.value)}
            placeholder="Build hiking endurance"
          />
        </label>
        <label>
          Preferred sports
          <textarea
            aria-label="Preferred sports"
            value={profileSports}
            onChange={(event) => setProfileSports(event.target.value)}
            placeholder="hiking\nmountaineering"
          />
        </label>
        <label>
          Constraints
          <textarea
            aria-label="Constraints"
            value={profileConstraints}
            onChange={(event) => setProfileConstraints(event.target.value)}
            placeholder="no running this week"
          />
        </label>
        <button type="button" onClick={saveProfile}>
          Save profile
        </button>
      </article>

      <article>
        <h2>Deletion</h2>
        <button
          type="button"
          onClick={() =>
            runAction("Clear chat/profile", () =>
              fetch("/api/delete", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ scope: "chat-profile" }),
              }),
            )
          }
        >
          Clear chat/profile
        </button>
        <button
          type="button"
          onClick={() =>
            runAction("Disconnect Garmin/delete data", () =>
              fetch("/api/delete", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ scope: "garmin-all" }),
              }),
            )
          }
        >
          Disconnect Garmin/delete data
        </button>
      </article>

      <article className="wide">
        <h2>Action status</h2>
        <pre className={`status ${status.kind}`}>{status.message}</pre>
      </article>
    </section>
  );
}
