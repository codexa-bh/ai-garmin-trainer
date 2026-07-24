/** @vitest-environment jsdom */
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
    expect(screen.getByText(/Not medical advice/)).toBeTruthy();
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
              runningLactateThresholdHeartRateBpm: 168,
              cyclingLactateThresholdHeartRateBpm: null,
              rowingLactateThresholdHeartRateBpm: null,
              cyclingFtpWatts: 250,
              cyclingFtpMeasuredOn: "2026-07-19",
              cyclingFtpSourceStale: false,
              vo2MaxRunning: null,
              vo2MaxCycling: null,
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

    expect(await screen.findByText("Running threshold HR")).toBeTruthy();
    expect(screen.getByText("168 bpm")).toBeTruthy();
    expect(screen.getByText("250 W (2026-07-19)")).toBeTruthy();
    expect(
      screen.getByText("Unavailable from current Garmin source"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Running threshold HR")).toBeNull();
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
      expect(statusText).toContain("activities 247, health days 933");
      expect(statusText).not.toContain("details 0/0");
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
  it("renders semantic memory inspect/edit/delete controls", async () => {
    let patchedBody: unknown;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/chat")) return jsonResponse(emptyChat);
      if (url === "/api/profile") return jsonResponse(profile([]));
      if (url === "/api/memory" && init?.method === "PATCH") {
        patchedBody = JSON.parse(String(init.body));
        return jsonResponse({
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
          memories: [],
        });
      }
      if (url === "/api/memory")
        return jsonResponse({
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
          memories: [
            {
              id: "memory-one",
              kind: "saved_preference",
              text: "Prefers morning hikes",
              conversationId: "chat-1",
              updatedAt: "2026-07-17T12:00:00Z",
            },
            {
              id: "memory-two",
              kind: "saved_preference",
              text: "Likes easy recovery rides",
              updatedAt: "2026-07-17T12:00:00Z",
            },
          ],
        });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(TrainerDashboard));
    openSettings();

    expect(await screen.findByText("Learned memory")).toBeTruthy();
    expect(screen.getByText("Prefers morning hikes")).toBeTruthy();
    expect(screen.getByText("Likes easy recovery rides")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const editBox = screen.getByLabelText("Edit memory") as HTMLTextAreaElement;
    fireEvent.change(editBox, { target: { value: "Prefers sunrise hikes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    await waitFor(() =>
      expect(patchedBody).toMatchObject({
        id: "memory-one",
        action: "update",
        text: "Prefers sunrise hikes",
      }),
    );
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
