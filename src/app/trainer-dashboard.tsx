"use client";

import { FormEvent, useState } from "react";

type Status = { kind: "idle" | "ok" | "error" | "busy"; message: string };

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

async function readTextStream(response: Response): Promise<string> {
  if (!response.body) return readResponse(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output.trim();
}

export function TrainerDashboard() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Ready. Sign in first, then verify the connector.",
  });
  const [message, setMessage] = useState("");
  const [chatOutput, setChatOutput] = useState("");

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

  async function localDevLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("Local allowlist sign-in", () =>
      fetch("/api/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
  }

  async function sendChat() {
    const text = message.trim();
    if (!text) return;
    setChatOutput("Streaming response requested…");
    setStatus({ kind: "busy", message: "Sending chat message…" });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              role: "user",
              parts: [{ type: "text", text }],
            },
          ],
        }),
      });
      const body = await readTextStream(response);
      setChatOutput(body);
      setStatus({
        kind: response.ok ? "ok" : "error",
        message: `Chat: ${response.ok ? "response received" : `failed (${response.status})`}`,
      });
    } catch (error) {
      setChatOutput("");
      setStatus({
        kind: "error",
        message: `Chat failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

  return (
    <section className="grid">
      <article>
        <h2>Sign in</h2>
        <p>
          For this local MVP smoke, use the development sign-in helper with an
          email from <code>ALLOWED_GOOGLE_EMAILS</code>. Google OAuth remains
          configured through <code>/api/auth</code>.
        </p>
        <form onSubmit={localDevLogin} className="stack">
          <input
            aria-label="Allowlisted email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit">Use local allowlisted session</button>
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
        <button
          type="button"
          onClick={() =>
            runAction("Sync now", () =>
              fetch("/api/sync", {
                method: "POST",
              }),
            )
          }
        >
          Sync now
        </button>
      </article>

      <article>
        <h2>Recent data</h2>
        <ul>
          <li>Activities paginate to exhaustion.</li>
          <li>
            Daily sleep, RHR, HRV, stress, steps, calories, and Body Battery are
            backfilled from the configured start date.
          </li>
          <li>Missing metrics stay explicit.</li>
        </ul>
      </article>

      <article className="wide">
        <h2>Trainer chat</h2>
        <p>
          Responses cite relevant dates, activities, and trends. Conversation
          history and profile memory persist locally.
        </p>
        <textarea
          aria-label="Message"
          placeholder="Ask about my recent training load…"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="button" onClick={sendChat}>
          Send
        </button>
        {chatOutput ? <pre className="output">{chatOutput}</pre> : null}
      </article>

      <article>
        <h2>Profile memory</h2>
        <p>
          Goals, sports, preferences, and constraints can be extracted from chat
          and corrected by the operator.
        </p>
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
