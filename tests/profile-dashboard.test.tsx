/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata } from "../src/app/layout";
import {
  activitySportIconDescriptor,
  TrainerDashboard,
} from "../src/app/trainer-dashboard";

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

function controlledSyncStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const response = Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    ),
  );
  return {
    response,
    push(event: unknown) {
      controller?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    },
    close() {
      controller?.close();
    },
  };
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

function importSummary(overrides: Record<string, unknown> = {}) {
  return {
    activities: 247,
    healthDays: 933,
    healthCoverage: {
      totalRows: 933,
      completeDays: 900,
      partialDays: 20,
      missingDays: 13,
      metrics: {
        sleepDays: 870,
        restingHeartRateDays: 920,
        hrvDays: 812,
        stressDays: 880,
        stepsDays: 933,
        calorieDays: 910,
        bodyBatteryDays: 777,
      },
    },
    detailedActivities: 245,
    detailCoverage: {
      total: 247,
      pending: 1,
      available: 230,
      partial: 15,
      unsupported: 1,
      retryableFailures: 0,
      preservedFailures: 0,
      inProgress: 0,
      terminal: 246,
    },
    athleteBaseline: {
      availability: "available",
      fetchedAt: "2026-07-22T08:00:00.000Z",
      lastAttemptAt: "2026-07-22T08:00:00.000Z",
      values: {
        cyclingFtpWatts: 250,
        cyclingFtpMeasuredOn: "2026-07-01",
        cyclingFtpSourceStale: false,
        availableTrainingDays: ["Tuesday", "Thursday"],
        preferredLongTrainingDays: ["Saturday"],
        configuredMaxHeartRateBpm: 190,
        heartRateZones: { status: "garmin_configured", boundaries: [] },
      },
    },
    bodyMetrics: {
      availability: "available",
      source: "garmin_mcp",
      fetchedAt: "2026-07-22T08:00:00.000Z",
      lastAttemptAt: "2026-07-22T08:00:00.000Z",
      preservedPrevious: false,
      currentWeightSource: "weigh_in",
      weighInAvailability: "available",
      values: { weightKg: 75, heightCm: 182 },
      history: {
        availability: "available",
        source: "weigh_in",
        rangeStart: "2026-01-01",
        rangeEnd: "2026-07-22",
        count: 42,
      },
    },
    ...overrides,
  };
}

type ActivityListTestItem = {
  garminId: string;
  name: string;
  label: string;
  sport: string;
  date: string;
  startedAt: string;
  durationSec: number;
  distanceMeters: number;
  elevationGainMeters: number;
  avgHeartRate: number;
  detailStatus: string;
};

function activityListItem(
  index: number,
  overrides: Partial<ActivityListTestItem> = {},
): ActivityListTestItem {
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
    ...overrides,
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

function captureAnimationFrames() {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return {
    flush() {
      for (const callback of callbacks.splice(0)) callback(performance.now());
    },
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
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

  it("omits the header context chip while preserving per-message local evidence", async () => {
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
    expect(screen.queryByText(/Active chat context/i)).toBeNull();
    expect(
      screen.queryByText("Active chat context · local evidence"),
    ).toBeNull();
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

  it("renders streamed trainer progress status before the response starts", async () => {
    const stream = controlledSyncStream();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory") return jsonResponse({ memories: [] });
      if (url.startsWith("/api/chat") && init?.method === "POST") {
        return stream.response;
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

    stream.push({
      type: "start",
      conversationId: "default",
      userMessage: {
        id: "user-1",
        role: "user",
        content: "What should I do tomorrow?",
        createdAt: "2026-07-21T12:00:00.000Z",
      },
    });
    stream.push({ type: "status", message: "Preparing local context…" });

    expect(await screen.findByText("Trainer is thinking…")).toBeTruthy();
    const thinkingIndicator = screen.getByTestId("pending-thinking-indicator");
    expect(thinkingIndicator.getAttribute("aria-hidden")).toBe("true");
    expect(thinkingIndicator.querySelectorAll("span")).toHaveLength(3);
    const substatus = await screen.findByTestId("pending-substatus");
    expect(substatus.getAttribute("aria-hidden")).toBe("true");
    expect(substatus.getAttribute("aria-live")).toBeNull();
    expect(substatus.textContent).toBe("Preparing local context…");

    stream.push({
      type: "status",
      message: "Asking the model to choose how to answer…",
    });
    await waitFor(() => {
      expect(screen.getByTestId("pending-substatus").textContent).toBe(
        "Asking the model to choose how to answer…",
      );
    });
    expect(screen.queryByText("Analyzing context")).toBeNull();
    expect(screen.queryByText("Weighing options")).toBeNull();
    expect(screen.queryByText("Preparing response")).toBeNull();
    expect(
      screen.queryByText("Trainer is thinking with bounded local history…"),
    ).toBeNull();

    stream.push({ type: "delta", textDelta: "Keep tomorrow easy." });
    stream.push({
      type: "done",
      assistantMessage: {
        id: "assistant-1",
        role: "assistant",
        content: "Keep tomorrow easy.",
        createdAt: "2026-07-21T12:00:01.000Z",
      },
      conversationId: "default",
      contextWindow: 5,
      historyLimit: 40,
      memoryProposal: { status: "none" },
    });
    stream.close();

    expect(await screen.findByText("Keep tomorrow easy.")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("pending-thinking-indicator")).toBeNull();
      expect(screen.queryByTestId("pending-substatus")).toBeNull();
    });
  });

  it("uses concise user-facing wording for non-streamed completion status", async () => {
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
    expect(await screen.findByText("Chat: response complete.")).toBeTruthy();
    expect(screen.queryByText(/Active chat context/i)).toBeNull();
    expect(screen.queryByText(/session lines/i)).toBeNull();
    expect(screen.queryByText(/recent local turns/i)).toBeNull();
  });

  it("uses concise user-facing wording for streamed completion status", async () => {
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
      await screen.findByText("Chat: streamed response complete."),
    ).toBeTruthy();
    expect(screen.queryByText(/Active chat context/i)).toBeNull();
    expect(screen.queryByText(/session lines/i)).toBeNull();
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
    const topbar = topbars[0] as HTMLElement;
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

    const mainNavigation = within(topbar).getByRole("navigation", {
      name: "Main navigation",
    });
    const expectedTopbarButtons = [
      "Toggle conversation history",
      "Activities",
      "Health",
      "Training Plan",
      "Sync",
      "Memory",
      "Data & settings",
    ];
    for (const name of expectedTopbarButtons) {
      expect(
        mainNavigation.contains(
          within(mainNavigation).getByRole("button", { name }),
        ),
      ).toBe(true);
    }
    expect(
      Array.from(mainNavigation.querySelectorAll("button")).map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual([
      "Conversations",
      "Activities",
      "Health",
      "Training Plan",
      "Sync",
      "Memory",
      "Settings",
    ]);
    expect(
      within(topbar)
        .getByRole("button", { name: "Menu" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    const title = topbar.querySelector(".app-title");
    expect(title?.textContent?.trim()).toBe("Garmin AI Trainer");
    expect(title?.getAttribute("title")).toBe("Garmin AI Trainer");
    expect(topbar.textContent).toContain("Garmin AI Trainer");
    expect(topbar.textContent).not.toContain("⌁");
    expect(topbar.textContent).not.toContain("Trainer chat");

    const css = readFileSync("src/app/style.css", "utf8");
    expect(css).toMatch(/@media \(min-width: 961px\)[\s\S]*\.app-topbar/);
    expect(css).toMatch(
      /\.app-topbar \{\s*display: flex;[\s\S]*justify-content: space-between;/,
    );
    expect(css).toMatch(/\.app-nav \{[\s\S]*display: flex;/);
    expect(css).toMatch(/\.app-title \{[\s\S]*text-overflow: ellipsis;/);
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*\.app-nav \{\s*display: none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*\.app-mobile-menu \{\s*display: block;/,
    );
    expect(css).toMatch(/\.app-topbar \{[\s\S]*position: sticky;/);
    expect(css).toMatch(/\.dashboard-shell \{[\s\S]*overflow: hidden;/);
  });

  it("exposes primary actions through a dismissible mobile main menu", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    stubViewport(true);

    render(React.createElement(TrainerDashboard));

    const menuToggle = screen.getByRole("button", { name: "Menu" });
    expect(menuToggle.getAttribute("aria-haspopup")).toBe("menu");
    expect(menuToggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuToggle);

    expect(menuToggle.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Main menu" });
    const menuItems = [
      "Toggle conversation history",
      "Activities",
      "Health",
      "Training Plan",
      "Sync",
      "Memory",
      "Data & settings",
    ];
    for (const name of menuItems) {
      expect(menu.contains(within(menu).getByRole("menuitem", { name }))).toBe(
        true,
      );
    }
    expect(
      Array.from(menu.querySelectorAll("button")).map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual([
      "Conversations",
      "Activities",
      "Health",
      "Training Plan",
      "Sync",
      "Memory",
      "Settings",
    ]);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(menuToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu", { name: "Main menu" })).toBeNull();

    fireEvent.click(menuToggle);
    expect(screen.getByRole("menu", { name: "Main menu" })).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu", { name: "Main menu" })).toBeNull();
  });

  it("activates mobile menu items and dismisses the menu", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities?")) {
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
    stubViewport(true);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Memory" }));

    expect(screen.queryByRole("menu", { name: "Main menu" })).toBeNull();
    const memoryDialog = screen.getByRole("dialog", { name: "Memory" });
    expect(memoryDialog).toBeTruthy();
    expect(
      within(memoryDialog).getByRole("button", { name: "Close" }),
    ).toBeTruthy();
    expect(screen.getByRole("log", { name: "Chat transcript" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Memory" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Data & settings" }));

    expect(screen.queryByRole("menu", { name: "Main menu" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Data & settings" }),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Data & settings" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Activities" }));

    expect(screen.queryByRole("menu", { name: "Main menu" })).toBeNull();
    expect(await screen.findByText("Activity 0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
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
    expect(
      screen.getByRole("heading", { name: "Garmin AI Trainer" }),
    ).toBeTruthy();
    expect(screen.queryByText("AI Garmin Connect Trainer")).toBeNull();

    openSettings();

    const dialog = screen.getByRole("dialog", { name: "Data & settings" });
    expect(dialog).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Memory" })).toBeNull();
    const profileSummary = screen.getByText(/Profile \/ trainer grounding/);
    expect(
      profileSummary
        .closest("details")
        ?.classList.contains("profile-settings-card"),
    ).toBe(true);
    expect(screen.getByLabelText("Goals")).toBeTruthy();
    expect(within(dialog).queryByText("Learned memory")).toBeNull();
    expect(within(dialog).queryByLabelText("Search memory text")).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Clear all memory" }),
    ).toBeNull();
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
        "953 health calendar rows (751 complete, 1 partial, 201 source-unavailable",
      );
      expect(statusText).toContain("often pre-watch/pre-device");
      expect(statusText).toContain("not estimated");
      expect(statusText).toContain("256 available, 0 partial, 2 unsupported");
    });
  });
});

describe("TrainerDashboard activity charts", () => {
  it("maps current synced sports to representative icons with a generic fallback", () => {
    expect(activitySportIconDescriptor("hiking")).toMatchObject({
      glyph: "⛰️",
      label: "Hiking",
      tone: "trail",
    });
    expect(activitySportIconDescriptor("mountaineering")).toMatchObject({
      glyph: "⛰️",
      label: "Mountaineering",
      tone: "trail",
    });
    expect(activitySportIconDescriptor("walking")).toMatchObject({
      glyph: "🚶",
      label: "Walking",
      tone: "walk",
    });
    expect(activitySportIconDescriptor("resort_snowboarding")).toMatchObject({
      glyph: "🏂",
      label: "Resort snowboarding",
      tone: "snow",
    });
    expect(
      activitySportIconDescriptor("backcountry_snowboarding"),
    ).toMatchObject({
      glyph: "🏂",
      label: "Backcountry snowboarding",
      tone: "snow",
    });
    expect(activitySportIconDescriptor("gravel_cycling")).toMatchObject({
      glyph: "🚴",
      label: "Gravel cycling",
      tone: "cycle",
    });
    expect(activitySportIconDescriptor("volleyball")).toMatchObject({
      glyph: "🏐",
      label: "Volleyball",
      tone: "ball",
    });
    expect(activitySportIconDescriptor("other")).toMatchObject({
      glyph: "◆",
      label: "Other activity",
      tone: "generic",
    });
    expect(activitySportIconDescriptor("future_sport")).toMatchObject({
      key: "unknown",
      glyph: "◆",
      label: "Activity type",
      tone: "generic",
    });
    expect(activitySportIconDescriptor("  ")).toMatchObject({
      key: "unknown",
      glyph: "◆",
      label: "Activity type",
      tone: "generic",
    });
  });

  it("renders sport icons in activity list metadata without visible sport text or tooltips", async () => {
    const activities = [
      activityListItem(0, {
        garminId: "23953090857",
        label: "Hiking result",
        name: "Hiking result",
        sport: "hiking",
        date: "2026-08-12",
      }),
      activityListItem(1, {
        garminId: "999999",
        label: "Mystery result",
        name: "Mystery result",
        sport: "future_sport",
      }),
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities?")) {
        return jsonResponse({
          activities,
          nextOffset: null,
          totalApprox: activities.length,
          limit: 100,
          offset: 0,
        });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));

    const hikingRow = (await screen.findByText("Hiking result")).closest(
      ".activity-list-item",
    );
    expect(hikingRow).toBeTruthy();
    const hikingMetadata = hikingRow?.querySelector("small");
    expect(hikingMetadata?.textContent).toContain("2026-08-12 · ");
    expect(hikingMetadata?.textContent).toContain("⛰️");
    expect(hikingMetadata?.textContent).not.toContain("Garmin ID");
    expect(hikingMetadata?.textContent).not.toContain("23953090857");
    expect(hikingMetadata?.textContent).not.toContain("hiking");
    expect(
      within(hikingMetadata as HTMLElement).getByLabelText("Hiking"),
    ).toBeTruthy();
    expect(
      within(hikingMetadata as HTMLElement)
        .getByLabelText("Hiking")
        .getAttribute("title"),
    ).toBeNull();

    const fallbackMetadata = screen
      .getByText("Mystery result")
      .closest(".activity-list-item")
      ?.querySelector("small");
    expect(fallbackMetadata?.textContent).toContain("◆");
    expect(fallbackMetadata?.textContent).not.toContain("Garmin ID");
    expect(fallbackMetadata?.textContent).not.toContain("999999");
    expect(fallbackMetadata?.textContent).not.toContain("future_sport");
    expect(
      within(fallbackMetadata as HTMLElement).getByLabelText("Activity type"),
    ).toBeTruthy();
    expect(
      within(fallbackMetadata as HTMLElement)
        .getByLabelText("Activity type")
        .getAttribute("title"),
    ).toBeNull();
  });

  it("styles activity sport icon chips as compact metadata glyphs", () => {
    const css = readFileSync("src/app/style.css", "utf8");
    const iconBlock =
      css.match(/\.activity-sport-icon\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(iconBlock).toContain("display: inline-grid;");
    expect(iconBlock).toContain("border-radius: 999px;");
    expect(iconBlock).toContain("vertical-align: -0.24em;");
  });

  it("keeps Activity dashboard chart cards compact while preserving responsive scroll contracts", () => {
    const css = readFileSync("src/app/style.css", "utf8");
    const chartGridBlock =
      css.match(/\.activity-chart-grid\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const chartCardBlock =
      css.match(/\.activity-chart\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const chartCaptionBlock =
      css.match(/\.activity-chart figcaption\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const chartSvgBlock =
      css.match(/\.activity-chart svg\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(chartGridBlock).toContain("minmax(140px, 1fr)");
    expect(chartGridBlock).toContain("gap: 6px;");
    expect(chartCardBlock).toContain("margin: 0;");
    expect(chartCardBlock).toContain("padding: 8px;");
    expect(chartCaptionBlock).toContain("gap: 8px;");
    expect(chartCaptionBlock).toContain("margin-bottom: 8px;");
    expect(chartSvgBlock).toContain("display: block;");
    expect(chartSvgBlock).toContain("width: 100%;");
    expect(chartSvgBlock).toContain("touch-action: none;");
  });

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
    const routeZoneGridBlock =
      css.match(/\.route-zone-grid\s*\{([\s\S]*?)\}/)?.[1] ?? "";
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
    expect(routeZoneGridBlock).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);",
    );
    expect(routeZoneGridBlock).toContain("align-items: stretch;");
    expect(css).toMatch(
      /\.selected-activity-heading,[\s\S]*\.route-zone-grid,[\s\S]*\.lap-table-wrap \{[\s\S]*flex: 0 0 auto;/,
    );
    expect(tabletMediaBlock).toMatch(
      /\.activity-dashboard-panel\s*\{[\s\S]*grid-template-columns: 1fr;[\s\S]*grid-template-rows: auto minmax\(170px, 32vh\) minmax\(0, 1fr\);/,
    );
    expect(tabletMediaBlock).toMatch(
      /\.route-zone-grid\s*\{[\s\S]*grid-template-columns: 1fr;/,
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

    expect(screen.getByRole("button", { name: "Activities" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));

    expect(await screen.findByText("Activity 0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
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

    expect(screen.getByRole("button", { name: "Sync" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));

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
            anaerobicTrainingEffect: 0,
            trainingEffectLabel: "AEROBIC_BASE",
            trainingLoad: 98,
            moderateIntensityMinutes: 3,
            vigorousIntensityMinutes: 37,
            totalIntensityMinutes: 10,
          },
          detail: {
            status: "available",
            hasHeartRate: true,
            hasElevation: true,
            hasLaps: true,
            recordCount: 3,
            lapCount: 1,
            unavailableReason:
              "Detail payload omits optional developer-only diagnostics.",
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
            speed: {
              status: "available",
              sourcePointCount: 3,
              pointCount: 3,
              message:
                "Speed uses a 60-second moving average derived from normalized cumulative distance and elapsed time.",
            },
            points: [
              {
                elapsedSec: 0,
                heartRate: 130,
                altitudeMeters: 1000,
                speedKmh: 9,
                gradePct: null,
              },
              {
                elapsedSec: 1800,
                heartRate: 150,
                altitudeMeters: 1050,
                speedKmh: 0,
                gradePct: 3,
              },
              {
                elapsedSec: 3600,
                heartRate: 136,
                altitudeMeters: 1012,
                speedKmh: 12.6,
                gradePct: -3,
              },
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
              maxLat: 46.3,
              minLon: 13.8,
              maxLon: 14.1,
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
                lat: 46.3,
                lon: 14.1,
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
              avgSpeedMps: 3,
              avgHeartRate: 143,
              maxHeartRate: null,
              elevationGainMeters: 120,
              elevationLossMeters: 115,
              avgPowerWatts: 218,
              normalizedPowerWatts: 222,
            },
            {
              lapNumber: 2,
              durationSec: 600,
              distanceMeters: 0,
              avgSpeedMps: 0,
              avgHeartRate: null,
              maxHeartRate: null,
              elevationGainMeters: null,
              elevationLossMeters: null,
              avgPowerWatts: null,
              normalizedPowerWatts: null,
            },
            {
              lapNumber: 3,
              durationSec: 300,
              distanceMeters: 1000,
              avgSpeedMps: null,
              avgHeartRate: 130,
              maxHeartRate: null,
              elevationGainMeters: 5,
              elevationLossMeters: null,
              avgPowerWatts: 180,
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
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    fireEvent.click(await screen.findByText("Morning Trail Run"));

    expect(await screen.findByText("Detail: available")).toBeTruthy();
    const summaryStats = screen.getByLabelText(
      "Selected activity summary stats",
    );
    expect(summaryStats.textContent).toContain("Duration");
    expect(summaryStats.textContent).toContain("Distance");
    expect(summaryStats.textContent).toContain("Elevation gain");
    expect(summaryStats.textContent).toContain("Elevation loss");
    expect(summaryStats.textContent).toContain("Calories");
    expect(summaryStats.textContent).toContain("Avg HR");
    expect(summaryStats.textContent).toContain("Max HR");
    expect(summaryStats.textContent).toContain("Steps");
    expect(summaryStats.textContent).not.toContain("Moderate intensity");
    expect(summaryStats.textContent).not.toContain("Vigorous intensity");
    expect(summaryStats.textContent).not.toContain("Total intensity");
    expect(summaryStats.textContent).not.toContain("Training effect");
    expect(summaryStats.textContent).not.toContain("Anaerobic TE");
    expect(summaryStats.textContent).not.toContain("Training load");
    expect(summaryStats.textContent).not.toContain("Benefit");
    const effortWidgets = screen.getByLabelText(
      "Selected activity effort widgets",
    );
    expect(effortWidgets.textContent).toContain("Intensity Minutes");
    expect(effortWidgets.textContent).toContain("Moderate");
    expect(effortWidgets.textContent).toContain("3 min");
    expect(effortWidgets.textContent).toContain("Vigorous x2");
    expect(effortWidgets.textContent).toContain("37 min");
    expect(effortWidgets.textContent).toContain("77 min");
    expect(effortWidgets.textContent).not.toContain("10 min");
    const intensityWidget = effortWidgets.querySelector(
      ".activity-effort-widget",
    );
    expect(intensityWidget).toBeTruthy();
    expect(intensityWidget?.querySelector(".activity-effort-total")).toBeNull();
    const intensityRows = Array.from(
      intensityWidget?.querySelectorAll(".activity-effort-list > div") ?? [],
    );
    expect(intensityRows).toHaveLength(3);
    expect(intensityRows[0]?.textContent).toContain("Total");
    expect(intensityRows[0]?.textContent).toContain("77 min");
    expect(intensityRows[1]?.textContent).toContain("Moderate");
    expect(intensityRows[2]?.textContent).toContain("Vigorous x2");
    expect(effortWidgets.textContent).toContain("Training Effect");
    expect(effortWidgets.textContent).toContain("Aerobic");
    expect(effortWidgets.textContent).toContain("3.2");
    expect(effortWidgets.textContent).toContain("Anaerobic");
    expect(effortWidgets.textContent).toContain("0.0");
    expect(effortWidgets.textContent).toContain("Primary Benefit");
    expect(effortWidgets.textContent).toContain("AEROBIC_BASE");
    expect(effortWidgets.textContent).toContain("Exercise Load");
    expect(effortWidgets.textContent).toContain("98");
    expect(summaryStats.textContent).not.toContain("Detail records");
    expect(screen.queryByText("Detail records")).toBeNull();
    expect(screen.getByText("Heart rate")).toBeTruthy();
    expect(screen.getByText("Elevation profile")).toBeTruthy();
    expect(screen.getByText("Speed")).toBeTruthy();
    expect(screen.queryByText("Heart rate over time")).toBeNull();
    expect(document.querySelector(".activity-chart-average-label")).toBeNull();
    expect(screen.getByText("0m elapsed · 130 bpm · Avg 145 bpm")).toBeTruthy();
    expect(screen.getByText("0m elapsed · 9 km/h · Avg 7.2 km/h")).toBeTruthy();
    expect(
      document.querySelectorAll(".activity-chart-average-line"),
    ).toHaveLength(2);
    expect(
      screen.queryByText(
        "60-second moving average from normalized cumulative distance and elapsed time.",
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("img", { name: "Pace over elapsed time" }),
    ).toBeNull();
    const speedChart = screen.getByRole("img", {
      name: "Speed over elapsed time",
    });
    Object.defineProperty(speedChart, "getBoundingClientRect", {
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
    expect(speedChart.getAttribute("preserveAspectRatio")).toBe("none");
    const speedPolyline = speedChart
      .querySelector("polyline")
      ?.getAttribute("points");
    fireEvent.pointerMove(speedChart, { clientX: 420 });
    expect(
      screen.getByText("30m elapsed · 0 km/h · Avg 7.2 km/h"),
    ).toBeTruthy();
    expect(
      speedChart
        .querySelector(".activity-chart-cursor ellipse")
        ?.getAttribute("cx"),
    ).toBe("161");
    expect(
      speedChart
        .querySelector(".activity-chart-cursor ellipse")
        ?.getAttribute("cy"),
    ).toBe("104");
    fireEvent.pointerMove(speedChart, { clientX: 100 });
    expect(screen.getByText("0m elapsed · 9 km/h · Avg 7.2 km/h")).toBeTruthy();
    fireEvent.pointerMove(speedChart, { clientX: 739 });
    expect(
      screen.getByText("1h 00m elapsed · 12.6 km/h · Avg 7.2 km/h"),
    ).toBeTruthy();
    expect(
      speedChart
        .querySelector(".activity-chart-cursor ellipse")
        ?.getAttribute("cx"),
    ).toBe("314");
    expect(speedChart.querySelector("polyline")?.getAttribute("points")).toBe(
      speedPolyline,
    );
    const hrChart = screen.getByRole("img", {
      name: "Heart rate over elapsed time",
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
    expect(hrChart.getAttribute("preserveAspectRatio")).toBe("none");
    fireEvent.pointerMove(hrChart, { clientX: 420 });
    expect(
      screen.getByText("30m elapsed · 150 bpm · Avg 145 bpm"),
    ).toBeTruthy();
    expect(
      hrChart
        .querySelector(".activity-chart-cursor ellipse")
        ?.getAttribute("cy"),
    ).toBe("8");
    fireEvent.pointerMove(hrChart, { clientX: 99 });
    expect(screen.getByText("0m elapsed · 130 bpm · Avg 145 bpm")).toBeTruthy();
    fireEvent.pointerMove(hrChart, { clientX: 741 });
    expect(
      screen.getByText("1h 00m elapsed · 136 bpm · Avg 145 bpm"),
    ).toBeTruthy();
    fireEvent.pointerMove(hrChart, { clientX: 420 });
    fireEvent.keyDown(hrChart, { key: "ArrowRight" });
    expect(
      screen.getByText("1h 00m elapsed · 136 bpm · Avg 145 bpm"),
    ).toBeTruthy();
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
    expect(elevationChart.getAttribute("preserveAspectRatio")).toBe("none");
    expect(
      screen.getByText("0m elapsed · 1,000 m · Grade unavailable"),
    ).toBeTruthy();
    fireEvent.pointerMove(elevationChart, { clientX: 420 });
    expect(
      screen.getByText("30m elapsed · 1,050 m · Grade +3.0%"),
    ).toBeTruthy();
    expect(
      elevationChart
        .querySelector(".activity-chart-cursor ellipse")
        ?.getAttribute("cx"),
    ).toBe("161");
    expect(
      elevationChart
        .querySelector(".activity-chart-cursor ellipse")
        ?.getAttribute("cy"),
    ).toBe("8");
    fireEvent.keyDown(elevationChart, { key: "ArrowRight" });
    expect(
      screen.getByText("1h 00m elapsed · 1,012 m · Grade -3.0%"),
    ).toBeTruthy();
    expect(screen.queryByText(/Accessible chart summary:/)).toBeNull();
    expect(screen.queryByText("Selected activity")).toBeNull();
    expect(screen.queryByText(/Charts downsampled to/)).toBeNull();
    expect(screen.getByText("Route map")).toBeTruthy();
    expect(
      screen.queryByText(
        "Compact local route · optional OpenTopoMap/OpenStreetMap tiles",
      ),
    ).toBeNull();
    const routeMap = screen.getByRole("img", {
      name: "GPS route map with OpenTopoMap background and start and finish markers",
    });
    expect(routeMap).toBeTruthy();
    expect(routeMap.getAttribute("viewBox")).toBe("0 0 420 220");
    expect(routeMap.getAttribute("data-zoom-offset")).toBe("0");
    expect(routeMap.getAttribute("data-pan-x")).toBe("0");
    expect(routeMap.getAttribute("data-pan-y")).toBe("0");
    expect(routeMap.getAttribute("data-dragging")).toBe("false");
    expect(routeMap.getAttribute("class")).toContain("is-pannable");
    const routeHalos = document.querySelectorAll(".route-map-segment-halo");
    const routeSegments = document.querySelectorAll(".route-map-segment");
    expect(routeHalos.length).toBe(routeSegments.length);
    expect(routeHalos.length).toBeGreaterThan(0);
    const initialSegmentX1 = routeSegments[0]?.getAttribute("x1");
    const initialOpenTopoMapTile = document.querySelector(
      ".route-map-tiles image",
    );
    const initialTileX = initialOpenTopoMapTile?.getAttribute("x");
    const zoomOut = screen.getByRole("button", {
      name: "Zoom out route map",
    });
    const resetView = screen.getByRole("button", {
      name: "Reset route map view",
    });
    const zoomIn = screen.getByRole("button", { name: "Zoom in route map" });
    expect(zoomOut).toBeTruthy();
    expect(resetView).toBeTruthy();
    expect((resetView as HTMLButtonElement).disabled).toBe(true);
    expect(zoomIn).toBeTruthy();
    fireEvent.pointerDown(routeMap, {
      pointerId: 7,
      button: 0,
      clientX: 200,
      clientY: 100,
    });
    expect(routeMap.getAttribute("data-dragging")).toBe("true");
    expect(routeMap.getAttribute("class")).toContain("is-dragging");
    fireEvent.pointerMove(routeMap, {
      pointerId: 7,
      buttons: 1,
      clientX: 232,
      clientY: 84,
    });
    expect(routeMap.getAttribute("data-pan-x")).toBe("32");
    expect(routeMap.getAttribute("data-pan-y")).toBe("-16");
    expect((resetView as HTMLButtonElement).disabled).toBe(false);
    expect(
      document.querySelector(".route-map-segment")?.getAttribute("x1"),
    ).not.toBe(initialSegmentX1);
    expect(
      document.querySelector(".route-map-tiles image")?.getAttribute("x"),
    ).not.toBe(initialTileX);
    fireEvent.pointerUp(routeMap, { pointerId: 7, clientX: 232, clientY: 84 });
    expect(routeMap.getAttribute("data-dragging")).toBe("false");
    fireEvent.click(zoomIn);
    expect(routeMap.getAttribute("data-zoom-offset")).toBe("1");
    expect(routeMap.getAttribute("data-pan-x")).toBe("32");
    expect((resetView as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    expect(routeMap.getAttribute("data-zoom-offset")).toBe("-1");
    expect((zoomOut as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resetView);
    expect(routeMap.getAttribute("data-zoom-offset")).toBe("0");
    expect(routeMap.getAttribute("data-pan-x")).toBe("0");
    expect(routeMap.getAttribute("data-pan-y")).toBe("0");
    expect((resetView as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /OpenTopoMap/ })).toBeNull();
    expect(screen.queryByText("Direction: start → finish")).toBeNull();
    expect(screen.queryByText("Full route shown")).toBeNull();
    expect(screen.queryByText(/representative route points/)).toBeNull();
    expect(
      screen.getByText(/Map data © OpenStreetMap contributors/),
    ).toBeTruthy();
    expect(
      screen.getByText(/map style © OpenTopoMap \(CC-BY-SA\)/),
    ).toBeTruthy();
    expect(screen.getByText(/client IP to OpenTopoMap/)).toBeTruthy();
    const openTopoMapTile = document.querySelector(".route-map-tiles image");
    expect(openTopoMapTile?.getAttribute("href")).toMatch(
      /^https:\/\/[abc]\.tile\.opentopomap\.org\/\d+\/\d+\/\d+\.png$/,
    );
    expect(openTopoMapTile?.getAttribute("href")).not.toContain(
      "basemaps.cartocdn.com",
    );
    fireEvent.error(openTopoMapTile as Element);
    await waitFor(() => {
      expect(
        screen.getByText("OpenTopoMap tiles failed; offline route shown."),
      ).toBeTruthy();
    });
    expect(screen.getByText("Time in HR zones")).toBeTruthy();
    expect(screen.getByText("Garmin activity HR-zone totals")).toBeTruthy();
    expect(screen.queryByText(/Source total:/)).toBeNull();
    expect(
      screen.queryByText(/Garmin-configured HR-zone boundaries/),
    ).toBeNull();
    expect(screen.getByText("1m 00s · 100%")).toBeTruthy();
    const routeZoneGrid = document.querySelector(".route-zone-grid");
    expect(routeZoneGrid).toBeTruthy();
    expect(
      Boolean(
        (routeZoneGrid?.compareDocumentPosition(effortWidgets) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
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
    const lapWrap = lapCaption.closest(".lap-table-wrap");
    expect(
      Boolean(
        effortWidgets.compareDocumentPosition(lapWrap as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    const lapTable = lapCaption.closest("table");
    expect(lapTable).toBeTruthy();
    expect(
      Array.from(lapTable?.querySelectorAll("thead th") ?? []).map(
        (header) => header.textContent,
      ),
    ).toEqual([
      "Lap",
      "Duration",
      "Distance",
      "Pace",
      "Avg Speed",
      "Avg HR",
      "Elev +/−",
    ]);
    const lapRows = Array.from(
      lapTable?.querySelectorAll("tbody tr") ?? [],
    ).map((row) =>
      Array.from(row.querySelectorAll("td")).map((cell) =>
        cell.textContent?.replace(/\s+/g, " ").trim(),
      ),
    );
    expect(lapRows).toEqual([
      [
        "1",
        "30m",
        "5.00 km",
        "6:00/km",
        "10.8 km/h",
        "143 bpm",
        "120 m / 115 m",
      ],
      [
        "2",
        "10m",
        "0.00 km",
        "Unavailable",
        "0 km/h",
        "Unavailable bpm",
        "Unavailable / Unavailable",
      ],
      [
        "3",
        "5m",
        "1.00 km",
        "5:00/km",
        "Unavailable",
        "130 bpm",
        "5 m / Unavailable",
      ],
    ]);
    expect(
      Array.from(lapTable?.querySelectorAll("th, td") ?? []).map((cell) =>
        cell.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).not.toContain("Power");
    expect(screen.queryByText("218 W")).toBeNull();
    expect(screen.getByText("10.00 km")).toBeTruthy();
    expect(screen.getByText("174 bpm")).toBeTruthy();
    expect(screen.getByText("143 bpm")).toBeTruthy();
    expect(screen.getByText("Training Effect")).toBeTruthy();
    expect(
      screen.queryByText(/Effort fields come from Garmin activity detail/),
    ).toBeNull();
    expect(screen.queryByText(/Detail limitation:/)).toBeNull();
    expect(screen.queryByText("Avg/Max HR")).toBeNull();
    expect(screen.queryByText(/143\s*\/\s*Unavailable/)).toBeNull();
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
            avgHeartRate: null,
            maxHeartRate: 174,
            steps: 9200,
            trainingEffect: 3.2,
            anaerobicTrainingEffect: null,
            trainingEffectLabel: null,
            trainingLoad: null,
            moderateIntensityMinutes: 3,
            vigorousIntensityMinutes: 0,
            totalIntensityMinutes: 99,
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
            speed: {
              status: "missing_speed",
              sourcePointCount: 0,
              pointCount: 0,
              message:
                "Speed unavailable because this activity has no normalized cumulative-distance stream samples.",
            },
            points: [
              {
                elapsedSec: 0,
                heartRate: 130,
                altitudeMeters: null,
                speedKmh: null,
                gradePct: null,
              },
              {
                elapsedSec: 60,
                heartRate: 136,
                altitudeMeters: null,
                speedKmh: null,
                gradePct: null,
              },
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
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    fireEvent.click(await screen.findByText("Morning Trail Run"));

    expect(await screen.findByText("Heart rate")).toBeTruthy();
    expect(
      screen.queryByText(
        /Chart timing is limited to the available sample-index stream/,
      ),
    ).toBeNull();
    expect(
      screen.getByText("No per-point altitude stream data available."),
    ).toBeTruthy();
    expect(screen.queryByText("Elevation profile")).toBeNull();
    expect(screen.getByText("Speed")).toBeTruthy();
    expect(screen.queryByText(/^Avg \d+ bpm$/)).toBeNull();
    expect(screen.queryByText(/^Avg .*km\/h$/)).toBeNull();
    expect(screen.queryByText(/elapsed · .* · Avg/)).toBeNull();
    expect(document.querySelector(".activity-chart-average-line")).toBeNull();
    expect(document.querySelector(".activity-chart-average-label")).toBeNull();
    expect(
      screen.getByText(
        "Speed unavailable because this activity has no normalized cumulative-distance stream samples.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        /no measured speed, GPS, summary, lap, or pace fallback is used/,
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("img", { name: "Pace over elapsed time" }),
    ).toBeNull();
    expect(screen.getByText("Route map unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /OpenTopoMap/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Zoom in route map" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset route map view" }),
    ).toBeNull();
    expect(document.querySelector(".route-map-svg")).toBeNull();
    expect(screen.queryByText(/OpenTopoMap/)).toBeNull();
    expect(
      screen.getByText(
        "Route unavailable because this activity has no normalized GPS stream points.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Time in HR zones unavailable")).toBeTruthy();
    const effortWidgets = screen.getByLabelText(
      "Selected activity effort widgets",
    );
    expect(effortWidgets.textContent).toContain("Intensity Minutes");
    expect(effortWidgets.textContent).toContain("Vigorous x2");
    expect(effortWidgets.textContent).toContain("0 min");
    expect(effortWidgets.textContent).toContain("3 min");
    expect(effortWidgets.textContent).not.toContain("99 min");
    const unavailableIntensityWidget = effortWidgets.querySelector(
      ".activity-effort-widget",
    );
    expect(
      unavailableIntensityWidget?.querySelector(".activity-effort-total"),
    ).toBeNull();
    expect(
      unavailableIntensityWidget?.querySelectorAll(
        ".activity-effort-list > div",
      ),
    ).toHaveLength(3);
    expect(effortWidgets.textContent).toContain("Training Effect");
    expect(effortWidgets.textContent).toContain("3.2");
    expect(effortWidgets.textContent).toContain("Unavailable");
    const routeZoneGrid = document.querySelector(".route-zone-grid");
    expect(routeZoneGrid).toBeTruthy();
    expect(
      Boolean(
        (routeZoneGrid?.compareDocumentPosition(effortWidgets) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    const noLapsMessage = screen.getByText(
      "No lap rows are available for this activity.",
    );
    expect(
      Boolean(
        effortWidgets.compareDocumentPosition(noLapsMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("opens with the activity selector expanded by default and a truthful collapse control", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities?")) {
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
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));

    const collapseButton = screen.getByRole("button", {
      name: "Collapse activity selector",
    });
    expect(collapseButton.getAttribute("aria-expanded")).toBe("true");
    expect(collapseButton.getAttribute("aria-controls")).toBe(
      "activity-selector-body",
    );
    expect(
      collapseButton.querySelector(".activity-selector-toggle-label"),
    ).toBeNull();
    expect(collapseButton.textContent?.trim()).toBe("");
    expect(collapseButton.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Activity selector")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Search synced activities" }),
    ).toBeTruthy();
    expect(screen.queryByText("Activities")).toBeNull();
    expect(
      screen.getByLabelText("Search activity name, sport, date, or Garmin ID"),
    ).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Synced activities" }),
    ).toBeTruthy();
    expect(
      document
        .querySelector(".activity-dashboard-panel")
        ?.classList.contains("activity-selector-collapsed"),
    ).toBe(false);
  });

  it("collapses the selector to a slim rail that hides the title/search/list and keeps the expand control", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url.startsWith("/api/activities?")) {
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
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(await screen.findByText("Activity 0")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse activity selector" }),
    );

    const expandButton = screen.getByRole("button", {
      name: "Expand activity selector",
    });
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");
    expect(expandButton.getAttribute("aria-controls")).toBe(
      "activity-selector-body",
    );
    expect(
      expandButton.querySelector(".activity-selector-toggle-label"),
    ).toBeNull();
    expect(expandButton.textContent?.trim()).toBe("");
    expect(expandButton.querySelector("svg")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Search synced activities" }),
    ).toBeNull();
    expect(
      document
        .querySelector(".activity-selector-heading")
        ?.getAttribute("hidden"),
    ).not.toBeNull();
    expect(screen.getByText("Activities")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(
      screen.queryByRole("list", { name: "Synced activities" }),
    ).toBeNull();
    expect(
      document
        .querySelector(".activity-dashboard-panel")
        ?.classList.contains("activity-selector-collapsed"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
  });

  it("keeps selected activity detail visible when collapsed and restores query/selection on expand", async () => {
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
            trainingEffect: null,
          },
          detail: {
            status: "available",
            hasHeartRate: false,
            hasElevation: false,
            hasLaps: false,
            recordCount: 0,
            lapCount: 0,
            unavailableReason: null,
          },
          charts: {
            downsampled: false,
            sourcePointCount: 0,
            pointCount: 0,
            maxPoints: 3,
            domainStartSec: 0,
            domainEndSec: 3600,
            timeScaleStatus: "elapsed",
            timeScaleMessage: null,
            speed: {
              status: "unavailable",
              sourcePointCount: 0,
              pointCount: 0,
              message: "no stream",
            },
            points: [],
          },
          route: {
            status: "unavailable",
            sourcePointCount: 0,
            pointCount: 0,
            maxPoints: 400,
            simplified: false,
            bounds: null,
            points: [],
            message: "Route unavailable.",
          },
          heartRateZones: {
            status: "unavailable",
            timeSource: null,
            zoneSource: null,
            zoneStatus: "unavailable",
            formula: null,
            classifiedSeconds: 0,
            unclassifiedSeconds: 0,
            noHeartRateSeconds: 0,
            activityDurationSec: 3600,
            sourceTotalSeconds: 0,
            message: "Unavailable.",
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
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    fireEvent.click(await screen.findByText("Morning Trail Run"));

    expect(await screen.findByText("Detail: available")).toBeTruthy();
    expect(screen.getByText("Duration")).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("Search activity name, sport, date, or Garmin ID"),
      { target: { value: "trail" } },
    );
    expect(screen.getByDisplayValue("trail")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse activity selector" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand activity selector" }),
    ).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText("Detail: available")).toBeTruthy();
    expect(screen.getByText("Duration")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand activity selector" }),
    );
    expect(screen.getByDisplayValue("trail")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Synced activities" }),
    ).toBeTruthy();
    expect(screen.getByText("Morning Trail Run")).toBeTruthy();
    expect(screen.getByText("Detail: available")).toBeTruthy();
    expect(screen.getByText("Duration")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Collapse activity selector" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
  });

  it("keeps the collapsed selector layout contract with detail space gains at desktop and narrow breakpoints", () => {
    const css = readFileSync("src/app/style.css", "utf8");
    const desktopCollapsed =
      css.match(
        /\.activity-dashboard-panel\.activity-selector-collapsed\s*\{([\s\S]*?)\}/,
      )?.[1] ?? "";
    expect(desktopCollapsed).toContain(
      "grid-template-columns: 48px minmax(0, 1fr);",
    );
    expect(css).toMatch(
      /\.activity-selector-collapsed \.activity-selector-body\s*\{\s*display: none;\s*}/,
    );
    expect(css).not.toContain(".activity-selector-toggle-label");
    expect(css).toMatch(
      /\.activity-selector-toggle\s*\{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/,
    );
    expect(css).toMatch(
      /\.activity-selector-collapsed \.activity-selector-heading\s*\{\s*display: none;\s*}/,
    );
    const tabletMediaBlock =
      css.match(
        /@media \(max-width: 960px\) \{([\s\S]*?)@media \(max-width: 640px\)/,
      )?.[1] ?? "";
    expect(tabletMediaBlock).toMatch(
      /\.activity-dashboard-panel\.activity-selector-collapsed\s*\{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\);\s*}/,
    );
    expect(tabletMediaBlock).toMatch(
      /\.activity-dashboard-panel\.activity-selector-collapsed\s*\{[\s\S]*?grid-template-columns: 1fr;/,
    );
    const mobileMediaBlock =
      css.match(/@media \(max-width: 640px\) \{([\s\S]*)$/)?.[1] ?? "";
    expect(mobileMediaBlock).toMatch(
      /\.activity-dashboard-panel\.activity-selector-collapsed\s*\{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\);\s*}/,
    );
    expect(mobileMediaBlock).toMatch(
      /\.activity-dashboard-panel\.activity-selector-collapsed\s*\{[\s\S]*?grid-template-columns: 1fr;/,
    );
  });
});

describe("TrainerDashboard dedicated Sync view", () => {
  it("opens Sync as navigation without starting a sync and renders metrics", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") return jsonResponse(importSummary());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));

    expect(
      screen.getByRole("heading", { name: "Sync", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Refresh metrics")).toBeNull();
    expect(screen.queryByText(/Import the latest Garmin data/)).toBeNull();
    expect(screen.queryByText(/Logs below are kept only/)).toBeNull();
    expect(screen.queryByText(/Import summary:/)).toBeNull();
    const metricsSection = screen.getByRole("region", {
      name: "Local Garmin coverage",
    });
    const metricLabels = Array.from(
      metricsSection.querySelectorAll("dt"),
      (term) => term.textContent,
    );
    expect(metricLabels.slice(0, 3)).toEqual([
      "Stored activities",
      "Athlete baseline",
      "Body metrics",
    ]);
    expect(metricLabels.slice(3)).toEqual([
      "Health coverage",
      "Detail coverage",
    ]);
    expect(screen.getByText("Stored activities")).toBeTruthy();
    expect(screen.getByText("247")).toBeTruthy();
    expect(screen.getByText("Health coverage")).toBeTruthy();
    const healthCoverageText = screen.getAllByText(
      /933 health calendar rows/,
    )[0].textContent;
    expect(healthCoverageText).toContain("13 source-unavailable");
    expect(healthCoverageText).toContain("pre-watch/pre-device");
    expect(healthCoverageText).toContain("not estimated");
    expect(screen.getByText("Detail coverage")).toBeTruthy();
    expect(
      screen.getAllByText(/230 available, 15 partial/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Athlete baseline")).toBeTruthy();
    expect(screen.getByText("Body metrics")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/sync" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("discloses weigh-in source and history source in Data & settings body-metrics rows", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") return jsonResponse(importSummary());
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Data & settings" }));

    const dialog = screen.getByRole("dialog", { name: "Data & settings" });
    expect(dialog.textContent).toContain(
      "current weight imported (75 kg, source: weigh-in)",
    );
    expect(dialog.textContent).toContain(
      "weight history 42 rows (2026-01-01 to 2026-07-22, source: weigh_in)",
    );
    expect(dialog.textContent).toContain("(source: latest weigh-in)");
    expect(dialog.textContent).toContain("Weigh-in status");
    expect(dialog.textContent).toContain("available");
  });

  it("streams from the internal Sync now action, auto-scrolls, and preserves logs across section navigation", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return (this.textContent ?? "").length;
      },
    );
    const stream = controlledSyncStream();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") return jsonResponse(importSummary());
      if (url.startsWith("/api/activities?")) {
        return jsonResponse({
          activities: [activityListItem(0)],
          nextOffset: null,
          totalApprox: 1,
          limit: 100,
          offset: 0,
        });
      }
      if (url === "/api/sync" && init?.method === "POST") {
        return stream.response;
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    const syncNowButton = screen.getByRole("button", {
      name: "Sync now — import latest Garmin data",
    });
    fireEvent.click(syncNowButton);

    await waitFor(() =>
      expect(syncNowButton.hasAttribute("disabled")).toBe(true),
    );
    expect(
      screen.getAllByText(/Sync already in progress/).length,
    ).toBeGreaterThan(0);

    stream.push({
      stage: "health",
      message: "Imported daily health 1/1: 2026-07-21.",
      activitiesImported: 247,
      healthDaysImported: 933,
    });

    await waitFor(() => {
      expect(
        screen.getByText(/health: Imported daily health 1\/1/).textContent,
      ).toContain("processed activity records 247, refreshed health dates 933");
      const syncLog = screen.getByLabelText(
        "Current sync progress log",
      ) as HTMLPreElement;
      expect(syncLog.scrollTop).toBe(syncLog.scrollHeight);
    });

    stream.push({
      type: "result",
      status: "completed",
      activitiesImported: 247,
      healthDaysImported: 933,
      detailsProcessed: 0,
      storedActivities: 247,
      storedHealthRows: 933,
      detail: "done",
    });
    stream.close();

    await waitFor(() =>
      expect(syncNowButton.hasAttribute("disabled")).toBe(false),
    );
    expect(screen.getAllByText(/Result: completed/).length).toBeGreaterThan(0);
    await waitFor(() => {
      const syncLog = screen.getByLabelText(
        "Current sync progress log",
      ) as HTMLPreElement;
      expect(syncLog.scrollTop).toBe(syncLog.scrollHeight);
    });
    expect(
      screen.getByText(/Sync complete\. Summary refreshed/).textContent,
    ).toContain("247 stored activities");
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/summary")
        .length,
    ).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(await screen.findByText("Activity 0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    expect(screen.getAllByText(/Result: completed/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/health: Imported daily health 1\/1/).length,
    ).toBeGreaterThan(0);
    const remountedSyncLog = screen.getByLabelText(
      "Current sync progress log",
    ) as HTMLPreElement;
    expect(remountedSyncLog.scrollTop).toBe(remountedSyncLog.scrollHeight);
  });

  it("keeps successful result copy concise and non-duplicative", async () => {
    const longDetail =
      "Garmin sync completed through the pinned stdio MCP connector with a very long paragraph that should not be repeated in the UI success result.";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") return jsonResponse(importSummary());
      if (url === "/api/sync" && init?.method === "POST") {
        return syncStreamResponse([
          {
            type: "result",
            status: "completed",
            activitiesProcessed: 12,
            healthDaysRefreshed: 8,
            detailsProcessed: 3,
            storedActivities: 247,
            storedHealthRows: 933,
            healthCoverage: importSummary().healthCoverage,
            detailCoverage: importSummary().detailCoverage,
            athleteBaseline: importSummary().athleteBaseline,
            bodyMetrics: importSummary().bodyMetrics,
            detail: longDetail,
          },
        ]);
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );

    await waitFor(() => {
      const log =
        screen.getByLabelText("Current sync progress log").textContent ?? "";
      expect(log).toContain("Result: completed");
      expect(log).toContain(
        "health coverage 900 complete, 20 partial, 13 source-unavailable",
      );
      expect(log).not.toContain(longDetail);
    });
    expect(
      screen.getByText(/Sync complete\. Summary refreshed/).textContent,
    ).not.toContain(longDetail);
  });

  it("uses clear activity-detail wording for detail Sync now progress", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/summary") return jsonResponse(importSummary());
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

    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sync now — import latest Garmin data",
      }),
    );

    await waitFor(() => {
      const statusText =
        screen.getByLabelText("Current sync progress log").textContent ?? "";
      expect(statusText).toContain("activity details 2/5");
      expect(statusText).not.toContain(", details 2/5");
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
    const memoryButton = screen.getByRole("button", { name: "Memory" });
    fireEvent.click(memoryButton);

    const memoryDialog = await screen.findByRole("dialog", { name: "Memory" });
    expect(memoryDialog).toBeTruthy();
    expect(await screen.findByText("Learned memory")).toBeTruthy();
    expect(container.querySelector(".memory-view-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
    expect(screen.getByRole("log", { name: "Chat transcript" })).toBeTruthy();
    const closeButton = within(memoryDialog).getByRole("button", {
      name: "Close",
    });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));
    expect(
      screen.queryByRole("dialog", { name: "Data & settings" }),
    ).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "Close memory" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Memory" })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(memoryButton));
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

  it("restores a scrolled-up transcript after returning from Activity charts", async () => {
    const animationFrames = captureAnimationFrames();
    const messages = Array.from({ length: 4 }, (_, index) => ({
      id: `assistant-${index}`,
      role: "assistant",
      content: `Activity return transcript line ${index}`,
      createdAt: `2026-07-17T12:0${index}:00Z`,
    }));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/training-plan")
        return jsonResponse({ plan: null, stale: true, staleAfterDays: 14 });
      if (url.startsWith("/api/activities?")) {
        return jsonResponse({
          activities: [],
          nextOffset: null,
          totalApprox: 0,
          limit: 100,
          offset: 0,
        });
      }
      if (url.startsWith("/api/chat")) {
        return jsonResponse({ ...emptyChat, messages, contextWindow: 4 });
      }
      return jsonResponse({ ok: true, conversations: [], memories: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      await screen.findByText("Activity return transcript line 3"),
    ).toBeTruthy();
    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1200,
      clientHeight: 200,
      scrollTop: 320,
    });
    fireEvent.scroll(transcript);

    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(
      await screen.findByRole("button", { name: "Back to chat" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

    const restoredTranscript = screen.getByRole("log", {
      name: "Chat transcript",
    });
    setTranscriptMetrics(restoredTranscript, {
      scrollHeight: 1200,
      clientHeight: 200,
      scrollTop: 0,
    });
    animationFrames.flush();

    expect(restoredTranscript.scrollTop).toBe(320);
  });

  it("restores a scrolled-up transcript after returning from Training Plan", async () => {
    const animationFrames = captureAnimationFrames();
    const messages = Array.from({ length: 4 }, (_, index) => ({
      id: `assistant-${index}`,
      role: "assistant",
      content: `Training Plan return transcript line ${index}`,
      createdAt: `2026-07-17T12:1${index}:00Z`,
    }));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/training-plan")
        return jsonResponse({ plan: null, stale: true, staleAfterDays: 14 });
      if (url.startsWith("/api/chat")) {
        return jsonResponse({ ...emptyChat, messages, contextWindow: 4 });
      }
      return jsonResponse({ ok: true, conversations: [], memories: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      await screen.findByText("Training Plan return transcript line 3"),
    ).toBeTruthy();
    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1400,
      clientHeight: 240,
      scrollTop: 450,
    });
    fireEvent.scroll(transcript);

    fireEvent.click(screen.getByRole("button", { name: "Training Plan" }));
    expect(
      await screen.findByRole("button", { name: "Back to chat" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

    const restoredTranscript = screen.getByRole("log", {
      name: "Chat transcript",
    });
    setTranscriptMetrics(restoredTranscript, {
      scrollHeight: 1400,
      clientHeight: 240,
      scrollTop: 0,
    });
    animationFrames.flush();

    expect(restoredTranscript.scrollTop).toBe(450);
  });

  it("keeps near-bottom users at the latest turn after section return", async () => {
    const animationFrames = captureAnimationFrames();
    const messages = Array.from({ length: 4 }, (_, index) => ({
      id: `assistant-${index}`,
      role: "assistant",
      content: `Near-bottom transcript line ${index}`,
      createdAt: `2026-07-17T12:2${index}:00Z`,
    }));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/training-plan")
        return jsonResponse({ plan: null, stale: true, staleAfterDays: 14 });
      if (url.startsWith("/api/chat")) {
        return jsonResponse({ ...emptyChat, messages, contextWindow: 4 });
      }
      return jsonResponse({ ok: true, conversations: [], memories: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(
      await screen.findByText("Near-bottom transcript line 3"),
    ).toBeTruthy();
    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    setTranscriptMetrics(transcript, {
      scrollHeight: 1200,
      clientHeight: 200,
      scrollTop: 930,
    });
    fireEvent.scroll(transcript);

    fireEvent.click(screen.getByRole("button", { name: "Training Plan" }));
    expect(
      await screen.findByRole("button", { name: "Back to chat" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

    const restoredTranscript = screen.getByRole("log", {
      name: "Chat transcript",
    });
    setTranscriptMetrics(restoredTranscript, {
      scrollHeight: 1600,
      clientHeight: 240,
      scrollTop: 0,
    });
    animationFrames.flush();

    expect(restoredTranscript.scrollTop).toBe(1600);
  });
});

describe("TrainerDashboard Training Plan section", () => {
  it("shows a new-chat suggestion when no Training Plan exists", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/training-plan")
        return jsonResponse({ plan: null, stale: true, staleAfterDays: 14 });
      return jsonResponse({ ok: true, conversations: [], memories: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    expect(await screen.findByText("No Training Plan saved yet.")).toBeTruthy();
    expect(screen.getByText(/Ask chat to create it/)).toBeTruthy();
  });

  it("opens Training Plan, renders safe Markdown, and supports manual save/cancel", async () => {
    let storedPlan = {
      title: "Summit base",
      contentMarkdown: "# Week 1\n- Easy hike\n[bad](javascript:alert(1))",
      revisedAt: "2026-08-01T09:00:00.000Z",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/training-plan" && (!init || init.method === "GET"))
        return jsonResponse({
          plan: storedPlan,
          stale: true,
          staleAfterDays: 14,
        });
      if (url === "/api/training-plan" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        storedPlan = {
          title: body.title,
          contentMarkdown: body.contentMarkdown,
          revisedAt: "2026-08-12T12:00:00.000Z",
        };
        return jsonResponse({ plan: storedPlan });
      }
      return jsonResponse({ ok: true, conversations: [], memories: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));

    fireEvent.click(
      await screen.findByRole("button", { name: "Training Plan" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Summit base" }),
    ).toBeTruthy();
    expect(screen.getByText("Week 1")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.getByText("bad")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Summit base"), {
      target: { value: "Revised base" },
    });
    fireEvent.change(screen.getByDisplayValue(/Easy hike/), {
      target: { value: "## Revised\n- Hill repeats" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByDisplayValue("Revised base")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("Summit base"), {
      target: { value: "Revised base" },
    });
    fireEvent.change(screen.getByDisplayValue(/Easy hike/), {
      target: { value: "## Revised\n- Hill repeats" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Revised base" }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Hill repeats")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/training-plan",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
