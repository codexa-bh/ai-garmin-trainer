/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata } from "../src/app/layout";
import { TrainerDashboard } from "../src/app/trainer-dashboard";

const emptyChat = {
  conversationId: "default",
  messages: [],
  contextWindow: 0,
  historyLimit: 12,
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function syncStreamResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    ),
  );
}

function profile(
  goals: string[] = ["Build hiking endurance"],
  preferences: Record<string, unknown> = { coachingStyle: "direct" },
) {
  return {
    goals,
    sports: ["hiking", "mountaineering"],
    constraints: ["no running this week"],
    preferences,
  };
}

function activityListItem(index: number) {
  const id = (111111 + index).toString();
  return {
    garminId: id,
    name: `Activity ${index}`,
    label: `Activity ${index}`,
    sport: index % 2 ? "cycling" : "running",
    date: "2026-08-01",
    startedAt: "2026-08-01T07:00:00.000Z",
    durationSec: 3600,
    distanceMeters: 10000 + index,
    elevationGainMeters: 260,
    avgHeartRate: 145,
    detailStatus: "available",
  };
}

function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Data & settings" }));
}

function stubViewport(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

async function openConversationMenu(title: string) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: `Conversation options for "${title}"`,
    }),
  );
}

async function clickConversationMenuItem(title: string, name: string) {
  await openConversationMenu(title);
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

function setTranscriptMetrics(
  transcript: HTMLElement,
  values: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperties(transcript, {
    scrollHeight: { value: values.scrollHeight, configurable: true },
    clientHeight: { value: values.clientHeight, configurable: true },
    scrollTop: {
      value: values.scrollTop,
      configurable: true,
      writable: true,
    },
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("app metadata", () => {
  it("uses the local Garmin AI Trainer tab title and favicon", () => {
    expect(metadata.title).toBe("Garmin AI Trainer");
    expect(metadata.icons).toEqual({
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    });
  });
});

describe("TrainerDashboard Profile hydration", () => {
  it("loads a saved Profile on no-auth startup but keeps it hidden until Data & settings opens", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(screen.queryByLabelText("Goals")).toBeNull();
    expect(screen.queryByText(/Sign in/i)).toBeNull();

    openSettings();

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Goals") as HTMLTextAreaElement).value,
      ).toBe("Build hiking endurance");
    });
    expect(
      (screen.getByLabelText("Preferred sports") as HTMLTextAreaElement).value,
    ).toBe("hiking\nmountaineering");
    expect(screen.queryByLabelText("Preferences JSON")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/dev-login",
      expect.anything(),
    );
  });

  it("shows env-gated LLM debug traces in Settings without leaking them into the transcript", async () => {
    const debugPayload = {
      conversationId: "default",
      messages: [
        {
          id: "assistant-debug-1",
          role: "assistant",
          content: "User-facing answer only.",
          createdAt: "2026-07-24T12:00:00.000Z",
          grounding: {
            debugTrace: {
              schemaVersion: 1,
              capturedAt: "2026-07-24T12:00:00.000Z",
              provider: "deepseek",
              model: "deepseek-chat",
              providerCalls: [{ index: 1, purpose: "planner" }],
              toolSteps: [{ index: 1, tool: "runReadOnlySql" }],
              finalAnswer: "User-facing answer only.",
              caps: { string: 1200 },
            },
          },
        },
        {
          id: "assistant-no-debug-1",
          role: "assistant",
          content: "Older assistant answer.",
          createdAt: "2026-07-24T11:00:00.000Z",
          grounding: null,
        },
      ],
      contextWindow: 2,
      historyLimit: 40,
      llmDebugTracesEnabled: true,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(debugPayload);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("User-facing answer only.")).toBeTruthy();
    expect(screen.queryByText("runReadOnlySql")).toBeNull();

    openSettings();

    expect(
      await screen.findByText("LLM debug traces", { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Local developer diagnostics are enabled/),
    ).toBeTruthy();
    expect(screen.getByText(/runReadOnlySql/)).toBeTruthy();
    expect(
      screen.getByText("No debug trace captured for this assistant message."),
    ).toBeTruthy();
  });

  it("keeps env-disabled LLM debug Settings section absent", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();

    await waitFor(() =>
      expect(
        screen.queryByText("LLM debug traces", { exact: false }),
      ).toBeNull(),
    );
  });

  it("keeps Diagnostics collapsed until opened", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      screen.queryByText(
        "Ready. Local trainer is available; verify the connector when needed.",
      ),
    ).toBeNull();

    openSettings();
    fireEvent.click(screen.getByText(/Current operation/));

    expect(
      await screen.findByText(
        "Ready. Local trainer is available; verify the connector when needed.",
      ),
    ).toBeTruthy();
  });

  it("labels active chat context and local evidence without the old local-message chip", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: "Synthesized trainer answer from local evidence.",
              createdAt: "2026-07-21T12:00:00.000Z",
              grounding: {
                tool: "runMathAnalysis",
                summary: "Detailed ranking rows should stay hidden.",
                privacy: "Computed from local normalized SQLite only.",
              },
            },
          ],
          contextWindow: 6,
          historyLimit: 40,
        });
      }
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({
          health: {
            enabled: false,
            ready: false,
            status: "disabled",
            detail: "Memory disabled.",
            provider: "app-sqlite-vector",
            vectorProvider: "sqlite",
            userDisabled: false,
          },
          memories: [],
          enabled: false,
          ready: false,
        });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      await screen.findByText(
        "Synthesized trainer answer from local evidence.",
      ),
    ).toBeTruthy();
    const chip = screen.getByText("Active chat context · local evidence");
    expect(chip.getAttribute("title")).toContain(
      "6 of 40 selected session context lines",
    );
    expect(chip.getAttribute("aria-label")).toBe(
      "Active chat context with local Garmin evidence",
    );
    expect(screen.getByText("Used local Garmin data.")).toBeTruthy();
    expect(screen.queryByText(/local messages/i)).toBeNull();
    expect(screen.queryByText(/recent local turns/i)).toBeNull();
    expect(screen.queryByText(/ · grounded/i)).toBeNull();
    expect(
      screen.queryByText("Detailed ranking rows should stay hidden."),
    ).toBeNull();
    expect(
      screen.queryByText("Computed from local normalized SQLite only."),
    ).toBeNull();
  });

  it("renders concise pending trainer copy before the response starts", async () => {
    let resolveChat!: (response: Response) => void;
    const pendingChat = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory") return jsonResponse({ memories: [] });
      if (url.startsWith("/api/chat") && init?.method === "POST") {
        return pendingChat;
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What should I do tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Trainer is thinking…")).toBeTruthy();
    expect(
      screen.queryByText("Trainer is thinking with bounded local history…"),
    ).toBeNull();

    resolveChat(
      new Response(
        JSON.stringify({
          conversationId: "default",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: "Keep tomorrow easy.",
              createdAt: "2026-07-21T12:00:00.000Z",
            },
          ],
          contextWindow: 5,
          historyLimit: 40,
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    expect(await screen.findByText("Keep tomorrow easy.")).toBeTruthy();
  });

  it("uses active chat context wording for non-streamed completion status", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory") return jsonResponse({ memories: [] });
      if (url.startsWith("/api/chat") && init?.method === "POST") {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: "Use an easy aerobic effort tomorrow.",
              createdAt: "2026-07-21T12:00:00.000Z",
            },
          ],
          contextWindow: 5,
          historyLimit: 40,
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    fireEvent.click(screen.getByText(/Current operation/));
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What should I do tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Use an easy aerobic effort tomorrow."),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        "Chat: response complete. Active chat context selected 5 of 40 session lines.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/recent local turns/i)).toBeNull();
  });

  it("uses active chat context wording for streamed completion status", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory") return jsonResponse({ memories: [] });
      if (url.startsWith("/api/chat") && init?.method === "POST") {
        return syncStreamResponse([
          {
            type: "start",
            userMessage: {
              id: "user-1",
              role: "user",
              content: "What should I do tomorrow?",
              createdAt: "2026-07-21T12:00:00.000Z",
            },
          },
          { type: "delta", textDelta: "Keep tomorrow easy." },
          {
            type: "done",
            assistantMessage: {
              id: "assistant-1",
              role: "assistant",
              content: "Keep tomorrow easy.",
              createdAt: "2026-07-21T12:00:01.000Z",
            },
            contextWindow: 7,
            historyLimit: 40,
            memoryProposal: { status: "none" },
          },
        ]);
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    fireEvent.click(screen.getByText(/Current operation/));
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What should I do tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Keep tomorrow easy.")).toBeTruthy();
    expect(
      await screen.findByText(
        "Chat: streamed response complete. Active chat context selected 7 of 40 session lines.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/recent local turns/i)).toBeNull();
  });

  it("submits a non-empty composer message with Enter without inserting a newline", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory") return jsonResponse({ memories: [] });
      if (url === "/api/chat" && init?.method === "POST") {
        return jsonResponse({
          ...emptyChat,
          messages: [
            {
              id: "assistant-enter",
              role: "assistant",
              content: "Enter submitted this composer message.",
              createdAt: "2026-07-25T12:00:00.000Z",
            },
          ],
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(message, {
      target: { value: "  What should I do tomorrow?  " },
    });

    expect(fireEvent.keyDown(message, { key: "Enter", code: "Enter" })).toBe(
      false,
    );

    expect(
      await screen.findByText("Enter submitted this composer message."),
    ).toBeTruthy();
    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === "/api/chat" && init?.method === "POST",
    );
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(String(postCalls[0]?.[1]?.body))).toMatchObject({
      conversationId: "default",
      message: "What should I do tomorrow?",
      stream: true,
    });
    expect(message.value).toBe("");
  });

  it("preserves Shift+Enter as multiline input and keeps blank Enter guarded", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory") return jsonResponse({ memories: [] });
      if (url === "/api/chat" && init?.method === "POST") {
        return jsonResponse({
          ...emptyChat,
          messages: [
            {
              id: "assistant-unexpected",
              role: "assistant",
              content: "Unexpected submit",
              createdAt: "2026-07-25T12:00:00.000Z",
            },
          ],
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    message.focus();
    fireEvent.change(message, { target: { value: "Line one" } });

    expect(
      fireEvent.keyDown(message, {
        key: "Enter",
        code: "Enter",
        shiftKey: true,
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(message);

    fireEvent.change(message, { target: { value: "   " } });
    expect(fireEvent.keyDown(message, { key: "Enter", code: "Enter" })).toBe(
      false,
    );

    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === "/api/chat" && init?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
    expect(screen.queryByText("Unexpected submit")).toBeNull();
  });

  it("keeps composer actions in normal flow with scoped textarea typography and padding", () => {
    const css = readFileSync("src/app/style.css", "utf8");
    const composerTextareaBlock =
      css.match(/\.message-composer textarea\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const actionsBlock =
      css.match(/\.composer-actions\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(composerTextareaBlock).toContain("padding: 16px;");
    expect(composerTextareaBlock).toContain("font-weight: 400;");
    expect(actionsBlock).toContain("position: static;");
    expect(actionsBlock).toContain("flex-wrap: wrap;");
    expect(actionsBlock).toContain("margin-top: 10px;");
    expect(actionsBlock).toContain("padding: 0 8px;");
  });

  it("keeps the desktop app topbar visible outside the transcript scroll contract", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) {
        return jsonResponse({
          ...emptyChat,
          messages: [
            {
              id: "assistant-long-chat",
              role: "assistant",
              content: "Long desktop transcript answer",
              createdAt: "2026-07-25T12:00:00Z",
            },
          ],
          contextWindow: 1,
        });
      }
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    stubViewport(false);

    const { container } = render(React.createElement(TrainerDashboard));

    expect(
      await screen.findByText("Long desktop transcript answer"),
    ).toBeTruthy();
    const topbars = Array.from(container.querySelectorAll(".app-topbar"));
    expect(topbars).toHaveLength(1);
    const topbar = topbars[0];
    expect(
      topbar.nextElementSibling?.classList.contains("chat-workspace"),
    ).toBe(true);

    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1600,
      clientHeight: 360,
      scrollTop: 840,
    });
    fireEvent.scroll(transcript);

    for (const name of [
      "Toggle conversation history",
      "Sync now — import latest Garmin data",
      "Data & settings",
    ]) {
      expect(topbar.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(topbar.textContent).toContain("AI Trainer");
    expect(topbar.textContent).toContain("Trainer chat");

    const css = readFileSync("src/app/style.css", "utf8");
    expect(css).toMatch(/@media \(min-width: 961px\)[\s\S]*\.app-topbar/);
    expect(css).toMatch(/\.app-topbar \{[\s\S]*position: sticky;/);
    expect(css).toMatch(/\.dashboard-shell \{[\s\S]*overflow: hidden;/);
  });

  it("renders the minimal chat shell and reachable grouped settings disclosure", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    stubViewport(false);

    const { container } = render(React.createElement(TrainerDashboard));

    const conversationToggle = screen.getByRole("button", {
      name: "Toggle conversation history",
    });
    const shell = container.querySelector(".dashboard-shell");
    expect(conversationToggle.getAttribute("aria-expanded")).toBe("false");
    expect(shell?.classList.contains("sidebar-collapsed")).toBe(true);

    fireEvent.click(conversationToggle);

    expect(conversationToggle.getAttribute("aria-expanded")).toBe("true");
    expect(shell?.classList.contains("sidebar-collapsed")).toBe(false);
    expect(screen.getByRole("heading", { name: "Trainer chat" })).toBeTruthy();
    expect(screen.queryByText("AI Garmin Connect Trainer")).toBeNull();

    openSettings();

    const dialog = screen.getByRole("dialog", { name: "Data & settings" });
    expect(dialog).toBeTruthy();
    const profileSummary = screen.getByText(/Profile \/ trainer grounding/);
    expect(
      profileSummary
        .closest("details")
        ?.classList.contains("profile-settings-card"),
    ).toBe(true);
    expect(screen.getByLabelText("Goals")).toBeTruthy();
    expect(screen.getByText("Learned memory")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Verify connector" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Garmin activity ID")).toBeTruthy();
    expect(screen.getByText(/Current operation/)).toBeTruthy();
    expect(screen.getByText(/Private AI coaching/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Clear chat/profile" }),
    ).toBeTruthy();
  });

  it("renders safe assistant Markdown while keeping unsafe links inert", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-markdown",
              role: "assistant",
              content:
                "## Plan\nUse **easy aerobic** work with [safe ref](https://example.test) and [bad ref](javascript:alert(1)).\n- Keep it light\n```txt\nraw <b>html</b> stays text\n```\n<img src=x onerror=alert(1)>",
              createdAt: "2026-07-21T12:00:00.000Z",
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(screen.getByText("easy aerobic").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "safe ref" })).toHaveProperty(
      "href",
      "https://example.test/",
    );
    expect(screen.getByText("bad ref").closest("a")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/raw <b>html<\/b> stays text/)).toBeTruthy();
  });

  it("renders assistant Markdown tables without weakening inline safety", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-table",
              role: "assistant",
              content:
                "## Weekly summary\n| Metric | Average | Range (Min–Max) |\n| --- | ---: | :---: |\n| **Duration** | `42 min` | [bad](javascript:alert(1)) |\n| Distance | [safe route](https://example.test/run) | <img src=x onerror=alert(1)> |\n\nAfter the table, keep *easy effort*.\nPipes but no separator: Metric | Average | Range",
              createdAt: "2026-07-21T12:00:00.000Z",
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const table = await screen.findByRole("table");
    expect(table).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Metric" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Average" })).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Range (Min–Max)" }),
    ).toBeTruthy();
    expect(screen.getByText("Duration").tagName).toBe("STRONG");
    expect(screen.getByText("42 min").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "safe route" })).toHaveProperty(
      "href",
      "https://example.test/run",
    );
    expect(screen.getByText("bad").closest("a")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("easy effort").tagName).toBe("EM");
    expect(
      screen.getByText(/Pipes but no separator: Metric \| Average \| Range/),
    ).toBeTruthy();
  });

  it("preserves dirty edits when a manual Profile reload returns late", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") {
        const profileGetCount = fetchMock.mock.calls.filter(
          ([calledUrl]) => String(calledUrl) === "/api/profile",
        ).length;
        if (profileGetCount === 1) return jsonResponse(profile([]));
        return jsonResponse(profile(["Persisted server value"]));
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    const goals = (await screen.findByLabelText(
      "Goals",
    )) as HTMLTextAreaElement;

    await waitFor(() => expect(goals.disabled).toBe(false));
    fireEvent.change(goals, { target: { value: "New local edit" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved Profile" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/current edits were preserved/i)).toBeTruthy();
    });
    expect(goals.value).toBe("New local edit");
  });

  it("saves line-based Profile fields and keeps the saved response in the form", async () => {
    let savedBody: unknown;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile" && init?.method === "GET")
        return jsonResponse(profile([]));
      if (url === "/api/profile" && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true, profile: savedBody });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    const goals = (await screen.findByLabelText(
      "Goals",
    )) as HTMLTextAreaElement;
    const sports = screen.getByLabelText(
      "Preferred sports",
    ) as HTMLTextAreaElement;

    fireEvent.change(goals, {
      target: { value: "Summit endurance\nEasy recovery" },
    });
    fireEvent.change(sports, { target: { value: "hiking\ncycling" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    fireEvent.click(screen.getByText(/Current operation/));

    await waitFor(() => {
      expect(screen.getByText("Profile: saved to local SQLite.")).toBeTruthy();
    });
    expect(savedBody).toMatchObject({
      goals: ["Summit endurance", "Easy recovery"],
      sports: ["hiking", "cycling"],
      constraints: ["no running this week"],
      preferences: { coachingStyle: "direct" },
    });
    expect(goals.value).toBe("Summit endurance\nEasy recovery");
  });
});

describe("TrainerDashboard athlete baseline summary", () => {
  it("renders read-only Garmin athlete baselines separately from Profile", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary")
        return jsonResponse({
          activities: 1,
          healthDays: 2,
          detailedActivities: 0,
          athleteBaseline: {
            availability: "partial",
            source: "garmin_mcp",
            fetchedAt: "2026-07-20T08:00:00.000Z",
            lastAttemptAt: "2026-07-20T08:00:00.000Z",
            preservedPrevious: false,
            values: {
              configuredMaxHeartRateBpm: null,
              heartRateZones: {
                status: "unavailable",
                source: null,
                formula: null,
                boundaries: [],
              },
              cyclingFtpWatts: 250,
              cyclingFtpMeasuredOn: "2026-07-19",
              cyclingFtpSourceStale: false,
              availableTrainingDays: ["monday", "wednesday"],
              preferredLongTrainingDays: ["sunday"],
            },
            unsupported: {
              configuredMaxHeartRate: true,
              completeHeartRateZoneBoundaries: true,
              reason: "not_exposed_by_pinned_connector",
            },
          },
        });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();

    expect(await screen.findByText("Cycling FTP")).toBeTruthy();
    expect(screen.queryByText("Running threshold HR")).toBeNull();
    expect(screen.queryByText("Running VO2 max")).toBeNull();
    expect(screen.getByText("250 W (2026-07-19)")).toBeTruthy();
    expect(
      screen.getAllByText("Unavailable from current Garmin source").length,
    ).toBeGreaterThan(0);
  });

  it("labels health coverage, detail states, and derived HR zones truthfully", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary")
        return jsonResponse({
          activities: 258,
          healthDays: 953,
          healthCoverage: {
            totalRows: 953,
            completeDays: 751,
            partialDays: 1,
            missingDays: 201,
            metrics: {
              sleepDays: 740,
              restingHeartRateDays: 751,
              hrvDays: 163,
              stressDays: 751,
              stepsDays: 751,
              calorieDays: 751,
              bodyBatteryDays: 751,
            },
          },
          detailedActivities: 256,
          detailCoverage: {
            total: 258,
            pending: 0,
            available: 256,
            partial: 0,
            unsupported: 2,
            retryableFailures: 0,
            preservedFailures: 0,
            inProgress: 0,
            terminal: 258,
          },
          athleteBaseline: {
            availability: "complete",
            source: "garmin_mcp",
            fetchedAt: "2026-08-10T08:00:00.000Z",
            lastAttemptAt: "2026-08-10T08:00:00.000Z",
            preservedPrevious: false,
            values: {
              configuredMaxHeartRateBpm: 190,
              heartRateZones: {
                status: "derived_from_garmin_max_hr",
                source: "garmin_fit_zones_target",
                formula: "50/60/70/80/90% of max HR",
                boundaries: [
                  { zone: 1, lowerBpm: 95, upperBpm: 113 },
                  { zone: 2, lowerBpm: 114, upperBpm: 132 },
                ],
              },
              cyclingFtpWatts: null,
              cyclingFtpMeasuredOn: null,
              cyclingFtpSourceStale: null,
              availableTrainingDays: [],
              preferredLongTrainingDays: [],
            },
            unsupported: {
              configuredMaxHeartRate: false,
              completeHeartRateZoneBoundaries: true,
              reason: "derived_from_garmin_max_hr",
            },
          },
        });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();

    expect(
      await screen.findByText(
        /configured max HR 190 bpm from Garmin FIT zones target/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/HR zones derived from Garmin max HR/),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Refresh import summary"));
    fireEvent.click(screen.getByText(/Current operation/));

    await waitFor(() => {
      const statusText = screen.getByText(/Import summary:/).textContent ?? "";
      expect(statusText).toContain("258 stored activities");
      expect(statusText).toContain(
        "953 health calendar rows (751 complete, 1 partial, 201 missing",
      );
      expect(statusText).toContain("256 available, 0 partial, 2 unsupported");
    });
  });
});

describe("TrainerDashboard activity charts", () => {
  it("keeps the full-screen activity dashboard scroll contract reachable at narrow breakpoints", () => {
    const css = readFileSync("src/app/style.css", "utf8");
    const panelBlock =
      css.match(/\.activity-dashboard-panel\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const detailScrollBlock =
      css.match(
        /\.selected-activity-detail\s*\{\s*overflow-x: hidden;([\s\S]*?)\}/,
      )?.[0] ?? "";
    const lapWrapBlock =
      css.match(/\.lap-table-wrap\s*\{\s*max-width: 100%;([\s\S]*?)\}/)?.[0] ??
      "";
    const tabletMediaBlock =
      css.match(
        /@media \(max-width: 960px\) \{([\s\S]*?)@media \(max-width: 640px\)/,
      )?.[1] ?? "";
    const mobileMediaBlock =
      css.match(/@media \(max-width: 640px\) \{([\s\S]*)$/)?.[1] ?? "";

    expect(panelBlock).toContain("height: 100dvh;");
    expect(panelBlock).toContain("min-height: 0;");
    expect(panelBlock).toContain("overflow: hidden;");
    expect(detailScrollBlock).toContain("overflow-y: auto;");
    expect(detailScrollBlock).toContain("overflow-x: hidden;");
    expect(lapWrapBlock).toContain("max-width: 100%;");
    expect(lapWrapBlock).toContain("overflow-x: auto;");
    expect(css).toMatch(
      /\.selected-activity-heading,[\s\S]*\.lap-table-wrap \{[\s\S]*flex: 0 0 auto;/,
    );
    expect(tabletMediaBlock).toMatch(
      /\.activity-dashboard-panel\s*\{[\s\S]*grid-template-columns: 1fr;[\s\S]*grid-template-rows: auto minmax\(170px, 32vh\) minmax\(0, 1fr\);/,
    );
    expect(mobileMediaBlock).toMatch(
      /\.activity-dashboard-panel\s*\{[\s\S]*grid-template-rows: auto minmax\(140px, 30vh\) minmax\(0, 1fr\);/,
    );
  });

  it("opens full-screen activity mode, requests 100 rows, resets search, and closes back to chat", async () => {
    const activityUrls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities?")) {
        activityUrls.push(url);
        if (url.includes("q=zzz")) {
          return jsonResponse({
            activities: [],
            nextOffset: null,
            totalApprox: 0,
            limit: 100,
            offset: 0,
          });
        }
        return jsonResponse({
          activities: [activityListItem(0)],
          nextOffset: null,
          totalApprox: 1,
          limit: 100,
          offset: 0,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      screen.getByRole("button", { name: "Activity charts" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Activity charts" }));

    expect(await screen.findByText("Activity 0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    ).toBeNull();
    expect(screen.queryByLabelText("Conversation history")).toBeNull();
    expect(screen.queryByText(/Refine search for more/)).toBeNull();
    expect(activityUrls[0]).toContain("limit=100");
    expect(activityUrls[0]).toContain("offset=0");

    fireEvent.change(
      screen.getByLabelText("Search activity name, sport, date, or Garmin ID"),
      { target: { value: "zzz" } },
    );

    await waitFor(() => {
      expect(
        screen.getAllByText("No synced activities match that search.").length,
      ).toBeGreaterThan(0);
    });
    expect(activityUrls.some((url) => url.includes("q=zzz"))).toBe(true);
    expect(activityUrls[activityUrls.length - 1]).toContain("offset=0");
    expect(screen.queryByText(/Showing first/)).toBeNull();
    expect(screen.queryByText(/Refine search for more/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

    expect(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Conversation history")).toBeTruthy();
  });

  it("loads the next 100 activities on bottom scroll and restarts pagination for search", async () => {
    const activityUrls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities?")) {
        activityUrls.push(url);
        const parsed = new URL(url, "http://local.test");
        const offset = Number(parsed.searchParams.get("offset") ?? 0);
        const query = parsed.searchParams.get("q") ?? "";
        if (query === "ride") {
          return jsonResponse({
            activities: [activityListItem(200)],
            nextOffset: null,
            totalApprox: 1,
            limit: 100,
            offset: 0,
          });
        }
        return jsonResponse({
          activities: Array.from(
            { length: offset === 0 ? 100 : 2 },
            (_, index) => activityListItem(offset + index),
          ),
          nextOffset: offset === 0 ? 100 : null,
          totalApprox: 102,
          limit: 100,
          offset,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    fireEvent.click(screen.getByRole("button", { name: "Activity charts" }));

    expect(await screen.findByText("Activity 0")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Synced activities" });
    Object.defineProperties(list, {
      scrollHeight: { value: 1200, configurable: true },
      clientHeight: { value: 400, configurable: true },
      scrollTop: { value: 760, configurable: true, writable: true },
    });
    fireEvent.scroll(list);

    expect(await screen.findByText("Activity 100")).toBeTruthy();
    expect(screen.getByText("Activity 101")).toBeTruthy();
    expect(activityUrls.some((url) => url.includes("offset=100"))).toBe(true);

    fireEvent.change(
      screen.getByLabelText("Search activity name, sport, date, or Garmin ID"),
      { target: { value: "ride" } },
    );

    expect(await screen.findByText("Activity 200")).toBeTruthy();
    expect(screen.queryByText("Activity 100")).toBeNull();
    expect(
      activityUrls.some(
        (url) => url.includes("q=ride") && url.includes("offset=0"),
      ),
    ).toBe(true);
  });

  it("renders selected factual stats, charts, and lap rows from dashboard payload", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities/111111/dashboard")) {
        return jsonResponse({
          activity: {
            garminId: "111111",
            name: "Morning Trail Run",
            label: "Morning Trail Run",
            sport: "running",
            date: "2026-08-01",
            startedAt: "2026-08-01T07:00:00.000Z",
            durationSec: 3600,
            distanceMeters: 10000,
            elevationGainMeters: 260,
            elevationLossMeters: 250,
            calories: 640,
            avgHeartRate: 145,
            maxHeartRate: 174,
            steps: 9200,
            trainingEffect: 3.2,
          },
          detail: {
            status: "available",
            hasHeartRate: true,
            hasElevation: true,
            hasLaps: true,
            recordCount: 3,
            lapCount: 1,
            unavailableReason: null,
          },
          charts: {
            downsampled: false,
            sourcePointCount: 3,
            pointCount: 3,
            maxPoints: 3,
            domainStartSec: 0,
            domainEndSec: 3600,
            timeScaleStatus: "elapsed",
            timeScaleMessage: null,
            points: [
              { elapsedSec: 0, heartRate: 130, altitudeMeters: 1000 },
              { elapsedSec: 1800, heartRate: 150, altitudeMeters: 1050 },
              { elapsedSec: 3600, heartRate: 136, altitudeMeters: 1012 },
            ],
          },
          route: {
            status: "available",
            sourcePointCount: 2,
            pointCount: 2,
            maxPoints: 400,
            simplified: false,
            bounds: {
              minLat: 46.1,
              maxLat: 46.101,
              minLon: 13.8,
              maxLon: 13.801,
              minAltitudeMeters: 1000,
              maxAltitudeMeters: 1012,
            },
            points: [
              {
                elapsedSec: 0,
                lat: 46.1,
                lon: 13.8,
                altitudeMeters: 1000,
                gradePct: 4,
              },
              {
                elapsedSec: 60,
                lat: 46.101,
                lon: 13.801,
                altitudeMeters: 1012,
                gradePct: -4,
              },
            ],
            message: "Showing 2 normalized GPS stream points.",
          },
          heartRateZones: {
            status: "available",
            timeSource: "garmin_activity",
            zoneSource: "garmin_mcp",
            zoneStatus: "garmin_configured",
            formula: null,
            classifiedSeconds: 60,
            unclassifiedSeconds: 0,
            noHeartRateSeconds: 0,
            activityDurationSec: 3600,
            sourceTotalSeconds: 60,
            message: "Using Garmin activity HR-zone time totals.",
            buckets: [
              {
                zone: 1,
                label: "Zone 1",
                lowerBpm: 90,
                upperBpm: 119,
                seconds: 0,
                percent: 0,
              },
              {
                zone: 2,
                label: "Zone 2",
                lowerBpm: 120,
                upperBpm: 139,
                seconds: 60,
                percent: 100,
              },
              {
                zone: 3,
                label: "Zone 3",
                lowerBpm: 140,
                upperBpm: 159,
                seconds: 0,
                percent: 0,
              },
              {
                zone: 4,
                label: "Zone 4",
                lowerBpm: 160,
                upperBpm: 179,
                seconds: 0,
                percent: 0,
              },
              {
                zone: 5,
                label: "Zone 5",
                lowerBpm: 180,
                upperBpm: null,
                seconds: 0,
                percent: 0,
              },
            ],
          },
          laps: [
            {
              lapNumber: 1,
              durationSec: 1800,
              distanceMeters: 5000,
              avgHeartRate: 143,
              maxHeartRate: 168,
              elevationGainMeters: 120,
              elevationLossMeters: 115,
              avgPowerWatts: null,
              normalizedPowerWatts: null,
            },
          ],
        });
      }
      if (url.startsWith("/api/activities?")) {
        return jsonResponse({
          activities: [
            {
              garminId: "111111",
              name: "Morning Trail Run",
              label: "Morning Trail Run",
              sport: "running",
              date: "2026-08-01",
              startedAt: "2026-08-01T07:00:00.000Z",
              durationSec: 3600,
              distanceMeters: 10000,
              elevationGainMeters: 260,
              avgHeartRate: 145,
              detailStatus: "available",
            },
          ],
          totalApprox: 1,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    fireEvent.click(screen.getByRole("button", { name: "Activity charts" }));
    fireEvent.click(await screen.findByText("Morning Trail Run"));

    expect(await screen.findByText("Detail: available")).toBeTruthy();
    expect(screen.getByText("Heart rate over time")).toBeTruthy();
    expect(screen.getByText("Elevation profile")).toBeTruthy();
    const hrChart = screen.getByRole("img", {
      name: "Heart rate over time over elapsed time",
    });
    Object.defineProperty(hrChart, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 100,
        width: 640,
        top: 0,
        height: 130,
        right: 740,
        bottom: 130,
      }),
    });
    fireEvent.pointerMove(hrChart, { clientX: 420 });
    expect(screen.getByText("30m elapsed · 150 bpm")).toBeTruthy();
    fireEvent.keyDown(hrChart, { key: "ArrowRight" });
    expect(screen.getByText("1h 00m elapsed · 136 bpm")).toBeTruthy();
    const elevationChart = screen.getByRole("img", {
      name: "Elevation profile over elapsed time",
    });
    Object.defineProperty(elevationChart, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 100,
        width: 640,
        top: 0,
        height: 130,
        right: 740,
        bottom: 130,
      }),
    });
    fireEvent.pointerMove(elevationChart, { clientX: 420 });
    expect(screen.getByText("30m elapsed · 1,050 m")).toBeTruthy();
    expect(screen.queryByText(/Accessible chart summary:/)).toBeNull();
    expect(screen.queryByText("Selected activity")).toBeNull();
    expect(screen.queryByText(/Charts downsampled to/)).toBeNull();
    expect(screen.getByText("Route map")).toBeTruthy();
    expect(
      screen.queryByText(
        "Compact local route · optional CARTO/OpenStreetMap tiles",
      ),
    ).toBeNull();
    const routeMap = screen.getByRole("img", {
      name: "GPS route map with CARTO background and start and finish markers",
    });
    expect(routeMap).toBeTruthy();
    expect(routeMap.getAttribute("viewBox")).toBe("0 0 420 220");
    expect(screen.queryByRole("button", { name: /CARTO/ })).toBeNull();
    expect(screen.queryByText("Direction: start → finish")).toBeNull();
    expect(screen.queryByText("Full route shown")).toBeNull();
    expect(screen.queryByText(/representative route points/)).toBeNull();
    expect(
      screen.getByText(/© CARTO, © OpenStreetMap contributors/),
    ).toBeTruthy();
    expect(screen.getByText(/client IP to CARTO/)).toBeTruthy();
    const cartoTile = document.querySelector(".route-map-tiles image");
    expect(cartoTile?.getAttribute("href")).toContain(
      "https://basemaps.cartocdn.com/light_all/",
    );
    fireEvent.error(cartoTile as Element);
    await waitFor(() => {
      expect(
        screen.getByText("CARTO tiles failed; offline route shown."),
      ).toBeTruthy();
    });
    expect(screen.getByText("Time in HR zones")).toBeTruthy();
    expect(screen.getByText("Garmin activity HR-zone totals")).toBeTruthy();
    expect(
      screen.getByText(/Garmin-configured HR-zone boundaries/),
    ).toBeTruthy();
    expect(screen.getByText("1m 00s · 100%")).toBeTruthy();
    expect(
      screen.getAllByText(/Zone [1-5]/).map((item) => item.textContent),
    ).toEqual(["Zone 5", "Zone 4", "Zone 3", "Zone 2", "Zone 1"]);
    const zoneFiveBar = screen
      .getByText("Zone 5")
      .closest(".hr-zone-row")
      ?.querySelector(".hr-zone-bar");
    const zoneOneBar = screen
      .getByText("Zone 1")
      .closest(".hr-zone-row")
      ?.querySelector(".hr-zone-bar");
    expect(zoneFiveBar?.className).toContain("hr-zone-bar-zone-5");
    expect(zoneOneBar?.className).toContain("hr-zone-bar-zone-1");
    const lapCaption = screen.getByText("Lap details");
    expect(lapCaption).toBeTruthy();
    expect(lapCaption.closest(".selected-activity-detail")).toBeTruthy();
    expect(lapCaption.closest(".lap-table-wrap")).toBeTruthy();
    expect(screen.getByText("10.00 km")).toBeTruthy();
    expect(screen.getByText("3.2")).toBeTruthy();
  });

  it("renders truthful missing-elevation copy when the selected activity has no altitude stream", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities/111111/dashboard")) {
        return jsonResponse({
          activity: {
            garminId: "111111",
            name: "Morning Trail Run",
            label: "Morning Trail Run",
            sport: "running",
            date: "2026-08-01",
            startedAt: "2026-08-01T07:00:00.000Z",
            durationSec: 3600,
            distanceMeters: 10000,
            elevationGainMeters: 260,
            elevationLossMeters: 250,
            calories: 640,
            avgHeartRate: 145,
            maxHeartRate: 174,
            steps: 9200,
            trainingEffect: 3.2,
          },
          detail: {
            status: "available",
            hasHeartRate: true,
            hasElevation: false,
            hasLaps: true,
            recordCount: 2,
            lapCount: 1,
            unavailableReason: null,
          },
          charts: {
            downsampled: false,
            sourcePointCount: 2,
            pointCount: 2,
            maxPoints: 2,
            domainStartSec: 0,
            domainEndSec: 60,
            timeScaleStatus: "sample_index_limited",
            timeScaleMessage:
              "Chart timing is limited to the available sample-index stream because no safe elapsed or timestamp evidence is available.",
            points: [
              { elapsedSec: 0, heartRate: 130, altitudeMeters: null },
              { elapsedSec: 60, heartRate: 136, altitudeMeters: null },
            ],
          },
          route: {
            status: "missing_gps",
            sourcePointCount: 0,
            pointCount: 0,
            maxPoints: 400,
            simplified: false,
            bounds: null,
            points: [],
            message:
              "Route unavailable because this activity has no normalized GPS stream points.",
          },
          heartRateZones: {
            status: "missing_zones",
            timeSource: null,
            zoneSource: null,
            zoneStatus: "unavailable",
            formula: null,
            classifiedSeconds: 0,
            unclassifiedSeconds: 0,
            noHeartRateSeconds: 0,
            activityDurationSec: 3600,
            sourceTotalSeconds: null,
            message:
              "Time in HR zones is unavailable because Garmin activity HR-zone totals and complete HR-zone boundaries are not available.",
            buckets: [],
          },
          laps: [],
        });
      }
      if (url.startsWith("/api/activities?")) {
        return jsonResponse({
          activities: [
            {
              garminId: "111111",
              name: "Morning Trail Run",
              label: "Morning Trail Run",
              sport: "running",
              date: "2026-08-01",
              startedAt: "2026-08-01T07:00:00.000Z",
              durationSec: 3600,
              distanceMeters: 10000,
              elevationGainMeters: 260,
              avgHeartRate: 145,
              detailStatus: "available",
            },
          ],
          totalApprox: 1,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    fireEvent.click(screen.getByRole("button", { name: "Activity charts" }));
    fireEvent.click(await screen.findByText("Morning Trail Run"));

    expect(await screen.findByText("Heart rate over time")).toBeTruthy();
    expect(
      screen.getByText(
        /Chart timing is limited to the available sample-index stream/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("No per-point altitude stream data available."),
    ).toBeTruthy();
    expect(screen.queryByText("Elevation profile")).toBeNull();
    expect(screen.getByText("Route map unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /CARTO/ })).toBeNull();
    expect(screen.queryByText(/© CARTO/)).toBeNull();
    expect(
      screen.getByText(
        "Route unavailable because this activity has no normalized GPS stream points.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Time in HR zones unavailable")).toBeTruthy();
  });
});

describe("TrainerDashboard primary Sync now", () => {
  it("keeps Sync now in the top bar before Settings opens", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const syncButton = screen.getByRole("button", {
      name: "Sync now — import latest Garmin data",
    });
    expect(syncButton).toBeTruthy();
    expect(syncButton.textContent).toContain("Sync now");

    openSettings();

    expect(
      screen.getAllByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    ).toHaveLength(1);
  });

  it("omits no-op detail queue copy from non-detail Sync now progress", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") {
        return jsonResponse({
          activities: 247,
          healthDays: 933,
          detailedActivities: 247,
        });
      }
      if (url === "/api/sync" && init?.method === "POST") {
        return syncStreamResponse([
          {
            stage: "health",
            message: "Imported daily health 1/1: 2026-07-21.",
            activitiesImported: 247,
            healthDaysImported: 933,
          },
          {
            type: "result",
            status: "completed",
            activitiesImported: 247,
            healthDaysImported: 933,
            detailsProcessed: 0,
            detail: "done",
          },
        ]);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );
    openSettings();
    fireEvent.click(screen.getByText(/Current operation/));

    await waitFor(() => {
      const statusText =
        screen.getByText(/health: Imported daily health 1\/1/).textContent ??
        "";
      expect(statusText).toContain(
        "processed activity records 247, refreshed health dates 933",
      );
      expect(statusText).not.toContain("activity details 0/0");
    });
  });

  it("uses clear activity-detail wording for detail Sync now progress", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") {
        return jsonResponse({
          activities: 247,
          healthDays: 933,
          detailedActivities: 245,
        });
      }
      if (url === "/api/sync" && init?.method === "POST") {
        return syncStreamResponse([
          {
            stage: "detail",
            message: "Refreshing missing activity detail 3/5: 123456…",
            activitiesImported: 247,
            healthDaysImported: 933,
            detailsProcessed: 2,
            detailTotal: 5,
          },
        ]);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );
    openSettings();
    fireEvent.click(screen.getByText(/Current operation/));

    await waitFor(() => {
      const statusText =
        screen.getByText(/detail: Refreshing missing activity detail 3\/5/)
          .textContent ?? "";
      expect(statusText).toContain("activity details 2/5");
      expect(statusText).not.toContain(", details 2/5");
    });
  });

  it("preserves hidden preferences when saving visible Profile fields", async () => {
    let savedBody: unknown;
    const seededPreferences = { coachingStyle: "direct", maxWeeklyHours: 10 };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile" && init?.method === "GET")
        return jsonResponse(
          profile(["Build hiking endurance"], seededPreferences),
        );
      if (url === "/api/profile" && init?.method === "POST") {
        savedBody = JSON.parse(String(init.body));
        return jsonResponse({ ok: true, profile: savedBody });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();
    const goals = (await screen.findByLabelText(
      "Goals",
    )) as HTMLTextAreaElement;

    await waitFor(() => expect(goals.disabled).toBe(false));
    fireEvent.change(goals, {
      target: { value: "Updated endurance goal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    fireEvent.click(screen.getByText(/Current operation/));

    await waitFor(() => {
      expect(screen.getByText(/Profile: saved to local SQLite/)).toBeTruthy();
    });
    expect(savedBody).toMatchObject({
      goals: ["Updated endurance goal"],
      preferences: seededPreferences,
    });
  });
});

describe("TrainerDashboard memory and new chat", () => {
  it("renders compact searchable semantic memory browsing and preserves edit/delete controls", async () => {
    let patchedBody: unknown;
    const memories = [
      {
        id: "memory-old",
        kind: "conversation",
        text: "Plans winter snowboard trips around resort comparison notes",
        conversationId: "chat-1",
        updatedAt: "2026-07-15T12:00:00Z",
      },
      {
        id: "memory-pref",
        kind: "saved_preference",
        text: "Prefers morning hikes",
        conversationId: "chat-2",
        updatedAt: "2026-07-18T12:00:00Z",
      },
      {
        id: "memory-correction",
        kind: "correction",
        text: "Corrected threshold pace estimate",
        updatedAt: "2026-07-17T12:00:00Z",
      },
      {
        id: "memory-temporary",
        kind: "temporary",
        text: "Temporary plan for taper week",
        updatedAt: "2026-07-16T12:00:00Z",
      },
    ];
    const memoryPayload = {
      health: {
        enabled: true,
        ready: true,
        status: "ready",
        detail: "Embedded SQLite semantic memory is configured.",
        provider: "app-sqlite-vector",
        vectorProvider: "sqlite",
        userDisabled: false,
      },
      enabled: true,
      ready: true,
      memories,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory" && init?.method === "PATCH") {
        patchedBody = JSON.parse(String(init.body));
        return jsonResponse(memoryPayload);
      }
      if (url === "/api/memory") return jsonResponse(memoryPayload);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(React.createElement(TrainerDashboard));
    openSettings();

    expect(await screen.findByText("Learned memory")).toBeTruthy();
    expect(screen.getAllByText("4 of 4 shown").length).toBeGreaterThan(0);
    expect(screen.getByText("Prefers morning hikes")).toBeTruthy();
    expect(screen.getByText("Temporary plan for taper week")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(4);

    fireEvent.change(screen.getByLabelText("Search memory text"), {
      target: { value: "snowboard" },
    });
    expect(screen.getAllByText("1 of 4 shown").length).toBeGreaterThan(0);
    expect(screen.getByText(/winter snowboard trips/)).toBeTruthy();
    expect(screen.queryByText("Prefers morning hikes")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search memory text"), {
      target: { value: "no match" },
    });
    expect(screen.getByText(/No memories match/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Kind"), {
      target: { value: "correction" },
    });
    expect(screen.getByText("Corrected threshold pace estimate")).toBeTruthy();
    expect(screen.queryByText("Temporary plan for taper week")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "oldest" },
    });
    const sortedTexts = [...container.querySelectorAll(".memory-text")].map(
      (item) => item.textContent,
    );
    expect(sortedTexts[0]).toContain("winter snowboard trips");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const editBox = screen.getByLabelText("Edit memory") as HTMLTextAreaElement;
    fireEvent.change(editBox, { target: { value: "Prefers sunrise hikes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    await waitFor(() =>
      expect(patchedBody).toMatchObject({
        id: "memory-old",
        action: "update",
        text: "Prefers sunrise hikes",
      }),
    );
  });

  it("renames the active saved conversation from the row menu", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    let conversations = [
      {
        id: "default",
        title: "Active plan",
        createdAt: updatedAt,
        updatedAt,
      },
      {
        id: "previous-chat",
        title: "Previous climb chat",
        createdAt: updatedAt,
        updatedAt,
      },
    ];
    let patchBody: unknown = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations") return jsonResponse({ conversations });
      if (url === "/api/conversations/default" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        conversations = conversations.map((item) =>
          item.id === "default"
            ? { ...item, title: "Long run planning", updatedAt }
            : item,
        );
        return jsonResponse({ conversation: conversations[0] });
      }
      if (url.startsWith("/api/conversations/default")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-active",
              role: "assistant",
              content: "Active visible transcript",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Active visible transcript")).toBeTruthy();
    await openConversationMenu("Active plan");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const titleInput = screen.getByLabelText(
      "Conversation title",
    ) as HTMLInputElement;
    expect(titleInput.value).toBe("Active plan");
    fireEvent.change(titleInput, { target: { value: "Long run planning" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchBody).toEqual({ title: "Long run planning" }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("Long run planning").length).toBeGreaterThan(
        0,
      ),
    );
    expect(screen.getByText("Active visible transcript")).toBeTruthy();
  });

  it("cancels or saves a non-active rename without selecting the conversation", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    let conversations = [
      {
        id: "default",
        title: "Active plan",
        createdAt: updatedAt,
        updatedAt,
      },
      {
        id: "previous-chat",
        title: "Previous climb chat",
        createdAt: updatedAt,
        updatedAt,
      },
    ];
    const patchBodies: unknown[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations") return jsonResponse({ conversations });
      if (
        url === "/api/conversations/previous-chat" &&
        init?.method === "PATCH"
      ) {
        patchBodies.push(JSON.parse(String(init.body)));
        conversations = conversations.map((item) =>
          item.id === "previous-chat"
            ? { ...item, title: "Climb notes", updatedAt }
            : item,
        );
        return jsonResponse({ conversation: conversations[1] });
      }
      if (url.startsWith("/api/conversations/default")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-active",
              role: "assistant",
              content: "Active visible transcript",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/conversations/previous-chat")) {
        return jsonResponse({
          conversationId: "previous-chat",
          messages: [
            {
              id: "assistant-previous",
              role: "assistant",
              content: "Previous transcript should not open",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Active visible transcript")).toBeTruthy();
    await openConversationMenu("Previous climb chat");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(patchBodies).toEqual([]);

    await openConversationMenu("Previous climb chat");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Conversation title"), {
      target: { value: "Climb notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchBodies).toEqual([{ title: "Climb notes" }]),
    );
    expect(screen.getAllByText("Active plan").length).toBeGreaterThan(0);
    expect(screen.getByText("Active visible transcript")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText("Climb notes").length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText("Previous transcript should not open"),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/conversations/previous-chat?"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps rename disabled while a streamed answer is in flight", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations")
        return jsonResponse({
          conversations: [
            {
              id: "default",
              title: "Active plan",
              createdAt: updatedAt,
              updatedAt,
            },
          ],
        });
      if (url.startsWith("/api/conversations/default")) {
        return jsonResponse({
          conversationId: "default",
          messages: [],
          contextWindow: 0,
          historyLimit: 12,
        });
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return new Promise<Response>(() => undefined);
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    await screen.findByRole("button", {
      name: 'Conversation options for "Active plan"',
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Plan tomorrow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Streaming…" })).toBeTruthy(),
    );
    await openConversationMenu("Active plan");
    expect(
      (screen.getByRole("menuitem", { name: "Rename" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("menuitem", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("deletes a previous saved conversation without selecting it", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    let conversations = [
      {
        id: "default",
        title: "Active plan",
        createdAt: updatedAt,
        updatedAt,
      },
      {
        id: "previous-chat",
        title: "Previous climb chat",
        createdAt: updatedAt,
        updatedAt,
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations") return jsonResponse({ conversations });
      if (
        url === "/api/conversations/previous-chat" &&
        init?.method === "DELETE"
      ) {
        conversations = conversations.filter(
          (item) => item.id !== "previous-chat",
        );
        return jsonResponse({
          deleted: true,
          conversationId: "previous-chat",
          nextConversationId: "default",
          conversations,
        });
      }
      if (url.startsWith("/api/conversations/default")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-active",
              role: "assistant",
              content: "Active visible transcript",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/conversations/previous-chat")) {
        return jsonResponse({
          conversationId: "previous-chat",
          messages: [
            {
              id: "assistant-previous",
              role: "assistant",
              content: "Previous transcript should not open",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Active visible transcript")).toBeTruthy();
    await openConversationMenu("Previous climb chat");
    expect(screen.getByRole("menu").className).toContain(
      "conversation-menu-floating",
    );
    expect(screen.getByRole("menu").getAttribute("style")).toContain("top:");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("Previous climb chat")).toBeNull();
    });
    expect(screen.getByText("Active visible transcript")).toBeTruthy();
    expect(
      screen.queryByText("Previous transcript should not open"),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/conversations/previous-chat?"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "Garmin data, Profile, and saved memories stay unchanged",
      ),
    );
  });

  it("closes an open conversation menu on outside pointer interaction", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations")
        return jsonResponse({
          conversations: [
            {
              id: "default",
              title: "Active plan",
              createdAt: updatedAt,
              updatedAt,
            },
            {
              id: "previous-chat",
              title: "Previous climb chat",
              createdAt: updatedAt,
              updatedAt,
            },
          ],
        });
      if (url.startsWith("/api/conversations/default"))
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-active",
              role: "assistant",
              content: "Active visible transcript",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Active visible transcript")).toBeTruthy();
    const trigger = await screen.findByRole("button", {
      name: 'Conversation options for "Previous climb chat"',
    });

    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(
      screen.getByRole("heading", { name: "Chat with your private coach" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a previous saved conversation when delete confirmation is cancelled", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations")
        return jsonResponse({
          conversations: [
            {
              id: "default",
              title: "Active plan",
              createdAt: updatedAt,
              updatedAt,
            },
            {
              id: "previous-chat",
              title: "Previous climb chat",
              createdAt: updatedAt,
              updatedAt,
            },
          ],
        });
      if (url.startsWith("/api/conversations/default"))
        return jsonResponse({
          conversationId: "default",
          messages: [],
          contextWindow: 0,
          historyLimit: 12,
        });
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    render(React.createElement(TrainerDashboard));

    await clickConversationMenuItem("Previous climb chat", "Delete");

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining("saved memories stay unchanged"),
    );
    expect(screen.getByText("Previous climb chat")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/conversations/previous-chat",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("falls back to a remaining chat when deleting the active conversation from the list", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    let conversations = [
      {
        id: "default",
        title: "Active plan",
        createdAt: updatedAt,
        updatedAt,
      },
      {
        id: "remaining-chat",
        title: "Remaining chat",
        createdAt: updatedAt,
        updatedAt,
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations") return jsonResponse({ conversations });
      if (url === "/api/conversations/default" && init?.method === "DELETE") {
        conversations = conversations.filter((item) => item.id !== "default");
        return jsonResponse({
          deleted: true,
          conversationId: "default",
          nextConversationId: "remaining-chat",
          conversations,
        });
      }
      if (url.startsWith("/api/conversations/default")) {
        return jsonResponse({
          conversationId: "default",
          messages: [
            {
              id: "assistant-active",
              role: "assistant",
              content: "Active answer before delete",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/conversations/remaining-chat")) {
        return jsonResponse({
          conversationId: "remaining-chat",
          messages: [
            {
              id: "assistant-remaining",
              role: "assistant",
              content: "Remaining chat transcript",
              createdAt: updatedAt,
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Active answer before delete")).toBeTruthy();
    await clickConversationMenuItem("Active plan", "Delete");

    expect(await screen.findByText("Remaining chat transcript")).toBeTruthy();
    expect(screen.queryByText("Active answer before delete")).toBeNull();
    expect(window.localStorage.getItem("trainer.activeConversationId")).toBe(
      "remaining-chat",
    );
  });

  it("disables saved-conversation deletion while a streamed answer is in flight", async () => {
    const updatedAt = "2026-07-17T12:00:00.000Z";
    let resolveChat!: (response: Response) => void;
    const chatPost = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({ memories: [], pending: [], confirmed: [] });
      if (url === "/api/conversations")
        return jsonResponse({
          conversations: [
            {
              id: "default",
              title: "Active plan",
              createdAt: updatedAt,
              updatedAt,
            },
            {
              id: "previous-chat",
              title: "Previous climb chat",
              createdAt: updatedAt,
              updatedAt,
            },
          ],
        });
      if (url.startsWith("/api/conversations/default"))
        return jsonResponse({
          conversationId: "default",
          messages: [],
          contextWindow: 0,
          historyLimit: 12,
        });
      if (url === "/api/chat" && init?.method === "POST") return chatPost;
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Hold this stream open" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await openConversationMenu("Previous climb chat");

    await waitFor(() => {
      expect(
        (screen.getByRole("menuitem", { name: "Delete" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    resolveChat(
      new Response(
        JSON.stringify({
          conversationId: "default",
          messages: [],
          contextWindow: 0,
          historyLimit: 12,
          memoryProposal: { status: "none" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
  });

  it("starts a manual new chat without replaying the visible transcript", async () => {
    let postedBody: { conversationId?: string } | undefined;
    const initialMessages = [
      {
        id: "assistant-old",
        role: "assistant",
        content: "Old visible transcript",
        createdAt: "2026-07-17T12:00:00Z",
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory")
        return jsonResponse({
          health: {
            enabled: false,
            ready: false,
            status: "disabled",
            detail: "Memory disabled.",
            provider: "app-sqlite-vector",
            vectorProvider: "sqlite",
            userDisabled: false,
          },
          memories: [],
          enabled: false,
          ready: false,
        });
      if (url.startsWith("/api/chat") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body));
        return jsonResponse({
          conversationId: postedBody?.conversationId,
          messages: [
            {
              id: "user-new",
              role: "user",
              content: "Fresh question",
              createdAt: "2026-07-17T12:01:00Z",
            },
          ],
          contextWindow: 1,
          historyLimit: 12,
        });
      }
      if (url.startsWith("/api/chat"))
        return jsonResponse({ ...emptyChat, messages: initialMessages });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Old visible transcript")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => {
      expect(screen.queryByText("Old visible transcript")).toBeNull();
    });
    openSettings();
    fireEvent.click(screen.getByText(/Current operation/));
    expect(
      await screen.findByText(
        "New chat created. Active session context reset; prior transcripts stay in local SQLite. Semantic memory, Profile, and Garmin facts remain available when configured.",
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Fresh question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(postedBody?.conversationId).toMatch(/^local-/);
    });
  });
});

describe("TrainerDashboard transcript scrolling", () => {
  it("does not yank passive history reloads when the user has scrolled up", async () => {
    const initialMessages = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Initial local answer",
        createdAt: "2026-07-17T12:00:00Z",
      },
    ];
    const reloadedMessages = [
      ...initialMessages,
      {
        id: "assistant-2",
        role: "assistant",
        content: "Passive later answer",
        createdAt: "2026-07-17T12:01:00Z",
      },
    ];
    let chatGets = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/chat")) {
        chatGets += 1;
        return jsonResponse({
          ...emptyChat,
          messages: chatGets === 1 ? initialMessages : reloadedMessages,
          contextWindow: chatGets === 1 ? 1 : 2,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("Initial local answer")).toBeTruthy();
    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 100,
    });
    fireEvent.scroll(transcript);

    await clickConversationMenuItem("Trainer chat", "Reload history");

    expect(await screen.findByText("Passive later answer")).toBeTruthy();
    expect(transcript.scrollTop).toBe(100);
  });

  it("forces the latest turn into view when the user sends a message", async () => {
    const responseMessages = [
      {
        id: "user-1",
        role: "user",
        content: "What should I do tomorrow?",
        createdAt: "2026-07-17T12:00:00Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Take an easy aerobic day.",
        createdAt: "2026-07-17T12:00:30Z",
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/chat") && init?.method === "POST")
        return jsonResponse({ ...emptyChat, messages: responseMessages });
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 100,
    });
    fireEvent.scroll(transcript);

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "What should I do tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Take an easy aerobic day.")).toBeTruthy();
    await waitFor(() => expect(transcript.scrollTop).toBe(1000));
  });
});
