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

export function TrainerDashboard() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Ready. Sign in first, then verify the connector.",
  });
  const [message, setMessage] = useState("");
  const [chatOutput, setChatOutput] = useState("");
  const [profileGoals, setProfileGoals] = useState("");
  const [profileSports, setProfileSports] = useState("");
  const [profileConstraints, setProfileConstraints] = useState("");

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

  async function sendChat() {
    const text = message.trim();
    if (!text) return;
    setChatOutput("Connecting to trainer…");
    setStatus({ kind: "busy", message: "Chat: connecting to model…" });
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
      if (!response.ok || !response.body) {
        const body = await readResponse(response);
        setChatOutput(body);
        setStatus({
          kind: "error",
          message: `Chat: failed (${response.status})`,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let output = "";
      setChatOutput("Trainer is typing…");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        setChatOutput(output || "Trainer is typing…");
        setStatus({
          kind: "busy",
          message: `Chat: streaming response… ${output.length} characters received`,
        });
      }
      output += decoder.decode();
      setChatOutput(output.trim() || "Trainer returned an empty response.");
      setStatus({
        kind: "ok",
        message: `Chat: response complete (${output.trim().length} characters)`,
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
